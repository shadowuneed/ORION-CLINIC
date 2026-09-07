import { hashAuditEvent } from '@/lib/audit/event-hash';
import {
  assertCommunicationSourceAllowed,
  communicationCapabilities,
  requireCommunicationPermission,
  type CommunicationPermission,
  type CommunicationScope,
} from '@/lib/auth/communication-access';
import {
  LOCAL_COMMUNICATION_SOURCE_LABEL,
  assertNotificationTransition,
  nextManualContactState,
  purposeForSource,
  renderApprovedTemplate,
  resolveCommunicationWindow,
  syntheticDestinationHint,
  syntheticDestinationRef,
  type ChannelConsentDecision,
  type CommunicationChannel,
  type CommunicationLanguage,
  type CommunicationPurpose,
  type CommunicationSourceType,
  type ManualContactState,
  type NotificationState,
  type PatientResponseKind,
} from '@/lib/domain/patient-communications';

export type CommunicationPatient = {
  id: string;
  displayName: string;
  medicalRecordNumber: string;
};

export type ChannelConsentRecord = {
  id: string;
  patientId: string;
  channel: CommunicationChannel;
  version: number;
  decision: ChannelConsentDecision;
  preferredLanguage: CommunicationLanguage;
  destinationHint: string | null;
  destinationVerifiedAt: number | null;
  noticeVersion: string;
  noticeHash: string;
  source: 'written' | 'verbal' | 'digital';
  effectiveAt: number;
  capturedByMembershipId: string;
  changeReason: string;
};

export type CommunicationTemplateRecord = {
  id: string;
  templateCode: string;
  version: number;
  purpose: CommunicationPurpose;
  channel: CommunicationChannel;
  language: CommunicationLanguage;
  body: string;
  contentHash: string;
  protectedLinkRequired: boolean;
  status: 'approved_test';
};

export type CommunicationPolicyRecord = {
  id: string;
  policyCode: string;
  version: number;
  quietStartMinute: number;
  quietEndMinute: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  protectedLinkMode: 'disabled_minimum_content_only';
  sourceType: 'local_test';
  timeZone: string;
};

export type CommunicationSourceRecord = {
  type: CommunicationSourceType;
  recordId: string;
  versionId: string;
  patient: CommunicationPatient;
  title: string;
  occursAt: number;
  status: 'confirmed' | 'plan_task_open';
};

export type DeliveryAttemptRecord = {
  id: string;
  attemptNumber: number;
  providerAdapter: 'disconnected';
  outcome: 'provider_unavailable';
  errorCode: 'PROVIDER_NOT_CONFIGURED';
  nextAttemptAt: number | null;
  occurredAt: number;
};

export type ManualContactTaskRecord = {
  id: string;
  notificationId: string;
  patient: CommunicationPatient;
  channel: CommunicationChannel;
  destinationHint: string;
  current: {
    id: string;
    version: number;
    state: ManualContactState;
    assignedMembershipId: string;
    assignedTo: string;
    dueAt: number;
    failureReason: string;
    responseId: string | null;
    outcomeSummary: string | null;
    changeReason: string;
  };
};

export type NotificationRecord = {
  id: string;
  patient: CommunicationPatient;
  current: {
    id: string;
    version: number;
    state: NotificationState;
    purpose: CommunicationPurpose;
    channel: CommunicationChannel;
    language: CommunicationLanguage;
    consentEventId: string;
    templateVersionId: string;
    policyVersionId: string;
    sourceType: CommunicationSourceType;
    sourceRecordId: string;
    sourceVersionId: string;
    requestedAt: number;
    scheduledAt: number;
    nextAttemptAt: number | null;
    destinationHint: string;
    renderedBody: string;
    contentHash: string;
    attemptCount: number;
    failureOwnerMembershipId: string;
    failureOwner: string;
    lastFailureCode: string | null;
    changeReason: string;
  };
  attempts: DeliveryAttemptRecord[];
};

export type CommunicationWorkspace = {
  dataMode: 'synthetic-only';
  sourceLabel: string;
  role: CommunicationScope['role'];
  providerConnection: 'not_connected';
  providerCallsEnabled: false;
  policy: CommunicationPolicyRecord | null;
  patients: CommunicationPatient[];
  consents: ChannelConsentRecord[];
  templates: CommunicationTemplateRecord[];
  sources: CommunicationSourceRecord[];
  notifications: NotificationRecord[];
  manualTasks: ManualContactTaskRecord[];
  capabilities: Record<CommunicationPermission, boolean>;
  protectedLink: {
    status: 'not_configured';
    strategy: 'minimum_content_only';
  };
};

export type RecordChannelConsentCommand = {
  patientId: string;
  channel: CommunicationChannel;
  decision: ChannelConsentDecision;
  preferredLanguage: CommunicationLanguage;
  destinationRef: string | null;
  destinationHint: string | null;
  destinationVerified: boolean;
  source: 'written' | 'verbal' | 'digital';
  expectedVersion: number | null;
  noticeVersion: string;
  noticeHash: string;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type ScheduleNotificationCommand = {
  sourceType: CommunicationSourceType;
  sourceRecordId: string;
  sourceVersionId: string;
  channel: CommunicationChannel;
  language: CommunicationLanguage;
  scheduledAt: number;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type ProcessNotificationCommand = {
  notificationId: string;
  action: 'process_due' | 'retry_now' | 'cancel' | 'require_manual_contact';
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  requestId: string;
  now?: number;
};

export type ManualContactCommand = {
  taskId: string;
  action: 'start' | 'record_response' | 'complete' | 'escalate' | 'cancel';
  expectedVersion: number;
  reason: string;
  responseKind: PatientResponseKind | null;
  responseLanguage: CommunicationLanguage | null;
  responseSummary: string | null;
  idempotencyKey: string;
  requestId: string;
  now?: number;
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type IdempotencyRow = {
  id: string;
  requestHash: string;
  status: string;
  resultResourceId: string | null;
  responseJson: string | null;
};

type PatientRow = CommunicationPatient;
type ConsentRow = ChannelConsentRecord & {
  destinationRef: string | null;
  destinationFingerprint: string | null;
};
type TemplateRow = CommunicationTemplateRecord & { placeholdersJson: string };
type PolicyRow = CommunicationPolicyRecord & { timeZone: string };
type SourceRow = CommunicationSourceRecord;
type NotificationRow = {
  notificationId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  currentEventId: string;
  currentVersion: number;
  state: NotificationState;
  purpose: CommunicationPurpose;
  channel: CommunicationChannel;
  language: CommunicationLanguage;
  consentEventId: string;
  templateVersionId: string;
  policyVersionId: string;
  sourceType: CommunicationSourceType;
  sourceRecordId: string;
  sourceVersionId: string;
  requestedAt: number;
  scheduledAt: number;
  nextAttemptAt: number | null;
  destinationHint: string;
  destinationFingerprint: string;
  renderedBody: string;
  templateValuesJson: string | null;
  contentHash: string;
  outboxEventId: string;
  attemptCount: number;
  failureOwnerMembershipId: string;
  failureOwner: string;
  lastFailureCode: string | null;
  changeReason: string;
};
type AttemptRow = DeliveryAttemptRecord & { notificationId: string };
type ManualTaskRow = {
  taskId: string;
  notificationId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  channel: CommunicationChannel;
  destinationHint: string;
  currentEventId: string;
  currentVersion: number;
  state: ManualContactState;
  assignedMembershipId: string;
  assignedTo: string;
  dueAt: number;
  failureReason: string;
  responseId: string | null;
  outcomeSummary: string | null;
  changeReason: string;
};

export class CommunicationAuditUnavailableError extends Error {}
export class CommunicationConflictError extends Error {}
export class CommunicationConsentRequiredError extends Error {}
export class CommunicationLifecycleError extends Error {}
export class CommunicationNotFoundError extends Error {}
export class CommunicationPolicyUnavailableError extends Error {}
export class CommunicationTemplateUnavailableError extends Error {}
export class CommunicationValidationError extends Error {}
export class CommunicationVersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly resource: 'consent' | 'notification' | 'manual_task',
  ) {
    super(`${resource} version conflict`);
  }
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeNullable(value: string | null) {
  const normalized = value ? normalizeText(value) : '';
  return normalized || null;
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function sha256Json(value: unknown) {
  return sha256Text(JSON.stringify(value));
}

function formatDateTime(timestamp: number, timeZone: string, language: CommunicationLanguage) {
  const locale = language === 'kk' ? 'kk-KZ' : 'ru-RU';
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
  return { date, time };
}

function timeZoneOffset(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(
    values.year,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  ) - timestamp;
}

function localDateAtHour(date: string, hour: number, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, 0, 0);
  let result = wallTime - timeZoneOffset(wallTime, timeZone);
  result = wallTime - timeZoneOffset(result, timeZone);
  return result;
}

function notificationFromRow(
  row: NotificationRow,
  attempts: DeliveryAttemptRecord[] = [],
): NotificationRecord {
  return {
    id: row.notificationId,
    patient: {
      id: row.patientId,
      displayName: row.patientDisplayName,
      medicalRecordNumber: row.medicalRecordNumber,
    },
    current: {
      id: row.currentEventId,
      version: row.currentVersion,
      state: row.state,
      purpose: row.purpose,
      channel: row.channel,
      language: row.language,
      consentEventId: row.consentEventId,
      templateVersionId: row.templateVersionId,
      policyVersionId: row.policyVersionId,
      sourceType: row.sourceType,
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
      requestedAt: row.requestedAt,
      scheduledAt: row.scheduledAt,
      nextAttemptAt: row.nextAttemptAt,
      destinationHint: row.destinationHint,
      renderedBody: row.renderedBody,
      contentHash: row.contentHash,
      attemptCount: row.attemptCount,
      failureOwnerMembershipId: row.failureOwnerMembershipId,
      failureOwner: row.failureOwner,
      lastFailureCode: row.lastFailureCode,
      changeReason: row.changeReason,
    },
    attempts,
  };
}

function manualTaskFromRow(row: ManualTaskRow): ManualContactTaskRecord {
  return {
    id: row.taskId,
    notificationId: row.notificationId,
    patient: {
      id: row.patientId,
      displayName: row.patientDisplayName,
      medicalRecordNumber: row.medicalRecordNumber,
    },
    channel: row.channel,
    destinationHint: row.destinationHint,
    current: {
      id: row.currentEventId,
      version: row.currentVersion,
      state: row.state,
      assignedMembershipId: row.assignedMembershipId,
      assignedTo: row.assignedTo,
      dueAt: row.dueAt,
      failureReason: row.failureReason,
      responseId: row.responseId,
      outcomeSummary: row.outcomeSummary,
      changeReason: row.changeReason,
    },
  };
}

export class D1PatientCommunicationsRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: CommunicationScope,
  ) {}

  async list(input: {
    patientId?: string;
    state?: NotificationState | 'all';
    limit?: number;
  } = {}): Promise<CommunicationWorkspace> {
    requireCommunicationPermission(this.scope.role, 'workspace.read');
    const limit = input.limit ?? 100;
    const patientFilter = input.patientId ? 'and patient.id = ?3' : '';
    const patientBinds: Array<string | number> = input.patientId
      ? [this.scope.organizationId, this.scope.facilityId, input.patientId]
      : [this.scope.organizationId, this.scope.facilityId];
    const patientAccessFilter = this.scope.role === 'clinician'
      ? `and (
          exists (
            select 1 from encounters encounter
            where encounter.organization_id = patient.organization_id
              and encounter.facility_id = patient.facility_id
              and encounter.patient_id = patient.id
              and encounter.clinician_membership_id = ?${patientBinds.push(this.scope.membershipId)}
              and encounter.status <> 'cancelled'
          ) or exists (
            select 1 from chronic_registry_enrollments enrollment
            join chronic_registry_enrollment_heads enrollment_head
              on enrollment_head.organization_id = enrollment.organization_id
              and enrollment_head.facility_id = enrollment.facility_id
              and enrollment_head.enrollment_id = enrollment.id
            join chronic_registry_enrollment_versions enrollment_current
              on enrollment_current.organization_id = enrollment_head.organization_id
              and enrollment_current.facility_id = enrollment_head.facility_id
              and enrollment_current.enrollment_id = enrollment_head.enrollment_id
              and enrollment_current.id = enrollment_head.current_version_id
              and enrollment_current.status = 'active'
            where enrollment.organization_id = patient.organization_id
              and enrollment.facility_id = patient.facility_id
              and enrollment.patient_id = patient.id
              and enrollment.managing_clinician_membership_id = ?${patientBinds.length}
          )
        )`
      : this.scope.role === 'nurse'
        ? `and exists (
            select 1 from chronic_care_tasks task
            join chronic_care_task_heads task_head
              on task_head.organization_id = task.organization_id
              and task_head.facility_id = task.facility_id
              and task_head.task_id = task.id
            join chronic_care_task_versions task_current
              on task_current.organization_id = task_head.organization_id
              and task_current.facility_id = task_head.facility_id
              and task_current.task_id = task_head.task_id
              and task_current.id = task_head.current_version_id
              and task_current.status in ('pending', 'in_progress', 'escalated')
            join chronic_registry_enrollment_heads enrollment_head
              on enrollment_head.organization_id = task.organization_id
              and enrollment_head.facility_id = task.facility_id
              and enrollment_head.enrollment_id = task.enrollment_id
            join chronic_registry_enrollment_versions enrollment_current
              on enrollment_current.organization_id = enrollment_head.organization_id
              and enrollment_current.facility_id = enrollment_head.facility_id
              and enrollment_current.enrollment_id = enrollment_head.enrollment_id
              and enrollment_current.id = enrollment_head.current_version_id
              and enrollment_current.status = 'active'
            where task.organization_id = patient.organization_id
              and task.facility_id = patient.facility_id
              and task.patient_id = patient.id
              and task.assigned_membership_id = ?${patientBinds.push(this.scope.membershipId)}
          )`
        : `and exists (
            select 1 from appointments appointment
            join appointment_heads appointment_head
              on appointment_head.organization_id = appointment.organization_id
              and appointment_head.facility_id = appointment.facility_id
              and appointment_head.appointment_id = appointment.id
            join appointment_versions appointment_current
              on appointment_current.organization_id = appointment_head.organization_id
              and appointment_current.facility_id = appointment_head.facility_id
              and appointment_current.appointment_id = appointment_head.appointment_id
              and appointment_current.id = appointment_head.current_version_id
              and appointment_current.status = 'confirmed'
            where appointment.organization_id = patient.organization_id
              and appointment.facility_id = patient.facility_id
              and appointment.patient_id = patient.id
          )`;
    patientBinds.push(limit);
    const patientLimitBind = `?${patientBinds.length}`;
    const notificationBinds: Array<string | number> = [
      this.scope.organizationId,
      this.scope.facilityId,
    ];
    const notificationFilters: string[] = [];
    if (input.state && input.state !== 'all') {
      notificationBinds.push(input.state);
      notificationFilters.push(`and event.state = ?${notificationBinds.length}`);
    }
    if (input.patientId) {
      notificationBinds.push(input.patientId);
      notificationFilters.push(`and event.patient_id = ?${notificationBinds.length}`);
    }
    const notificationAccessFilter = this.scope.role === 'registrar'
      ? `and event.source_type = 'appointment' and exists (
          select 1 from appointments appointment
          join appointment_heads appointment_head
            on appointment_head.organization_id = appointment.organization_id
            and appointment_head.facility_id = appointment.facility_id
            and appointment_head.appointment_id = appointment.id
          join appointment_versions appointment_current
            on appointment_current.organization_id = appointment_head.organization_id
            and appointment_current.facility_id = appointment_head.facility_id
            and appointment_current.appointment_id = appointment_head.appointment_id
            and appointment_current.id = appointment_head.current_version_id
            and appointment_current.status = 'confirmed'
          where appointment.organization_id = event.organization_id
            and appointment.facility_id = event.facility_id
            and appointment.id = event.source_record_id
        )`
      : this.scope.role === 'clinician'
        ? `and (
            (event.source_type = 'appointment' and exists (
              select 1 from appointments appointment
              join appointment_heads appointment_head
                on appointment_head.organization_id = appointment.organization_id
                and appointment_head.facility_id = appointment.facility_id
                and appointment_head.appointment_id = appointment.id
              join appointment_versions appointment_current
                on appointment_current.organization_id = appointment_head.organization_id
                and appointment_current.facility_id = appointment_head.facility_id
                and appointment_current.appointment_id = appointment_head.appointment_id
                and appointment_current.id = appointment_head.current_version_id
                and appointment_current.status = 'confirmed'
              join service_requests request
                on request.organization_id = appointment.organization_id
                and request.facility_id = appointment.facility_id
                and request.id = appointment.referral_request_id
              join encounters encounter
                on encounter.organization_id = request.organization_id
                and encounter.facility_id = request.facility_id
                and encounter.id = request.encounter_id
                and encounter.clinician_membership_id = ?${notificationBinds.push(this.scope.membershipId)}
                and encounter.status <> 'cancelled'
              where appointment.organization_id = event.organization_id
                and appointment.facility_id = event.facility_id
                and appointment.id = event.source_record_id
            )) or (event.source_type = 'care_plan_task' and exists (
              select 1 from chronic_care_tasks task
              join chronic_care_task_heads task_head
                on task_head.organization_id = task.organization_id
                and task_head.facility_id = task.facility_id
                and task_head.task_id = task.id
              join chronic_care_task_versions task_current
                on task_current.organization_id = task_head.organization_id
                and task_current.facility_id = task_head.facility_id
                and task_current.task_id = task_head.task_id
                and task_current.id = task_head.current_version_id
                and task_current.status in ('pending', 'in_progress', 'escalated')
              join chronic_registry_enrollments enrollment
                on enrollment.organization_id = task.organization_id
                and enrollment.facility_id = task.facility_id
                and enrollment.id = task.enrollment_id
              join chronic_registry_enrollment_heads enrollment_head
                on enrollment_head.organization_id = enrollment.organization_id
                and enrollment_head.facility_id = enrollment.facility_id
                and enrollment_head.enrollment_id = enrollment.id
              join chronic_registry_enrollment_versions enrollment_current
                on enrollment_current.organization_id = enrollment_head.organization_id
                and enrollment_current.facility_id = enrollment_head.facility_id
                and enrollment_current.enrollment_id = enrollment_head.enrollment_id
                and enrollment_current.id = enrollment_head.current_version_id
                and enrollment_current.status = 'active'
              where task.organization_id = event.organization_id
                and task.facility_id = event.facility_id
                and task.id = event.source_record_id
                and enrollment.managing_clinician_membership_id = ?${notificationBinds.length}
            ))
          )`
        : `and event.source_type = 'care_plan_task' and exists (
            select 1 from chronic_care_tasks task
            join chronic_care_task_heads task_head
              on task_head.organization_id = task.organization_id
              and task_head.facility_id = task.facility_id
              and task_head.task_id = task.id
            join chronic_care_task_versions task_current
              on task_current.organization_id = task_head.organization_id
              and task_current.facility_id = task_head.facility_id
              and task_current.task_id = task_head.task_id
              and task_current.id = task_head.current_version_id
              and task_current.status in ('pending', 'in_progress', 'escalated')
            join chronic_registry_enrollment_heads enrollment_head
              on enrollment_head.organization_id = task.organization_id
              and enrollment_head.facility_id = task.facility_id
              and enrollment_head.enrollment_id = task.enrollment_id
            join chronic_registry_enrollment_versions enrollment_current
              on enrollment_current.organization_id = enrollment_head.organization_id
              and enrollment_current.facility_id = enrollment_head.facility_id
              and enrollment_current.enrollment_id = enrollment_head.enrollment_id
              and enrollment_current.id = enrollment_head.current_version_id
              and enrollment_current.status = 'active'
            where task.organization_id = event.organization_id
              and task.facility_id = event.facility_id
              and task.id = event.source_record_id
              and task.assigned_membership_id = ?${notificationBinds.push(this.scope.membershipId)}
          )`;
    notificationBinds.push(limit);
    const notificationLimitBind = `?${notificationBinds.length}`;
    const manualBinds: Array<string | number> = [
      this.scope.organizationId,
      this.scope.facilityId,
    ];
    const manualPatientFilter = input.patientId
      ? `and notification.patient_id = ?${manualBinds.push(input.patientId)}`
      : '';
    manualBinds.push(this.scope.membershipId);
    const manualAssigneeBind = `?${manualBinds.length}`;
    manualBinds.push(limit);
    const manualLimitBind = `?${manualBinds.length}`;

    const [policy, patients, templates, appointments, careTasks, notifications, manualTasks] =
      await Promise.all([
        this.getPolicy(),
        this.database.prepare(`
          select patient.id,
            coalesce(profile.display_name, patient.display_name) as displayName,
            patient.medical_record_number as medicalRecordNumber
          from patients patient
          left join patient_profile_heads profile_head
            on profile_head.organization_id = patient.organization_id
            and profile_head.facility_id = patient.facility_id
            and profile_head.patient_id = patient.id
          left join patient_profile_versions profile
            on profile.organization_id = profile_head.organization_id
            and profile.facility_id = profile_head.facility_id
            and profile.patient_id = profile_head.patient_id
            and profile.id = profile_head.current_version_id
          where patient.organization_id = ?1 and patient.facility_id = ?2
            and patient.status = 'active' ${patientFilter}
            ${patientAccessFilter}
          order by displayName, patient.id limit ${patientLimitBind}
        `).bind(...patientBinds).all<PatientRow>(),
        this.database.prepare(`
          select id, template_code as templateCode, version, purpose, channel,
            language, body, placeholders_json as placeholdersJson,
            content_hash as contentHash,
            protected_link_required as protectedLinkRequired, status
          from communication_template_versions
          where organization_id = ?1 and facility_id = ?2
            and status = 'approved_test' and source_type = 'local_test'
            and version = (
              select max(latest.version)
              from communication_template_versions latest
              where latest.organization_id = communication_template_versions.organization_id
                and latest.facility_id = communication_template_versions.facility_id
                and latest.purpose = communication_template_versions.purpose
                and latest.channel = communication_template_versions.channel
                and latest.language = communication_template_versions.language
            )
          order by purpose, channel, language
        `).bind(this.scope.organizationId, this.scope.facilityId).all<TemplateRow>(),
        this.listAppointmentSources(),
        this.listCareTaskSources(),
        this.database.prepare(`${this.notificationSelectSql()}
          where head.organization_id = ?1 and head.facility_id = ?2
            ${notificationFilters.join('\n')}
            ${notificationAccessFilter}
          order by event.scheduled_at desc, event.notification_id
          limit ${notificationLimitBind}
        `).bind(...notificationBinds).all<NotificationRow>(),
        this.database.prepare(`${this.manualTaskSelectSql()}
          where head.organization_id = ?1 and head.facility_id = ?2
            ${manualPatientFilter}
            and event.assigned_membership_id = ${manualAssigneeBind}
          order by event.due_at, event.task_id
          limit ${manualLimitBind}
        `).bind(...manualBinds).all<ManualTaskRow>(),
      ]);

    const accessiblePatientIds = patients.results.map((patient) => patient.id);
    const consentRows = accessiblePatientIds.length
      ? await this.database.prepare(`
          select event.id, event.patient_id as patientId, event.channel,
            event.version, event.decision,
            event.preferred_language as preferredLanguage,
            event.destination_ref as destinationRef,
            event.destination_hint as destinationHint,
            event.destination_fingerprint as destinationFingerprint,
            event.destination_verified_at as destinationVerifiedAt,
            event.notice_version as noticeVersion, event.notice_hash as noticeHash,
            event.source, event.effective_at as effectiveAt,
            event.captured_by_membership_id as capturedByMembershipId,
            event.change_reason as changeReason
          from patient_channel_consent_heads head
          join patient_channel_consent_events event
            on event.organization_id = head.organization_id
            and event.facility_id = head.facility_id
            and event.patient_id = head.patient_id
            and event.channel = head.channel
            and event.id = head.current_consent_event_id
          where head.organization_id = ?1 and head.facility_id = ?2
            and head.patient_id in (${accessiblePatientIds.map((_, index) => `?${index + 3}`).join(', ')})
          order by event.patient_id, event.channel
        `).bind(
          this.scope.organizationId,
          this.scope.facilityId,
          ...accessiblePatientIds,
        ).all<ConsentRow>()
      : null;
    const accessibleNotificationIds = notifications.results.map(
      (notification) => notification.notificationId,
    );
    const attemptRows = accessibleNotificationIds.length
      ? await this.database.prepare(`
          select id, notification_id as notificationId,
            attempt_number as attemptNumber, provider_adapter as providerAdapter,
            outcome, error_code as errorCode, next_attempt_at as nextAttemptAt,
            occurred_at as occurredAt
          from notification_delivery_attempts
          where organization_id = ?1 and facility_id = ?2
            and notification_id in (${accessibleNotificationIds.map((_, index) => `?${index + 3}`).join(', ')})
          order by notification_id, attempt_number
        `).bind(
          this.scope.organizationId,
          this.scope.facilityId,
          ...accessibleNotificationIds,
        ).all<AttemptRow>()
      : null;

    const attemptMap = new Map<string, DeliveryAttemptRecord[]>();
    for (const attempt of attemptRows?.results ?? []) {
      const entries = attemptMap.get(attempt.notificationId) ?? [];
      entries.push({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        providerAdapter: attempt.providerAdapter,
        outcome: attempt.outcome,
        errorCode: attempt.errorCode,
        nextAttemptAt: attempt.nextAttemptAt,
        occurredAt: attempt.occurredAt,
      });
      attemptMap.set(attempt.notificationId, entries);
    }

    const patientMatches = (patientId: string) =>
      !input.patientId || patientId === input.patientId;
    const accessiblePatientIdSet = new Set(accessiblePatientIds);

    return {
      dataMode: 'synthetic-only',
      sourceLabel: LOCAL_COMMUNICATION_SOURCE_LABEL,
      role: this.scope.role,
      providerConnection: 'not_connected',
      providerCallsEnabled: false,
      policy,
      patients: patients.results,
      consents: (consentRows?.results ?? [])
        .filter(
          (consent) =>
            accessiblePatientIdSet.has(consent.patientId) && patientMatches(consent.patientId),
        )
        .map((consent) => ({
          id: consent.id,
          patientId: consent.patientId,
          channel: consent.channel,
          version: consent.version,
          decision: consent.decision,
          preferredLanguage: consent.preferredLanguage,
          destinationHint: consent.destinationHint,
          destinationVerifiedAt: consent.destinationVerifiedAt,
          noticeVersion: consent.noticeVersion,
          noticeHash: consent.noticeHash,
          source: consent.source,
          effectiveAt: consent.effectiveAt,
          capturedByMembershipId: consent.capturedByMembershipId,
          changeReason: consent.changeReason,
        })),
      templates: templates.results.map((template) => ({
        id: template.id,
        templateCode: template.templateCode,
        version: template.version,
        purpose: template.purpose,
        channel: template.channel,
        language: template.language,
        body: template.body,
        contentHash: template.contentHash,
        protectedLinkRequired: Boolean(template.protectedLinkRequired),
        status: template.status,
      })),
      sources: [...appointments, ...careTasks].filter((source) =>
        patientMatches(source.patient.id),
      ),
      notifications: notifications.results
        .map((row) =>
          notificationFromRow(row, attemptMap.get(row.notificationId) ?? []),
        ),
      manualTasks: manualTasks.results
        .filter(
          (row) =>
            accessiblePatientIdSet.has(row.patientId) && patientMatches(row.patientId),
        )
        .map(manualTaskFromRow),
      capabilities: communicationCapabilities(this.scope.role),
      protectedLink: {
        status: 'not_configured',
        strategy: 'minimum_content_only',
      },
    };
  }

  private async getPolicy(): Promise<PolicyRow | null> {
    return this.database.prepare(`
      select policy.id, policy.policy_code as policyCode, policy.version,
        policy.quiet_start_minute as quietStartMinute,
        policy.quiet_end_minute as quietEndMinute,
        policy.max_attempts as maxAttempts,
        policy.retry_delay_minutes as retryDelayMinutes,
        policy.protected_link_mode as protectedLinkMode,
        policy.source_type as sourceType, facility.timezone as timeZone
      from communication_policy_versions policy
      join facilities facility
        on facility.organization_id = policy.organization_id
        and facility.id = policy.facility_id
        and facility.status = 'active'
      where policy.organization_id = ?1 and policy.facility_id = ?2
        and policy.status = 'active_test' and policy.source_type = 'local_test'
      order by policy.version desc limit 1
    `).bind(this.scope.organizationId, this.scope.facilityId).first<PolicyRow>();
  }

  private async listAppointmentSources(): Promise<CommunicationSourceRecord[]> {
    if (this.scope.role === 'nurse') return [];
    const clinicianFilter = this.scope.role === 'clinician'
      ? `and exists (
          select 1 from service_requests request
          join encounters encounter
            on encounter.organization_id = request.organization_id
            and encounter.facility_id = request.facility_id
            and encounter.id = request.encounter_id
          where request.organization_id = appointment.organization_id
            and request.facility_id = appointment.facility_id
            and request.id = appointment.referral_request_id
            and encounter.clinician_membership_id = ?3
        )`
      : '';
    const binds = this.scope.role === 'clinician'
      ? [this.scope.organizationId, this.scope.facilityId, this.scope.membershipId]
      : [this.scope.organizationId, this.scope.facilityId];
    const rows = await this.database.prepare(`
      select appointment.id as recordId, version.id as versionId,
        appointment.patient_id as patientId,
        coalesce(profile.display_name, patient.display_name) as patientDisplayName,
        patient.medical_record_number as medicalRecordNumber,
        service.display_name as serviceName, provider.display_name as providerName,
        slot.starts_at as occursAt
      from appointments appointment
      join appointment_heads head
        on head.organization_id = appointment.organization_id
        and head.facility_id = appointment.facility_id
        and head.appointment_id = appointment.id
      join appointment_versions version
        on version.organization_id = head.organization_id
        and version.facility_id = head.facility_id
        and version.appointment_id = head.appointment_id
        and version.id = head.current_version_id
        and version.status = 'confirmed'
      join appointment_slots slot
        on slot.organization_id = version.organization_id
        and slot.facility_id = version.facility_id
        and slot.id = version.slot_id
      join scheduling_services service
        on service.organization_id = slot.organization_id
        and service.facility_id = slot.facility_id
        and service.id = slot.service_id
      join scheduling_providers provider
        on provider.organization_id = slot.organization_id
        and provider.facility_id = slot.facility_id
        and provider.id = slot.provider_id
      join patients patient
        on patient.organization_id = appointment.organization_id
        and patient.facility_id = appointment.facility_id
        and patient.id = appointment.patient_id
        and patient.status = 'active'
      left join patient_profile_heads profile_head
        on profile_head.organization_id = patient.organization_id
        and profile_head.facility_id = patient.facility_id
        and profile_head.patient_id = patient.id
      left join patient_profile_versions profile
        on profile.organization_id = profile_head.organization_id
        and profile.facility_id = profile_head.facility_id
        and profile.patient_id = profile_head.patient_id
        and profile.id = profile_head.current_version_id
      where appointment.organization_id = ?1 and appointment.facility_id = ?2
        ${clinicianFilter}
      order by slot.starts_at, appointment.id
    `).bind(...binds).all<{
      recordId: string;
      versionId: string;
      patientId: string;
      patientDisplayName: string;
      medicalRecordNumber: string;
      serviceName: string;
      providerName: string;
      occursAt: number;
    }>();
    return rows.results.map((row) => ({
      type: 'appointment',
      recordId: row.recordId,
      versionId: row.versionId,
      patient: {
        id: row.patientId,
        displayName: row.patientDisplayName,
        medicalRecordNumber: row.medicalRecordNumber,
      },
      title: `${row.serviceName} · ${row.providerName}`,
      occursAt: row.occursAt,
      status: 'confirmed',
    }));
  }

  private async listCareTaskSources(): Promise<CommunicationSourceRecord[]> {
    if (this.scope.role === 'registrar') return [];
    const visibility = this.scope.role === 'clinician'
      ? 'enrollment.managing_clinician_membership_id = ?3'
      : 'task.assigned_membership_id = ?3';
    const rows = await this.database.prepare(`
      select task.id as recordId, task.source_plan_version_id as versionId,
        task.patient_id as patientId,
        coalesce(profile.display_name, patient.display_name) as patientDisplayName,
        patient.medical_record_number as medicalRecordNumber,
        task.title, current.due_date as dueDate, facility.timezone as timeZone
      from chronic_care_tasks task
      join chronic_care_task_heads head
        on head.organization_id = task.organization_id
        and head.facility_id = task.facility_id
        and head.task_id = task.id
      join chronic_care_task_versions current
        on current.organization_id = head.organization_id
        and current.facility_id = head.facility_id
        and current.task_id = head.task_id
        and current.id = head.current_version_id
        and current.status in ('pending', 'in_progress', 'escalated')
      join chronic_care_plan_heads plan_head
        on plan_head.organization_id = task.organization_id
        and plan_head.facility_id = task.facility_id
        and plan_head.care_plan_id = task.care_plan_id
        and plan_head.current_version_id = task.source_plan_version_id
      join chronic_registry_enrollments enrollment
        on enrollment.organization_id = task.organization_id
        and enrollment.facility_id = task.facility_id
        and enrollment.id = task.enrollment_id
      join chronic_registry_enrollment_heads enrollment_head
        on enrollment_head.organization_id = enrollment.organization_id
        and enrollment_head.facility_id = enrollment.facility_id
        and enrollment_head.enrollment_id = enrollment.id
      join chronic_registry_enrollment_versions enrollment_version
        on enrollment_version.organization_id = enrollment_head.organization_id
        and enrollment_version.facility_id = enrollment_head.facility_id
        and enrollment_version.enrollment_id = enrollment_head.enrollment_id
        and enrollment_version.id = enrollment_head.current_version_id
        and enrollment_version.status = 'active'
      join facilities facility
        on facility.organization_id = task.organization_id
        and facility.id = task.facility_id
        and facility.status = 'active'
      join patients patient
        on patient.organization_id = task.organization_id
        and patient.facility_id = task.facility_id
        and patient.id = task.patient_id
        and patient.status = 'active'
      left join patient_profile_heads profile_head
        on profile_head.organization_id = patient.organization_id
        and profile_head.facility_id = patient.facility_id
        and profile_head.patient_id = patient.id
      left join patient_profile_versions profile
        on profile.organization_id = profile_head.organization_id
        and profile.facility_id = profile_head.facility_id
        and profile.patient_id = profile_head.patient_id
        and profile.id = profile_head.current_version_id
      where task.organization_id = ?1 and task.facility_id = ?2
        and ${visibility}
      order by current.due_date, task.id
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      this.scope.membershipId,
    ).all<{
      recordId: string;
      versionId: string;
      patientId: string;
      patientDisplayName: string;
      medicalRecordNumber: string;
      title: string;
      dueDate: string;
      timeZone: string;
    }>();
    return rows.results.map((row) => ({
      type: 'care_plan_task',
      recordId: row.recordId,
      versionId: row.versionId,
      patient: {
        id: row.patientId,
        displayName: row.patientDisplayName,
        medicalRecordNumber: row.medicalRecordNumber,
      },
      title: row.title,
      occursAt: localDateAtHour(row.dueDate, 9, row.timeZone),
      status: 'plan_task_open',
    }));
  }

  private notificationSelectSql() {
    return `select event.notification_id as notificationId,
      event.patient_id as patientId,
      coalesce(profile.display_name, patient.display_name) as patientDisplayName,
      patient.medical_record_number as medicalRecordNumber,
      event.id as currentEventId, event.version as currentVersion,
      event.state, event.purpose, event.channel, event.language,
      event.consent_event_id as consentEventId,
      event.template_version_id as templateVersionId,
      event.policy_version_id as policyVersionId,
      event.source_type as sourceType, event.source_record_id as sourceRecordId,
      event.source_version_id as sourceVersionId,
      event.requested_at as requestedAt, event.scheduled_at as scheduledAt,
      event.next_attempt_at as nextAttemptAt,
      event.destination_hint as destinationHint,
      event.destination_fingerprint as destinationFingerprint,
      event.rendered_body as renderedBody,
      event.template_values_json as templateValuesJson,
      event.content_hash as contentHash,
      event.outbox_event_id as outboxEventId, event.attempt_count as attemptCount,
      event.failure_owner_membership_id as failureOwnerMembershipId,
      owner_user.display_name as failureOwner,
      event.last_failure_code as lastFailureCode,
      event.change_reason as changeReason
      from patient_notification_heads head
      join patient_notification_events event
        on event.organization_id = head.organization_id
        and event.facility_id = head.facility_id
        and event.notification_id = head.notification_id
        and event.id = head.current_event_id
      join patients patient
        on patient.organization_id = event.organization_id
        and patient.facility_id = event.facility_id
        and patient.id = event.patient_id
      left join patient_profile_heads profile_head
        on profile_head.organization_id = patient.organization_id
        and profile_head.facility_id = patient.facility_id
        and profile_head.patient_id = patient.id
      left join patient_profile_versions profile
        on profile.organization_id = profile_head.organization_id
        and profile.facility_id = profile_head.facility_id
        and profile.patient_id = profile_head.patient_id
        and profile.id = profile_head.current_version_id
      join memberships owner_membership
        on owner_membership.organization_id = event.organization_id
        and owner_membership.facility_id = event.facility_id
        and owner_membership.id = event.failure_owner_membership_id
      join users owner_user on owner_user.id = owner_membership.user_id`;
  }

  private manualTaskSelectSql() {
    return `select event.task_id as taskId,
      event.notification_id as notificationId,
      notification.patient_id as patientId,
      coalesce(profile.display_name, patient.display_name) as patientDisplayName,
      patient.medical_record_number as medicalRecordNumber,
      notification.channel, notification.destination_hint as destinationHint,
      event.id as currentEventId, event.version as currentVersion,
      event.state, event.assigned_membership_id as assignedMembershipId,
      assignee_user.display_name as assignedTo, event.due_at as dueAt,
      event.failure_reason as failureReason, event.response_id as responseId,
      event.outcome_summary as outcomeSummary, event.change_reason as changeReason
      from communication_manual_task_heads head
      join communication_manual_task_events event
        on event.organization_id = head.organization_id
        and event.facility_id = head.facility_id
        and event.task_id = head.task_id
        and event.id = head.current_event_id
      join patient_notification_heads notification_head
        on notification_head.organization_id = event.organization_id
        and notification_head.facility_id = event.facility_id
        and notification_head.notification_id = event.notification_id
      join patient_notification_events notification
        on notification.organization_id = notification_head.organization_id
        and notification.facility_id = notification_head.facility_id
        and notification.notification_id = notification_head.notification_id
        and notification.id = notification_head.current_event_id
      join patients patient
        on patient.organization_id = notification.organization_id
        and patient.facility_id = notification.facility_id
        and patient.id = notification.patient_id
      left join patient_profile_heads profile_head
        on profile_head.organization_id = patient.organization_id
        and profile_head.facility_id = patient.facility_id
        and profile_head.patient_id = patient.id
      left join patient_profile_versions profile
        on profile.organization_id = profile_head.organization_id
        and profile.facility_id = profile_head.facility_id
        and profile.patient_id = profile_head.patient_id
        and profile.id = profile_head.current_version_id
      join memberships assignee
        on assignee.organization_id = event.organization_id
        and assignee.facility_id = event.facility_id
        and assignee.id = event.assigned_membership_id
      join users assignee_user on assignee_user.id = assignee.user_id`;
  }

  private async getCurrentNotification(notificationId: string) {
    return this.database.prepare(`${this.notificationSelectSql()}
      where head.organization_id = ?1 and head.facility_id = ?2
        and head.notification_id = ?3 limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      notificationId,
    ).first<NotificationRow>();
  }

  private async getCurrentManualTask(taskId: string) {
    return this.database.prepare(`${this.manualTaskSelectSql()}
      where head.organization_id = ?1 and head.facility_id = ?2
        and head.task_id = ?3 limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      taskId,
    ).first<ManualTaskRow>();
  }

  async recordChannelConsent(
    input: RecordChannelConsentCommand,
  ): Promise<ChannelConsentRecord> {
    requireCommunicationPermission(this.scope.role, 'consent.capture');
    const now = Date.now();
    const normalized = {
      ...input,
      destinationRef:
        input.decision === 'granted' ? normalizeNullable(input.destinationRef) : null,
      destinationHint:
        input.decision === 'granted' ? normalizeNullable(input.destinationHint) : null,
      reason: normalizeText(input.reason),
      noticeVersion: normalizeText(input.noticeVersion),
    };
    if (
      normalized.decision === 'granted' &&
      (normalized.destinationRef !==
          syntheticDestinationRef(normalized.channel, normalized.patientId) ||
        normalized.destinationHint !== syntheticDestinationHint(normalized.channel) ||
        !input.destinationVerified)
    ) {
      throw new CommunicationValidationError(
        'Разрешённый канал требует проверенного синтетического назначения',
      );
    }
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      patientId: normalized.patientId,
      channel: normalized.channel,
      decision: normalized.decision,
      preferredLanguage: normalized.preferredLanguage,
      destinationRef: normalized.destinationRef,
      destinationHint: normalized.destinationHint,
      destinationVerified: input.destinationVerified,
      source: normalized.source,
      expectedVersion: normalized.expectedVersion,
      noticeVersion: normalized.noticeVersion,
      noticeHash: normalized.noticeHash,
      reason: normalized.reason,
    });
    const operation = 'communication.channel_consent.record';
    const patient = await this.database.prepare(`
      select patient.id,
        coalesce(profile.display_name, patient.display_name) as displayName,
        patient.medical_record_number as medicalRecordNumber
      from patients patient
      left join patient_profile_heads profile_head
        on profile_head.organization_id = patient.organization_id
        and profile_head.facility_id = patient.facility_id
        and profile_head.patient_id = patient.id
      left join patient_profile_versions profile
        on profile.organization_id = profile_head.organization_id
        and profile.facility_id = profile_head.facility_id
        and profile.patient_id = profile_head.patient_id
        and profile.id = profile_head.current_version_id
      where patient.organization_id = ?1 and patient.facility_id = ?2
        and patient.id = ?3 and patient.status = 'active' limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      normalized.patientId,
    ).first<PatientRow>();
    if (!patient) throw new CommunicationNotFoundError();
    if (!(await this.canAccessPatient(patient.id))) {
      throw new CommunicationNotFoundError();
    }
    const replay = await this.findIdempotency(operation, input.idempotencyKey);
    if (replay) return this.resolveReplay<ChannelConsentRecord>(replay, requestHash);

    const current = await this.database.prepare(`
      select event.id, event.version
      from patient_channel_consent_heads head
      join patient_channel_consent_events event
        on event.organization_id = head.organization_id
        and event.facility_id = head.facility_id
        and event.patient_id = head.patient_id
        and event.channel = head.channel
        and event.id = head.current_consent_event_id
      where head.organization_id = ?1 and head.facility_id = ?2
        and head.patient_id = ?3 and head.channel = ?4 limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      normalized.patientId,
      normalized.channel,
    ).first<{ id: string; version: number }>();
    if (normalized.expectedVersion === null) {
      if (current) {
        throw new CommunicationVersionConflictError(current.version, 'consent');
      }
    } else if (!current || current.version !== normalized.expectedVersion) {
      throw new CommunicationVersionConflictError(current?.version ?? 0, 'consent');
    }

    const version = (current?.version ?? 0) + 1;
    const eventId = `channel-consent-${crypto.randomUUID()}`;
    const destinationFingerprint = normalized.destinationRef
      ? await sha256Text(normalized.destinationRef)
      : null;
    const response: ChannelConsentRecord = {
      id: eventId,
      patientId: normalized.patientId,
      channel: normalized.channel,
      version,
      decision: normalized.decision,
      preferredLanguage: normalized.preferredLanguage,
      destinationHint: normalized.destinationHint,
      destinationVerifiedAt: normalized.destinationRef ? now : null,
      noticeVersion: normalized.noticeVersion,
      noticeHash: normalized.noticeHash,
      source: normalized.source,
      effectiveAt: now,
      capturedByMembershipId: this.scope.membershipId,
      changeReason: normalized.reason,
    };
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`insert into patient_channel_consent_events (
        id, organization_id, facility_id, patient_id, channel, version,
        supersedes_consent_event_id, decision, preferred_language,
        destination_ref, destination_hint, destination_fingerprint,
        destination_verified_at, notice_version, notice_hash, source,
        effective_at, captured_by_membership_id, change_reason, created_at, access_assignment_id
      ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`)
        .bind(
          eventId,
          this.scope.organizationId,
          this.scope.facilityId,
          normalized.patientId,
          normalized.channel,
          version,
          current?.id ?? null,
          normalized.decision,
          normalized.preferredLanguage,
          normalized.destinationRef,
          normalized.destinationHint,
          destinationFingerprint,
          normalized.destinationRef ? now : null,
          normalized.noticeVersion,
          normalized.noticeHash,
          normalized.source,
          now,
          this.scope.membershipId,
          normalized.reason,
          now,
          this.scope.accessAssignmentId,
        ),
    ];
    if (current) {
      statements.push(
        this.database.prepare(`update patient_channel_consent_heads
          set current_consent_event_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and patient_id = ?5 and channel = ?6
            and current_consent_event_id = ?7 and lock_version = ?8`)
          .bind(
            eventId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            normalized.patientId,
            normalized.channel,
            current.id,
            current.version,
          ),
      );
    } else {
      statements.push(
        this.database.prepare(`insert into patient_channel_consent_heads (
          id, organization_id, facility_id, patient_id, channel,
          current_consent_event_id, lock_version, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)`)
          .bind(
            `channel-consent-head-${crypto.randomUUID()}`,
            this.scope.organizationId,
            this.scope.facilityId,
            normalized.patientId,
            normalized.channel,
            eventId,
            now,
          ),
      );
    }
    return this.commitCommand({
      operation,
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'patient_channel_consent',
      resourceId: eventId,
      response,
      action: `communication.consent.${normalized.decision}`,
      entityType: 'patient_channel_consent',
      requestId: input.requestId,
      metadata: {
        patientId: normalized.patientId,
        channel: normalized.channel,
        version,
        decision: normalized.decision,
        language: normalized.preferredLanguage,
        destinationVerified: Boolean(normalized.destinationRef),
        noticeVersion: normalized.noticeVersion,
      },
      now,
      statements,
    });
  }

  async scheduleNotification(
    input: ScheduleNotificationCommand,
  ): Promise<NotificationRecord> {
    requireCommunicationPermission(this.scope.role, 'notification.schedule');
    assertCommunicationSourceAllowed(this.scope.role, input.sourceType);
    const now = Date.now();
    const normalizedReason = normalizeText(input.reason);
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      sourceType: input.sourceType,
      sourceRecordId: input.sourceRecordId,
      sourceVersionId: input.sourceVersionId,
      channel: input.channel,
      language: input.language,
      scheduledAt: input.scheduledAt,
      reason: normalizedReason,
    });
    const operation = 'communication.notification.schedule';
    const policy = await this.getPolicy();
    if (!policy) throw new CommunicationPolicyUnavailableError();
    const source = await this.requireCurrentSource(
      input.sourceType,
      input.sourceRecordId,
      input.sourceVersionId,
    );
    const replay = await this.findIdempotency(operation, input.idempotencyKey);
    if (replay) return this.resolveReplay<NotificationRecord>(replay, requestHash);
    const purpose = purposeForSource(input.sourceType);
    const consent = await this.getCurrentConsent(source.patient.id, input.channel);
    if (
      !consent ||
      consent.decision !== 'granted' ||
      consent.preferredLanguage !== input.language ||
      !consent.destinationRef ||
      !consent.destinationHint ||
      !consent.destinationFingerprint ||
      consent.destinationVerifiedAt === null
    ) {
      throw new CommunicationConsentRequiredError();
    }
    const template = await this.database.prepare(`
      select id, template_code as templateCode, version, purpose, channel,
        language, body, placeholders_json as placeholdersJson,
        content_hash as contentHash,
        protected_link_required as protectedLinkRequired, status
      from communication_template_versions
      where organization_id = ?1 and facility_id = ?2
        and purpose = ?3 and channel = ?4 and language = ?5
        and status = 'approved_test' and source_type = 'local_test'
        and minimum_content_only = 1 and protected_link_required = 0
        and version = (
          select max(latest.version)
          from communication_template_versions latest
          where latest.organization_id = communication_template_versions.organization_id
            and latest.facility_id = communication_template_versions.facility_id
            and latest.purpose = communication_template_versions.purpose
            and latest.channel = communication_template_versions.channel
            and latest.language = communication_template_versions.language
        )
      order by version desc limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      purpose,
      input.channel,
      input.language,
    ).first<TemplateRow>();
    if (!template) throw new CommunicationTemplateUnavailableError();
    const facility = await this.database.prepare(`select name from facilities
      where organization_id = ?1 and id = ?2 and status = 'active' limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<{ name: string }>();
    if (!facility) throw new CommunicationNotFoundError();
    const sourceDateTime = formatDateTime(source.occursAt, policy.timeZone, input.language);
    const values: Record<string, string> = input.sourceType === 'appointment'
      ? {
          facilityName: facility.name,
          appointmentDate: sourceDateTime.date,
          appointmentTime: sourceDateTime.time,
        }
      : {
          facilityName: facility.name,
          dueDate: sourceDateTime.date,
        };
    let placeholders: string[];
    try {
      placeholders = JSON.parse(template.placeholdersJson) as string[];
    } catch {
      throw new CommunicationTemplateUnavailableError();
    }
    let renderedBody: string;
    try {
      renderedBody = renderApprovedTemplate(template.body, placeholders, values);
    } catch {
      throw new CommunicationTemplateUnavailableError();
    }
    const contentHash = await sha256Text(renderedBody);
    const window = resolveCommunicationWindow({
      requestedAt: input.scheduledAt,
      timeZone: policy.timeZone,
      quietStartMinute: policy.quietStartMinute,
      quietEndMinute: policy.quietEndMinute,
    });
    const state: NotificationState = window.deferred
      ? 'deferred_quiet_hours'
      : 'scheduled';
    const owner = await this.resolveFailureOwner(source);
    const notificationId = `notification-${crypto.randomUUID()}`;
    const eventId = `notification-event-${crypto.randomUUID()}`;
    const outboxEventId = `outbox-${crypto.randomUUID()}`;
    const duplicate = await this.database.prepare(`
      select 1 as found from patient_notification_events
      where organization_id = ?1 and facility_id = ?2
        and source_type = ?3 and source_record_id = ?4
        and source_version_id = ?5 and channel = ?6
        and scheduled_at = ?7 and version = 1 limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      input.sourceType,
      input.sourceRecordId,
      input.sourceVersionId,
      input.channel,
      input.scheduledAt,
    ).first<{ found: number }>();
    if (duplicate) {
      throw new CommunicationConflictError('Duplicate notification intent');
    }
    const row: NotificationRow = {
      notificationId,
      patientId: source.patient.id,
      patientDisplayName: source.patient.displayName,
      medicalRecordNumber: source.patient.medicalRecordNumber,
      currentEventId: eventId,
      currentVersion: 1,
      state,
      purpose,
      channel: input.channel,
      language: input.language,
      consentEventId: consent.id,
      templateVersionId: template.id,
      policyVersionId: policy.id,
      sourceType: input.sourceType,
      sourceRecordId: input.sourceRecordId,
      sourceVersionId: input.sourceVersionId,
      requestedAt: now,
      scheduledAt: input.scheduledAt,
      nextAttemptAt: window.nextAttemptAt,
      destinationHint: consent.destinationHint,
      destinationFingerprint: consent.destinationFingerprint,
      renderedBody,
      templateValuesJson: JSON.stringify(values),
      contentHash,
      outboxEventId,
      attemptCount: 0,
      failureOwnerMembershipId: owner.membershipId,
      failureOwner: owner.displayName,
      lastFailureCode: null,
      changeReason: normalizedReason,
    };
    const response = notificationFromRow(row);
    const statements = [
      this.database.prepare(`insert into outbox_events (
        id, organization_id, facility_id, aggregate_type, aggregate_id,
        aggregate_version, command_id, event_type, payload_json,
        event_idempotency_key, status, attempts, next_attempt_at, created_at, access_assignment_id
      ) values (?1, ?2, ?3, 'patient_notification', ?4, 1, null,
        'patient_notification.dispatch_requested', ?5, ?6, 'pending', 0, ?7, ?8, ?9)`)
        .bind(
          outboxEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          notificationId,
          JSON.stringify({
            notificationId,
            patientId: source.patient.id,
            sourceType: input.sourceType,
            sourceRecordId: input.sourceRecordId,
            sourceVersionId: input.sourceVersionId,
            channel: input.channel,
            templateVersionId: template.id,
            contentHash,
          }),
          `patient-notification:${notificationId}`,
          window.nextAttemptAt,
          now,
          this.scope.accessAssignmentId,
        ),
      this.notificationEventInsert(row, null, this.scope.membershipId, normalizedReason, now),
      this.database.prepare(`insert into patient_notification_heads (
        id, organization_id, facility_id, notification_id, current_event_id,
        lock_version, created_at, updated_at
      ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
        .bind(
          `notification-head-${crypto.randomUUID()}`,
          this.scope.organizationId,
          this.scope.facilityId,
          notificationId,
          eventId,
          now,
        ),
    ];
    return this.commitCommand({
      operation,
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'patient_notification',
      resourceId: notificationId,
      response,
      action: 'communication.notification.schedule',
      entityType: 'patient_notification',
      requestId: input.requestId,
      metadata: {
        patientId: source.patient.id,
        sourceType: input.sourceType,
        sourceRecordId: input.sourceRecordId,
        sourceVersionId: input.sourceVersionId,
        channel: input.channel,
        language: input.language,
        templateVersionId: template.id,
        policyVersionId: policy.id,
        scheduledAt: input.scheduledAt,
        state,
        failureOwnerMembershipId: owner.membershipId,
      },
      now,
      statements,
    });
  }

  async processNotification(
    input: ProcessNotificationCommand,
  ): Promise<NotificationRecord> {
    const permission: CommunicationPermission =
      input.action === 'cancel' ? 'notification.cancel' : 'notification.process';
    requireCommunicationPermission(this.scope.role, permission);
    const now = input.now ?? Date.now();
    const reason = normalizeText(input.reason);
    const operation = `communication.notification.${input.action}`;
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      notificationId: input.notificationId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      reason,
    });
    const current = await this.getCurrentNotification(input.notificationId);
    if (!current) throw new CommunicationNotFoundError();
    await this.assertNotificationSourceAccess(current);
    const replay = await this.findIdempotency(operation, input.idempotencyKey);
    if (replay) return this.resolveReplay<NotificationRecord>(replay, requestHash);
    if (current.currentVersion !== input.expectedVersion) {
      throw new CommunicationVersionConflictError(
        current.currentVersion,
        'notification',
      );
    }
    if (
      !['scheduled', 'deferred_quiet_hours', 'retry_scheduled'].includes(
        current.state,
      )
    ) {
      throw new CommunicationLifecycleError(
        'Уведомление уже не ожидает обработки',
      );
    }
    const dueAt = current.nextAttemptAt ?? current.scheduledAt;
    const requiresDueTime =
      input.action === 'process_due' ||
      input.action === 'retry_now' ||
      input.action === 'require_manual_contact';
    if (requiresDueTime && dueAt > now) {
      throw new CommunicationLifecycleError('Время обработки ещё не наступило');
    }

    const policy = await this.getPolicyById(current.policyVersionId);
    if (!policy) throw new CommunicationPolicyUnavailableError();
    const eventId = `notification-event-${crypto.randomUUID()}`;
    const next: NotificationRow = {
      ...current,
      currentEventId: eventId,
      currentVersion: current.currentVersion + 1,
      changeReason: reason,
    };
    const statements: D1PreparedStatement[] = [];
    let auditAction = `communication.notification.${input.action}`;
    let attempt: DeliveryAttemptRecord | null = null;
    let createManualTask = false;

    if (input.action === 'cancel') {
      next.state = 'cancelled_by_staff';
      next.nextAttemptAt = null;
    } else {
      const consent = await this.getCurrentConsent(current.patientId, current.channel);
      if (
        !consent ||
        consent.id !== current.consentEventId ||
        consent.decision !== 'granted' ||
        consent.preferredLanguage !== current.language ||
        !consent.destinationVerifiedAt
      ) {
        next.state = 'suppressed_opt_out';
        next.nextAttemptAt = null;
        next.lastFailureCode = 'CHANNEL_CONSENT_NOT_CURRENT';
        auditAction = 'communication.notification.suppressed_opt_out';
      } else {
        let sourceCurrent = true;
        try {
          await this.requireCurrentSource(
            current.sourceType,
            current.sourceRecordId,
            current.sourceVersionId,
          );
        } catch (error) {
          if (error instanceof CommunicationNotFoundError) sourceCurrent = false;
          else throw error;
        }
        if (!sourceCurrent) {
          next.state = 'cancelled_source';
          next.nextAttemptAt = null;
          next.lastFailureCode = 'SOURCE_NOT_CURRENT';
          auditAction = 'communication.notification.cancelled_source';
        } else {
          const window = resolveCommunicationWindow({
            requestedAt: now,
            timeZone: policy.timeZone,
            quietStartMinute: policy.quietStartMinute,
            quietEndMinute: policy.quietEndMinute,
          });
          if (window.deferred) {
            next.state = current.state === 'scheduled'
              ? 'deferred_quiet_hours'
              : 'retry_scheduled';
            next.nextAttemptAt = window.nextAttemptAt;
            next.lastFailureCode = null;
            auditAction = 'communication.notification.deferred_quiet_hours';
          } else if (input.action === 'require_manual_contact') {
            next.state = 'manual_contact_required';
            next.nextAttemptAt = null;
            next.lastFailureCode = 'MANUAL_CONTACT_REQUIRED';
            createManualTask = true;
          } else {
            const attemptNumber = current.attemptCount + 1;
            const exhausted = attemptNumber >= policy.maxAttempts;
            const retryAt = exhausted
              ? null
              : now + policy.retryDelayMinutes * 60_000;
            const attemptId = `delivery-attempt-${crypto.randomUUID()}`;
            attempt = {
              id: attemptId,
              attemptNumber,
              providerAdapter: 'disconnected',
              outcome: 'provider_unavailable',
              errorCode: 'PROVIDER_NOT_CONFIGURED',
              nextAttemptAt: retryAt,
              occurredAt: now,
            };
            statements.push(
              this.database.prepare(`insert into notification_delivery_attempts (
                id, organization_id, facility_id, notification_id,
                notification_event_id, attempt_number, provider_adapter,
                outcome, error_code, provider_message_id, next_attempt_at,
                recorded_by_membership_id, occurred_at, created_at, access_assignment_id
              ) values (?1, ?2, ?3, ?4, ?5, ?6, 'disconnected',
                'provider_unavailable', 'PROVIDER_NOT_CONFIGURED', null,
                ?7, ?8, ?9, ?9, ?10)`)
                .bind(
                  attemptId,
                  this.scope.organizationId,
                  this.scope.facilityId,
                  current.notificationId,
                  current.currentEventId,
                  attemptNumber,
                  retryAt,
                  this.scope.membershipId,
                  now,
                  this.scope.accessAssignmentId,
                ),
            );
            next.attemptCount = attemptNumber;
            next.lastFailureCode = 'PROVIDER_NOT_CONFIGURED';
            if (exhausted) {
              next.state = 'manual_contact_required';
              next.nextAttemptAt = null;
              createManualTask = true;
              auditAction = 'communication.notification.manual_contact_required';
            } else {
              next.state = 'retry_scheduled';
              next.nextAttemptAt = retryAt;
              auditAction = 'communication.notification.retry_scheduled';
            }
          }
        }
      }
    }

    try {
      assertNotificationTransition(current.state, next.state);
    } catch (error) {
      throw new CommunicationLifecycleError(
        error instanceof Error ? error.message : 'Недопустимый переход',
      );
    }

    statements.push(
      this.notificationEventInsert(
        next,
        current.currentEventId,
        this.scope.membershipId,
        reason,
        now,
      ),
      this.database.prepare(`update patient_notification_heads
        set current_event_id = ?1, lock_version = lock_version + 1,
          updated_at = ?2
        where organization_id = ?3 and facility_id = ?4
          and notification_id = ?5 and current_event_id = ?6
          and lock_version = ?7`)
        .bind(
          eventId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          current.notificationId,
          current.currentEventId,
          current.currentVersion,
        ),
    );

    if (next.state === 'retry_scheduled' || next.state === 'deferred_quiet_hours') {
      statements.push(
        this.database.prepare(`update outbox_events set
          status = ?1, attempts = ?2, next_attempt_at = ?3,
          completed_at = null, last_error_code = ?4,
          last_error_at = ?5, lease_owner = null,
          lease_expires_at = null, claimed_at = null
          where organization_id = ?6 and facility_id = ?7 and id = ?8
            and aggregate_id = ?9 and status in ('pending', 'failed')`)
          .bind(
            next.state === 'retry_scheduled' ? 'failed' : 'pending',
            next.attemptCount,
            next.nextAttemptAt,
            next.lastFailureCode,
            next.lastFailureCode ? now : null,
            this.scope.organizationId,
            this.scope.facilityId,
            current.outboxEventId,
            current.notificationId,
          ),
      );
    } else {
      const terminalOutboxStatus = next.state === 'manual_contact_required'
        ? 'dead_letter'
        : 'succeeded';
      statements.push(
        this.database.prepare(`update outbox_events set
          status = ?1, attempts = ?2, next_attempt_at = ?3,
          completed_at = ?4, last_error_code = ?5,
          last_error_at = ?6, lease_owner = null,
          lease_expires_at = null, claimed_at = null
          where organization_id = ?7 and facility_id = ?8 and id = ?9
            and aggregate_id = ?10 and status in ('pending', 'failed')`)
          .bind(
            terminalOutboxStatus,
            next.attemptCount,
            now,
            terminalOutboxStatus === 'succeeded' ? now : null,
            next.lastFailureCode,
            next.lastFailureCode ? now : null,
            this.scope.organizationId,
            this.scope.facilityId,
            current.outboxEventId,
            current.notificationId,
          ),
      );
    }

    if (createManualTask) {
      const existingTask = await this.database.prepare(`select task_id as taskId
        from communication_manual_task_events
        where organization_id = ?1 and facility_id = ?2
          and notification_id = ?3 and version = 1 limit 1`)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          current.notificationId,
        )
        .first<{ taskId: string }>();
      if (existingTask) {
        throw new CommunicationConflictError(
          'Ручная задача для уведомления уже создана',
        );
      }
      statements.push(...this.manualTaskCreateStatements(next, now, reason));
    }

    const previousAttempts = await this.database.prepare(`
      select id, attempt_number as attemptNumber,
        provider_adapter as providerAdapter, outcome,
        error_code as errorCode, next_attempt_at as nextAttemptAt,
        occurred_at as occurredAt
      from notification_delivery_attempts
      where organization_id = ?1 and facility_id = ?2
        and notification_id = ?3 order by attempt_number
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      current.notificationId,
    ).all<DeliveryAttemptRecord>();
    const attempts = attempt
      ? [...previousAttempts.results, attempt]
      : previousAttempts.results;
    const response = notificationFromRow(next, attempts);
    return this.commitCommand({
      operation,
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'patient_notification',
      resourceId: current.notificationId,
      response,
      action: auditAction,
      entityType: 'patient_notification',
      requestId: input.requestId,
      metadata: {
        notificationId: current.notificationId,
        fromState: current.state,
        toState: next.state,
        attemptNumber: attempt?.attemptNumber ?? null,
        providerAdapter: attempt?.providerAdapter ?? null,
        providerCallPerformed: false,
        failureOwnerMembershipId: next.failureOwnerMembershipId,
      },
      now,
      statements,
    });
  }

  async commandManualTask(input: ManualContactCommand): Promise<ManualContactTaskRecord> {
    const permissionByAction: Record<ManualContactCommand['action'], CommunicationPermission> = {
      start: 'manual.start',
      record_response: 'manual.response',
      complete: 'manual.complete',
      escalate: 'manual.escalate',
      cancel: 'manual.cancel',
    };
    requireCommunicationPermission(this.scope.role, permissionByAction[input.action]);
    const now = input.now ?? Date.now();
    const reason = normalizeText(input.reason);
    const responseSummary = normalizeNullable(input.responseSummary);
    const operation = `communication.manual_task.${input.action}`;
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      taskId: input.taskId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      reason,
      responseKind: input.responseKind,
      responseLanguage: input.responseLanguage,
      responseSummary,
    });
    const current = await this.getCurrentManualTask(input.taskId);
    if (!current || current.assignedMembershipId !== this.scope.membershipId) {
      throw new CommunicationNotFoundError();
    }
    const replay = await this.findIdempotency(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<ManualContactTaskRecord>(replay, requestHash);
    }
    if (current.currentVersion !== input.expectedVersion) {
      throw new CommunicationVersionConflictError(current.currentVersion, 'manual_task');
    }
    let nextState: ManualContactState;
    try {
      nextState = nextManualContactState(current.state, input.action);
    } catch (error) {
      throw new CommunicationLifecycleError(
        error instanceof Error ? error.message : 'Недопустимый переход',
      );
    }

    if (
      input.action === 'record_response' &&
      (!input.responseKind || !input.responseLanguage || !responseSummary)
    ) {
      throw new CommunicationValidationError(
        'Для ответа укажите тип, язык и содержание',
      );
    }

    const notification = await this.getCurrentNotification(current.notificationId);
    if (!notification) throw new CommunicationNotFoundError();
    if (input.action === 'start' || input.action === 'record_response') {
      if (current.dueAt > now) {
        throw new CommunicationLifecycleError('Время ручного контакта ещё не наступило');
      }
      const consent = await this.getCurrentConsent(notification.patientId, notification.channel);
      if (
        !consent ||
        consent.id !== notification.consentEventId ||
        consent.decision !== 'granted' ||
        consent.preferredLanguage !== notification.language ||
        !consent.destinationVerifiedAt
      ) {
        throw new CommunicationConsentRequiredError();
      }
      await this.requireCurrentSource(
        notification.sourceType,
        notification.sourceRecordId,
        notification.sourceVersionId,
      );
      if (input.action === 'start') {
        const policy = await this.getPolicyById(notification.policyVersionId);
        if (!policy) throw new CommunicationPolicyUnavailableError();
        const window = resolveCommunicationWindow({
          requestedAt: now,
          timeZone: policy.timeZone,
          quietStartMinute: policy.quietStartMinute,
          quietEndMinute: policy.quietEndMinute,
        });
        if (window.deferred) {
          throw new CommunicationLifecycleError(
            'Ручной исходящий контакт нельзя начинать в тихие часы',
          );
        }
      }
    }
    const eventId = `manual-task-event-${crypto.randomUUID()}`;
    const responseId = input.action === 'record_response'
      ? `communication-response-${crypto.randomUUID()}`
      : current.responseId;
    const next: ManualTaskRow = {
      ...current,
      currentEventId: eventId,
      currentVersion: current.currentVersion + 1,
      state: nextState,
      responseId,
      outcomeSummary:
        input.action === 'record_response'
          ? responseSummary
          : input.action === 'start'
            ? current.outcomeSummary
            : reason,
      changeReason: reason,
    };
    const statements: D1PreparedStatement[] = [];

    if (input.action === 'record_response') {
      statements.push(
        this.database.prepare(`insert into communication_patient_responses (
          id, organization_id, facility_id, notification_id, manual_task_id,
          response_kind, language, summary, source,
          recorded_by_membership_id, received_at, created_at, access_assignment_id
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
          'staff_recorded', ?9, ?10, ?10, ?11)`)
          .bind(
            responseId,
            this.scope.organizationId,
            this.scope.facilityId,
            current.notificationId,
            current.taskId,
            input.responseKind,
            input.responseLanguage,
            responseSummary,
            this.scope.membershipId,
            now,
            this.scope.accessAssignmentId,
          ),
      );
    }

    statements.push(
      this.manualTaskEventInsert(
        next,
        current.currentEventId,
        this.scope.membershipId,
        reason,
        now,
      ),
      this.database.prepare(`update communication_manual_task_heads
        set current_event_id = ?1, lock_version = lock_version + 1,
          updated_at = ?2
        where organization_id = ?3 and facility_id = ?4
          and task_id = ?5 and current_event_id = ?6 and lock_version = ?7`)
        .bind(
          eventId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          current.taskId,
          current.currentEventId,
          current.currentVersion,
        ),
    );

    let notificationNextState: NotificationState | null = null;
    if (input.action === 'record_response' && notification.state === 'manual_contact_required') {
      notificationNextState = 'patient_replied';
    } else if (input.action === 'complete') {
      notificationNextState = 'manual_contact_completed';
    } else if (input.action === 'cancel') {
      notificationNextState = 'cancelled_by_staff';
    }
    if (notificationNextState) {
      try {
        assertNotificationTransition(notification.state, notificationNextState);
      } catch (error) {
        throw new CommunicationLifecycleError(
          error instanceof Error ? error.message : 'Недопустимый переход',
        );
      }
      const notificationEventId = `notification-event-${crypto.randomUUID()}`;
      const nextNotification: NotificationRow = {
        ...notification,
        currentEventId: notificationEventId,
        currentVersion: notification.currentVersion + 1,
        state: notificationNextState,
        nextAttemptAt: null,
        changeReason: reason,
      };
      statements.push(
        this.notificationEventInsert(
          nextNotification,
          notification.currentEventId,
          this.scope.membershipId,
          reason,
          now,
        ),
        this.database.prepare(`update patient_notification_heads
          set current_event_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and notification_id = ?5 and current_event_id = ?6
            and lock_version = ?7`)
          .bind(
            notificationEventId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            notification.notificationId,
            notification.currentEventId,
            notification.currentVersion,
          ),
      );
    }

    const response = manualTaskFromRow(next);
    return this.commitCommand({
      operation,
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'communication_manual_task',
      resourceId: current.taskId,
      response,
      action: `communication.manual_task.${input.action}`,
      entityType: 'communication_manual_task',
      requestId: input.requestId,
      metadata: {
        taskId: current.taskId,
        notificationId: current.notificationId,
        fromState: current.state,
        toState: next.state,
        responseId: input.action === 'record_response' ? responseId : null,
        responseKind: input.responseKind,
        notificationState: notificationNextState,
        clinicalRecordChanged: false,
      },
      now,
      statements,
    });
  }

  async recordListRead(
    requestId: string,
    filters: { patientId?: string; state?: string; resultCount: number },
  ) {
    requireCommunicationPermission(this.scope.role, 'workspace.read');
    const now = Date.now();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: 'communication.workspace.read',
        entityType: 'communication_workspace',
        entityId: this.scope.facilityId,
        requestId,
        metadata: {
          patientFilterApplied: Boolean(filters.patientId),
          state: filters.state ?? 'all',
          resultCount: filters.resultCount,
          minimumNecessary: true,
        },
        occurredAt: now,
      });
      const statements = [this.auditInsert(audit), this.auditHeadUpdate(audit)];
      try {
        const results = await this.database.batch(statements);
        if (
          results.length !== statements.length ||
          results.some((result) => result.meta.changes !== 1)
        ) {
          throw new CommunicationConflictError('Не удалось записать аудит чтения');
        }
        return;
      } catch (error) {
        const currentAudit = await this.requireAuditHead();
        const contended =
          currentAudit.lastSequence !== auditHead.lastSequence ||
          currentAudit.lockVersion !== auditHead.lockVersion;
        if (contended && attempt < 2) continue;
        throw error;
      }
    }
    throw new CommunicationAuditUnavailableError();
  }

  private async getPolicyById(policyVersionId: string): Promise<PolicyRow | null> {
    return this.database.prepare(`
      select policy.id, policy.policy_code as policyCode, policy.version,
        policy.quiet_start_minute as quietStartMinute,
        policy.quiet_end_minute as quietEndMinute,
        policy.max_attempts as maxAttempts,
        policy.retry_delay_minutes as retryDelayMinutes,
        policy.protected_link_mode as protectedLinkMode,
        policy.source_type as sourceType, facility.timezone as timeZone
      from communication_policy_versions policy
      join facilities facility
        on facility.organization_id = policy.organization_id
        and facility.id = policy.facility_id
        and facility.status = 'active'
      where policy.organization_id = ?1 and policy.facility_id = ?2
        and policy.id = ?3 and policy.source_type = 'local_test' limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      policyVersionId,
    ).first<PolicyRow>();
  }

  private async getCurrentConsent(
    patientId: string,
    channel: CommunicationChannel,
  ): Promise<ConsentRow | null> {
    return this.database.prepare(`
      select event.id, event.patient_id as patientId, event.channel,
        event.version, event.decision,
        event.preferred_language as preferredLanguage,
        event.destination_ref as destinationRef,
        event.destination_hint as destinationHint,
        event.destination_fingerprint as destinationFingerprint,
        event.destination_verified_at as destinationVerifiedAt,
        event.notice_version as noticeVersion, event.notice_hash as noticeHash,
        event.source, event.effective_at as effectiveAt,
        event.captured_by_membership_id as capturedByMembershipId,
        event.change_reason as changeReason
      from patient_channel_consent_heads head
      join patient_channel_consent_events event
        on event.organization_id = head.organization_id
        and event.facility_id = head.facility_id
        and event.patient_id = head.patient_id
        and event.channel = head.channel
        and event.id = head.current_consent_event_id
      where head.organization_id = ?1 and head.facility_id = ?2
        and head.patient_id = ?3 and head.channel = ?4 limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      patientId,
      channel,
    ).first<ConsentRow>();
  }

  private async requireCurrentSource(
    sourceType: CommunicationSourceType,
    sourceRecordId: string,
    sourceVersionId: string,
  ): Promise<SourceRow> {
    assertCommunicationSourceAllowed(this.scope.role, sourceType);
    const sources = sourceType === 'appointment'
      ? await this.listAppointmentSources()
      : await this.listCareTaskSources();
    const source = sources.find(
      (candidate) =>
        candidate.recordId === sourceRecordId &&
        candidate.versionId === sourceVersionId,
    );
    if (!source) throw new CommunicationNotFoundError();
    return source;
  }

  private async canAccessNotificationSource(notification: NotificationRow) {
    try {
      assertCommunicationSourceAllowed(this.scope.role, notification.sourceType);
    } catch {
      return false;
    }
    if (this.scope.role === 'registrar' && notification.sourceType === 'appointment') {
      return true;
    }
    const accessible = notification.sourceType === 'appointment'
      ? await this.database.prepare(`select 1 as found
          from appointments appointment
          join service_requests request
            on request.organization_id = appointment.organization_id
            and request.facility_id = appointment.facility_id
            and request.id = appointment.referral_request_id
          join encounters encounter
            on encounter.organization_id = request.organization_id
            and encounter.facility_id = request.facility_id
            and encounter.id = request.encounter_id
          where appointment.organization_id = ?1 and appointment.facility_id = ?2
            and appointment.id = ?3 and encounter.clinician_membership_id = ?4
          limit 1`)
          .bind(
            this.scope.organizationId,
            this.scope.facilityId,
            notification.sourceRecordId,
            this.scope.membershipId,
          )
          .first<{ found: number }>()
      : await this.database.prepare(`select 1 as found
          from chronic_care_tasks task
          join chronic_registry_enrollments enrollment
            on enrollment.organization_id = task.organization_id
            and enrollment.facility_id = task.facility_id
            and enrollment.id = task.enrollment_id
          where task.organization_id = ?1 and task.facility_id = ?2
            and task.id = ?3
            and (
              (?4 = 'clinician' and enrollment.managing_clinician_membership_id = ?5)
              or (?4 = 'nurse' and task.assigned_membership_id = ?5)
            )
          limit 1`)
          .bind(
            this.scope.organizationId,
            this.scope.facilityId,
            notification.sourceRecordId,
            this.scope.role,
            this.scope.membershipId,
          )
          .first<{ found: number }>();
    return Boolean(accessible);
  }

  private async assertNotificationSourceAccess(notification: NotificationRow) {
    if (!(await this.canAccessNotificationSource(notification))) {
      throw new CommunicationNotFoundError();
    }
  }

  private async canAccessPatient(patientId: string) {
    if (this.scope.role === 'clinician') {
      const assigned = await this.database.prepare(`
        select 1 as found
        where exists (
          select 1 from encounters encounter
          where encounter.organization_id = ?1 and encounter.facility_id = ?2
            and encounter.patient_id = ?3 and encounter.clinician_membership_id = ?4
            and encounter.status <> 'cancelled'
        ) or exists (
          select 1 from chronic_registry_enrollments enrollment
          join chronic_registry_enrollment_heads head
            on head.organization_id = enrollment.organization_id
            and head.facility_id = enrollment.facility_id
            and head.enrollment_id = enrollment.id
          join chronic_registry_enrollment_versions current
            on current.organization_id = head.organization_id
            and current.facility_id = head.facility_id
            and current.enrollment_id = head.enrollment_id
            and current.id = head.current_version_id
            and current.status = 'active'
          where enrollment.organization_id = ?1 and enrollment.facility_id = ?2
            and enrollment.patient_id = ?3
            and enrollment.managing_clinician_membership_id = ?4
        )
      `).bind(
        this.scope.organizationId,
        this.scope.facilityId,
        patientId,
        this.scope.membershipId,
      ).first<{ found: number }>();
      return Boolean(assigned);
    }
    if (this.scope.role === 'nurse') {
      const assigned = await this.database.prepare(`
        select 1 as found from chronic_care_tasks task
        join chronic_care_task_heads task_head
          on task_head.organization_id = task.organization_id
          and task_head.facility_id = task.facility_id
          and task_head.task_id = task.id
        join chronic_care_task_versions current_task
          on current_task.organization_id = task_head.organization_id
          and current_task.facility_id = task_head.facility_id
          and current_task.task_id = task_head.task_id
          and current_task.id = task_head.current_version_id
          and current_task.status in ('pending', 'in_progress', 'escalated')
        join chronic_registry_enrollment_heads enrollment_head
          on enrollment_head.organization_id = task.organization_id
          and enrollment_head.facility_id = task.facility_id
          and enrollment_head.enrollment_id = task.enrollment_id
        join chronic_registry_enrollment_versions enrollment_version
          on enrollment_version.organization_id = enrollment_head.organization_id
          and enrollment_version.facility_id = enrollment_head.facility_id
          and enrollment_version.enrollment_id = enrollment_head.enrollment_id
          and enrollment_version.id = enrollment_head.current_version_id
          and enrollment_version.status = 'active'
        where task.organization_id = ?1 and task.facility_id = ?2
          and task.patient_id = ?3 and task.assigned_membership_id = ?4
        limit 1
      `).bind(
        this.scope.organizationId,
        this.scope.facilityId,
        patientId,
        this.scope.membershipId,
      ).first<{ found: number }>();
      return Boolean(assigned);
    }
    const scheduled = await this.database.prepare(`
      select 1 as found from appointments appointment
      join appointment_heads head
        on head.organization_id = appointment.organization_id
        and head.facility_id = appointment.facility_id
        and head.appointment_id = appointment.id
      join appointment_versions current
        on current.organization_id = head.organization_id
        and current.facility_id = head.facility_id
        and current.appointment_id = head.appointment_id
        and current.id = head.current_version_id
        and current.status = 'confirmed'
      where appointment.organization_id = ?1 and appointment.facility_id = ?2
        and appointment.patient_id = ?3
      limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      patientId,
    ).first<{ found: number }>();
    return Boolean(scheduled);
  }

  private async resolveFailureOwner(source: CommunicationSourceRecord) {
    if (source.type === 'care_plan_task') {
      const assignee = await this.database.prepare(`
        select membership.id as membershipId, user.display_name as displayName
        from chronic_care_tasks task
        join memberships membership
          on membership.organization_id = task.organization_id
          and membership.facility_id = task.facility_id
          and membership.id = task.assigned_membership_id
          and membership.status = 'active'
        join users user on user.id = membership.user_id and user.status = 'active'
        where task.organization_id = ?1 and task.facility_id = ?2
          and task.id = ?3 and task.patient_id = ?4
        limit 1
      `).bind(
        this.scope.organizationId,
        this.scope.facilityId,
        source.recordId,
        source.patient.id,
      ).first<{ membershipId: string; displayName: string }>();
      if (assignee) return assignee;
      throw new CommunicationLifecycleError(
        'Нельзя назначить ручной контакт: ответственный за задачу неактивен',
      );
    }
    const actor = await this.database.prepare(`
      select membership.id as membershipId, user.display_name as displayName
      from memberships membership
      join users user on user.id = membership.user_id and user.status = 'active'
      where membership.organization_id = ?1 and membership.facility_id = ?2
        and membership.id = ?3 and membership.status = 'active' limit 1
    `).bind(
      this.scope.organizationId,
      this.scope.facilityId,
      this.scope.membershipId,
    ).first<{ membershipId: string; displayName: string }>();
    if (!actor) throw new CommunicationNotFoundError();
    return actor;
  }

  private notificationEventInsert(
    row: NotificationRow,
    predecessorId: string | null,
    actorMembershipId: string,
    reason: string,
    now: number,
  ) {
    return this.database.prepare(`insert into patient_notification_events (
      id, organization_id, facility_id, notification_id, patient_id,
      version, supersedes_notification_event_id, state, purpose, channel,
      language, consent_event_id, template_version_id, policy_version_id,
      source_type, source_record_id, source_version_id, requested_at,
      scheduled_at, next_attempt_at, destination_hint,
      destination_fingerprint, rendered_body, template_values_json,
      content_hash, outbox_event_id,
      attempt_count, failure_owner_membership_id, last_failure_code,
      changed_by_membership_id, change_reason, created_at, access_assignment_id
    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
      ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
      ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31,
      ?32, ?33)`)
      .bind(
        row.currentEventId,
        this.scope.organizationId,
        this.scope.facilityId,
        row.notificationId,
        row.patientId,
        row.currentVersion,
        predecessorId,
        row.state,
        row.purpose,
        row.channel,
        row.language,
        row.consentEventId,
        row.templateVersionId,
        row.policyVersionId,
        row.sourceType,
        row.sourceRecordId,
        row.sourceVersionId,
        row.requestedAt,
        row.scheduledAt,
        row.nextAttemptAt,
        row.destinationHint,
        row.destinationFingerprint,
        row.renderedBody,
        row.templateValuesJson,
        row.contentHash,
        row.outboxEventId,
        row.attemptCount,
        row.failureOwnerMembershipId,
        row.lastFailureCode,
        actorMembershipId,
        reason,
        now,
        this.scope.accessAssignmentId,
      );
  }

  private manualTaskCreateStatements(
    notification: NotificationRow,
    now: number,
    reason: string,
  ) {
    const taskId = `communication-manual-task-${crypto.randomUUID()}`;
    const eventId = `manual-task-event-${crypto.randomUUID()}`;
    const failureReason = notification.lastFailureCode === 'PROVIDER_NOT_CONFIGURED'
      ? 'Провайдер связи не подключён; нужен ручной контакт'
      : reason;
    const row: ManualTaskRow = {
      taskId,
      notificationId: notification.notificationId,
      patientId: notification.patientId,
      patientDisplayName: notification.patientDisplayName,
      medicalRecordNumber: notification.medicalRecordNumber,
      channel: notification.channel,
      destinationHint: notification.destinationHint,
      currentEventId: eventId,
      currentVersion: 1,
      state: 'open',
      assignedMembershipId: notification.failureOwnerMembershipId,
      assignedTo: notification.failureOwner,
      dueAt: now,
      failureReason,
      responseId: null,
      outcomeSummary: null,
      changeReason: reason,
    };
    return [
      this.manualTaskEventInsert(row, null, this.scope.membershipId, reason, now),
      this.database.prepare(`insert into communication_manual_task_heads (
        id, organization_id, facility_id, task_id, current_event_id,
        lock_version, created_at, updated_at
      ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
        .bind(
          `manual-task-head-${crypto.randomUUID()}`,
          this.scope.organizationId,
          this.scope.facilityId,
          taskId,
          eventId,
          now,
        ),
    ];
  }

  private manualTaskEventInsert(
    row: ManualTaskRow,
    predecessorId: string | null,
    actorMembershipId: string,
    reason: string,
    now: number,
  ) {
    return this.database.prepare(`insert into communication_manual_task_events (
      id, organization_id, facility_id, task_id, notification_id,
      version, supersedes_task_event_id, state, assigned_membership_id,
      due_at, failure_reason, response_id, outcome_summary,
      changed_by_membership_id, change_reason, created_at, access_assignment_id
    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
      ?11, ?12, ?13, ?14, ?15, ?16, ?17)`)
      .bind(
        row.currentEventId,
        this.scope.organizationId,
        this.scope.facilityId,
        row.taskId,
        row.notificationId,
        row.currentVersion,
        predecessorId,
        row.state,
        row.assignedMembershipId,
        row.dueAt,
        row.failureReason,
        row.responseId,
        row.outcomeSummary,
        actorMembershipId,
        reason,
        now,
        this.scope.accessAssignmentId,
      );
  }

  private async requireAuditHead() {
    const row = await this.database.prepare(`select last_sequence as lastSequence,
      last_event_hash as lastEventHash, lock_version as lockVersion
      from audit_stream_heads
      where organization_id = ?1 and facility_id = ?2 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
    if (!row) throw new CommunicationAuditUnavailableError();
    return row;
  }

  private async createAudit(input: {
    auditHead: AuditHeadRow;
    action: string;
    entityType: string;
    entityId: string;
    requestId: string;
    metadata: Record<string, unknown>;
    occurredAt: number;
  }) {
    const sequence = input.auditHead.lastSequence + 1;
    const metadataJson = JSON.stringify({ ...input.metadata, accessAssignmentId: this.scope.accessAssignmentId });
    const eventHash = await hashAuditEvent({
      previousHash: input.auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: this.scope.userId,
      actorMembershipId: this.scope.membershipId,
      action: input.action,
      outcome: 'succeeded',
      purpose: 'synthetic_patient_communication',
      schemaVersion: 1,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      metadataJson,
      occurredAt: input.occurredAt,
    });
    return {
      ...input,
      id: `audit-${crypto.randomUUID()}`,
      sequence,
      metadataJson,
      eventHash,
    };
  }

  private auditInsert(
    audit: Awaited<ReturnType<D1PatientCommunicationsRepository['createAudit']>>,
  ) {
    return this.database.prepare(`insert into audit_events (
      id, organization_id, facility_id, sequence, actor_type, actor_id,
      actor_membership_id, action, outcome, purpose, schema_version,
      entity_type, entity_id, request_id, metadata_json, previous_hash,
      event_hash, occurred_at
    ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
      'synthetic_patient_communication', 1, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
      .bind(
        audit.id,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.sequence,
        this.scope.userId,
        this.scope.membershipId,
        audit.action,
        audit.entityType,
        audit.entityId,
        audit.requestId,
        audit.metadataJson,
        audit.auditHead.lastEventHash,
        audit.eventHash,
        audit.occurredAt,
      );
  }

  private auditHeadUpdate(
    audit: Awaited<ReturnType<D1PatientCommunicationsRepository['createAudit']>>,
  ) {
    return this.database.prepare(`update audit_stream_heads
      set last_sequence = ?1, last_event_hash = ?2,
        lock_version = lock_version + 1, updated_at = ?3
      where organization_id = ?4 and facility_id = ?5
        and last_sequence = ?6 and lock_version = ?7
        and exists (select 1 from audit_events where id = ?8)`)
      .bind(
        audit.sequence,
        audit.eventHash,
        audit.occurredAt,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.auditHead.lastSequence,
        audit.auditHead.lockVersion,
        audit.id,
      );
  }

  private async findIdempotency(operation: string, key: string) {
    return this.database.prepare(`select id, request_hash as requestHash, status,
      result_resource_id as resultResourceId, response_json as responseJson
      from command_idempotency
      where organization_id = ?1 and facility_id = ?2
        and actor_membership_id = ?3 and operation = ?4
        and idempotency_key = ?5 and access_assignment_id = ?6 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        operation,
        key,
        this.scope.accessAssignmentId,
      )
      .first<IdempotencyRow>();
  }

  private resolveReplay<T>(replay: IdempotencyRow, requestHash: string): T {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId ||
      !replay.responseJson
    ) {
      throw new CommunicationConflictError(
        'Ключ идемпотентности конфликтует с прошлой командой связи',
      );
    }
    try {
      const stored = JSON.parse(replay.responseJson) as T & { id?: string };
      if (stored.id !== replay.resultResourceId) throw new Error('Resource mismatch');
      return stored;
    } catch {
      throw new CommunicationConflictError(
        'Сохранённый ответ команды связи повреждён',
      );
    }
  }

  private commandStart(input: {
    id: string;
    operation: string;
    key: string;
    requestHash: string;
    now: number;
  }) {
    return this.database.prepare(`insert into command_idempotency (
      id, organization_id, facility_id, actor_membership_id,
      operation, idempotency_key, request_hash, status, created_at, access_assignment_id
    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'processing', ?8, ?9)`)
      .bind(
        input.id,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        input.operation,
        input.key,
        input.requestHash,
        input.now,
        this.scope.accessAssignmentId,
      );
  }

  private commandComplete(input: {
    id: string;
    resourceType: string;
    resourceId: string;
    responseJson: string;
    now: number;
  }) {
    return this.database.prepare(`update command_idempotency
      set status = 'succeeded', result_resource_type = ?1,
        result_resource_id = ?2, response_json = ?3, completed_at = ?4
      where id = ?5 and status = 'processing'`)
      .bind(
        input.resourceType,
        input.resourceId,
        input.responseJson,
        input.now,
        input.id,
      );
  }

  private async commitCommand<T>(input: {
    operation: string;
    key: string;
    requestHash: string;
    resourceType: string;
    resourceId: string;
    response: T;
    action: string;
    entityType: string;
    requestId: string;
    metadata: Record<string, unknown>;
    now: number;
    statements: D1PreparedStatement[];
  }): Promise<T> {
    const existing = await this.findIdempotency(input.operation, input.key);
    if (existing) return this.resolveReplay<T>(existing, input.requestHash);
    const commandId = `command-${crypto.randomUUID()}`;
    const responseJson = JSON.stringify(input.response);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: input.action,
        entityType: input.entityType,
        entityId: input.resourceId,
        requestId: input.requestId,
        metadata: input.metadata,
        occurredAt: input.now,
      });
      const statements = [
        this.commandStart({
          id: commandId,
          operation: input.operation,
          key: input.key,
          requestHash: input.requestHash,
          now: input.now,
        }),
        ...input.statements,
        this.auditInsert(audit),
        this.auditHeadUpdate(audit),
        this.commandComplete({
          id: commandId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          responseJson,
          now: input.now,
        }),
      ];
      try {
        const results = await this.database.batch(statements);
        if (
          results.length !== statements.length ||
          results.some((result) => result.meta.changes !== 1)
        ) {
          throw new CommunicationConflictError(
            'Команда связи не была зафиксирована атомарно',
          );
        }
        return input.response;
      } catch (error) {
        const replay = await this.findIdempotency(input.operation, input.key);
        if (replay?.status === 'succeeded') {
          return this.resolveReplay<T>(replay, input.requestHash);
        }
        const currentAudit = await this.requireAuditHead();
        const contended =
          currentAudit.lastSequence !== auditHead.lastSequence ||
          currentAudit.lockVersion !== auditHead.lockVersion;
        if (contended && attempt < 2) continue;
        throw error;
      }
    }
    throw new CommunicationAuditUnavailableError();
  }
}
