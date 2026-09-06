import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { FacilityAccessScope } from '@/lib/auth/facility-access';
import {
  SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
  SYNTHETIC_SCHEDULE_SOURCE_LABEL,
  hashSchedulingConfirmationStatement,
} from '@/lib/domain/scheduling';
import {
  D1SchedulingWorkflowRepository,
  SchedulingConflictError,
  SchedulingConsentRequiredError,
  SchedulingLifecycleError,
  SchedulingNotFoundError,
  SchedulingVersionConflictError,
  type SchedulingAppointmentRecord,
} from './scheduling-workflow';

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

function seedCareConsent(
  database: DatabaseSync,
  suffix: string,
  patientId: string,
  encounterId: string,
  occurredAt: number,
) {
  database
    .prepare(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at
      ) values (
        ?, 'org-a', 'fac-a', ?, ?, 1, 'care', 'granted', 'membership-b',
        'test-v1', ?, 'ru', 'verbal', ?, ?
      )
    `)
    .run(
      `consent-care-${suffix}-v1`,
      patientId,
      encounterId,
      '2'.repeat(64),
      occurredAt,
      occurredAt,
    );
  database
    .prepare(`
      insert into consent_heads (
        id, organization_id, facility_id, patient_id, encounter_id,
        consent_type, current_consent_event_id, lock_version,
        created_at, updated_at
      ) values (?, 'org-a', 'fac-a', ?, ?, 'care', ?, 1, ?, ?)
    `)
    .run(
      `consent-head-care-${suffix}`,
      patientId,
      encounterId,
      `consent-care-${suffix}-v1`,
      occurredAt,
      occurredAt,
    );
}

function withdrawCareConsent(
  database: DatabaseSync,
  suffix: string,
  patientId: string,
  encounterId: string,
  occurredAt: number,
) {
  database
    .prepare(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at,
        supersedes_consent_event_id
      ) values (
        ?, 'org-a', 'fac-a', ?, ?, 2, 'care', 'withdrawn', 'membership-b',
        'test-v1', ?, 'ru', 'verbal', ?, ?, ?
      )
    `)
    .run(
      `consent-care-${suffix}-v2`,
      patientId,
      encounterId,
      '2'.repeat(64),
      occurredAt,
      occurredAt,
      `consent-care-${suffix}-v1`,
    );
  database
    .prepare(`
      update consent_heads
      set current_consent_event_id = ?, lock_version = 2, updated_at = ?
      where id = ? and lock_version = 1
    `)
    .run(
      `consent-care-${suffix}-v2`,
      occurredAt,
      `consent-head-care-${suffix}`,
    );
}

function seedReferral(
  database: DatabaseSync,
  suffix: string,
  patientId: string,
  encounterId: string,
  createdAt: number,
) {
  const requestId = `referral-${suffix}`;
  const draftId = `referral-${suffix}-v1`;
  const activeId = `referral-${suffix}-v2`;
  const encounter = database
    .prepare(`
      select clinician_membership_id as clinicianMembershipId
      from encounters where id = ?
    `)
    .get(encounterId) as { clinicianMembershipId: string };
  const authorMembershipId = encounter.clinicianMembershipId;
  const accessAssignmentId =
    authorMembershipId === 'membership-a'
      ? 'orders-assignment-a'
      : 'orders-assignment-b';
  database
    .prepare(`
      insert into service_requests (
        id, organization_id, facility_id, patient_id, encounter_id,
        request_kind, created_by_membership_id, access_assignment_id, created_at
      ) values (
        ?, 'org-a', 'fac-a', ?, ?, 'referral', ?, ?, ?
      )
    `)
    .run(
      requestId,
      patientId,
      encounterId,
      authorMembershipId,
      accessAssignmentId,
      createdAt,
    );
  database
    .prepare(`
      insert into service_request_versions (
        id, organization_id, facility_id, service_request_id, version,
        supersedes_version_id, status, priority, requested_service,
        target_specialty, medical_justification, clinician_note,
        status_reason, authored_by_membership_id,
        access_assignment_id, approved_by_membership_id, approved_at, created_at
      ) values (
        ?, 'org-a', 'fac-a', ?, 1, null, 'draft', 'routine',
        'Консультация эндокринолога', 'Эндокринология',
        'Синтетическое направление для проверки расписания', null, null,
        ?, ?, null, null, ?
      )
    `)
    .run(
      draftId,
      requestId,
      authorMembershipId,
      accessAssignmentId,
      createdAt,
    );
  database
    .prepare(`
      insert into service_request_heads (
        id, organization_id, facility_id, service_request_id,
        current_version_id, lock_version, created_at, updated_at
      ) values (?, 'org-a', 'fac-a', ?, ?, 1, ?, ?)
    `)
    .run(`referral-${suffix}-head`, requestId, draftId, createdAt, createdAt);
  database
    .prepare(`
      insert into service_request_versions (
        id, organization_id, facility_id, service_request_id, version,
        supersedes_version_id, status, priority, requested_service,
        target_specialty, medical_justification, clinician_note,
        status_reason, authored_by_membership_id,
        access_assignment_id, approved_by_membership_id, approved_at, created_at
      ) values (
        ?, 'org-a', 'fac-a', ?, 2, ?, 'active', 'routine',
        'Консультация эндокринолога', 'Эндокринология',
        'Синтетическое направление для проверки расписания', null,
        'Проверено врачом', ?, ?, ?, ?, ?
      )
    `)
    .run(
      activeId,
      requestId,
      draftId,
      authorMembershipId,
      accessAssignmentId,
      authorMembershipId,
      createdAt + 1,
      createdAt + 1,
    );
  database
    .prepare(`
      update service_request_heads
      set current_version_id = ?, lock_version = 2, updated_at = ?
      where service_request_id = ? and lock_version = 1
    `)
    .run(activeId, createdAt + 1, requestId);
  return { requestId, versionId: activeId };
}

function seedOrderAccess(database: DatabaseSync, effectiveFrom: number) {
  database.exec(`
    insert into departments (
      id, organization_id, facility_id, code, name, kind, status,
      created_at, updated_at, version
    ) values (
      'orders-department', 'org-a', 'fac-a', 'orders', 'Orders',
      'clinical', 'active', ${effectiveFrom}, ${effectiveFrom}, 1
    );
    insert into department_versions (
      id, organization_id, facility_id, department_id, version,
      supersedes_version_id, name, kind, status, change_reason,
      changed_by_membership_id, changed_at, created_at
    ) values (
      'orders-department-v1', 'org-a', 'fac-a', 'orders-department', 1,
      null, 'Orders', 'clinical', 'active', 'Synthetic scheduling fixture',
      'membership-b', ${effectiveFrom}, ${effectiveFrom}
    );
    insert into department_heads (
      id, organization_id, facility_id, department_id, current_version_id,
      lock_version, created_at, updated_at
    ) values (
      'orders-department-head', 'org-a', 'fac-a', 'orders-department',
      'orders-department-v1', 1, ${effectiveFrom}, ${effectiveFrom}
    );
    insert into department_access_assignments (
      id, organization_id, facility_id, department_id, membership_id,
      created_by_membership_id, created_at
    ) values
      (
        'orders-assignment-a', 'org-a', 'fac-a', 'orders-department',
        'membership-a', 'membership-b', ${effectiveFrom}
      ),
      (
        'orders-assignment-b', 'org-a', 'fac-a', 'orders-department',
        'membership-b', 'membership-b', ${effectiveFrom}
      );
    insert into department_access_assignment_versions (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, version, supersedes_version_id, status, source_type,
      roles_json, allow_permissions_json, deny_permissions_json,
      effective_from, effective_until, change_reason,
      changed_by_membership_id, changed_at, created_at
    ) values
      (
        'orders-assignment-a-v1', 'org-a', 'fac-a', 'orders-assignment-a',
        'orders-department', 'membership-a', 1, null, 'active', 'bootstrap',
        '["doctor"]', '[]', '[]', ${effectiveFrom}, null,
        'Synthetic scheduling fixture', 'membership-b',
        ${effectiveFrom}, ${effectiveFrom}
      ),
      (
        'orders-assignment-b-v1', 'org-a', 'fac-a', 'orders-assignment-b',
        'orders-department', 'membership-b', 1, null, 'active', 'bootstrap',
        '["doctor"]', '[]', '[]', ${effectiveFrom}, null,
        'Synthetic scheduling fixture', 'membership-b',
        ${effectiveFrom}, ${effectiveFrom}
      );
    insert into department_access_assignment_heads (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, current_version_id, lock_version, created_at, updated_at
    ) values
      (
        'orders-assignment-a-head', 'org-a', 'fac-a', 'orders-assignment-a',
        'orders-department', 'membership-a', 'orders-assignment-a-v1',
        1, ${effectiveFrom}, ${effectiveFrom}
      ),
      (
        'orders-assignment-b-head', 'org-a', 'fac-a', 'orders-assignment-b',
        'orders-department', 'membership-b', 'orders-assignment-b-v1',
        1, ${effectiveFrom}, ${effectiveFrom}
      );
  `);
}

function seedSchedule(database: DatabaseSync, now: number) {
  const source = SYNTHETIC_SCHEDULE_SOURCE_LABEL;
  database
    .prepare(`
      insert into scheduling_specialties (
        id, organization_id, facility_id, code, display_name, status,
        source_type, source_label, source_system, source_record_id,
        source_revision, source_observed_at, created_at
      ) values (
        'specialty-endocrinology', 'org-a', 'fac-a', 'ENDO',
        'Эндокринология', 'active', 'manual_test', ?, 'orion-test-manual',
        'specialty-endo', 'revision-1', ?, ?
      )
    `)
    .run(source, now, now);
  database
    .prepare(`
      insert into scheduling_services (
        id, organization_id, facility_id, specialty_id, code, display_name,
        duration_minutes, status, source_type, source_label, source_system,
        source_record_id, source_revision, source_observed_at, created_at
      ) values (
        'service-endocrinology-first', 'org-a', 'fac-a',
        'specialty-endocrinology', 'ENDO-FIRST',
        'Первичная консультация эндокринолога', 30, 'active',
        'manual_test', ?, 'orion-test-manual', 'service-endo-first',
        'revision-1', ?, ?
      )
    `)
    .run(source, now, now);
  database
    .prepare(`
      insert into scheduling_providers (
        id, organization_id, facility_id, specialty_id, display_name, status,
        source_type, source_label, source_system, source_record_id,
        source_revision, source_observed_at, created_at
      ) values (
        'provider-endocrinologist', 'org-a', 'fac-a',
        'specialty-endocrinology', 'Врач Эндокринолог', 'active',
        'manual_test', ?, 'orion-test-manual', 'provider-endo',
        'revision-1', ?, ?
      )
    `)
    .run(source, now, now);
  database
    .prepare(`
      insert into provider_schedules (
        id, organization_id, facility_id, provider_id, service_id, timezone,
        valid_from, valid_to, status, source_type, source_label, source_system,
        source_record_id, source_revision, source_observed_at, created_at
      ) values (
        'schedule-endocrinologist', 'org-a', 'fac-a',
        'provider-endocrinologist', 'service-endocrinology-first',
        'Asia/Almaty', ?, ?, 'active', 'manual_test', ?,
        'orion-test-manual', 'schedule-endo', 'revision-1', ?, ?
      )
    `)
    .run(now - 60_000, now + 86_400_000, source, now, now);

  const startsAt = [now + 3_600_000, now + 7_200_000];
  for (const [index, start] of startsAt.entries()) {
    const slotId = `slot-${index + 1}`;
    const versionId = `${slotId}-v1`;
    database
      .prepare(`
        insert into appointment_slots (
          id, organization_id, facility_id, schedule_id, provider_id,
          service_id, starts_at, ends_at, source_type, source_label,
          source_system, source_record_id, source_revision,
          source_observed_at, created_at
        ) values (
          ?, 'org-a', 'fac-a', 'schedule-endocrinologist',
          'provider-endocrinologist', 'service-endocrinology-first', ?, ?,
          'manual_test', ?, 'orion-test-manual', ?, 'revision-1', ?, ?
        )
      `)
      .run(slotId, start, start + 1_800_000, source, slotId, now, now);
    database
      .prepare(`
        insert into appointment_slot_versions (
          id, organization_id, facility_id, slot_id, version,
          supersedes_version_id, status, appointment_id, patient_id,
          referral_request_id, referral_version_id, held_by_membership_id,
          hold_expires_at, change_reason, changed_by_membership_id, created_at
        ) values (
          ?, 'org-a', 'fac-a', ?, 1, null, 'available', null, null,
          null, null, null, null, 'Ручное тестовое время доступно',
          'membership-a', ?
        )
      `)
      .run(versionId, slotId, now);
    database
      .prepare(`
        insert into appointment_slot_heads (
          id, organization_id, facility_id, slot_id, current_version_id,
          lock_version, created_at, updated_at
        ) values (?, 'org-a', 'fac-a', ?, ?, 1, ?, ?)
      `)
      .run(`${slotId}-head`, slotId, versionId, now, now);
  }
  return { firstSlotStartsAt: startsAt[0] };
}

function fixture(
  options: {
    assigned?: boolean;
    careConsent?: boolean;
    secondReferral?: boolean;
  } = {},
) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  const now = Date.now() - 5_000;
  const assignedMembership = options.assigned === false ? 'membership-b' : 'membership-a';
  database.exec(`
    insert into organizations (id, name) values ('org-a', 'Clinic A');
    insert into facilities (id, organization_id, name, timezone)
      values ('fac-a', 'org-a', 'Facility A', 'Asia/Almaty');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values
        ('user-a', 'openai:sites', 'doctor-a', 'Doctor A', 'active'),
        ('user-b', 'openai:sites', 'doctor-b', 'Doctor B', 'active');
    insert into memberships (id, organization_id, facility_id, user_id, role, status)
      values
        ('membership-a', 'org-a', 'fac-a', 'user-a', 'clinician', 'active'),
        ('membership-b', 'org-a', 'fac-a', 'user-b', 'clinician', 'active');
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name,
      birth_date, sex_at_birth, status
    ) values (
      'patient-a', 'org-a', 'fac-a', 'SYN-1001', 'Пациент Тестовый А',
      '1988-06-20', 'male', 'active'
    );
    insert into encounters (
      id, organization_id, facility_id, patient_id, clinician_membership_id,
      status, reason_for_visit, started_at
    ) values (
      'encounter-a', 'org-a', 'fac-a', 'patient-a', '${assignedMembership}',
      'in_progress', 'Контрольное обследование', ${now}
    );
    insert into audit_stream_heads (
      id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
    ) values ('audit-head-a', 'org-a', 'fac-a', 0, null, 1);
  `);
  seedOrderAccess(database, now - 1);
  seedCareConsent(database, 'a', 'patient-a', 'encounter-a', now);
  const primaryReferral = seedReferral(
    database,
    'a',
    'patient-a',
    'encounter-a',
    now + 1,
  );

  let secondReferral: ReturnType<typeof seedReferral> | null = null;
  if (options.secondReferral) {
    database.exec(`
      insert into patients (
        id, organization_id, facility_id, medical_record_number, display_name,
        birth_date, sex_at_birth, status
      ) values (
        'patient-b', 'org-a', 'fac-a', 'SYN-1002', 'Пациент Тестовый Б',
        '1992-03-11', 'female', 'active'
      );
      insert into encounters (
        id, organization_id, facility_id, patient_id, clinician_membership_id,
        status, reason_for_visit, started_at
      ) values (
        'encounter-b', 'org-a', 'fac-a', 'patient-b', 'membership-a',
        'in_progress', 'Повторное обследование', ${now}
      );
    `);
    seedCareConsent(database, 'b', 'patient-b', 'encounter-b', now);
    secondReferral = seedReferral(
      database,
      'b',
      'patient-b',
      'encounter-b',
      now + 1,
    );
  }

  if (options.careConsent === false) {
    withdrawCareConsent(database, 'a', 'patient-a', 'encounter-a', now + 10);
  }
  const { firstSlotStartsAt } = seedSchedule(database, Date.now());
  const scope: FacilityAccessScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    userId: 'user-a',
    membershipId: 'membership-a',
    role: 'clinician',
  };
  const d1 = createD1Adapter(database);
  return {
    database,
    d1,
    scope,
    repository: new D1SchedulingWorkflowRepository(d1, scope),
    primaryReferral,
    secondReferral,
    firstSlotStartsAt,
  };
}

function preferenceInput(
  referral: { requestId: string; versionId: string },
  startsAt: number,
  key: string,
) {
  const date = new Date(startsAt).toISOString().slice(0, 10);
  return {
    serviceRequestId: referral.requestId,
    serviceRequestVersionId: referral.versionId,
    preferredDateFrom: date,
    preferredDateTo: date,
    earliestLocalTime: '08:00',
    latestLocalTime: '18:00',
    preferredProviderId: 'provider-endocrinologist',
    notes: 'Пациент подтвердил удобное время',
    noticeLanguage: 'ru' as const,
    idempotencyKey: key,
    requestId: `http-${key}`,
  };
}

async function confirmationFor(appointment: SchedulingAppointmentRecord) {
  const context = {
    appointmentId: appointment.id,
    slotId: appointment.slot.id,
    startsAt: appointment.slot.startsAt,
    endsAt: appointment.slot.endsAt,
    subject: 'patient' as const,
    method: 'verbal_in_person' as const,
    language: 'ru' as const,
  };
  return {
    subject: context.subject,
    method: context.method,
    language: context.language,
    statementVersion: SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
    statementHash: await hashSchedulingConfirmationStatement(context),
    acknowledged: true as const,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 scheduling workflow', () => {
  it('persists preference, hold, patient confirmation and the complete queue lifecycle', async () => {
    const { database, repository, primaryReferral, firstSlotStartsAt } = fixture();
    const initial = await repository.list();
    expect(initial.eligibleReferrals).toHaveLength(1);
    expect(initial.slots).toHaveLength(2);
    expect(initial.slots[0]).toMatchObject({
      id: 'slot-1',
      sourceLabel: SYNTHETIC_SCHEDULE_SOURCE_LABEL,
      current: { version: 1, status: 'available' },
    });

    const preference = await repository.createPreference(
      preferenceInput(
        primaryReferral,
        firstSlotStartsAt,
        '00000000-0000-4000-8000-000000000501',
      ),
    );
    expect(preference).toMatchObject({
      serviceRequestId: primaryReferral.requestId,
      serviceRequestVersionId: primaryReferral.versionId,
      patientId: 'patient-a',
      version: 1,
      noticeLanguage: 'ru',
    });

    const held = await repository.holdSlot({
      serviceRequestId: primaryReferral.requestId,
      slotId: 'slot-1',
      preferenceSnapshotId: preference.id,
      expectedSlotVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000502',
      requestId: 'http-hold-slot',
    });
    expect(held.current).toMatchObject({
      version: 1,
      status: 'held',
      slotVersion: 2,
    });
    expect(held.current.holdExpiresAt).toBeGreaterThan(Date.now());

    await expect(
      repository.confirmAppointment({
        appointmentId: held.id,
        expectedAppointmentVersion: 1,
        expectedSlotVersion: 2,
        confirmation: {
          ...(await confirmationFor(held)),
          statementHash: 'c'.repeat(64),
        },
        reason: 'Повреждённое подтверждение не должно сохраниться',
        idempotencyKey: '00000000-0000-4000-8000-000000000599',
        requestId: 'http-invalid-confirmation-hash',
      }),
    ).rejects.toBeInstanceOf(SchedulingLifecycleError);
    await expect(repository.getAppointment(held.id)).resolves.toMatchObject({
      current: { version: 1, status: 'held' },
    });

    const confirmed = await repository.confirmAppointment({
      appointmentId: held.id,
      expectedAppointmentVersion: 1,
      expectedSlotVersion: 2,
      confirmation: await confirmationFor(held),
      reason: 'Пациент лично подтвердил предложенное время',
      idempotencyKey: '00000000-0000-4000-8000-000000000503',
      requestId: 'http-confirm-appointment',
    });
    expect(confirmed.current).toMatchObject({
      version: 2,
      status: 'confirmed',
      slotVersion: 3,
      holdExpiresAt: null,
    });

    let ticket = await repository.issueQueueTicket({
      appointmentId: held.id,
      expectedAppointmentVersion: 2,
      idempotencyKey: '00000000-0000-4000-8000-000000000504',
      requestId: 'http-issue-queue',
    });
    expect(ticket).toMatchObject({
      appointmentId: held.id,
      sequence: 1,
      displayNumber: 'A001',
      current: { version: 1, status: 'issued' },
    });

    ticket = await repository.commandQueue({
      ticketId: ticket.id,
      action: 'arrive',
      expectedQueueVersion: 1,
      reason: 'Пациент прибыл в клинику',
      roomLabel: null,
      exceptionCode: null,
      exceptionNote: null,
      idempotencyKey: '00000000-0000-4000-8000-000000000505',
      requestId: 'http-arrive',
    });
    expect(ticket.current).toMatchObject({ version: 2, status: 'arrived' });

    ticket = await repository.commandQueue({
      ticketId: ticket.id,
      action: 'call',
      expectedQueueVersion: 2,
      reason: 'Пациент вызван в кабинет',
      roomLabel: 'Кабинет 12',
      exceptionCode: null,
      exceptionNote: null,
      idempotencyKey: '00000000-0000-4000-8000-000000000506',
      requestId: 'http-call',
    });
    expect(ticket.current).toMatchObject({
      version: 3,
      status: 'called',
      roomLabel: 'Кабинет 12',
    });

    ticket = await repository.commandQueue({
      ticketId: ticket.id,
      action: 'start_service',
      expectedQueueVersion: 3,
      reason: 'Приём пациента начат врачом',
      roomLabel: 'Кабинет 12',
      exceptionCode: null,
      exceptionNote: null,
      idempotencyKey: '00000000-0000-4000-8000-000000000507',
      requestId: 'http-start-service',
    });
    expect(ticket.current).toMatchObject({ version: 4, status: 'in_service' });

    ticket = await repository.commandQueue({
      ticketId: ticket.id,
      action: 'complete',
      expectedQueueVersion: 4,
      expectedAppointmentVersion: 2,
      reason: 'Приём завершён врачом',
      roomLabel: null,
      exceptionCode: null,
      exceptionNote: null,
      idempotencyKey: '00000000-0000-4000-8000-000000000508',
      requestId: 'http-complete-service',
    });
    expect(ticket.current).toMatchObject({
      version: 5,
      status: 'completed',
      roomLabel: 'Кабинет 12',
    });
    await expect(repository.getAppointment(held.id)).resolves.toMatchObject({
      current: { version: 3, status: 'completed' },
    });
    expect(
      database.prepare('select count(*) as count from audit_events').get(),
    ).toEqual({ count: 8 });
    expect(
      database.prepare('select count(*) as count from command_idempotency').get(),
    ).toEqual({ count: 8 });
  });

  it('returns the exact committed response on replay and rejects a changed payload', async () => {
    const { database, repository, primaryReferral, firstSlotStartsAt } = fixture();
    const preferenceCommand = preferenceInput(
      primaryReferral,
      firstSlotStartsAt,
      '00000000-0000-4000-8000-000000000510',
    );
    const preference = await repository.createPreference(preferenceCommand);
    await expect(repository.createPreference(preferenceCommand)).resolves.toEqual(
      preference,
    );

    const holdCommand = {
      serviceRequestId: primaryReferral.requestId,
      slotId: 'slot-1',
      preferenceSnapshotId: preference.id,
      expectedSlotVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000511',
      requestId: 'http-exact-hold',
    };
    const held = await repository.holdSlot(holdCommand);
    await repository.confirmAppointment({
      appointmentId: held.id,
      expectedAppointmentVersion: 1,
      expectedSlotVersion: 2,
      confirmation: await confirmationFor(held),
      reason: 'Пациент подтвердил время',
      idempotencyKey: '00000000-0000-4000-8000-000000000512',
      requestId: 'http-progress-after-hold',
    });

    await expect(repository.holdSlot(holdCommand)).resolves.toEqual(held);
    await expect(
      repository.holdSlot({ ...holdCommand, expectedSlotVersion: 3 }),
    ).rejects.toBeInstanceOf(SchedulingConflictError);
    expect(
      database.prepare('select count(*) as count from appointments').get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare('select count(*) as count from command_idempotency').get(),
    ).toEqual({ count: 3 });
  });

  it('allows only one of two patients to acquire the same slot', async () => {
    const {
      database,
      repository,
      primaryReferral,
      secondReferral,
      firstSlotStartsAt,
    } = fixture({ secondReferral: true });
    if (!secondReferral) throw new Error('Second referral fixture is required');
    const [preferenceA, preferenceB] = await Promise.all([
      repository.createPreference(
        preferenceInput(
          primaryReferral,
          firstSlotStartsAt,
          '00000000-0000-4000-8000-000000000520',
        ),
      ),
      repository.createPreference(
        preferenceInput(
          secondReferral,
          firstSlotStartsAt,
          '00000000-0000-4000-8000-000000000521',
        ),
      ),
    ]);

    const outcomes = await Promise.allSettled([
      repository.holdSlot({
        serviceRequestId: primaryReferral.requestId,
        slotId: 'slot-1',
        preferenceSnapshotId: preferenceA.id,
        expectedSlotVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000522',
        requestId: 'http-concurrent-hold-a',
      }),
      repository.holdSlot({
        serviceRequestId: secondReferral.requestId,
        slotId: 'slot-1',
        preferenceSnapshotId: preferenceB.id,
        expectedSlotVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000523',
        requestId: 'http-concurrent-hold-b',
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(rejection?.reason).toBeInstanceOf(SchedulingVersionConflictError);
    expect(
      database.prepare('select count(*) as count from appointments').get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(`
          select version, status, appointment_id as appointmentId
          from appointment_slot_versions
          where slot_id = 'slot-1'
          order by version desc limit 1
        `)
        .get(),
    ).toMatchObject({ version: 2, status: 'held' });
  });

  it('cancels a confirmed appointment, releases its slot and cancels its queue ticket', async () => {
    const { database, repository, primaryReferral, firstSlotStartsAt } = fixture();
    const preference = await repository.createPreference(
      preferenceInput(
        primaryReferral,
        firstSlotStartsAt,
        '00000000-0000-4000-8000-000000000530',
      ),
    );
    const held = await repository.holdSlot({
      serviceRequestId: primaryReferral.requestId,
      slotId: 'slot-1',
      preferenceSnapshotId: preference.id,
      expectedSlotVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000531',
      requestId: 'http-cancel-hold',
    });
    await repository.confirmAppointment({
      appointmentId: held.id,
      expectedAppointmentVersion: 1,
      expectedSlotVersion: 2,
      confirmation: await confirmationFor(held),
      reason: 'Пациент подтвердил время',
      idempotencyKey: '00000000-0000-4000-8000-000000000532',
      requestId: 'http-cancel-confirm',
    });
    const ticket = await repository.issueQueueTicket({
      appointmentId: held.id,
      expectedAppointmentVersion: 2,
      idempotencyKey: '00000000-0000-4000-8000-000000000533',
      requestId: 'http-cancel-ticket',
    });
    const cancelCommand = {
      appointmentId: held.id,
      action: 'cancel' as const,
      expectedAppointmentVersion: 2,
      expectedSlotVersion: 3,
      reason: 'Пациент отказался от предложенного времени',
      idempotencyKey: '00000000-0000-4000-8000-000000000534',
      requestId: 'http-cancel-appointment',
    };
    const cancelled = await repository.commandAppointment(cancelCommand);
    expect(cancelled.current).toMatchObject({
      version: 3,
      status: 'cancelled',
      slotVersion: 4,
    });
    await expect(repository.commandAppointment(cancelCommand)).resolves.toEqual(
      cancelled,
    );
    await expect(repository.getQueueTicket(ticket.id)).resolves.toMatchObject({
      current: { version: 2, status: 'cancelled' },
    });
    expect(
      database
        .prepare(`
          select version, status, appointment_id as appointmentId
          from appointment_slot_versions
          where slot_id = 'slot-1'
          order by version desc limit 1
        `)
        .get(),
    ).toEqual({ version: 4, status: 'available', appointmentId: null });
  });

  it('fails closed for an unassigned referral, withdrawn care consent and cross-scope reads', async () => {
    const unassigned = fixture({ assigned: false });
    await expect(
      unassigned.repository.createPreference(
        preferenceInput(
          unassigned.primaryReferral,
          unassigned.firstSlotStartsAt,
          '00000000-0000-4000-8000-000000000540',
        ),
      ),
    ).rejects.toBeInstanceOf(SchedulingNotFoundError);

    const withoutConsent = fixture({ careConsent: false });
    await expect(
      withoutConsent.repository.createPreference(
        preferenceInput(
          withoutConsent.primaryReferral,
          withoutConsent.firstSlotStartsAt,
          '00000000-0000-4000-8000-000000000541',
        ),
      ),
    ).rejects.toBeInstanceOf(SchedulingConsentRequiredError);

    const scoped = fixture();
    const preference = await scoped.repository.createPreference(
      preferenceInput(
        scoped.primaryReferral,
        scoped.firstSlotStartsAt,
        '00000000-0000-4000-8000-000000000542',
      ),
    );
    const held = await scoped.repository.holdSlot({
      serviceRequestId: scoped.primaryReferral.requestId,
      slotId: 'slot-1',
      preferenceSnapshotId: preference.id,
      expectedSlotVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000543',
      requestId: 'http-scope-hold',
    });
    const otherScope: FacilityAccessScope = {
      organizationId: 'org-other',
      facilityId: 'fac-other',
      userId: 'user-other',
      membershipId: 'membership-other',
      role: 'clinician',
    };
    const otherRepository = new D1SchedulingWorkflowRepository(
      scoped.d1,
      otherScope,
    );
    await expect(otherRepository.getAppointment(held.id)).resolves.toBeNull();
  });
});
