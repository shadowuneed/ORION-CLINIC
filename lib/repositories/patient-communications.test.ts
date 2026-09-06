import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommunicationScope } from '@/lib/auth/communication-access';
import type { SchedulingScope } from '@/lib/auth/scheduling-access';
import {
  SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
  hashSchedulingConfirmationStatement,
} from '@/lib/domain/scheduling';
import {
  CommunicationConflictError,
  CommunicationLifecycleError,
  CommunicationNotFoundError,
  CommunicationTemplateUnavailableError,
  D1PatientCommunicationsRepository,
} from './patient-communications';
import {
  D1SchedulingWorkflowRepository,
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
const clinicianScope: CommunicationScope = {
  organizationId: 'org-a',
  facilityId: 'fac-a',
  userId: 'user-a',
  membershipId: 'membership-a',
  role: 'clinician',
};
const nurseScope: CommunicationScope = {
  organizationId: 'org-a',
  facilityId: 'fac-a',
  userId: 'user-care-nurse',
  membershipId: 'membership-care-nurse',
  role: 'nurse',
};
const schedulingClinicianScope: SchedulingScope = {
  organizationId: clinicianScope.organizationId,
  facilityId: clinicianScope.facilityId,
  userId: clinicianScope.userId,
  membershipId: clinicianScope.membershipId,
  accessAssignmentId: 'access-assignment-a-general-medicine',
  role: 'clinician',
};
const uuid = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const noticeHash = 'c'.repeat(64);
const daytime = Date.parse('2026-09-05T05:00:00.000Z');

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
  target.exec(readFileSync(join('db', 'seed.local.sql'), 'utf8'));
  target.exec(readFileSync(join('db', 'seed.scheduling.local.sql'), 'utf8'));
  target.exec(readFileSync(join('db', 'seed.chronic-care.local.sql'), 'utf8'));
  target.exec(readFileSync(join('db', 'seed.communications.local.sql'), 'utf8'));
  return { target, database: createD1Adapter(target) };
}

function grantSmsFor(
  repository: D1PatientCommunicationsRepository,
  patientId: string,
  key: string,
) {
  return repository.recordChannelConsent({
    patientId,
    channel: 'sms',
    decision: 'granted',
    preferredLanguage: 'ru',
    destinationRef: `test:sms:${patientId}`,
    destinationHint: 'Тестовый канал · SMS',
    destinationVerified: true,
    source: 'verbal',
    expectedVersion: null,
    noticeVersion: 'ORION-COMMS-LOCAL-V1',
    noticeHash,
    reason: 'Пациент разрешил тестовый SMS-канал',
    idempotencyKey: key,
    requestId: `request-${key}`,
  });
}

function grantSms(repository: D1PatientCommunicationsRepository, key = uuid(1)) {
  return grantSmsFor(repository, 'patient-care-a', key);
}

async function schedulingConfirmationFor(appointment: SchedulingAppointmentRecord) {
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

async function createConfirmedAppointment(database: D1Database) {
  const scheduling = new D1SchedulingWorkflowRepository(database, schedulingClinicianScope);
  const workspace = await scheduling.list();
  const referral = workspace.eligibleReferrals.find(
    (candidate) => candidate.serviceRequestId === 'service-request-scheduling-referral',
  );
  const slot = workspace.slots.find(
    (candidate) => candidate.id === 'slot-endo-2027-01-14-0800',
  );
  if (!referral || !slot) throw new Error('Scheduling fixture is incomplete');
  const preferredDate = new Date(slot.startsAt).toISOString().slice(0, 10);
  const preference = await scheduling.createPreference({
    serviceRequestId: referral.serviceRequestId,
    serviceRequestVersionId: referral.serviceRequestVersionId,
    preferredDateFrom: preferredDate,
    preferredDateTo: preferredDate,
    earliestLocalTime: '08:00',
    latestLocalTime: '18:00',
    preferredProviderId: slot.providerId,
    notes: 'Пациент подтвердил тестовое время',
    noticeLanguage: 'ru',
    idempotencyKey: uuid(40),
    requestId: 'request-appointment-preference',
  });
  const held = await scheduling.holdSlot({
    serviceRequestId: referral.serviceRequestId,
    slotId: slot.id,
    preferenceSnapshotId: preference.id,
    expectedSlotVersion: slot.current.version,
    idempotencyKey: uuid(41),
    requestId: 'request-appointment-hold',
  });
  const confirmed = await scheduling.confirmAppointment({
    appointmentId: held.id,
    expectedAppointmentVersion: held.current.version,
    expectedSlotVersion: held.current.slotVersion,
    confirmation: await schedulingConfirmationFor(held),
    reason: 'Пациент подтвердил тестовую запись',
    idempotencyKey: uuid(42),
    requestId: 'request-appointment-confirm',
  });
  return { scheduling, held, confirmed };
}

function scheduleCare(
  repository: D1PatientCommunicationsRepository,
  key = uuid(2),
  overrides: {
    sourceRecordId?: string;
    scheduledAt?: number;
  } = {},
) {
  return repository.scheduleNotification({
    sourceType: 'care_plan_task',
    sourceRecordId: overrides.sourceRecordId ?? 'chronic-task-care-soon',
    sourceVersionId: 'chronic-care-plan-care-a-v1',
    channel: 'sms',
    language: 'ru',
    scheduledAt: overrides.scheduledAt ?? daytime,
    reason: 'Напомнить о согласованном пункте плана',
    idempotencyKey: key,
    requestId: `request-${key}`,
  });
}

function insertTemplateVersion(
  target: DatabaseSync,
  input: {
    id: string;
    status: 'approved_test' | 'retired';
    body: string;
    hashCharacter: string;
  },
) {
  target.prepare(`insert into communication_template_versions (
    id, organization_id, facility_id, template_code, version, status,
    source_type, purpose, channel, language, body, placeholders_json,
    content_hash, minimum_content_only, protected_link_required,
    approved_by_membership_id, approved_at, created_at
  ) values (?, 'org-a', 'fac-a', 'CARE_SMS_RU', 2, ?, 'local_test',
    'care_plan_reminder', 'sms', 'ru', ?, '["dueDate","facilityName"]',
    ?, 1, 0, 'membership-a', ?, ?)`)
    .run(
      input.id,
      input.status,
      input.body,
      input.hashCharacter.repeat(64),
      daytime,
      daytime,
    );
}

type InitialNotificationRow = {
  patientId: string;
  state: string;
  purpose: string;
  channel: string;
  language: string;
  consentEventId: string;
  templateVersionId: string;
  policyVersionId: string;
  sourceType: string;
  sourceRecordId: string;
  sourceVersionId: string;
  requestedAt: number;
  scheduledAt: number;
  nextAttemptAt: number;
  destinationHint: string;
  destinationFingerprint: string;
  renderedBody: string;
  templateValuesJson: string;
  contentHash: string;
  failureOwnerMembershipId: string;
};

function expectTamperedInitialNotificationRejected(
  target: DatabaseSync,
  originalNotificationId: string,
  sequence: number,
  tamper: 'rendered_body' | 'outbox' | 'purpose_source',
) {
  const original = target.prepare(`select
      patient_id as patientId, state, purpose, channel, language,
      consent_event_id as consentEventId,
      template_version_id as templateVersionId,
      policy_version_id as policyVersionId,
      source_type as sourceType, source_record_id as sourceRecordId,
      source_version_id as sourceVersionId, requested_at as requestedAt,
      scheduled_at as scheduledAt, next_attempt_at as nextAttemptAt,
      destination_hint as destinationHint,
      destination_fingerprint as destinationFingerprint,
      rendered_body as renderedBody, template_values_json as templateValuesJson,
      content_hash as contentHash,
      failure_owner_membership_id as failureOwnerMembershipId
    from patient_notification_events
    where notification_id = ? and version = 1`).get(
      originalNotificationId,
    ) as InitialNotificationRow;
  const notificationId = `tampered-notification-${sequence}`;
  const eventId = `tampered-notification-event-${sequence}`;
  const outboxId = `tampered-outbox-${sequence}`;
  const scheduledAt = original.scheduledAt + sequence * 1_000;
  const nextAttemptAt = original.nextAttemptAt + sequence * 1_000;
  const contentHash = original.contentHash;
  const payload = {
    notificationId,
    patientId: original.patientId,
    sourceType: original.sourceType,
    sourceRecordId: original.sourceRecordId,
    sourceVersionId: original.sourceVersionId,
    channel: original.channel,
    templateVersionId: original.templateVersionId,
    contentHash: tamper === 'outbox' ? 'f'.repeat(64) : contentHash,
  };
  const savepoint = `tampered_initial_${sequence}`;

  target.exec(`savepoint ${savepoint}`);
  try {
    target.prepare(`insert into outbox_events (
      id, organization_id, facility_id, aggregate_type, aggregate_id,
      aggregate_version, command_id, event_type, payload_json,
      event_idempotency_key, status, attempts, next_attempt_at, created_at
    ) values (?, 'org-a', 'fac-a', 'patient_notification', ?, 1, null,
      'patient_notification.dispatch_requested', ?, ?, 'pending', 0, ?, ?)`)
      .run(
        outboxId,
        notificationId,
        JSON.stringify(payload),
        `patient-notification:${notificationId}`,
        nextAttemptAt,
        original.requestedAt,
      );

    expect(() =>
      target.prepare(`insert into patient_notification_events (
        id, organization_id, facility_id, notification_id, patient_id,
        version, supersedes_notification_event_id, state, purpose, channel,
        language, consent_event_id, template_version_id, policy_version_id,
        source_type, source_record_id, source_version_id, requested_at,
        scheduled_at, next_attempt_at, destination_hint,
        destination_fingerprint, rendered_body, template_values_json,
        content_hash, outbox_event_id, attempt_count,
        failure_owner_membership_id, last_failure_code,
        changed_by_membership_id, change_reason, created_at
      ) values (?, 'org-a', 'fac-a', ?, ?, 1, null, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, null,
        'membership-a', 'Проверка защиты от подмены', ?)`)
        .run(
          eventId,
          notificationId,
          original.patientId,
          original.state,
          tamper === 'purpose_source' ? 'appointment_reminder' : original.purpose,
          original.channel,
          original.language,
          original.consentEventId,
          original.templateVersionId,
          original.policyVersionId,
          original.sourceType,
          original.sourceRecordId,
          original.sourceVersionId,
          original.requestedAt,
          scheduledAt,
          nextAttemptAt,
          original.destinationHint,
          original.destinationFingerprint,
          tamper === 'rendered_body'
            ? `${original.renderedBody} Подменено.`
            : original.renderedBody,
          original.templateValuesJson,
          contentHash,
          outboxId,
          original.failureOwnerMembershipId,
          original.requestedAt,
        ),
    ).toThrow(/exact approved template render|exact outbox|valid source/);
  } finally {
    target.exec(`rollback to ${savepoint}`);
    target.exec(`release ${savepoint}`);
  }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('D1 patient communications', () => {
  it('loads the complete local policy and template matrix idempotently', () => {
    const { target } = createFixture();
    target.exec(readFileSync(join('db', 'seed.communications.local.sql'), 'utf8'));
    expect(
      target.prepare('select count(*) as count from communication_policy_versions').get(),
    ).toEqual({ count: 1 });
    expect(
      target.prepare('select count(*) as count from communication_template_versions').get(),
    ).toEqual({ count: 16 });
    expect(target.prepare('pragma quick_check').get()).toEqual({ quick_check: 'ok' });
    expect(target.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it('keeps channel consent versioned, redacted, and idempotent', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientCommunicationsRepository(database, clinicianScope);
    const first = await grantSms(repository);
    const replay = await grantSms(repository);
    expect(replay).toEqual(first);
    await expect(
      repository.recordChannelConsent({
        ...(await Promise.resolve({
          patientId: 'patient-care-a',
          channel: 'sms' as const,
          decision: 'granted' as const,
          preferredLanguage: 'ru' as const,
          destinationRef: 'test:sms:patient-care-a',
          destinationHint: 'Тестовый канал · SMS',
          destinationVerified: true,
          source: 'verbal' as const,
          expectedVersion: null,
          noticeVersion: 'ORION-COMMS-LOCAL-V1',
          noticeHash,
          reason: 'Другая причина при том же ключе',
          idempotencyKey: uuid(1),
          requestId: 'request-conflict',
        })),
      }),
    ).rejects.toBeInstanceOf(CommunicationConflictError);
    const workspace = await repository.list({ patientId: 'patient-care-a' });
    expect(workspace.providerCallsEnabled).toBe(false);
    expect(workspace.providerConnection).toBe('not_connected');
    expect(workspace.consents).toHaveLength(1);
    expect(JSON.stringify(workspace.consents)).not.toContain('destinationRef');
    expect(JSON.stringify(workspace.consents)).not.toContain('destinationFingerprint');
    expect(target.prepare('select count(*) as count from patient_channel_consent_events').get())
      .toEqual({ count: 1 });
  });

  it('schedules from the exact confirmed appointment and rejects stale or cancelled sources', async () => {
    const { target, database } = createFixture();
    const { scheduling, held, confirmed } = await createConfirmedAppointment(database);
    const communications = new D1PatientCommunicationsRepository(database, clinicianScope);
    await grantSmsFor(communications, 'patient-a-lifecycle', uuid(43));

    const scheduled = await communications.scheduleNotification({
      sourceType: 'appointment',
      sourceRecordId: confirmed.id,
      sourceVersionId: confirmed.current.id,
      channel: 'sms',
      language: 'ru',
      scheduledAt: daytime,
      reason: 'Напомнить о подтверждённой тестовой записи',
      idempotencyKey: uuid(44),
      requestId: 'request-appointment-reminder',
    });
    expect(scheduled.current).toMatchObject({
      state: 'scheduled',
      purpose: 'appointment_reminder',
      sourceType: 'appointment',
      sourceRecordId: confirmed.id,
      sourceVersionId: confirmed.current.id,
      failureOwnerMembershipId: 'membership-a',
    });
    expect(scheduled.current.renderedBody).toContain('Synthetic Main Facility');
    expect(scheduled.current.renderedBody).toContain('14.01.2027');

    const beforeRejectedCommands = target.prepare(`select
      (select count(*) from patient_notification_events) as notificationEvents,
      (select count(*) from outbox_events) as outboxEvents,
      (select count(*) from audit_events
        where action like 'communication.%') as communicationAudit`).get();
    await expect(
      communications.scheduleNotification({
        sourceType: 'appointment',
        sourceRecordId: confirmed.id,
        sourceVersionId: held.current.id,
        channel: 'sms',
        language: 'ru',
        scheduledAt: daytime + 1_000,
        reason: 'Устаревшая версия записи не должна использоваться',
        idempotencyKey: uuid(45),
        requestId: 'request-stale-appointment-reminder',
      }),
    ).rejects.toBeInstanceOf(CommunicationNotFoundError);

    const cancelled = await scheduling.commandAppointment({
      appointmentId: confirmed.id,
      action: 'cancel',
      expectedAppointmentVersion: confirmed.current.version,
      expectedSlotVersion: confirmed.current.slotVersion,
      reason: 'Отменить тестовую запись после проверки источника',
      idempotencyKey: uuid(46),
      requestId: 'request-cancel-appointment-source',
    });
    expect(cancelled.current.status).toBe('cancelled');
    await expect(
      communications.scheduleNotification({
        sourceType: 'appointment',
        sourceRecordId: confirmed.id,
        sourceVersionId: confirmed.current.id,
        channel: 'sms',
        language: 'ru',
        scheduledAt: daytime + 2_000,
        reason: 'Отменённая запись не должна создавать новое намерение',
        idempotencyKey: uuid(47),
        requestId: 'request-cancelled-appointment-reminder',
      }),
    ).rejects.toBeInstanceOf(CommunicationNotFoundError);
    expect(target.prepare(`select
      (select count(*) from patient_notification_events) as notificationEvents,
      (select count(*) from outbox_events) as outboxEvents,
      (select count(*) from audit_events
        where action like 'communication.%') as communicationAudit`).get())
      .toEqual(beforeRejectedCommands);
  });

  it('retries a disconnected adapter, creates one manual task, and records a reply', async () => {
    const { target, database } = createFixture();
    const clinician = new D1PatientCommunicationsRepository(database, clinicianScope);
    const nurse = new D1PatientCommunicationsRepository(database, nurseScope);
    await grantSms(clinician);
    const scheduled = await scheduleCare(clinician);
    expect(scheduled.current.state).toBe('scheduled');
    expect(scheduled.current.renderedBody).toContain('Synthetic Main Facility');
    const outbox = target.prepare(`select payload_json as payload
      from outbox_events where aggregate_id = ?`).get(scheduled.id) as { payload: string };
    expect(outbox.payload).toContain(scheduled.id);
    expect(outbox.payload).not.toContain('test:sms:');
    expect(outbox.payload).not.toContain(scheduled.current.renderedBody);
    const firstAttempt = await clinician.processNotification({
      notificationId: scheduled.id,
      action: 'process_due',
      expectedVersion: 1,
      reason: 'Локальная проверка очереди без вызова провайдера',
      idempotencyKey: uuid(3),
      requestId: 'request-process-one',
      now: daytime,
    });
    expect(firstAttempt.current.state).toBe('retry_scheduled');
    expect(firstAttempt.attempts).toHaveLength(1);
    expect(firstAttempt.attempts[0]).toMatchObject({
      providerAdapter: 'disconnected',
      outcome: 'provider_unavailable',
      errorCode: 'PROVIDER_NOT_CONFIGURED',
    });
    const retryAt = firstAttempt.current.nextAttemptAt!;
    const exhausted = await clinician.processNotification({
      notificationId: scheduled.id,
      action: 'retry_now',
      expectedVersion: 2,
      reason: 'Повторная локальная проверка без вызова провайдера',
      idempotencyKey: uuid(4),
      requestId: 'request-process-two',
      now: retryAt,
    });
    expect(exhausted.current.state).toBe('manual_contact_required');
    expect(exhausted.attempts).toHaveLength(2);
    expect(target.prepare(`select count(*) as count from patient_notification_events
      where state = 'delivered'`).get()).toEqual({ count: 0 });
    expect(target.prepare('select count(*) as count from communication_manual_task_heads').get())
      .toEqual({ count: 1 });

    const nurseWorkspace = await nurse.list({ patientId: 'patient-care-a' });
    expect(nurseWorkspace.manualTasks).toHaveLength(1);
    const task = nurseWorkspace.manualTasks[0];
    const answered = await nurse.commandManualTask({
      taskId: task.id,
      action: 'record_response',
      expectedVersion: 1,
      reason: 'Медсестра записала синтетический ответ пациента',
      responseKind: 'confirmed',
      responseLanguage: 'ru',
      responseSummary: 'Пациент подтвердил, что помнит о пункте плана.',
      idempotencyKey: uuid(5),
      requestId: 'request-manual-response',
      now: retryAt + 60_000,
    });
    expect(answered.current.state).toBe('in_progress');
    const completed = await nurse.commandManualTask({
      taskId: task.id,
      action: 'complete',
      expectedVersion: 2,
      reason: 'Ручной контакт завершён медсестрой',
      responseKind: null,
      responseLanguage: null,
      responseSummary: null,
      idempotencyKey: uuid(6),
      requestId: 'request-manual-complete',
      now: retryAt + 120_000,
    });
    expect(completed.current.state).toBe('completed');
    expect(target.prepare('select count(*) as count from communication_patient_responses').get())
      .toEqual({ count: 1 });
    const finalWorkspace = await clinician.list({ patientId: 'patient-care-a' });
    expect(finalWorkspace.notifications[0].current.state).toBe('manual_contact_completed');
    const communicationAudit = target.prepare(`select sequence, action,
      previous_hash as previousHash, event_hash as eventHash
      from audit_events where purpose = 'synthetic_patient_communication'
      order by sequence`).all() as Array<{
        sequence: number;
        action: string;
        previousHash: string | null;
        eventHash: string;
      }>;
    expect(communicationAudit.map((event) => event.action)).toEqual([
      'communication.consent.granted',
      'communication.notification.schedule',
      'communication.notification.retry_scheduled',
      'communication.notification.manual_contact_required',
      'communication.manual_task.record_response',
      'communication.manual_task.complete',
    ]);
    for (let index = 1; index < communicationAudit.length; index += 1) {
      expect(communicationAudit[index].sequence).toBe(communicationAudit[index - 1].sequence + 1);
      expect(communicationAudit[index].previousHash).toBe(communicationAudit[index - 1].eventHash);
    }
    expect(target.prepare(`select last_sequence as lastSequence,
      last_event_hash as lastEventHash from audit_stream_heads
      where organization_id = 'org-a' and facility_id = 'fac-a'`).get()).toEqual({
      lastSequence: communicationAudit.at(-1)?.sequence,
      lastEventHash: communicationAudit.at(-1)?.eventHash,
    });
  });

  it('persists nurse escalation as communication audit without changing the signed care plan', async () => {
    const { target, database } = createFixture();
    const clinician = new D1PatientCommunicationsRepository(database, clinicianScope);
    const nurse = new D1PatientCommunicationsRepository(database, nurseScope);
    await grantSms(clinician, uuid(48));
    const scheduled = await scheduleCare(clinician, uuid(49));
    await clinician.processNotification({
      notificationId: scheduled.id,
      action: 'require_manual_contact',
      expectedVersion: 1,
      reason: 'Передать просроченное тестовое напоминание ответственному сотруднику',
      idempotencyKey: uuid(50),
      requestId: 'request-manual-task-for-escalation',
      now: daytime,
    });
    const task = (await nurse.list({ patientId: 'patient-care-a' })).manualTasks[0];
    const planBefore = target.prepare(`select head.current_version_id as currentVersionId,
      (select count(*) from chronic_care_plan_versions) as versionCount
      from chronic_care_plan_heads head
      where head.care_plan_id = 'chronic-care-plan-care-a'`).get();

    const escalated = await nurse.commandManualTask({
      taskId: task.id,
      action: 'escalate',
      expectedVersion: 1,
      reason: 'Нужна отдельная оценка ответственного врача',
      responseKind: null,
      responseLanguage: null,
      responseSummary: null,
      idempotencyKey: uuid(51),
      requestId: 'request-escalate-manual-contact',
      now: daytime + 60_000,
    });
    expect(escalated.current).toMatchObject({
      state: 'escalated',
      assignedMembershipId: 'membership-care-nurse',
      responseId: null,
    });
    expect(target.prepare(`select action, actor_membership_id as actorMembershipId,
      entity_id as entityId, purpose from audit_events
      where request_id = 'request-escalate-manual-contact'`).get()).toEqual({
      action: 'communication.manual_task.escalate',
      actorMembershipId: 'membership-care-nurse',
      entityId: task.id,
      purpose: 'synthetic_patient_communication',
    });
    expect(target.prepare(`select head.current_version_id as currentVersionId,
      (select count(*) from chronic_care_plan_versions) as versionCount
      from chronic_care_plan_heads head
      where head.care_plan_id = 'chronic-care-plan-care-a'`).get()).toEqual(planBefore);
    expect(target.prepare(`select state from patient_notification_events event
      join patient_notification_heads head
        on head.current_event_id = event.id
      where head.notification_id = ?`).get(scheduled.id)).toEqual({
      state: 'manual_contact_required',
    });
  });

  it('suppresses a queued reminder after channel withdrawal without an attempt', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientCommunicationsRepository(database, clinicianScope);
    await grantSms(repository);
    const scheduled = await scheduleCare(repository);
    await repository.recordChannelConsent({
      patientId: 'patient-care-a',
      channel: 'sms',
      decision: 'withdrawn',
      preferredLanguage: 'ru',
      destinationRef: null,
      destinationHint: null,
      destinationVerified: false,
      source: 'verbal',
      expectedVersion: 1,
      noticeVersion: 'ORION-COMMS-LOCAL-V1',
      noticeHash,
      reason: 'Пациент отозвал разрешение на тестовый SMS-канал',
      idempotencyKey: uuid(7),
      requestId: 'request-withdraw',
    });
    const suppressed = await repository.processNotification({
      notificationId: scheduled.id,
      action: 'process_due',
      expectedVersion: 1,
      reason: 'Повторная проверка согласия перед обработкой',
      idempotencyKey: uuid(8),
      requestId: 'request-suppress',
      now: daytime,
    });
    expect(suppressed.current.state).toBe('suppressed_opt_out');
    expect(target.prepare('select count(*) as count from notification_delivery_attempts').get())
      .toEqual({ count: 0 });
    expect(target.prepare('select status, completed_at as completedAt from outbox_events').get())
      .toMatchObject({ status: 'succeeded' });
  });

  it.each(['process_due', 'retry_now', 'require_manual_contact'] as const)(
    'blocks %s before scheduledAt without attempts or manual tasks',
    async (action) => {
      const { target, database } = createFixture();
      const repository = new D1PatientCommunicationsRepository(database, clinicianScope);
      await grantSms(repository, uuid(11));
      const scheduledAt = daytime + 30 * 60_000;
      const scheduled = await scheduleCare(repository, uuid(12), { scheduledAt });

      await expect(
        repository.processNotification({
          notificationId: scheduled.id,
          action,
          expectedVersion: 1,
          reason: 'Попытка обработки до согласованного времени',
          idempotencyKey:
            action === 'process_due' ? uuid(13) : action === 'retry_now' ? uuid(14) : uuid(35),
          requestId: `request-future-${action}`,
          now: daytime,
        }),
      ).rejects.toBeInstanceOf(CommunicationLifecycleError);

      expect(target.prepare('select count(*) as count from notification_delivery_attempts').get())
        .toEqual({ count: 0 });
      expect(target.prepare('select count(*) as count from communication_manual_task_heads').get())
        .toEqual({ count: 0 });
      expect(target.prepare(`select lock_version as lockVersion
        from patient_notification_heads where notification_id = ?`).get(scheduled.id))
        .toEqual({ lockVersion: 1 });
    },
  );

  it('suppresses require_manual_contact after opt-out without creating a task', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientCommunicationsRepository(database, clinicianScope);
    await grantSms(repository, uuid(15));
    const scheduled = await scheduleCare(repository, uuid(16));
    await repository.recordChannelConsent({
      patientId: 'patient-care-a',
      channel: 'sms',
      decision: 'withdrawn',
      preferredLanguage: 'ru',
      destinationRef: null,
      destinationHint: null,
      destinationVerified: false,
      source: 'verbal',
      expectedVersion: 1,
      noticeVersion: 'ORION-COMMS-LOCAL-V1',
      noticeHash,
      reason: 'Пациент отозвал разрешение перед ручным контактом',
      idempotencyKey: uuid(17),
      requestId: 'request-withdraw-before-manual',
    });

    const suppressed = await repository.processNotification({
      notificationId: scheduled.id,
      action: 'require_manual_contact',
      expectedVersion: 1,
      reason: 'Проверка актуального согласия перед ручной задачей',
      idempotencyKey: uuid(18),
      requestId: 'request-manual-after-withdraw',
      now: daytime,
    });

    expect(suppressed.current.state).toBe('suppressed_opt_out');
    expect(target.prepare('select count(*) as count from notification_delivery_attempts').get())
      .toEqual({ count: 0 });
    expect(target.prepare('select count(*) as count from communication_manual_task_heads').get())
      .toEqual({ count: 0 });
  });

  it('assigns care fallback to the exact task nurse and rejects starting it in quiet hours', async () => {
    const { target, database } = createFixture();
    const clinician = new D1PatientCommunicationsRepository(database, clinicianScope);
    const nurse = new D1PatientCommunicationsRepository(database, nurseScope);
    await grantSms(clinician, uuid(19));
    const scheduled = await scheduleCare(clinician, uuid(20));
    expect(scheduled.current).toMatchObject({
      failureOwnerMembershipId: 'membership-care-nurse',
      failureOwner: 'М. Тестовая',
    });
    await clinician.processNotification({
      notificationId: scheduled.id,
      action: 'require_manual_contact',
      expectedVersion: 1,
      reason: 'Создать ручную задачу ответственному по плану',
      idempotencyKey: uuid(21),
      requestId: 'request-create-exact-owner-task',
      now: daytime,
    });
    const task = (await nurse.list({ patientId: 'patient-care-a' })).manualTasks[0];
    expect(task.current.assignedMembershipId).toBe('membership-care-nurse');

    const quietAt = Date.parse('2026-09-05T18:00:00.000Z');
    await expect(
      nurse.commandManualTask({
        taskId: task.id,
        action: 'start',
        expectedVersion: 1,
        reason: 'Попытка исходящего контакта в тихие часы',
        responseKind: null,
        responseLanguage: null,
        responseSummary: null,
        idempotencyKey: uuid(22),
        requestId: 'request-start-manual-in-quiet-hours',
        now: quietAt,
      }),
    ).rejects.toBeInstanceOf(CommunicationLifecycleError);
    expect(target.prepare(`select count(*) as count
      from communication_manual_task_events where task_id = ?`).get(task.id))
      .toEqual({ count: 1 });
  });

  it('selects approved v2 and blocks an older approved template behind retired latest v2', async () => {
    const approvedFixture = createFixture();
    insertTemplateVersion(approvedFixture.target, {
      id: 'communication-template-care-sms-ru-v2-approved',
      status: 'approved_test',
      body: 'ORION V2: пункт плана на {{dueDate}}. Клиника: {{facilityName}}.',
      hashCharacter: 'd',
    });
    const approvedRepository = new D1PatientCommunicationsRepository(
      approvedFixture.database,
      clinicianScope,
    );
    await grantSms(approvedRepository, uuid(23));
    const fromV2 = await scheduleCare(approvedRepository, uuid(24));
    expect(fromV2.current.templateVersionId)
      .toBe('communication-template-care-sms-ru-v2-approved');
    expect(fromV2.current.renderedBody).toContain('ORION V2');

    const retiredFixture = createFixture();
    insertTemplateVersion(retiredFixture.target, {
      id: 'communication-template-care-sms-ru-v2-retired',
      status: 'retired',
      body: 'ORION RETIRED: пункт плана на {{dueDate}}. Клиника: {{facilityName}}.',
      hashCharacter: 'e',
    });
    const retiredRepository = new D1PatientCommunicationsRepository(
      retiredFixture.database,
      clinicianScope,
    );
    await grantSms(retiredRepository, uuid(25));
    await expect(scheduleCare(retiredRepository, uuid(26)))
      .rejects.toBeInstanceOf(CommunicationTemplateUnavailableError);
    expect(retiredFixture.target.prepare(
      'select count(*) as count from patient_notification_events',
    ).get()).toEqual({ count: 0 });
  });

  it('rejects direct SQL tampering of the rendered body, outbox binding, and purpose/source pair', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientCommunicationsRepository(database, clinicianScope);
    await grantSms(repository, uuid(27));
    const scheduled = await scheduleCare(repository, uuid(28));

    expectTamperedInitialNotificationRejected(target, scheduled.id, 1, 'rendered_body');
    expectTamperedInitialNotificationRejected(target, scheduled.id, 2, 'outbox');
    expectTamperedInitialNotificationRejected(target, scheduled.id, 3, 'purpose_source');
    expect(target.prepare('select count(*) as count from patient_notification_events').get())
      .toEqual({ count: 1 });
    expect(target.prepare('select count(*) as count from outbox_events').get())
      .toEqual({ count: 1 });
  });

  it('rejects a raw consent row with a non-system destination', () => {
    const { target } = createFixture();

    expect(() =>
      target.prepare(`insert into patient_channel_consent_events (
        id, organization_id, facility_id, patient_id, channel, version,
        supersedes_consent_event_id, decision, preferred_language,
        destination_ref, destination_hint, destination_fingerprint,
        destination_verified_at, notice_version, notice_hash, source,
        effective_at, captured_by_membership_id, change_reason, created_at
      ) values (?, 'org-a', 'fac-a', 'patient-care-a', 'telegram', 1,
        null, 'granted', 'ru', 'test:telegram:patient-care-a', ?, ?, ?,
        'ORION-COMMS-LOCAL-V1', ?, 'verbal', ?, 'membership-a', ?, ?)`)
        .run(
          'tampered-real-destination',
          '+7 700 000 00 00',
          'f'.repeat(64),
          daytime,
          noticeHash,
          daytime,
          'Проверка запрета реального адреса',
          daytime,
        ),
    ).toThrow(/exact system synthetic destination/);
  });

  it('rejects linking a patient response to a different manual task', async () => {
    const { target, database } = createFixture();
    const clinician = new D1PatientCommunicationsRepository(database, clinicianScope);
    const nurse = new D1PatientCommunicationsRepository(database, nurseScope);
    await grantSms(clinician, uuid(29));

    const first = await scheduleCare(clinician, uuid(30));
    await clinician.processNotification({
      notificationId: first.id,
      action: 'require_manual_contact',
      expectedVersion: 1,
      reason: 'Создать первую ручную задачу',
      idempotencyKey: uuid(31),
      requestId: 'request-first-manual-task',
      now: daytime,
    });
    const second = await scheduleCare(clinician, uuid(32), {
      sourceRecordId: 'chronic-task-care-overdue',
      scheduledAt: daytime + 1_000,
    });
    await clinician.processNotification({
      notificationId: second.id,
      action: 'require_manual_contact',
      expectedVersion: 1,
      reason: 'Создать вторую ручную задачу',
      idempotencyKey: uuid(33),
      requestId: 'request-second-manual-task',
      now: daytime + 1_000,
    });
    const tasks = (await nurse.list({ patientId: 'patient-care-a' })).manualTasks;
    const firstTask = tasks.find((task) => task.notificationId === first.id)!;
    const secondTask = tasks.find((task) => task.notificationId === second.id)!;
    await nurse.commandManualTask({
      taskId: firstTask.id,
      action: 'record_response',
      expectedVersion: 1,
      reason: 'Записать ответ только для первой задачи',
      responseKind: 'confirmed',
      responseLanguage: 'ru',
      responseSummary: 'Пациент подтвердил первый тестовый ручной контакт.',
      idempotencyKey: uuid(34),
      requestId: 'request-first-task-response',
      now: daytime + 60_000,
    });
    const response = target.prepare(`select id
      from communication_patient_responses where manual_task_id = ?`).get(firstTask.id) as {
      id: string;
    };

    expect(() =>
      target.prepare(`insert into communication_manual_task_events (
        id, organization_id, facility_id, task_id, notification_id, version,
        supersedes_task_event_id, state, assigned_membership_id, due_at,
        failure_reason, response_id, outcome_summary,
        changed_by_membership_id, change_reason, created_at
      ) select 'tampered-cross-task-event', organization_id, facility_id,
        task_id, notification_id, 2, id, 'in_progress', assigned_membership_id,
        due_at, failure_reason, ?, 'Подставлен ответ другой задачи',
        'membership-care-nurse', 'Проверка связи ответа с задачей', ?
      from communication_manual_task_events
      where task_id = ? and version = 1`)
        .run(response.id, daytime + 120_000, secondTask.id),
    ).toThrow(/same task and notification/);
    expect(target.prepare(`select count(*) as count
      from communication_manual_task_events where task_id = ?`).get(secondTask.id))
      .toEqual({ count: 1 });
  });

  it('defers in quiet hours and rejects processing before the next eligible time', async () => {
    const { database } = createFixture();
    const repository = new D1PatientCommunicationsRepository(database, clinicianScope);
    await grantSms(repository);
    const quietAt = Date.parse('2026-09-05T18:00:00.000Z');
    const scheduled = await repository.scheduleNotification({
      sourceType: 'care_plan_task',
      sourceRecordId: 'chronic-task-care-follow-up',
      sourceVersionId: 'chronic-care-plan-care-a-v1',
      channel: 'sms',
      language: 'ru',
      scheduledAt: quietAt,
      reason: 'Проверка переноса в тихие часы',
      idempotencyKey: uuid(9),
      requestId: 'request-quiet',
    });
    expect(scheduled.current.state).toBe('deferred_quiet_hours');
    expect(scheduled.current.nextAttemptAt).toBeGreaterThan(quietAt);
    await expect(
      repository.processNotification({
        notificationId: scheduled.id,
        action: 'process_due',
        expectedVersion: 1,
        reason: 'Ранняя попытка обработки очереди',
        idempotencyKey: uuid(10),
        requestId: 'request-too-early',
        now: quietAt,
      }),
    ).rejects.toBeInstanceOf(CommunicationLifecycleError);
  });
});
