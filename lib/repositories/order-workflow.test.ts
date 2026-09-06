import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderWorkflowAccessScope } from '@/lib/auth/order-workflow-access';
import {
  D1OrderWorkflowRepository,
  OrderWorkflowAuditUnavailableError,
  OrderWorkflowClinicianRequiredError,
  OrderWorkflowConflictError,
  OrderWorkflowConsentRequiredError,
  OrderWorkflowLifecycleError,
  OrderWorkflowNotFoundError,
} from './order-workflow';

type TestBoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

const databases: DatabaseSync[] = [];

function applyMigrations(target: DatabaseSync) {
  target.exec('pragma foreign_keys = on');
  for (const fileName of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    target.exec(
      readFileSync(join('drizzle', fileName), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
  }
}

function d1Result<T>(results: T[], changes = 0) {
  return { success: true, results, meta: { changes } } as unknown as D1Result<T>;
}

function createD1Adapter(target: DatabaseSync): D1Database {
  const prepareBound = (
    sql: string,
    bindings: SQLInputValue[] = [],
  ): TestBoundStatement => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return prepareBound(sql, values as SQLInputValue[]) as unknown as D1PreparedStatement;
    },
    async first<T = unknown>(columnName?: string) {
      const row = target.prepare(sql).get(...bindings) as Record<string, T> | undefined;
      if (!row) return null;
      return columnName ? row[columnName] ?? null : (row as T);
    },
    async all<T = unknown>() {
      return d1Result(target.prepare(sql).all(...bindings) as T[]);
    },
    async run<T = unknown>() {
      const result = target.prepare(sql).run(...bindings);
      return d1Result<T>([], Number(result.changes));
    },
    async raw<T = unknown>() {
      return target
        .prepare(sql)
        .all(...bindings)
        .map((row) => Object.values(row as Record<string, unknown>)) as T[];
    },
  });

  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      target.exec('begin immediate');
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          results.push(await (statement as unknown as TestBoundStatement).run<T>());
        }
        target.exec('commit');
        return results;
      } catch (error) {
        target.exec('rollback');
        throw error;
      }
    },
    async exec(query: string) {
      target.exec(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      throw new Error('Sessions are not used in this test');
    },
    dump() {
      throw new Error('Dump is not used in this test');
    },
  } as unknown as D1Database;
}

function fixture(options: {
  role?: 'clinician' | 'registrar';
  careConsent?: boolean;
  assigned?: boolean;
} = {}) {
  const role = options.role ?? 'clinician';
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  const clinicianMembership = options.assigned === false ? 'membership-b' : 'membership-a';
  database.exec(`
    insert into organizations (id, name) values ('org-a', 'Clinic A');
    insert into facilities (id, organization_id, name)
      values ('fac-a', 'org-a', 'Facility A');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values
        ('user-a', 'openai:sites', 'doctor-a', 'Doctor A', 'active'),
        ('user-b', 'openai:sites', 'doctor-b', 'Doctor B', 'active');
    insert into memberships (id, organization_id, facility_id, user_id, role, status)
      values
        ('membership-a', 'org-a', 'fac-a', 'user-a', '${role}', 'active'),
        ('membership-b', 'org-a', 'fac-a', 'user-b', 'clinician', 'active');
    insert into departments (
      id, organization_id, facility_id, code, name, kind, status,
      created_at, updated_at, version
    ) values (
      'department-a', 'org-a', 'fac-a', 'therapy', 'Therapy', 'clinical',
      'active', 1000, 1000, 1
    );
    insert into department_versions (
      id, organization_id, facility_id, department_id, version,
      supersedes_version_id, name, kind, status, change_reason,
      changed_by_membership_id, changed_at, created_at
    ) values (
      'department-a-v1', 'org-a', 'fac-a', 'department-a', 1, null,
      'Therapy', 'clinical', 'active', 'synthetic department',
      'membership-b', 1000, 1000
    );
    insert into department_heads (
      id, organization_id, facility_id, department_id, current_version_id,
      lock_version, created_at, updated_at
    ) values (
      'department-a-head', 'org-a', 'fac-a', 'department-a',
      'department-a-v1', 1, 1000, 1000
    );
    insert into department_access_assignments (
      id, organization_id, facility_id, department_id, membership_id,
      created_by_membership_id, created_at
    ) values
      ('assignment-a', 'org-a', 'fac-a', 'department-a', 'membership-a',
       'membership-b', 1000),
      ('assignment-b', 'org-a', 'fac-a', 'department-a', 'membership-b',
       'membership-b', 1000);
    insert into department_access_assignment_versions (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, version, supersedes_version_id, status, source_type,
      roles_json, allow_permissions_json, deny_permissions_json,
      effective_from, effective_until, change_reason,
      changed_by_membership_id, changed_at, created_at
    ) values
      ('assignment-a-v1', 'org-a', 'fac-a', 'assignment-a', 'department-a',
       'membership-a', 1, null, 'active', 'bootstrap',
       '${role === 'clinician' ? '["doctor"]' : '["registrar"]'}',
       '[]', '[]', 1000, null, 'synthetic assignment',
       'membership-b', 1000, 1000),
      ('assignment-b-v1', 'org-a', 'fac-a', 'assignment-b', 'department-a',
       'membership-b', 1, null, 'active', 'bootstrap',
       '["doctor"]', '[]', '[]', 1000, null, 'synthetic assignment',
       'membership-b', 1000, 1000);
    insert into department_access_assignment_heads (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, current_version_id, lock_version, created_at, updated_at
    ) values
      ('assignment-a-head', 'org-a', 'fac-a', 'assignment-a', 'department-a',
       'membership-a', 'assignment-a-v1', 1, 1000, 1000),
      ('assignment-b-head', 'org-a', 'fac-a', 'assignment-b', 'department-a',
       'membership-b', 'assignment-b-v1', 1, 1000, 1000);
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name,
      birth_date, sex_at_birth, status
    ) values (
      'patient-a', 'org-a', 'fac-a', 'SYN-1001', 'Пациент Тестовый',
      '1988-06-20', 'male', 'active'
    );
    insert into encounters (
      id, organization_id, facility_id, patient_id, clinician_membership_id,
      status, reason_for_visit, started_at
    ) values (
      'encounter-a', 'org-a', 'fac-a', 'patient-a', '${clinicianMembership}',
      'in_progress', 'Контрольное обследование', 1787902200000
    );
    insert into audit_stream_heads (
      id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
    ) values ('audit-head-a', 'org-a', 'fac-a', 0, null, 1);
  `);
  if (options.careConsent !== false) {
    const now = Date.now() - 1_000;
    database.prepare(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at
      ) values (
        'consent-care-v1', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 1,
        'care', 'granted', 'membership-b', 'test-v1',
        '23d23241bbdf590681ef18941576e994598e84124c5bd25dc99b9fe209ee238e',
        'ru', 'verbal', ?, ?
      )
    `).run(now, now);
    database.exec(`
      insert into consent_heads (
        id, organization_id, facility_id, patient_id, encounter_id,
        consent_type, current_consent_event_id, lock_version
      ) values (
        'consent-head-care', 'org-a', 'fac-a', 'patient-a', 'encounter-a',
        'care', 'consent-care-v1', 1
      );
    `);
  }
  const scope: OrderWorkflowAccessScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    userId: 'user-a',
    membershipId: 'membership-a',
    accessAssignmentId: 'assignment-a',
    role,
  };
  const d1 = createD1Adapter(database);
  return {
    database,
    d1,
    scope,
    repository: new D1OrderWorkflowRepository(d1, scope),
  };
}

const createInput = {
  encounterId: 'encounter-a',
  kind: 'laboratory' as const,
  priority: 'urgent' as const,
  requestedService: 'Гликированный гемоглобин HbA1c',
  targetSpecialty: null,
  medicalJustification: 'Уточнение нарушений углеводного обмена по жалобам пациента',
  clinicianNote: 'Выполнить натощак',
  idempotencyKey: '00000000-0000-4000-8000-000000000101',
  requestId: 'http-create-order',
};

const artifact = {
  id: 'artifact-a',
  objectKey: 'org-a/fac-a/results/artifact-a.pdf',
  fileName: 'hba1c-test.pdf',
  mimeType: 'application/pdf' as const,
  sha256: 'a'.repeat(64),
  byteSize: 128,
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 order workflow', () => {
  it('creates a draft, requires separate approval, reviews a result and completes', async () => {
    const { database, repository } = fixture();
    const draft = await repository.createDraft(createInput);
    expect(draft.current).toMatchObject({ status: 'draft', version: 1 });
    expect(draft.report).toBeNull();

    await expect(
      repository.transition({
        requestIdValue: draft.id,
        action: 'complete',
        reason: 'Попытка преждевременного завершения',
        expectedVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000102',
        requestId: 'http-complete-early',
      }),
    ).rejects.toBeInstanceOf(OrderWorkflowLifecycleError);

    const active = await repository.transition({
      requestIdValue: draft.id,
      action: 'approve',
      reason: 'Показания и сведения проверены врачом',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000103',
      requestId: 'http-approve',
    });
    expect(active.current).toMatchObject({
      status: 'active',
      version: 2,
      approvedBy: 'Doctor A',
    });

    const withResult = await repository.attachResult({
      requestIdValue: draft.id,
      reportStatus: 'final',
      conclusion: 'HbA1c 6,8 %. Результат требует клинической интерпретации.',
      changeReason: 'Получен финальный лабораторный результат',
      expectedReportVersion: 0,
      artifact,
      idempotencyKey: '00000000-0000-4000-8000-000000000104',
      requestId: 'http-attach-result',
    });
    expect(withResult.report?.current).toMatchObject({
      version: 1,
      reportStatus: 'final',
      reviewState: 'pending',
    });
    expect(withResult.canComplete).toBe(false);

    const reviewed = await repository.reviewResult({
      requestIdValue: draft.id,
      decision: 'reviewed',
      note: null,
      expectedReportVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000105',
      requestId: 'http-review-result',
    });
    expect(reviewed.report?.current).toMatchObject({
      version: 2,
      reportStatus: 'final',
      reviewState: 'reviewed',
      reviewedBy: 'Doctor A',
    });
    expect(reviewed.canComplete).toBe(true);

    const completed = await repository.transition({
      requestIdValue: draft.id,
      action: 'complete',
      reason: 'Финальный результат проверен и учтён врачом',
      expectedVersion: 2,
      idempotencyKey: '00000000-0000-4000-8000-000000000106',
      requestId: 'http-complete',
    });
    expect(completed.current).toMatchObject({ status: 'completed', version: 3 });
    expect(completed.history.map((entry) => entry.status)).toEqual([
      'completed',
      'active',
      'draft',
    ]);
    expect(
      database.prepare('select count(*) as count from audit_events').get(),
    ).toEqual({ count: 5 });
    expect(
      database
        .prepare(`
          select count(*) as count
          from command_idempotency
          where access_assignment_id = 'assignment-a'
        `)
        .get(),
    ).toEqual({ count: 5 });
  });

  it('replays an exact command and rejects stale versions', async () => {
    const { database, repository } = fixture();
    const first = await repository.createDraft(createInput);
    const approvalInput = {
      requestIdValue: first.id,
      action: 'approve',
      reason: 'Проверено врачом перед отправкой',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000110',
      requestId: 'http-approve-once',
    } as const;
    await repository.transition(approvalInput);
    await repository.transition({
      requestIdValue: first.id,
      action: 'hold',
      reason: 'Ожидается дополнительная информация',
      expectedVersion: 2,
      idempotencyKey: '00000000-0000-4000-8000-000000000112',
      requestId: 'http-hold-after-approve',
    });
    database.exec(`
      update patients set display_name = 'Пациент Изменённый' where id = 'patient-a';
      update encounters
      set status = 'review', version = version + 1, updated_at = updated_at + 1
      where id = 'encounter-a';
      update encounters set reason_for_visit = 'Изменённая причина'
      where id = 'encounter-a';
    `);

    const createReplay = await repository.createDraft(createInput);
    expect(createReplay).toMatchObject({
      id: first.id,
      patient: { displayName: 'Пациент Тестовый' },
      encounter: {
        status: 'in_progress',
        reasonForVisit: 'Контрольное обследование',
      },
      current: { status: 'draft', version: 1 },
      history: [{ status: 'draft', version: 1 }],
      report: null,
    });
    const approvalReplay = await repository.transition(approvalInput);
    expect(approvalReplay).toMatchObject({
      id: first.id,
      current: { status: 'active', version: 2 },
    });
    expect(approvalReplay.history.map((entry) => entry.status)).toEqual([
      'active',
      'draft',
    ]);
    expect(
      database.prepare('select count(*) as count from service_requests').get(),
    ).toEqual({ count: 1 });
    await expect(
      repository.transition({
        requestIdValue: first.id,
        action: 'hold',
        reason: 'Нужна дополнительная информация',
        expectedVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000111',
        requestId: 'http-hold-stale',
      }),
    ).rejects.toMatchObject({
      currentVersion: 3,
      resource: 'request',
    });
  });

  it('collapses concurrent exact creates into one committed request', async () => {
    const { database, repository } = fixture();
    const [left, right] = await Promise.all([
      repository.createDraft({
        ...createInput,
        idempotencyKey: '00000000-0000-4000-8000-000000000115',
      }),
      repository.createDraft({
        ...createInput,
        idempotencyKey: '00000000-0000-4000-8000-000000000115',
      }),
    ]);

    expect(left.id).toBe(right.id);
    expect(left.current.version).toBe(1);
    expect(right.current.version).toBe(1);
    expect(
      database.prepare('select count(*) as count from service_requests').get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare('select count(*) as count from command_idempotency').get(),
    ).toEqual({ count: 1 });
  });

  it('fails closed for registrar, unassigned encounter and missing consent', async () => {
    await expect(fixture({ role: 'registrar' }).repository.list()).rejects.toBeInstanceOf(
      OrderWorkflowClinicianRequiredError,
    );
    await expect(
      fixture({ assigned: false }).repository.createDraft(createInput),
    ).rejects.toBeInstanceOf(OrderWorkflowNotFoundError);
    await expect(
      fixture({ careConsent: false }).repository.createDraft(createInput),
    ).rejects.toBeInstanceOf(OrderWorkflowConsentRequiredError);
  });

  it('records reconciliation as an immutable successor', async () => {
    const { repository } = fixture();
    const draft = await repository.createDraft(createInput);
    await repository.transition({
      requestIdValue: draft.id,
      action: 'approve',
      reason: 'Подтверждено врачом',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000120',
      requestId: 'http-approve-reconcile',
    });
    await repository.attachResult({
      requestIdValue: draft.id,
      reportStatus: 'preliminary',
      conclusion: 'Предварительное заключение',
      changeReason: 'Получен предварительный результат',
      expectedReportVersion: 0,
      artifact,
      idempotencyKey: '00000000-0000-4000-8000-000000000121',
      requestId: 'http-attach-preliminary',
    });
    const reconciled = await repository.reviewResult({
      requestIdValue: draft.id,
      decision: 'needs_reconciliation',
      note: 'ФИО в документе не совпадает с карточкой пациента',
      expectedReportVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000122',
      requestId: 'http-reconcile',
    });
    expect(reconciled.report?.history).toHaveLength(2);
    expect(reconciled.report?.current).toMatchObject({
      reviewState: 'needs_reconciliation',
      reconciliationNote: 'ФИО в документе не совпадает с карточкой пациента',
    });
    await expect(
      repository.reviewResult({
        requestIdValue: draft.id,
        decision: 'reviewed',
        note: null,
        expectedReportVersion: 2,
        idempotencyKey: '00000000-0000-4000-8000-000000000123',
        requestId: 'http-reconcile-bypass',
      }),
    ).rejects.toBeInstanceOf(OrderWorkflowLifecycleError);
  });

  it('blocks result review after the service request becomes terminal', async () => {
    const { repository } = fixture();
    const draft = await repository.createDraft({
      ...createInput,
      idempotencyKey: '00000000-0000-4000-8000-000000000124',
    });
    await repository.transition({
      requestIdValue: draft.id,
      action: 'approve',
      reason: 'Подтверждено врачом',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000125',
      requestId: 'http-terminal-review-approve',
    });
    await repository.attachResult({
      requestIdValue: draft.id,
      reportStatus: 'final',
      conclusion: 'Синтетический финальный результат',
      changeReason: 'Получен синтетический результат',
      expectedReportVersion: 0,
      artifact: { ...artifact, id: 'artifact-terminal-review' },
      idempotencyKey: '00000000-0000-4000-8000-000000000126',
      requestId: 'http-terminal-review-upload',
    });
    await repository.transition({
      requestIdValue: draft.id,
      action: 'revoke',
      reason: 'Направление отозвано врачом',
      expectedVersion: 2,
      idempotencyKey: '00000000-0000-4000-8000-000000000127',
      requestId: 'http-terminal-review-revoke',
    });

    await expect(
      repository.reviewResult({
        requestIdValue: draft.id,
        decision: 'reviewed',
        note: null,
        expectedReportVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000128',
        requestId: 'http-terminal-review-attempt',
      }),
    ).rejects.toBeInstanceOf(OrderWorkflowLifecycleError);
  });

  it('reserves a result upload before persistence and rejects changed bytes under the same key', async () => {
    const { database, repository } = fixture();
    const draft = await repository.createDraft(createInput);
    await repository.transition({
      requestIdValue: draft.id,
      action: 'approve',
      reason: 'Подтверждено врачом',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000130',
      requestId: 'http-approve-upload-reservation',
    });
    const input = {
      requestIdValue: draft.id,
      reportStatus: 'final' as const,
      conclusion: 'Финальный синтетический результат',
      changeReason: 'Получен финальный результат',
      expectedReportVersion: 0,
      artifact,
      idempotencyKey: '00000000-0000-4000-8000-000000000131',
      requestId: 'http-reserve-result',
    };
    const reservation = await repository.reserveResultUpload(input);
    expect(reservation.kind).toBe('reserved');
    expect(
      database.prepare(`select status from command_idempotency where idempotency_key = ?`).get(
        input.idempotencyKey,
      ),
    ).toEqual({ status: 'processing' });

    await expect(
      repository.reserveResultUpload({
        ...input,
        artifact: { ...artifact, sha256: 'b'.repeat(64) },
      }),
    ).rejects.toBeInstanceOf(OrderWorkflowConflictError);
    expect(
      database.prepare('select count(*) as count from diagnostic_reports').get(),
    ).toEqual({ count: 0 });

    if (reservation.kind !== 'reserved') throw new Error('Expected reservation');
    await repository.markResultUploadObjectStored(reservation.commandId);
    expect(
      database
        .prepare(`
          select status, object_key as objectKey
          from diagnostic_result_upload_intents where command_id = ?
        `)
        .get(reservation.commandId),
    ).toMatchObject({ status: 'object_stored', objectKey: artifact.objectKey });
    const committed = await repository.commitReservedResult(
      input,
      reservation.commandId,
    );
    expect(committed.report?.current).toMatchObject({
      version: 1,
      reviewState: 'pending',
    });
    await repository.reviewResult({
      requestIdValue: draft.id,
      decision: 'reviewed',
      note: null,
      expectedReportVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000132',
      requestId: 'http-review-after-reservation',
    });
    const replay = await repository.reserveResultUpload(input);
    expect(replay.kind).toBe('replayed');
    if (replay.kind === 'replayed') {
      expect(replay.record.report?.current).toMatchObject({
        version: 1,
        reviewState: 'pending',
      });
      expect(replay.record.report?.history).toHaveLength(1);
    }
    expect(
      database
        .prepare('select status from diagnostic_result_upload_intents where command_id = ?')
        .get(reservation.commandId),
    ).toEqual({ status: 'committed' });
  });

  it('reconciles an expired stored object through an audited cleanup state', async () => {
    const { database, repository } = fixture();
    const draft = await repository.createDraft({
      ...createInput,
      idempotencyKey: '00000000-0000-4000-8000-000000000133',
    });
    await repository.transition({
      requestIdValue: draft.id,
      action: 'approve',
      reason: 'Подтверждено врачом',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000134',
      requestId: 'http-cleanup-approve',
    });
    const input = {
      requestIdValue: draft.id,
      reportStatus: 'final' as const,
      conclusion: 'Синтетический незавершённый результат',
      changeReason: 'Проверка очистки загрузки',
      expectedReportVersion: 0,
      artifact: { ...artifact, id: 'artifact-expired-upload' },
      idempotencyKey: '00000000-0000-4000-8000-000000000135',
      requestId: 'http-cleanup-reserve',
    };
    const reservation = await repository.reserveResultUpload(input);
    if (reservation.kind !== 'reserved') throw new Error('Expected reservation');
    await repository.markResultUploadObjectStored(reservation.commandId);

    const expired = await repository.listExpiredResultUploads({
      before: Date.now() + 1,
    });
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      commandId: reservation.commandId,
      status: 'object_stored',
      objectKey: artifact.objectKey,
    });

    const pending = await repository.beginResultUploadCleanup({
      commandId: reservation.commandId,
      failureCode: 'UPLOAD_RESERVATION_EXPIRED',
      requestId: 'http-cleanup-start',
    });
    expect(pending).toMatchObject({ status: 'cleanup_pending' });
    expect(
      database.prepare('select status from command_idempotency where id = ?').get(
        reservation.commandId,
      ),
    ).toEqual({ status: 'failed' });

    const cleaned = await repository.completeResultUploadCleanup({
      commandId: reservation.commandId,
      requestId: 'http-cleanup-complete',
    });
    expect(cleaned).toMatchObject({
      status: 'cleaned',
      failureCode: 'UPLOAD_RESERVATION_EXPIRED',
    });
    await expect(repository.reserveResultUpload(input)).rejects.toBeInstanceOf(
      OrderWorkflowConflictError,
    );
  });

  it('retries artifact-read audit contention and fails closed after exhaustion', async () => {
    const { d1, repository, scope } = fixture();
    const draft = await repository.createDraft({
      ...createInput,
      idempotencyKey: '00000000-0000-4000-8000-000000000136',
    });
    await repository.transition({
      requestIdValue: draft.id,
      action: 'approve',
      reason: 'Подтверждено врачом',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000137',
      requestId: 'http-audit-retry-approve',
    });
    await repository.attachResult({
      requestIdValue: draft.id,
      reportStatus: 'final',
      conclusion: 'Синтетический результат для проверки аудита',
      changeReason: 'Проверка конкурентного чтения',
      expectedReportVersion: 0,
      artifact: { ...artifact, id: 'artifact-audit-retry' },
      idempotencyKey: '00000000-0000-4000-8000-000000000138',
      requestId: 'http-audit-retry-upload',
    });

    const flakyDatabase = (failures: number) => {
      let remaining = failures;
      return {
        ...d1,
        async batch<T = unknown>(statements: D1PreparedStatement[]) {
          const isArtifactRead = statements.some((statement) =>
            (statement as unknown as TestBoundStatement).bindings.includes(
              'diagnostic_report.artifact.read',
            ),
          );
          if (isArtifactRead && remaining > 0) {
            remaining -= 1;
            throw new Error('synthetic audit head contention');
          }
          return d1.batch<T>(statements);
        },
      } as D1Database;
    };

    await expect(
      new D1OrderWorkflowRepository(flakyDatabase(2), scope).recordArtifactRead({
        requestIdValue: draft.id,
        artifactId: 'artifact-audit-retry',
        requestId: 'http-audit-read-retry',
      }),
    ).resolves.toBeUndefined();
    await expect(
      new D1OrderWorkflowRepository(flakyDatabase(3), scope).recordArtifactRead({
        requestIdValue: draft.id,
        artifactId: 'artifact-audit-retry',
        requestId: 'http-audit-read-exhausted',
      }),
    ).rejects.toBeInstanceOf(OrderWorkflowAuditUnavailableError);
  });

  it('blocks mutations when the patient card is archived while preserving reads', async () => {
    const { database, repository } = fixture();
    const draft = await repository.createDraft(createInput);
    database.exec(`update patients set status = 'inactive' where id = 'patient-a';`);

    expect((await repository.get(draft.id))?.current.status).toBe('draft');
    await expect(
      repository.transition({
        requestIdValue: draft.id,
        action: 'approve',
        reason: 'Недопустимое изменение архивной карточки',
        expectedVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000140',
        requestId: 'http-archived-patient-order',
      }),
    ).rejects.toBeInstanceOf(OrderWorkflowLifecycleError);
  });

  it('enforces immutable identities, versions and linear heads in SQLite', async () => {
    const { database, repository } = fixture();
    const draft = await repository.createDraft(createInput);
    expect(() =>
      database.prepare(`update service_request_versions set status = 'active' where service_request_id = ?`).run(draft.id),
    ).toThrow('service request versions are immutable');
    expect(() =>
      database.prepare('delete from service_requests where id = ?').run(draft.id),
    ).toThrow('service requests cannot be deleted');
    expect(() =>
      database.prepare(`update service_request_heads set lock_version = 9 where service_request_id = ?`).run(draft.id),
    ).toThrow('service request head must advance by one immutable version');
  });

  it('does not let a legacy clinician role bypass orders.manage assignment guards', () => {
    const { database } = fixture();
    database.exec(`
      insert into users (id, external_issuer, external_subject, display_name, status)
      values ('user-legacy', 'openai:sites', 'legacy-doctor', 'Legacy Doctor', 'active');
      insert into memberships (
        id, organization_id, facility_id, user_id, role, status
      ) values (
        'membership-legacy', 'org-a', 'fac-a', 'user-legacy', 'clinician', 'active'
      );
      insert into encounters (
        id, organization_id, facility_id, patient_id, clinician_membership_id,
        status, reason_for_visit, started_at
      ) values (
        'encounter-legacy', 'org-a', 'fac-a', 'patient-a',
        'membership-legacy', 'in_progress', 'Legacy guard check', 1787902200000
      );
    `);

    expect(() =>
      database.exec(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          access_assignment_id, operation, idempotency_key, request_hash,
          status, created_at
        ) values (
          'command-legacy', 'org-a', 'fac-a', 'membership-legacy',
          null, 'order.create', 'legacy-key', '${'a'.repeat(64)}',
          'processing', 1788685000000
        );
      `),
    ).toThrow(/selected current doctor orders\.manage assignment/i);

    expect(() =>
      database.exec(`
        insert into service_requests (
          id, organization_id, facility_id, patient_id, encounter_id,
          request_kind, created_by_membership_id, created_at
        ) values (
          'service-request-legacy', 'org-a', 'fac-a', 'patient-a',
          'encounter-legacy', 'laboratory', 'membership-legacy', 1788685000000
        );
      `),
    ).toThrow(/exact current doctor assignment/i);

    expect(() =>
      database.exec(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          access_assignment_id, operation, idempotency_key, request_hash,
          status, created_at
        ) values (
          'command-cross-assignment', 'org-a', 'fac-a', 'membership-legacy',
          'assignment-a', 'order.create', 'cross-assignment-key',
          '${'b'.repeat(64)}', 'processing', 1788685000000
        );
      `),
    ).toThrow(/selected current doctor orders\.manage assignment/i);
  });

  it('keeps doctor-only SQL mutations closed to a non-doctor explicit grant', () => {
    const { database } = fixture();
    database.exec(`
      insert into users (id, external_issuer, external_subject, display_name, status)
      values ('user-nurse', 'openai:sites', 'nurse-a', 'Nurse A', 'active');
      insert into memberships (
        id, organization_id, facility_id, user_id, role, status
      ) values (
        'membership-nurse', 'org-a', 'fac-a', 'user-nurse', 'clinician', 'active'
      );
      insert into department_access_assignments (
        id, organization_id, facility_id, department_id, membership_id,
        created_by_membership_id, created_at
      ) values (
        'assignment-nurse', 'org-a', 'fac-a', 'department-a',
        'membership-nurse', 'membership-b', 1000
      );
      insert into department_access_assignment_versions (
        id, organization_id, facility_id, assignment_id, department_id,
        membership_id, version, supersedes_version_id, status, source_type,
        roles_json, allow_permissions_json, deny_permissions_json,
        effective_from, effective_until, change_reason,
        changed_by_membership_id, changed_at, created_at
      ) values (
        'assignment-nurse-v1', 'org-a', 'fac-a', 'assignment-nurse',
        'department-a', 'membership-nurse', 1, null, 'active',
        'bootstrap', '["nurse"]', '["orders.manage"]', '[]',
        1000, null, 'Synthetic explicit grant check',
        'membership-b', 1000, 1000
      );
      insert into department_access_assignment_heads (
        id, organization_id, facility_id, assignment_id, department_id,
        membership_id, current_version_id, lock_version, created_at, updated_at
      ) values (
        'assignment-nurse-head', 'org-a', 'fac-a', 'assignment-nurse',
        'department-a', 'membership-nurse', 'assignment-nurse-v1',
        1, 1000, 1000
      );
    `);

    expect(() =>
      database.exec(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          access_assignment_id, operation, idempotency_key, request_hash,
          status, created_at
        ) values (
          'command-nurse', 'org-a', 'fac-a', 'membership-nurse',
          'assignment-nurse', 'order.create', 'nurse-explicit-key',
          '${'c'.repeat(64)}', 'processing', 1788685000000
        );
      `),
    ).toThrow(/selected current doctor orders\.manage assignment/i);
  });

  it('does not let another authorized doctor write into a treating clinician encounter', () => {
    const { database } = fixture();

    expect(() =>
      database.exec(`
        insert into service_requests (
          id, organization_id, facility_id, patient_id, encounter_id,
          request_kind, created_by_membership_id, access_assignment_id,
          created_at
        ) values (
          'service-request-cross-clinician', 'org-a', 'fac-a', 'patient-a',
          'encounter-a', 'laboratory', 'membership-b', 'assignment-b',
          1788685000000
        );
      `),
    ).toThrow(/exact current doctor assignment and treating encounter/i);
  });

  it('keeps the selected assignment immutable after a command starts', async () => {
    const { database, repository } = fixture();
    await repository.createDraft({
      ...createInput,
      idempotencyKey: '00000000-0000-4000-8000-000000000151',
    });

    expect(() =>
      database.exec(`
        update command_idempotency
        set access_assignment_id = 'assignment-b'
        where operation = 'order.create'
          and idempotency_key = '00000000-0000-4000-8000-000000000151';
      `),
    ).toThrow(/command access assignment is immutable/i);
  });

  it('does not allow a doctor to attribute approval to another membership', async () => {
    const { database, repository } = fixture();
    const draft = await repository.createDraft({
      ...createInput,
      idempotencyKey: '00000000-0000-4000-8000-000000000152',
    });
    const now = Date.now();

    expect(() =>
      database.prepare(`
        insert into service_request_versions (
          id, organization_id, facility_id, service_request_id, version,
          supersedes_version_id, status, priority, requested_service,
          target_specialty, medical_justification, clinician_note,
          status_reason, authored_by_membership_id, access_assignment_id,
          approved_by_membership_id, approved_at, created_at
        ) values (
          'spoofed-order-approval', 'org-a', 'fac-a', ?, 2, ?, 'active',
          'urgent', 'Synthetic approval impersonation check', null,
          'Synthetic medical justification for access guard', null,
          'Spoofed approval', 'membership-a', 'assignment-a',
          'membership-b', ?, ?
        )
      `).run(draft.id, draft.current.id, now, now),
    ).toThrow(/service request version requires exact current doctor assignment/i);
  });

  it('uses current time so an expired assignment cannot be revived by backdating', () => {
    const { database } = fixture();
    database.exec(`
      insert into department_access_assignment_versions (
        id, organization_id, facility_id, assignment_id, department_id,
        membership_id, version, supersedes_version_id, status, source_type,
        roles_json, allow_permissions_json, deny_permissions_json,
        effective_from, effective_until, change_reason,
        changed_by_membership_id, changed_at, created_at
      ) values (
        'assignment-b-v2-expired', 'org-a', 'fac-a', 'assignment-b',
        'department-a', 'membership-b', 2, 'assignment-b-v1', 'active',
        'bootstrap', '["doctor"]', '[]', '[]', 1000, 2000,
        'Synthetic expired assignment', 'membership-b', 1500, 1500
      );
      update department_access_assignment_heads
      set current_version_id = 'assignment-b-v2-expired', lock_version = 2,
        updated_at = 1500
      where id = 'assignment-b-head' and lock_version = 1;
    `);

    expect(() =>
      database.exec(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          access_assignment_id, operation, idempotency_key, request_hash,
          status, created_at
        ) values (
          'command-expired-backdated', 'org-a', 'fac-a', 'membership-b',
          'assignment-b', 'order.create', 'expired-backdated-key',
          '${'d'.repeat(64)}', 'processing', 1500
        );
      `),
    ).toThrow(/selected current doctor orders\.manage assignment/i);
  });
});
