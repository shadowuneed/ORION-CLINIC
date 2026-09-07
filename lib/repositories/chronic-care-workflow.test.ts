import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChronicCarePermissionRequiredError,
  type ChronicCareScope,
} from '@/lib/auth/chronic-care-access';
import {
  D1ChronicCareWorkflowRepository,
  ChronicCareConflictError,
  ChronicCareNotFoundError,
  ChronicCareVersionConflictError,
} from './chronic-care-workflow';

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
const clinicianScope: ChronicCareScope = {
  organizationId: 'org-a',
  facilityId: 'fac-a',
  userId: 'user-doctor',
  membershipId: 'membership-doctor',
  accessAssignmentId: 'assignment-doctor',
  role: 'clinician',
};
const nurseScope: ChronicCareScope = {
  organizationId: 'org-a',
  facilityId: 'fac-a',
  userId: 'user-nurse',
  membershipId: 'membership-nurse',
  accessAssignmentId: 'assignment-nurse',
  role: 'nurse',
};
const uuid = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

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
  let batchTail: Promise<void> = Promise.resolve();
  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const previous = batchTail;
      let release!: () => void;
      batchTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      target.exec('begin immediate');
      try {
        const results = statements.map((statement) => {
          const bound = statement as unknown as TestBoundStatement;
          const result = target.prepare(bound.sql).run(...bound.bindings);
          return d1Result<T>([], Number(result.changes));
        });
        target.exec('commit');
        return results;
      } catch (error) {
        target.exec('rollback');
        throw error;
      } finally {
        release();
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

function createFixture() {
  const target = new DatabaseSync(':memory:');
  databases.push(target);
  applyMigrations(target);
  target.exec(`
    insert into organizations (id, name, status) values
      ('org-a', 'Synthetic Clinic', 'active'),
      ('org-b', 'Other Synthetic Clinic', 'active');
    insert into facilities (id, organization_id, name, timezone, status) values
      ('fac-a', 'org-a', 'Main', 'Asia/Almaty', 'active'),
      ('fac-b', 'org-b', 'Other', 'Asia/Almaty', 'active');
    insert into users (id, external_issuer, external_subject, display_name, status) values
      ('user-doctor', 'test', 'doctor', 'Врач Тестовый', 'active'),
      ('user-nurse', 'test', 'nurse', 'Медсестра Тестовая', 'active'),
      ('user-other', 'test', 'other', 'Другой врач', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values
      ('membership-doctor', 'org-a', 'fac-a', 'user-doctor', 'clinician', 'active'),
      ('membership-nurse', 'org-a', 'fac-a', 'user-nurse', 'nurse', 'active'),
      ('membership-other', 'org-b', 'fac-b', 'user-other', 'clinician', 'active');
    insert into departments (
      id, organization_id, facility_id, code, name, kind, status
    ) values
      ('department-a', 'org-a', 'fac-a', 'care', 'Наблюдение', 'clinical', 'active'),
      ('department-b', 'org-b', 'fac-b', 'care', 'Наблюдение', 'clinical', 'active');
    insert into department_versions (
      id, organization_id, facility_id, department_id, version, name,
      kind, status, change_reason, changed_by_membership_id, changed_at, created_at
    ) values
      ('department-a-v1', 'org-a', 'fac-a', 'department-a', 1,
       'Наблюдение', 'clinical', 'active', 'Тестовый отдел',
       'membership-doctor', 1, 1),
      ('department-b-v1', 'org-b', 'fac-b', 'department-b', 1,
       'Наблюдение', 'clinical', 'active', 'Тестовый отдел',
       'membership-other', 1, 1);
    insert into department_heads (
      id, organization_id, facility_id, department_id, current_version_id,
      lock_version, created_at, updated_at
    ) values
      ('department-a-head', 'org-a', 'fac-a', 'department-a',
       'department-a-v1', 1, 1, 1),
      ('department-b-head', 'org-b', 'fac-b', 'department-b',
       'department-b-v1', 1, 1, 1);
    insert into department_access_assignments (
      id, organization_id, facility_id, department_id, membership_id,
      created_by_membership_id, created_at
    ) values
      ('assignment-doctor', 'org-a', 'fac-a', 'department-a',
       'membership-doctor', 'membership-doctor', 1),
      ('assignment-nurse', 'org-a', 'fac-a', 'department-a',
       'membership-nurse', 'membership-doctor', 1),
      ('assignment-other', 'org-b', 'fac-b', 'department-b',
       'membership-other', 'membership-other', 1);
    insert into department_access_assignment_versions (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, version, status, source_type, roles_json,
      allow_permissions_json, deny_permissions_json, effective_from,
      change_reason, changed_by_membership_id, changed_at, created_at
    ) values
      ('assignment-doctor-v1', 'org-a', 'fac-a', 'assignment-doctor',
       'department-a', 'membership-doctor', 1, 'active', 'bootstrap', '["doctor"]',
       '[]', '[]', 1, 'Тестовое назначение врача', 'membership-doctor', 1, 1),
      ('assignment-nurse-v1', 'org-a', 'fac-a', 'assignment-nurse',
       'department-a', 'membership-nurse', 1, 'active', 'bootstrap', '["nurse"]',
       '[]', '[]', 1, 'Тестовое назначение медсестры', 'membership-doctor', 1, 1),
      ('assignment-other-v1', 'org-b', 'fac-b', 'assignment-other',
       'department-b', 'membership-other', 1, 'active', 'bootstrap', '["doctor"]',
       '[]', '[]', 1, 'Тестовое назначение врача', 'membership-other', 1, 1);
    insert into department_access_assignment_heads (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, current_version_id, lock_version, created_at, updated_at
    ) values
      ('assignment-doctor-head', 'org-a', 'fac-a', 'assignment-doctor',
       'department-a', 'membership-doctor', 'assignment-doctor-v1', 1, 1, 1),
      ('assignment-nurse-head', 'org-a', 'fac-a', 'assignment-nurse',
       'department-a', 'membership-nurse', 'assignment-nurse-v1', 1, 1, 1),
      ('assignment-other-head', 'org-b', 'fac-b', 'assignment-other',
       'department-b', 'membership-other', 'assignment-other-v1', 1, 1, 1);
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name, status
    ) values ('patient-a', 'org-a', 'fac-a', 'SYN-CARE-01', 'Пациент Тестовый', 'active');
    insert into encounters (
      id, organization_id, facility_id, patient_id, clinician_membership_id,
      status, reason_for_visit
    ) values (
      'encounter-a', 'org-a', 'fac-a', 'patient-a', 'membership-doctor',
      'finalized', 'Синтетический эндокринологический приём'
    );
    insert into protocol_versions (
      id, organization_id, facility_id, encounter_id, version, status,
      content_json, source_hash, created_by_membership_id,
      signed_by_membership_id, signed_at, supersedes_protocol_version_id,
      created_at
    ) values (
      'protocol-a-v1', 'org-a', 'fac-a', 'encounter-a', 1, 'draft',
      '{}', '${'a'.repeat(64)}', 'membership-doctor',
      null, null, null, 1000
    );
    insert into protocol_heads (
      id, organization_id, facility_id, encounter_id,
      current_protocol_version_id, current_signed_protocol_version_id,
      lock_version, updated_at
    ) values (
      'protocol-head-a', 'org-a', 'fac-a', 'encounter-a',
      'protocol-a-v1', null, 1, 1000
    );
    insert into protocol_versions (
      id, organization_id, facility_id, encounter_id, version, status,
      content_json, source_hash, created_by_membership_id,
      signed_by_membership_id, signed_at, supersedes_protocol_version_id,
      created_at
    ) values (
      'protocol-a-v2', 'org-a', 'fac-a', 'encounter-a', 2, 'signed',
      '{}', '${'b'.repeat(64)}', 'membership-doctor',
      'membership-doctor', 1788472800000, 'protocol-a-v1', 2000
    );
    update protocol_heads
      set current_protocol_version_id = 'protocol-a-v2',
        current_signed_protocol_version_id = 'protocol-a-v2',
        lock_version = 2, updated_at = 2000
      where id = 'protocol-head-a';
    insert into audit_stream_heads (
      id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
    ) values ('audit-head-a', 'org-a', 'fac-a', 0, null, 1);
  `);
  return { target, database: createD1Adapter(target) };
}

function enrollmentCommand(idempotencyKey = uuid(1)) {
  return {
    patientId: 'patient-a',
    basisEncounterId: 'encounter-a',
    basisProtocolVersionId: 'protocol-a-v2',
    registryCode: 'SYN-ENDO-01',
    diagnosisDisplay: 'Синтетический диагноз для проверки наблюдения',
    diagnosisCode: 'SYN-E11',
    diagnosisBasis: 'Врач подтвердил тестовый диагноз по подписанному протоколу.',
    doctorConfirmed: true as const,
    localSourceAcknowledged: true as const,
    reason: 'Включение в локальное тестовое наблюдение',
    idempotencyKey,
    requestId: `request-${idempotencyKey}`,
  };
}

function carePlan(enrollmentId: string, idempotencyKey = uuid(2)) {
  return {
    enrollmentId,
    expectedEnrollmentVersion: 1,
    expectedPlanVersion: null,
    content: {
      effectiveFrom: '2026-09-01',
      effectiveTo: '2026-12-31',
      goals: ['Отслеживать тестовые показатели самочувствия'],
      treatmentPlan: 'Тестовый план мероприятий, который подписывает только врач.',
      dietPlan: 'Тестовый план питания, который подписывает только врач.',
      medications: [
        {
          name: 'Тестовый препарат A',
          dose: '1 условная единица',
          route: 'условно',
          schedule: 'по тестовому расписанию',
          startsOn: '2026-09-01',
          endsOn: null,
          instructions: 'Не является медицинским назначением.',
        },
      ],
      tasks: [
        {
          key: 'nurse-contact-1',
          kind: 'nurse_contact' as const,
          title: 'Уточнить самочувствие',
          dueDate: '2026-09-03',
          ownerRole: 'nurse' as const,
          assignedMembershipId: 'membership-nurse',
          instructions: 'Записать ответ пациента без постановки диагноза.',
        },
        {
          key: 'doctor-follow-up-1',
          kind: 'follow_up_visit' as const,
          title: 'Контрольный приём врача',
          dueDate: '2026-09-11',
          ownerRole: 'clinician' as const,
          assignedMembershipId: 'membership-doctor',
          instructions: 'Врач оценивает данные и принимает решение.',
        },
      ],
    },
    doctorConfirmed: true as const,
    localSourceAcknowledged: true as const,
    reason: 'Первичное подписание тестового плана',
    idempotencyKey,
    requestId: `request-${idempotencyKey}`,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('D1 chronic-care workflow', () => {
  it('loads the explicit chronic-care fixture twice without duplicating rows', () => {
    const target = new DatabaseSync(':memory:');
    databases.push(target);
    applyMigrations(target);
    target.exec(readFileSync(join('db', 'seed.local.sql'), 'utf8'));
    const careSeed = readFileSync(join('db', 'seed.chronic-care.local.sql'), 'utf8');
    target.exec(careSeed);
    target.exec(careSeed);
    const counts = target.prepare(`select
      (select count(*) from chronic_registry_enrollments) as enrollments,
      (select count(*) from chronic_care_plan_versions) as plans,
      (select count(*) from chronic_care_tasks) as tasks,
      (select count(*) from chronic_care_task_versions) as taskVersions
    `).get() as Record<string, number>;
    expect(counts).toMatchObject({
      enrollments: 1,
      plans: 1,
      tasks: 3,
      taskVersions: 3,
    });
    expect(target.prepare('pragma quick_check').get()).toEqual({ quick_check: 'ok' });
    expect(target.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it('runs doctor enrollment, signed plan, nurse escalation, and doctor resolution', async () => {
    const { database, target } = createFixture();
    const doctor = new D1ChronicCareWorkflowRepository(database, clinicianScope);
    const nurse = new D1ChronicCareWorkflowRepository(database, nurseScope);
    const before = await doctor.list({ now: Date.parse('2026-09-04T10:00:00Z') });
    expect(before.eligibleBases).toHaveLength(1);
    const enrollment = await doctor.createEnrollment(enrollmentCommand());
    expect(enrollment.current.status).toBe('active');
    const plan = await doctor.saveSignedPlan(carePlan(enrollment.id));
    expect(plan.current.content.tasks).toHaveLength(2);
    const doctorView = await doctor.list({ now: Date.parse('2026-09-04T10:00:00Z') });
    expect(doctorView.cohortCounts.overdue).toBe(1);
    expect(doctorView.cohortCounts.due_soon).toBe(1);
    expect(doctorView.tasks.every((task) => task.sourcePlanVersionId === plan.current.id)).toBe(true);
    const nurseView = await nurse.list({ now: Date.parse('2026-09-04T10:00:00Z') });
    expect(nurseView.tasks).toHaveLength(1);
    const nurseTask = nurseView.tasks[0];
    await expect(
      doctor.commandTask({
        taskId: nurseTask.id,
        action: 'start',
        expectedTaskVersion: 1,
        reason: 'Врач не должен выполнять назначенную медсестре задачу',
        contactMethod: null,
        wellbeing: null,
        responseSummary: null,
        escalationReason: null,
        idempotencyKey: uuid(9),
        requestId: 'request-doctor-nurse-task',
      }),
    ).rejects.toBeInstanceOf(ChronicCarePermissionRequiredError);
    const answered = await nurse.commandTask({
      taskId: nurseTask.id,
      action: 'record_response',
      expectedTaskVersion: 1,
      reason: 'Ответ пациента записан медсестрой',
      contactMethod: 'phone',
      wellbeing: 'concerning',
      responseSummary: 'Пациент сообщил о тестовом ухудшении самочувствия.',
      escalationReason: null,
      idempotencyKey: uuid(3),
      requestId: 'request-response',
    });
    expect(answered.current.status).toBe('in_progress');
    const escalated = await nurse.commandTask({
      taskId: nurseTask.id,
      action: 'escalate',
      expectedTaskVersion: 2,
      reason: 'Передано врачу для клинического решения',
      contactMethod: null,
      wellbeing: null,
      responseSummary: null,
      escalationReason: 'Тестовое ухудшение требует оценки врача.',
      idempotencyKey: uuid(4),
      requestId: 'request-escalate',
    });
    expect(escalated.current.status).toBe('escalated');
    const resolved = await doctor.commandTask({
      taskId: nurseTask.id,
      action: 'resolve',
      expectedTaskVersion: 3,
      reason: 'Врач проверил эскалацию и закрыл задачу',
      contactMethod: null,
      wellbeing: null,
      responseSummary: null,
      escalationReason: null,
      idempotencyKey: uuid(5),
      requestId: 'request-resolve',
    });
    expect(resolved.current.status).toBe('completed');
    expect(resolved.current.escalationReason).toContain('ухудшение');
    const scopedRows = target.prepare(`
      select 'enrollments' as tableName, count(*) as total,
        count(access_assignment_id) as scoped from chronic_registry_enrollments
      union all select 'enrollmentVersions', count(*),
        count(access_assignment_id) from chronic_registry_enrollment_versions
      union all select 'plans', count(*),
        count(access_assignment_id) from chronic_care_plans
      union all select 'planVersions', count(*),
        count(access_assignment_id) from chronic_care_plan_versions
      union all select 'tasks', count(*),
        count(access_assignment_id) from chronic_care_tasks
      union all select 'taskVersions', count(*),
        count(access_assignment_id) from chronic_care_task_versions
      union all select 'commands', count(*),
        count(access_assignment_id) from command_idempotency
    `).all() as Array<{ tableName: string; total: number; scoped: number }>;
    expect(scopedRows.every((row) => row.total > 0 && row.total === row.scoped)).toBe(
      true,
    );
    const auditAssignments = target.prepare(`
      select json_extract(metadata_json, '$.accessAssignmentId') as assignmentId
      from audit_events where purpose = 'synthetic_chronic_care'
    `).all() as Array<{ assignmentId: string | null }>;
    expect(auditAssignments.length).toBeGreaterThan(0);
    expect(
      auditAssignments.every(
        (row) =>
          row.assignmentId === 'assignment-doctor' ||
          row.assignmentId === 'assignment-nurse',
      ),
    ).toBe(true);
  });

  it('rejects chronic-care commands without an exact current allowed assignment', () => {
    const { target } = createFixture();
    expect(() =>
      target.exec(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          operation, idempotency_key, request_hash, status, created_at
        ) values (
          'command-unscoped', 'org-a', 'fac-a', 'membership-doctor',
          'chronic.enrollment.create', 'unscoped-key',
          '${'c'.repeat(64)}', 'processing', 1
        )
      `),
    ).toThrow(/exact current assignment/);
    expect(() =>
      target.exec(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          access_assignment_id, operation, idempotency_key,
          request_hash, status, created_at
        ) values (
          'command-nurse-plan', 'org-a', 'fac-a', 'membership-nurse',
          'assignment-nurse', 'chronic.plan.sign', 'nurse-plan-key',
          '${'d'.repeat(64)}', 'processing', 1
        )
      `),
    ).toThrow(/allowed role/);
  });

  it('replays the same command and rejects a changed payload for the same key', async () => {
    const { database } = createFixture();
    const doctor = new D1ChronicCareWorkflowRepository(database, clinicianScope);
    const first = await doctor.createEnrollment(enrollmentCommand());
    const replay = await doctor.createEnrollment(enrollmentCommand());
    expect(replay).toEqual(first);
    await expect(
      doctor.createEnrollment({
        ...enrollmentCommand(),
        diagnosisDisplay: 'Другое значение с тем же ключом',
      }),
    ).rejects.toBeInstanceOf(ChronicCareConflictError);
  });

  it('rejects stale plan versions and cancels old open tasks on a signed revision', async () => {
    const { database } = createFixture();
    const doctor = new D1ChronicCareWorkflowRepository(database, clinicianScope);
    const enrollment = await doctor.createEnrollment(enrollmentCommand());
    const initial = await doctor.saveSignedPlan(carePlan(enrollment.id));
    await expect(
      doctor.saveSignedPlan({
        ...carePlan(enrollment.id, uuid(6)),
        expectedPlanVersion: 9,
      }),
    ).rejects.toBeInstanceOf(ChronicCareVersionConflictError);
    const revisedInput = carePlan(enrollment.id, uuid(7));
    const revised = await doctor.saveSignedPlan({
      ...revisedInput,
      expectedPlanVersion: 1,
      content: {
        ...revisedInput.content,
        tasks: [
          {
            ...revisedInput.content.tasks[1],
            key: 'doctor-follow-up-2',
            dueDate: '2026-10-01',
          },
        ],
      },
      reason: 'Врач подписал вторую версию тестового плана',
    });
    expect(revised.current.version).toBe(2);
    expect(revised.current.id).not.toBe(initial.current.id);
    const workspace = await doctor.list({ now: Date.parse('2026-09-04T10:00:00Z') });
    expect(workspace.tasks.filter((task) => task.current.status === 'cancelled')).toHaveLength(2);
    expect(workspace.tasks.filter((task) => task.sourcePlanVersionId === revised.current.id)).toHaveLength(1);
  });

  it('keeps cross-facility data neutral and rejects an unknown task', async () => {
    const { database } = createFixture();
    const other = new D1ChronicCareWorkflowRepository(database, {
      organizationId: 'org-b',
      facilityId: 'fac-b',
      userId: 'user-other',
      membershipId: 'membership-other',
      accessAssignmentId: 'assignment-other',
      role: 'clinician',
    });
    const workspace = await other.list({ now: Date.parse('2026-09-04T10:00:00Z') });
    expect(workspace.enrollments).toEqual([]);
    await expect(
      other.commandTask({
        taskId: 'unknown',
        action: 'start',
        expectedTaskVersion: 1,
        reason: 'Попытка вне области доступа',
        contactMethod: null,
        wellbeing: null,
        responseSummary: null,
        escalationReason: null,
        idempotencyKey: uuid(8),
        requestId: 'request-cross-scope',
      }),
    ).rejects.toBeInstanceOf(ChronicCareNotFoundError);
  });
});
