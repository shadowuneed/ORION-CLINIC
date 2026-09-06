import { hashAuditEvent } from '@/lib/audit/event-hash';
import {
  requireSchedulingPermission,
  schedulingCapabilities,
  type SchedulingPermission,
  type SchedulingScope,
} from '@/lib/auth/scheduling-access';
import {
  assertQueueTicketCanBeIssued,
  assertReferralEligibleForScheduling,
  assertSchedulingAppointmentTransition,
  assertSchedulingQueueTransition,
  assertSchedulingSlotTransition,
  hashSchedulingConfirmationStatement,
  SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
  schedulingHoldExpiresAt,
  type SchedulingAppointmentStatus,
  type SchedulingLanguage,
  type SchedulingQueueStatus,
  type SchedulingSlotStatus,
} from '@/lib/domain/scheduling';

export type SchedulingListInput = {
  dateFrom?: string;
  dateTo?: string;
  specialtyId?: string;
  providerId?: string;
  slotStatus?: SchedulingSlotStatus | 'all';
  appointmentStatus?: SchedulingAppointmentStatus | 'all';
  limit?: number;
};

export type SchedulingEligibleReferral = {
  serviceRequestId: string;
  serviceRequestVersionId: string;
  encounterId: string;
  patient: {
    id: string;
    displayName: string;
    medicalRecordNumber: string;
  };
  requestedService: string;
  targetSpecialty: string | null;
  approvedAt: number;
};

export type SchedulingSpecialty = {
  id: string;
  code: string;
  displayName: string;
};

export type SchedulingService = {
  id: string;
  specialtyId: string;
  code: string;
  displayName: string;
  durationMinutes: number;
};

export type SchedulingProvider = {
  id: string;
  specialtyId: string;
  displayName: string;
};

export type SchedulingSlotRecord = {
  id: string;
  scheduleId: string;
  providerId: string;
  serviceId: string;
  specialtyId: string;
  startsAt: number;
  endsAt: number;
  sourceLabel: string;
  current: {
    id: string;
    version: number;
    status: SchedulingSlotStatus;
    appointmentId: string | null;
    holdExpiresAt: number | null;
  };
};

export type SchedulingPreferenceSnapshot = {
  id: string;
  serviceRequestId: string;
  serviceRequestVersionId: string;
  patientId: string;
  version: number;
  preferredDateFrom: string;
  preferredDateTo: string;
  earliestLocalTime: string | null;
  latestLocalTime: string | null;
  preferredProviderId: string | null;
  notes: string | null;
  noticeLanguage: SchedulingLanguage;
  capturedAt: number;
};

export type SchedulingAppointmentRecord = {
  id: string;
  serviceRequestId: string;
  patient: {
    id: string;
    displayName: string;
    medicalRecordNumber: string;
  };
  slot: {
    id: string;
    providerId: string;
    providerName: string;
    serviceId: string;
    serviceName: string;
    specialtyId: string;
    specialtyName: string;
    startsAt: number;
    endsAt: number;
  };
  current: {
    id: string;
    version: number;
    status: SchedulingAppointmentStatus;
    slotVersion: number;
    preferenceSnapshotId: string;
    serviceRequestVersionId: string;
    holdExpiresAt: number | null;
    confirmedAt: number | null;
    changeReason: string;
  };
};

export type SchedulingQueueTicketRecord = {
  id: string;
  appointmentId: string;
  patient: {
    id: string;
    displayName: string;
    medicalRecordNumber: string;
  };
  serviceDate: string;
  sequence: number;
  displayNumber: string;
  current: {
    id: string;
    version: number;
    status: SchedulingQueueStatus;
    roomLabel: string | null;
    exceptionCode: string | null;
    exceptionNote: string | null;
    changeReason: string;
  };
};

export type SchedulingWorkspace = {
  eligibleReferrals: SchedulingEligibleReferral[];
  specialties: SchedulingSpecialty[];
  services: SchedulingService[];
  providers: SchedulingProvider[];
  slots: SchedulingSlotRecord[];
  preferences: SchedulingPreferenceSnapshot[];
  appointments: SchedulingAppointmentRecord[];
  queue: SchedulingQueueTicketRecord[];
  capabilities: Record<SchedulingPermission, boolean>;
};

export type CreateSchedulingPreferenceCommand = {
  serviceRequestId: string;
  serviceRequestVersionId: string;
  preferredDateFrom: string;
  preferredDateTo: string;
  earliestLocalTime: string | null;
  latestLocalTime: string | null;
  preferredProviderId: string | null;
  notes: string | null;
  noticeLanguage: SchedulingLanguage;
  idempotencyKey: string;
  requestId: string;
};

export type HoldSchedulingSlotCommand = {
  serviceRequestId: string;
  slotId: string;
  preferenceSnapshotId: string;
  expectedSlotVersion: number;
  idempotencyKey: string;
  requestId: string;
};

export type ConfirmSchedulingAppointmentCommand = {
  appointmentId: string;
  expectedAppointmentVersion: number;
  expectedSlotVersion: number;
  confirmation: {
    subject: 'patient' | 'proxy';
    method: 'verbal_in_person' | 'verbal_phone' | 'digital';
    language: SchedulingLanguage;
    statementVersion: string;
    statementHash: string;
    acknowledged: true;
  };
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type SchedulingAppointmentCommand = {
  appointmentId: string;
  action: 'cancel' | 'expire_hold' | 'mark_no_show';
  expectedAppointmentVersion: number;
  expectedSlotVersion: number;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type IssueSchedulingQueueTicketCommand = {
  appointmentId: string;
  expectedAppointmentVersion: number;
  idempotencyKey: string;
  requestId: string;
};

export type SchedulingQueueCommand = {
  ticketId: string;
  action: 'arrive' | 'call' | 'start_service' | 'complete' | 'mark_exception';
  expectedQueueVersion: number;
  expectedAppointmentVersion?: number;
  reason: string;
  roomLabel: string | null;
  exceptionCode: string | null;
  exceptionNote: string | null;
  idempotencyKey: string;
  requestId: string;
};

type ReferralRow = {
  serviceRequestId: string;
  serviceRequestVersionId: string;
  encounterId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  requestedService: string;
  targetSpecialty: string | null;
  approvedByMembershipId: string | null;
  approvedAt: number | null;
  requestKind: string;
  status: string;
  clinicianMembershipId: string;
  careConsentEffective: number;
};

type SlotRow = {
  id: string;
  scheduleId: string;
  providerId: string;
  serviceId: string;
  specialtyId: string;
  startsAt: number;
  endsAt: number;
  sourceLabel: string;
  currentVersionId: string;
  currentVersion: number;
  currentStatus: SchedulingSlotStatus;
  appointmentId: string | null;
  patientId: string | null;
  referralRequestId: string | null;
  referralVersionId: string | null;
  heldByMembershipId: string | null;
  holdExpiresAt: number | null;
  providerName: string;
  serviceName: string;
  specialtyName: string;
};

type AppointmentRow = {
  id: string;
  serviceRequestId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  slotId: string;
  providerId: string;
  providerName: string;
  serviceId: string;
  serviceName: string;
  specialtyId: string;
  specialtyName: string;
  startsAt: number;
  endsAt: number;
  currentVersionId: string;
  currentVersion: number;
  currentStatus: SchedulingAppointmentStatus;
  slotVersion: number;
  preferenceSnapshotId: string;
  serviceRequestVersionId: string;
  holdExpiresAt: number | null;
  confirmedAt: number | null;
  confirmationSubject: 'patient' | 'proxy' | null;
  confirmationMethod: 'verbal_in_person' | 'verbal_phone' | 'digital' | null;
  confirmationLanguage: SchedulingLanguage | null;
  confirmationStatementVersion: string | null;
  confirmationStatementHash: string | null;
  changeReason: string;
};

type QueueRow = {
  id: string;
  appointmentId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  serviceDate: string;
  sequence: number;
  displayNumber: string;
  currentVersionId: string;
  currentVersion: number;
  currentStatus: SchedulingQueueStatus;
  roomLabel: string | null;
  exceptionCode: string | null;
  exceptionNote: string | null;
  changeReason: string;
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

export class SchedulingAuditUnavailableError extends Error {}
export class SchedulingConflictError extends Error {}
export class SchedulingConsentRequiredError extends Error {}
export class SchedulingLifecycleError extends Error {}
export class SchedulingNotFoundError extends Error {}
export class SchedulingVersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly resource: 'preference' | 'slot' | 'appointment' | 'queue',
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

function formatDateInTimeZone(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

async function sha256Json(value: unknown) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function toAppointment(row: AppointmentRow): SchedulingAppointmentRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    patient: {
      id: row.patientId,
      displayName: row.patientDisplayName,
      medicalRecordNumber: row.medicalRecordNumber,
    },
    slot: {
      id: row.slotId,
      providerId: row.providerId,
      providerName: row.providerName,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      specialtyId: row.specialtyId,
      specialtyName: row.specialtyName,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    },
    current: {
      id: row.currentVersionId,
      version: row.currentVersion,
      status: row.currentStatus,
      slotVersion: row.slotVersion,
      preferenceSnapshotId: row.preferenceSnapshotId,
      serviceRequestVersionId: row.serviceRequestVersionId,
      holdExpiresAt: row.holdExpiresAt,
      confirmedAt: row.confirmedAt,
      changeReason: row.changeReason,
    },
  };
}

function toQueueTicket(row: QueueRow): SchedulingQueueTicketRecord {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    patient: {
      id: row.patientId,
      displayName: row.patientDisplayName,
      medicalRecordNumber: row.medicalRecordNumber,
    },
    serviceDate: row.serviceDate,
    sequence: row.sequence,
    displayNumber: row.displayNumber,
    current: {
      id: row.currentVersionId,
      version: row.currentVersion,
      status: row.currentStatus,
      roomLabel: row.roomLabel,
      exceptionCode: row.exceptionCode,
      exceptionNote: row.exceptionNote,
      changeReason: row.changeReason,
    },
  };
}

export class D1SchedulingWorkflowRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: SchedulingScope,
  ) {}

  async list(input: SchedulingListInput = {}): Promise<SchedulingWorkspace> {
    requireSchedulingPermission(this.scope.role, 'workspace.read');
    const now = Date.now();
    const [
      referralResult,
      specialtyResult,
      serviceResult,
      providerResult,
      slotResult,
      preferenceResult,
      appointmentResult,
      queueResult,
    ] = await Promise.all([
      this.database
        .prepare(`
          select request.id as serviceRequestId,
            current.id as serviceRequestVersionId,
            request.encounter_id as encounterId,
            request.patient_id as patientId,
            patient.display_name as patientDisplayName,
            patient.medical_record_number as medicalRecordNumber,
            current.requested_service as requestedService,
            current.target_specialty as targetSpecialty,
            current.approved_by_membership_id as approvedByMembershipId,
            current.approved_at as approvedAt,
            request.request_kind as requestKind, current.status,
            encounter.clinician_membership_id as clinicianMembershipId,
            exists (
              select 1 from consent_heads consent_head
              join consent_events consent_event
                on consent_event.organization_id = consent_head.organization_id
                and consent_event.facility_id = consent_head.facility_id
                and consent_event.patient_id = consent_head.patient_id
                and consent_event.encounter_id = consent_head.encounter_id
                and consent_event.consent_type = consent_head.consent_type
                and consent_event.id = consent_head.current_consent_event_id
              where consent_head.organization_id = request.organization_id
                and consent_head.facility_id = request.facility_id
                and consent_head.encounter_id = request.encounter_id
                and consent_head.consent_type = 'care'
                and consent_event.decision = 'granted'
                and consent_event.effective_at <= ?3
                and (consent_event.expires_at is null or consent_event.expires_at > ?3)
            ) as careConsentEffective
          from service_requests request
          join service_request_heads head
            on head.organization_id = request.organization_id
            and head.facility_id = request.facility_id
            and head.service_request_id = request.id
          join service_request_versions current
            on current.organization_id = head.organization_id
            and current.facility_id = head.facility_id
            and current.service_request_id = head.service_request_id
            and current.id = head.current_version_id
          join patients patient
            on patient.organization_id = request.organization_id
            and patient.facility_id = request.facility_id
            and patient.id = request.patient_id
            and patient.status = 'active'
          join encounters encounter
            on encounter.organization_id = request.organization_id
            and encounter.facility_id = request.facility_id
            and encounter.id = request.encounter_id
          where request.organization_id = ?1 and request.facility_id = ?2
            and request.request_kind = 'referral'
            and current.status = 'active'
            and current.approved_by_membership_id is not null
            and current.approved_at is not null
          order by current.approved_at desc, request.id
        `)
        .bind(this.scope.organizationId, this.scope.facilityId, now)
        .all<ReferralRow>(),
      this.database
        .prepare(`select id, code, display_name as displayName
          from scheduling_specialties
          where organization_id = ?1 and facility_id = ?2 and status = 'active'
          order by display_name, id`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<SchedulingSpecialty>(),
      this.database
        .prepare(`select id, specialty_id as specialtyId, code,
          display_name as displayName, duration_minutes as durationMinutes
          from scheduling_services
          where organization_id = ?1 and facility_id = ?2 and status = 'active'
          order by display_name, id`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<SchedulingService>(),
      this.database
        .prepare(`select id, specialty_id as specialtyId,
          display_name as displayName
          from scheduling_providers
          where organization_id = ?1 and facility_id = ?2 and status = 'active'
          order by display_name, id`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<SchedulingProvider>(),
      this.database
        .prepare(`select slot.id, slot.schedule_id as scheduleId,
          slot.provider_id as providerId, slot.service_id as serviceId,
          service.specialty_id as specialtyId, slot.starts_at as startsAt,
          slot.ends_at as endsAt, slot.source_label as sourceLabel,
          head.current_version_id as currentVersionId,
          head.lock_version as currentVersion,
          current.status as currentStatus,
          current.appointment_id as appointmentId,
          current.patient_id as patientId,
          current.referral_request_id as referralRequestId,
          current.referral_version_id as referralVersionId,
          current.held_by_membership_id as heldByMembershipId,
          current.hold_expires_at as holdExpiresAt,
          provider.display_name as providerName,
          service.display_name as serviceName,
          specialty.display_name as specialtyName
          from appointment_slots slot
          join appointment_slot_heads head
            on head.organization_id = slot.organization_id
            and head.facility_id = slot.facility_id
            and head.slot_id = slot.id
          join appointment_slot_versions current
            on current.organization_id = head.organization_id
            and current.facility_id = head.facility_id
            and current.slot_id = head.slot_id
            and current.id = head.current_version_id
          join scheduling_providers provider
            on provider.organization_id = slot.organization_id
            and provider.facility_id = slot.facility_id
            and provider.id = slot.provider_id
          join scheduling_services service
            on service.organization_id = slot.organization_id
            and service.facility_id = slot.facility_id
            and service.id = slot.service_id
          join scheduling_specialties specialty
            on specialty.organization_id = service.organization_id
            and specialty.facility_id = service.facility_id
            and specialty.id = service.specialty_id
          where slot.organization_id = ?1 and slot.facility_id = ?2
            and slot.source_type = 'manual_test'
          order by slot.starts_at, provider.display_name, slot.id`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<SlotRow>(),
      this.database
        .prepare(`select preference.id,
          preference.referral_request_id as serviceRequestId,
          preference.referral_version_id as serviceRequestVersionId,
          preference.patient_id as patientId, preference.version,
          preference.preferred_date_from as preferredDateFrom,
          preference.preferred_date_to as preferredDateTo,
          preference.earliest_local_time as earliestLocalTime,
          preference.latest_local_time as latestLocalTime,
          preference.preferred_provider_id as preferredProviderId,
          preference.notes, preference.notice_language as noticeLanguage,
          preference.captured_at as capturedAt
          from scheduling_preference_snapshots preference
          where preference.organization_id = ?1 and preference.facility_id = ?2
            and not exists (
              select 1 from scheduling_preference_snapshots newer
              where newer.organization_id = preference.organization_id
                and newer.facility_id = preference.facility_id
                and newer.referral_request_id = preference.referral_request_id
                and newer.version > preference.version
            )
          order by preference.captured_at desc, preference.id`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<SchedulingPreferenceSnapshot>(),
      this.database
        .prepare(this.appointmentSelectSql())
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<AppointmentRow>(),
      this.database
        .prepare(this.queueSelectSql())
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<QueueRow>(),
    ]);

    const eligibleReferrals = referralResult.results
      .filter(
        (row) =>
          row.careConsentEffective === 1 &&
          (this.scope.role === 'registrar' ||
            row.clinicianMembershipId === this.scope.membershipId),
      )
      .map((row) => ({
        serviceRequestId: row.serviceRequestId,
        serviceRequestVersionId: row.serviceRequestVersionId,
        encounterId: row.encounterId,
        patient: {
          id: row.patientId,
          displayName: row.patientDisplayName,
          medicalRecordNumber: row.medicalRecordNumber,
        },
        requestedService: row.requestedService,
        targetSpecialty: row.targetSpecialty,
        approvedAt: row.approvedAt as number,
      }));

    const from = input.dateFrom ? Date.parse(`${input.dateFrom}T00:00:00Z`) : null;
    const to = input.dateTo ? Date.parse(`${input.dateTo}T23:59:59.999Z`) : null;
    const limit = input.limit ?? 100;
    const slots = slotResult.results
      .filter((row) => from === null || row.startsAt >= from)
      .filter((row) => to === null || row.startsAt <= to)
      .filter((row) => !input.specialtyId || row.specialtyId === input.specialtyId)
      .filter((row) => !input.providerId || row.providerId === input.providerId)
      .filter(
        (row) =>
          !input.slotStatus ||
          input.slotStatus === 'all' ||
          row.currentStatus === input.slotStatus,
      )
      .slice(0, limit)
      .map(
        (row): SchedulingSlotRecord => ({
          id: row.id,
          scheduleId: row.scheduleId,
          providerId: row.providerId,
          serviceId: row.serviceId,
          specialtyId: row.specialtyId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          sourceLabel: row.sourceLabel,
          current: {
            id: row.currentVersionId,
            version: row.currentVersion,
            status: row.currentStatus,
            appointmentId: row.appointmentId,
            holdExpiresAt: row.holdExpiresAt,
          },
        }),
      );
    const appointments = appointmentResult.results
      .filter(
        (row) =>
          !input.appointmentStatus ||
          input.appointmentStatus === 'all' ||
          row.currentStatus === input.appointmentStatus,
      )
      .slice(0, limit)
      .map(toAppointment);

    return {
      eligibleReferrals,
      specialties: specialtyResult.results,
      services: serviceResult.results,
      providers: providerResult.results,
      slots,
      preferences: preferenceResult.results,
      appointments,
      queue: queueResult.results.slice(0, limit).map(toQueueTicket),
      capabilities: schedulingCapabilities(this.scope.role),
    };
  }

  async createPreference(
    input: CreateSchedulingPreferenceCommand,
  ): Promise<SchedulingPreferenceSnapshot> {
    requireSchedulingPermission(this.scope.role, 'preference.capture');
    const normalized = {
      accessAssignmentId: this.scope.accessAssignmentId,
      serviceRequestId: input.serviceRequestId,
      serviceRequestVersionId: input.serviceRequestVersionId,
      preferredDateFrom: input.preferredDateFrom,
      preferredDateTo: input.preferredDateTo,
      earliestLocalTime: input.earliestLocalTime,
      latestLocalTime: input.latestLocalTime,
      preferredProviderId: input.preferredProviderId,
      notes: normalizeNullable(input.notes),
      noticeLanguage: input.noticeLanguage,
      dataMode: 'synthetic-only',
    } as const;
    const requestHash = await sha256Json(normalized);
    const replay = await this.findIdempotency(
      'scheduling.preference.create',
      input.idempotencyKey,
    );
    if (replay) {
      return this.resolveReplay<SchedulingPreferenceSnapshot>(replay, requestHash);
    }

    const referral = await this.requireEligibleReferral(
      normalized.serviceRequestId,
      normalized.serviceRequestVersionId,
    );
    if (normalized.preferredProviderId) {
      const provider = await this.database
        .prepare(`select 1 as present from scheduling_providers
          where organization_id = ?1 and facility_id = ?2 and id = ?3
            and status = 'active' and source_type = 'manual_test' limit 1`)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          normalized.preferredProviderId,
        )
        .first<{ present: number }>();
      if (!provider) throw new SchedulingNotFoundError();
    }

    const previous = await this.database
      .prepare(`select id, version from scheduling_preference_snapshots
        where organization_id = ?1 and facility_id = ?2
          and referral_request_id = ?3
        order by version desc limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        normalized.serviceRequestId,
      )
      .first<{ id: string; version: number }>();
    const now = Date.now();
    const preferenceId = `preference-${crypto.randomUUID()}`;
    const response: SchedulingPreferenceSnapshot = {
      id: preferenceId,
      serviceRequestId: normalized.serviceRequestId,
      serviceRequestVersionId: normalized.serviceRequestVersionId,
      patientId: referral.patientId,
      version: (previous?.version ?? 0) + 1,
      preferredDateFrom: normalized.preferredDateFrom,
      preferredDateTo: normalized.preferredDateTo,
      earliestLocalTime: normalized.earliestLocalTime,
      latestLocalTime: normalized.latestLocalTime,
      preferredProviderId: normalized.preferredProviderId,
      notes: normalized.notes,
      noticeLanguage: normalized.noticeLanguage,
      capturedAt: now,
    };

    try {
      return await this.commitCommand({
        operation: 'scheduling.preference.create',
        key: input.idempotencyKey,
        requestHash,
        resourceType: 'scheduling_preference',
        resourceId: preferenceId,
        response,
        action: 'scheduling.preference.created',
        entityType: 'scheduling_preference',
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          preferenceVersion: response.version,
          serviceRequestId: response.serviceRequestId,
          dataMode: 'synthetic-only',
        },
        now,
        statements: [
          this.database
            .prepare(`insert into scheduling_preference_snapshots (
              id, organization_id, facility_id, patient_id,
              referral_request_id, referral_version_id, version,
              supersedes_preference_id, preferred_date_from, preferred_date_to,
              earliest_local_time, latest_local_time, preferred_provider_id,
              notes, notice_language, captured_by_membership_id,
              access_assignment_id, captured_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
              ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`)
            .bind(
              preferenceId,
              this.scope.organizationId,
              this.scope.facilityId,
              referral.patientId,
              response.serviceRequestId,
              response.serviceRequestVersionId,
              response.version,
              previous?.id ?? null,
              response.preferredDateFrom,
              response.preferredDateTo,
              response.earliestLocalTime,
              response.latestLocalTime,
              response.preferredProviderId,
              response.notes,
              response.noticeLanguage,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
        ],
      });
    } catch (error) {
      if (error instanceof SchedulingConflictError) throw error;
      const current = await this.database
        .prepare(`select max(version) as version from scheduling_preference_snapshots
          where organization_id = ?1 and facility_id = ?2
            and referral_request_id = ?3`)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          response.serviceRequestId,
        )
        .first<{ version: number | null }>();
      if ((current?.version ?? 0) !== (previous?.version ?? 0)) {
        throw new SchedulingVersionConflictError(current?.version ?? 0, 'preference');
      }
      throw new SchedulingConflictError('Preference could not be committed');
    }
  }

  async holdSlot(
    input: HoldSchedulingSlotCommand,
  ): Promise<SchedulingAppointmentRecord> {
    requireSchedulingPermission(this.scope.role, 'appointment.hold');
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      serviceRequestId: input.serviceRequestId,
      slotId: input.slotId,
      preferenceSnapshotId: input.preferenceSnapshotId,
      expectedSlotVersion: input.expectedSlotVersion,
      dataMode: 'synthetic-only',
    });
    const replay = await this.findIdempotency(
      'scheduling.appointment.hold',
      input.idempotencyKey,
    );
    if (replay) {
      return this.resolveReplay<SchedulingAppointmentRecord>(replay, requestHash);
    }

    const referral = await this.requireEligibleReferral(input.serviceRequestId);
    const preference = await this.getCurrentPreference(input.preferenceSnapshotId);
    if (
      !preference ||
      preference.serviceRequestId !== referral.serviceRequestId ||
      preference.serviceRequestVersionId !== referral.serviceRequestVersionId ||
      preference.patientId !== referral.patientId
    ) {
      throw new SchedulingNotFoundError();
    }
    const slot = await this.getSlotRow(input.slotId);
    if (!slot) throw new SchedulingNotFoundError();
    if (slot.currentVersion !== input.expectedSlotVersion) {
      throw new SchedulingVersionConflictError(slot.currentVersion, 'slot');
    }
    try {
      assertSchedulingSlotTransition(slot.currentStatus, 'held');
    } catch (error) {
      throw new SchedulingLifecycleError((error as Error).message);
    }
    const activeAppointment = await this.database
      .prepare(`select appointment.id
        from appointments appointment
        join appointment_heads head
          on head.organization_id = appointment.organization_id
          and head.facility_id = appointment.facility_id
          and head.appointment_id = appointment.id
        join appointment_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.appointment_id = head.appointment_id
          and current.id = head.current_version_id
        where appointment.organization_id = ?1 and appointment.facility_id = ?2
          and appointment.referral_request_id = ?3
          and current.status in ('held', 'confirmed') limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        referral.serviceRequestId,
      )
      .first<{ id: string }>();
    if (activeAppointment) {
      throw new SchedulingConflictError('Referral already has an active appointment');
    }

    const now = Date.now();
    const holdExpiresAt = Math.min(
      schedulingHoldExpiresAt(now),
      slot.startsAt - 60_000,
    );
    if (slot.startsAt <= now || holdExpiresAt <= now) {
      throw new SchedulingLifecycleError('Нельзя удержать уже начавшееся время');
    }
    const appointmentId = `appointment-${crypto.randomUUID()}`;
    const appointmentVersionId = `appointment-version-${crypto.randomUUID()}`;
    const slotVersionId = `slot-version-${crypto.randomUUID()}`;
    const reason = 'Время временно удерживается до решения пациента';
    const response: SchedulingAppointmentRecord = {
      id: appointmentId,
      serviceRequestId: referral.serviceRequestId,
      patient: {
        id: referral.patientId,
        displayName: referral.patientDisplayName,
        medicalRecordNumber: referral.medicalRecordNumber,
      },
      slot: {
        id: slot.id,
        providerId: slot.providerId,
        providerName: slot.providerName,
        serviceId: slot.serviceId,
        serviceName: slot.serviceName,
        specialtyId: slot.specialtyId,
        specialtyName: slot.specialtyName,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      },
      current: {
        id: appointmentVersionId,
        version: 1,
        status: 'held',
        slotVersion: slot.currentVersion + 1,
        preferenceSnapshotId: preference.id,
        serviceRequestVersionId: referral.serviceRequestVersionId,
        holdExpiresAt,
        confirmedAt: null,
        changeReason: reason,
      },
    };

    try {
      return await this.commitCommand({
        operation: 'scheduling.appointment.hold',
        key: input.idempotencyKey,
        requestHash,
        resourceType: 'appointment',
        resourceId: appointmentId,
        response,
        action: 'scheduling.appointment.held',
        entityType: 'appointment',
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          slotId: slot.id,
          slotVersion: response.current.slotVersion,
          serviceRequestId: referral.serviceRequestId,
          holdExpiresAt,
          dataMode: 'synthetic-only',
        },
        now,
        statements: [
          this.database
            .prepare(`insert into appointments (
              id, organization_id, facility_id, patient_id,
              referral_request_id, created_by_membership_id,
              access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
            .bind(
              appointmentId,
              this.scope.organizationId,
              this.scope.facilityId,
              referral.patientId,
              referral.serviceRequestId,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`insert into appointment_versions (
              id, organization_id, facility_id, appointment_id, version,
              supersedes_version_id, status, slot_id, preference_snapshot_id,
              referral_version_id, hold_expires_at, change_reason,
              changed_by_membership_id, access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, 1, null, 'held', ?5, ?6, ?7,
              ?8, ?9, ?10, ?11, ?12)`)
            .bind(
              appointmentVersionId,
              this.scope.organizationId,
              this.scope.facilityId,
              appointmentId,
              slot.id,
              preference.id,
              referral.serviceRequestVersionId,
              holdExpiresAt,
              reason,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`insert into appointment_heads (
              id, organization_id, facility_id, appointment_id,
              current_version_id, lock_version, created_at, updated_at
            ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
            .bind(
              `appointment-head-${crypto.randomUUID()}`,
              this.scope.organizationId,
              this.scope.facilityId,
              appointmentId,
              appointmentVersionId,
              now,
            ),
          this.database
            .prepare(`insert into appointment_slot_versions (
              id, organization_id, facility_id, slot_id, version,
              supersedes_version_id, status, appointment_id, patient_id,
              referral_request_id, referral_version_id, held_by_membership_id,
              hold_expires_at, change_reason, changed_by_membership_id,
              access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, 'held', ?7, ?8, ?9,
              ?10, ?11, ?12, ?13, ?11, ?14, ?15)`)
            .bind(
              slotVersionId,
              this.scope.organizationId,
              this.scope.facilityId,
              slot.id,
              slot.currentVersion + 1,
              slot.currentVersionId,
              appointmentId,
              referral.patientId,
              referral.serviceRequestId,
              referral.serviceRequestVersionId,
              this.scope.membershipId,
              holdExpiresAt,
              reason,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`update appointment_slot_heads
              set current_version_id = ?1, lock_version = lock_version + 1,
                updated_at = ?2
              where organization_id = ?3 and facility_id = ?4 and slot_id = ?5
                and current_version_id = ?6 and lock_version = ?7`)
            .bind(
              slotVersionId,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              slot.id,
              slot.currentVersionId,
              slot.currentVersion,
            ),
        ],
      });
    } catch (error) {
      if (
        error instanceof SchedulingConflictError ||
        error instanceof SchedulingAuditUnavailableError
      ) {
        throw error;
      }
      const current = await this.getSlotRow(slot.id);
      if (current && current.currentVersion !== input.expectedSlotVersion) {
        throw new SchedulingVersionConflictError(current.currentVersion, 'slot');
      }
      throw new SchedulingConflictError('Slot hold could not be committed');
    }
  }

  async confirmAppointment(
    input: ConfirmSchedulingAppointmentCommand,
  ): Promise<SchedulingAppointmentRecord> {
    requireSchedulingPermission(this.scope.role, 'appointment.confirm');
    const reason = normalizeText(input.reason);
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      appointmentId: input.appointmentId,
      expectedAppointmentVersion: input.expectedAppointmentVersion,
      expectedSlotVersion: input.expectedSlotVersion,
      confirmation: input.confirmation,
      reason,
      dataMode: 'synthetic-only',
    });
    const replay = await this.findIdempotency(
      'scheduling.appointment.confirm',
      input.idempotencyKey,
    );
    if (replay) {
      return this.resolveReplay<SchedulingAppointmentRecord>(replay, requestHash);
    }

    const appointment = await this.getAppointmentRow(input.appointmentId);
    if (!appointment) throw new SchedulingNotFoundError();
    if (appointment.currentVersion !== input.expectedAppointmentVersion) {
      throw new SchedulingVersionConflictError(
        appointment.currentVersion,
        'appointment',
      );
    }
    const slot = await this.getSlotRow(appointment.slotId);
    if (!slot) throw new SchedulingNotFoundError();
    if (slot.currentVersion !== input.expectedSlotVersion) {
      throw new SchedulingVersionConflictError(slot.currentVersion, 'slot');
    }
    const now = Date.now();
    if (
      appointment.currentStatus !== 'held' ||
      slot.currentStatus !== 'held' ||
      slot.appointmentId !== appointment.id ||
      appointment.holdExpiresAt === null ||
      slot.holdExpiresAt === null ||
      appointment.holdExpiresAt <= now ||
      slot.holdExpiresAt <= now
    ) {
      throw new SchedulingLifecycleError(
        'Подтверждение возможно только для действующего резерва этого пациента',
      );
    }
    if (
      input.confirmation.statementVersion !==
      SCHEDULING_CONFIRMATION_STATEMENT_VERSION
    ) {
      throw new SchedulingLifecycleError(
        'Версия формулировки подтверждения не поддерживается',
      );
    }
    const expectedStatementHash = await hashSchedulingConfirmationStatement({
      appointmentId: appointment.id,
      slotId: appointment.slotId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      subject: input.confirmation.subject,
      method: input.confirmation.method,
      language: input.confirmation.language,
    });
    if (input.confirmation.statementHash !== expectedStatementHash) {
      throw new SchedulingLifecycleError(
        'Подтверждение пациента не соответствует выбранной записи',
      );
    }
    try {
      assertSchedulingAppointmentTransition('held', 'confirmed');
      assertSchedulingSlotTransition('held', 'booked');
    } catch (error) {
      throw new SchedulingLifecycleError((error as Error).message);
    }

    const appointmentVersionId = `appointment-version-${crypto.randomUUID()}`;
    const slotVersionId = `slot-version-${crypto.randomUUID()}`;
    const response: SchedulingAppointmentRecord = {
      ...toAppointment(appointment),
      current: {
        id: appointmentVersionId,
        version: appointment.currentVersion + 1,
        status: 'confirmed',
        slotVersion: slot.currentVersion + 1,
        preferenceSnapshotId: appointment.preferenceSnapshotId,
        serviceRequestVersionId: appointment.serviceRequestVersionId,
        holdExpiresAt: null,
        confirmedAt: now,
        changeReason: reason,
      },
    };

    try {
      return await this.commitCommand({
        operation: 'scheduling.appointment.confirm',
        key: input.idempotencyKey,
        requestHash,
        resourceType: 'appointment',
        resourceId: appointment.id,
        response,
        action: 'scheduling.appointment.confirmed',
        entityType: 'appointment',
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          appointmentVersion: response.current.version,
          slotId: slot.id,
          slotVersion: response.current.slotVersion,
          confirmationMethod: input.confirmation.method,
          confirmationLanguage: input.confirmation.language,
          dataMode: 'synthetic-only',
        },
        now,
        statements: [
          this.database
            .prepare(`insert into appointment_versions (
              id, organization_id, facility_id, appointment_id, version,
              supersedes_version_id, status, slot_id, preference_snapshot_id,
              referral_version_id, hold_expires_at, confirmation_subject,
              confirmation_method, confirmation_language,
              confirmation_statement_version, confirmation_statement_hash,
              confirmed_at, change_reason, changed_by_membership_id,
              access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, 'confirmed', ?7, ?8,
              ?9, null, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`)
            .bind(
              appointmentVersionId,
              this.scope.organizationId,
              this.scope.facilityId,
              appointment.id,
              appointment.currentVersion + 1,
              appointment.currentVersionId,
              appointment.slotId,
              appointment.preferenceSnapshotId,
              appointment.serviceRequestVersionId,
              input.confirmation.subject,
              input.confirmation.method,
              input.confirmation.language,
              input.confirmation.statementVersion,
              input.confirmation.statementHash,
              now,
              reason,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`update appointment_heads
              set current_version_id = ?1, lock_version = lock_version + 1,
                updated_at = ?2
              where organization_id = ?3 and facility_id = ?4
                and appointment_id = ?5 and current_version_id = ?6
                and lock_version = ?7`)
            .bind(
              appointmentVersionId,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              appointment.id,
              appointment.currentVersionId,
              appointment.currentVersion,
            ),
          this.database
            .prepare(`insert into appointment_slot_versions (
              id, organization_id, facility_id, slot_id, version,
              supersedes_version_id, status, appointment_id, patient_id,
              referral_request_id, referral_version_id, held_by_membership_id,
              hold_expires_at, change_reason, changed_by_membership_id,
              access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, 'booked', ?7, ?8,
              ?9, ?10, ?11, null, ?12, ?13, ?14, ?15)`)
            .bind(
              slotVersionId,
              this.scope.organizationId,
              this.scope.facilityId,
              slot.id,
              slot.currentVersion + 1,
              slot.currentVersionId,
              appointment.id,
              appointment.patientId,
              appointment.serviceRequestId,
              appointment.serviceRequestVersionId,
              slot.heldByMembershipId ?? this.scope.membershipId,
              reason,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`update appointment_slot_heads
              set current_version_id = ?1, lock_version = lock_version + 1,
                updated_at = ?2
              where organization_id = ?3 and facility_id = ?4 and slot_id = ?5
                and current_version_id = ?6 and lock_version = ?7`)
            .bind(
              slotVersionId,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              slot.id,
              slot.currentVersionId,
              slot.currentVersion,
            ),
        ],
      });
    } catch (error) {
      if (
        error instanceof SchedulingConflictError ||
        error instanceof SchedulingAuditUnavailableError
      ) {
        throw error;
      }
      const current = await this.getAppointmentRow(appointment.id);
      if (current && current.currentVersion !== input.expectedAppointmentVersion) {
        throw new SchedulingVersionConflictError(current.currentVersion, 'appointment');
      }
      throw new SchedulingConflictError('Appointment confirmation could not commit');
    }
  }

  async commandAppointment(
    input: SchedulingAppointmentCommand,
  ): Promise<SchedulingAppointmentRecord> {
    const permission: Record<
      SchedulingAppointmentCommand['action'],
      SchedulingPermission
    > = {
      cancel: 'appointment.cancel',
      expire_hold: 'appointment.expire',
      mark_no_show: 'appointment.no_show',
    };
    requireSchedulingPermission(this.scope.role, permission[input.action]);
    const reason = normalizeText(input.reason);
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      appointmentId: input.appointmentId,
      action: input.action,
      expectedAppointmentVersion: input.expectedAppointmentVersion,
      expectedSlotVersion: input.expectedSlotVersion,
      reason,
      dataMode: 'synthetic-only',
    });
    const operation = `scheduling.appointment.${input.action}`;
    const replay = await this.findIdempotency(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<SchedulingAppointmentRecord>(replay, requestHash);
    }

    const appointment = await this.getAppointmentRow(input.appointmentId);
    if (!appointment) throw new SchedulingNotFoundError();
    if (appointment.currentVersion !== input.expectedAppointmentVersion) {
      throw new SchedulingVersionConflictError(
        appointment.currentVersion,
        'appointment',
      );
    }
    const slot = await this.getSlotRow(appointment.slotId);
    if (!slot) throw new SchedulingNotFoundError();
    if (slot.currentVersion !== input.expectedSlotVersion) {
      throw new SchedulingVersionConflictError(slot.currentVersion, 'slot');
    }
    const nextStatus: Record<
      SchedulingAppointmentCommand['action'],
      SchedulingAppointmentStatus
    > = {
      cancel: 'cancelled',
      expire_hold: 'expired',
      mark_no_show: 'no_show',
    };
    try {
      assertSchedulingAppointmentTransition(
        appointment.currentStatus,
        nextStatus[input.action],
      );
    } catch (error) {
      throw new SchedulingLifecycleError((error as Error).message);
    }
    const now = Date.now();
    if (
      input.action === 'expire_hold' &&
      (appointment.holdExpiresAt === null || appointment.holdExpiresAt > now)
    ) {
      throw new SchedulingLifecycleError('Действующий резерв ещё не истёк');
    }
    if (input.action === 'mark_no_show' && appointment.endsAt > now) {
      throw new SchedulingLifecycleError(
        'Неявку можно отметить только после окончания времени записи',
      );
    }
    const queue =
      input.action === 'cancel'
        ? await this.getQueueByAppointment(appointment.id)
        : null;
    if (queue && queue.currentStatus === 'in_service') {
      throw new SchedulingLifecycleError(
        'Нельзя отменить запись после начала обслуживания',
      );
    }
    if (queue && !['completed', 'cancelled', 'exception'].includes(queue.currentStatus)) {
      try {
        assertSchedulingQueueTransition(queue.currentStatus, 'cancelled');
      } catch (error) {
        throw new SchedulingLifecycleError((error as Error).message);
      }
    }

    const appointmentVersionId = `appointment-version-${crypto.randomUUID()}`;
    const response: SchedulingAppointmentRecord = {
      ...toAppointment(appointment),
      current: {
        ...toAppointment(appointment).current,
        id: appointmentVersionId,
        version: appointment.currentVersion + 1,
        status: nextStatus[input.action],
        slotVersion:
          input.action === 'cancel' || input.action === 'expire_hold'
            ? slot.currentVersion + 1
            : slot.currentVersion,
        holdExpiresAt: null,
        changeReason: reason,
      },
    };
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(`insert into appointment_versions (
          id, organization_id, facility_id, appointment_id, version,
          supersedes_version_id, status, slot_id, preference_snapshot_id,
          referral_version_id, hold_expires_at, confirmation_subject,
          confirmation_method, confirmation_language,
          confirmation_statement_version, confirmation_statement_hash,
          confirmed_at, change_reason, changed_by_membership_id,
          access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, null,
          ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`)
        .bind(
          appointmentVersionId,
          this.scope.organizationId,
          this.scope.facilityId,
          appointment.id,
          appointment.currentVersion + 1,
          appointment.currentVersionId,
          nextStatus[input.action],
          appointment.slotId,
          appointment.preferenceSnapshotId,
          appointment.serviceRequestVersionId,
          appointment.confirmationSubject,
          appointment.confirmationMethod,
          appointment.confirmationLanguage,
          appointment.confirmationStatementVersion,
          appointment.confirmationStatementHash,
          appointment.confirmedAt,
          reason,
          this.scope.membershipId,
          this.scope.accessAssignmentId,
          now,
        ),
      this.database
        .prepare(`update appointment_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and appointment_id = ?5 and current_version_id = ?6
            and lock_version = ?7`)
        .bind(
          appointmentVersionId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          appointment.id,
          appointment.currentVersionId,
          appointment.currentVersion,
        ),
    ];

    if (input.action === 'cancel' || input.action === 'expire_hold') {
      try {
        assertSchedulingSlotTransition(slot.currentStatus, 'available');
      } catch (error) {
        throw new SchedulingLifecycleError((error as Error).message);
      }
      const slotVersionId = `slot-version-${crypto.randomUUID()}`;
      statements.push(
        this.database
          .prepare(`insert into appointment_slot_versions (
            id, organization_id, facility_id, slot_id, version,
            supersedes_version_id, status, appointment_id, patient_id,
            referral_request_id, referral_version_id, held_by_membership_id,
            hold_expires_at, change_reason, changed_by_membership_id,
            access_assignment_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, 'available', null, null,
            null, null, null, null, ?7, ?8, ?9, ?10)`)
          .bind(
            slotVersionId,
            this.scope.organizationId,
            this.scope.facilityId,
            slot.id,
            slot.currentVersion + 1,
            slot.currentVersionId,
            reason,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database
          .prepare(`update appointment_slot_heads
            set current_version_id = ?1, lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4 and slot_id = ?5
              and current_version_id = ?6 and lock_version = ?7`)
          .bind(
            slotVersionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            slot.id,
            slot.currentVersionId,
            slot.currentVersion,
          ),
      );
    }

    if (queue && !['completed', 'cancelled', 'exception'].includes(queue.currentStatus)) {
      const queueVersionId = `queue-version-${crypto.randomUUID()}`;
      statements.push(
        this.database
          .prepare(`insert into queue_ticket_versions (
            id, organization_id, facility_id, queue_ticket_id, version,
            supersedes_version_id, status, room_label, exception_code,
            exception_note, change_reason, changed_by_membership_id,
            access_assignment_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, 'cancelled', ?7, null,
            null, ?8, ?9, ?10, ?11)`)
          .bind(
            queueVersionId,
            this.scope.organizationId,
            this.scope.facilityId,
            queue.id,
            queue.currentVersion + 1,
            queue.currentVersionId,
            queue.roomLabel,
            reason,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database
          .prepare(`update queue_ticket_heads
            set current_version_id = ?1, lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4
              and queue_ticket_id = ?5 and current_version_id = ?6
              and lock_version = ?7`)
          .bind(
            queueVersionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            queue.id,
            queue.currentVersionId,
            queue.currentVersion,
          ),
      );
    }

    try {
      return await this.commitCommand({
        operation,
        key: input.idempotencyKey,
        requestHash,
        resourceType: 'appointment',
        resourceId: appointment.id,
        response,
        action: operation,
        entityType: 'appointment',
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          action: input.action,
          appointmentVersion: response.current.version,
          slotVersion: response.current.slotVersion,
          queueCancelled: Boolean(queue),
          dataMode: 'synthetic-only',
        },
        now,
        statements,
      });
    } catch (error) {
      if (
        error instanceof SchedulingConflictError ||
        error instanceof SchedulingAuditUnavailableError
      ) {
        throw error;
      }
      const current = await this.getAppointmentRow(appointment.id);
      if (current && current.currentVersion !== input.expectedAppointmentVersion) {
        throw new SchedulingVersionConflictError(current.currentVersion, 'appointment');
      }
      throw new SchedulingConflictError('Appointment command could not commit');
    }
  }

  async issueQueueTicket(
    input: IssueSchedulingQueueTicketCommand,
  ): Promise<SchedulingQueueTicketRecord> {
    requireSchedulingPermission(this.scope.role, 'queue.issue');
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      appointmentId: input.appointmentId,
      expectedAppointmentVersion: input.expectedAppointmentVersion,
      dataMode: 'synthetic-only',
    });
    const replay = await this.findIdempotency(
      'scheduling.queue.issue',
      input.idempotencyKey,
    );
    if (replay) {
      return this.resolveReplay<SchedulingQueueTicketRecord>(replay, requestHash);
    }
    const appointment = await this.getAppointmentRow(input.appointmentId);
    if (!appointment) throw new SchedulingNotFoundError();
    if (appointment.currentVersion !== input.expectedAppointmentVersion) {
      throw new SchedulingVersionConflictError(
        appointment.currentVersion,
        'appointment',
      );
    }
    try {
      assertQueueTicketCanBeIssued(appointment.currentStatus);
    } catch (error) {
      throw new SchedulingLifecycleError((error as Error).message);
    }
    const existing = await this.getQueueByAppointment(appointment.id);
    if (existing) {
      throw new SchedulingConflictError('Appointment already has a queue ticket');
    }
    const timezoneRow = await this.database
      .prepare(`select timezone from facilities
        where organization_id = ?1 and id = ?2 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<{ timezone: string }>();
    if (!timezoneRow) throw new SchedulingNotFoundError();
    const serviceDate = formatDateInTimeZone(
      appointment.startsAt,
      timezoneRow.timezone,
    );
    const sequenceRow = await this.database
      .prepare(`select coalesce(max(sequence), 0) + 1 as nextSequence
        from queue_tickets where organization_id = ?1 and facility_id = ?2
          and service_date = ?3`)
      .bind(this.scope.organizationId, this.scope.facilityId, serviceDate)
      .first<{ nextSequence: number }>();
    const sequence = sequenceRow?.nextSequence ?? 1;
    const displayNumber = `A${String(sequence).padStart(3, '0')}`;
    const ticketId = `queue-${crypto.randomUUID()}`;
    const versionId = `queue-version-${crypto.randomUUID()}`;
    const now = Date.now();
    const reason = 'Талон создан из подтверждённой записи';
    const response: SchedulingQueueTicketRecord = {
      id: ticketId,
      appointmentId: appointment.id,
      patient: {
        id: appointment.patientId,
        displayName: appointment.patientDisplayName,
        medicalRecordNumber: appointment.medicalRecordNumber,
      },
      serviceDate,
      sequence,
      displayNumber,
      current: {
        id: versionId,
        version: 1,
        status: 'issued',
        roomLabel: null,
        exceptionCode: null,
        exceptionNote: null,
        changeReason: reason,
      },
    };
    try {
      return await this.commitCommand({
        operation: 'scheduling.queue.issue',
        key: input.idempotencyKey,
        requestHash,
        resourceType: 'queue_ticket',
        resourceId: ticketId,
        response,
        action: 'scheduling.queue.issued',
        entityType: 'queue_ticket',
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          appointmentId: appointment.id,
          serviceDate,
          sequence,
          dataMode: 'synthetic-only',
        },
        now,
        statements: [
          this.database
            .prepare(`insert into queue_tickets (
              id, organization_id, facility_id, appointment_id, patient_id,
              service_date, sequence, display_number,
              created_by_membership_id, access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
            .bind(
              ticketId,
              this.scope.organizationId,
              this.scope.facilityId,
              appointment.id,
              appointment.patientId,
              serviceDate,
              sequence,
              displayNumber,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`insert into queue_ticket_versions (
              id, organization_id, facility_id, queue_ticket_id, version,
              supersedes_version_id, status, room_label, exception_code,
              exception_note, change_reason, changed_by_membership_id,
              access_assignment_id, created_at
            ) values (?1, ?2, ?3, ?4, 1, null, 'issued', null, null,
              null, ?5, ?6, ?7, ?8)`)
            .bind(
              versionId,
              this.scope.organizationId,
              this.scope.facilityId,
              ticketId,
              reason,
              this.scope.membershipId,
              this.scope.accessAssignmentId,
              now,
            ),
          this.database
            .prepare(`insert into queue_ticket_heads (
              id, organization_id, facility_id, queue_ticket_id,
              current_version_id, lock_version, created_at, updated_at
            ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`)
            .bind(
              `queue-head-${crypto.randomUUID()}`,
              this.scope.organizationId,
              this.scope.facilityId,
              ticketId,
              versionId,
              now,
            ),
        ],
      });
    } catch (error) {
      if (
        error instanceof SchedulingConflictError ||
        error instanceof SchedulingAuditUnavailableError
      ) {
        throw error;
      }
      const current = await this.getAppointmentRow(appointment.id);
      if (current && current.currentVersion !== input.expectedAppointmentVersion) {
        throw new SchedulingVersionConflictError(current.currentVersion, 'appointment');
      }
      throw new SchedulingConflictError('Queue ticket could not be issued');
    }
  }

  async commandQueue(
    input: SchedulingQueueCommand,
  ): Promise<SchedulingQueueTicketRecord> {
    const permission: Record<SchedulingQueueCommand['action'], SchedulingPermission> = {
      arrive: 'queue.arrive',
      call: 'queue.call',
      start_service: 'queue.start_service',
      complete: 'queue.complete',
      mark_exception: 'queue.exception',
    };
    requireSchedulingPermission(this.scope.role, permission[input.action]);
    const reason = normalizeText(input.reason);
    const normalizedRoom = normalizeNullable(input.roomLabel);
    const normalizedExceptionCode = normalizeNullable(input.exceptionCode);
    const normalizedExceptionNote = normalizeNullable(input.exceptionNote);
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      ticketId: input.ticketId,
      action: input.action,
      expectedQueueVersion: input.expectedQueueVersion,
      expectedAppointmentVersion: input.expectedAppointmentVersion ?? null,
      reason,
      roomLabel: normalizedRoom,
      exceptionCode: normalizedExceptionCode,
      exceptionNote: normalizedExceptionNote,
      dataMode: 'synthetic-only',
    });
    const operation = `scheduling.queue.${input.action}`;
    const replay = await this.findIdempotency(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<SchedulingQueueTicketRecord>(replay, requestHash);
    }
    const ticket = await this.getQueueTicketRow(input.ticketId);
    if (!ticket) throw new SchedulingNotFoundError();
    if (ticket.currentVersion !== input.expectedQueueVersion) {
      throw new SchedulingVersionConflictError(ticket.currentVersion, 'queue');
    }
    const nextStatus: Record<
      SchedulingQueueCommand['action'],
      SchedulingQueueStatus
    > = {
      arrive: 'arrived',
      call: 'called',
      start_service: 'in_service',
      complete: 'completed',
      mark_exception: 'exception',
    };
    try {
      assertSchedulingQueueTransition(ticket.currentStatus, nextStatus[input.action]);
    } catch (error) {
      throw new SchedulingLifecycleError((error as Error).message);
    }
    if (
      (input.action === 'call' || input.action === 'start_service') &&
      !normalizedRoom
    ) {
      throw new SchedulingLifecycleError('Укажите кабинет для вызова пациента');
    }
    if (
      input.action === 'mark_exception' &&
      (!normalizedExceptionCode || !normalizedExceptionNote)
    ) {
      throw new SchedulingLifecycleError('Укажите код и описание проблемы');
    }

    const appointment =
      input.action === 'complete'
        ? await this.getAppointmentRow(ticket.appointmentId)
        : null;
    if (input.action === 'complete') {
      if (!appointment || input.expectedAppointmentVersion === undefined) {
        throw new SchedulingLifecycleError(
          'Для завершения очереди нужна текущая версия записи',
        );
      }
      if (appointment.currentVersion !== input.expectedAppointmentVersion) {
        throw new SchedulingVersionConflictError(
          appointment.currentVersion,
          'appointment',
        );
      }
      try {
        assertSchedulingAppointmentTransition(appointment.currentStatus, 'completed');
      } catch (error) {
        throw new SchedulingLifecycleError((error as Error).message);
      }
    }

    const roomLabel =
      input.action === 'call' || input.action === 'start_service'
        ? normalizedRoom
        : ticket.roomLabel;
    const exceptionCode =
      input.action === 'mark_exception' ? normalizedExceptionCode : null;
    const exceptionNote =
      input.action === 'mark_exception' ? normalizedExceptionNote : null;
    const now = Date.now();
    const versionId = `queue-version-${crypto.randomUUID()}`;
    const response: SchedulingQueueTicketRecord = {
      ...toQueueTicket(ticket),
      current: {
        id: versionId,
        version: ticket.currentVersion + 1,
        status: nextStatus[input.action],
        roomLabel,
        exceptionCode,
        exceptionNote,
        changeReason: reason,
      },
    };
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(`insert into queue_ticket_versions (
          id, organization_id, facility_id, queue_ticket_id, version,
          supersedes_version_id, status, room_label, exception_code,
          exception_note, change_reason, changed_by_membership_id,
          access_assignment_id, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
        .bind(
          versionId,
          this.scope.organizationId,
          this.scope.facilityId,
          ticket.id,
          ticket.currentVersion + 1,
          ticket.currentVersionId,
          nextStatus[input.action],
          roomLabel,
          exceptionCode,
          exceptionNote,
          reason,
          this.scope.membershipId,
          this.scope.accessAssignmentId,
          now,
        ),
      this.database
        .prepare(`update queue_ticket_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and queue_ticket_id = ?5 and current_version_id = ?6
            and lock_version = ?7`)
        .bind(
          versionId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          ticket.id,
          ticket.currentVersionId,
          ticket.currentVersion,
        ),
    ];
    if (appointment) {
      const appointmentVersionId = `appointment-version-${crypto.randomUUID()}`;
      statements.push(
        this.database
          .prepare(`insert into appointment_versions (
            id, organization_id, facility_id, appointment_id, version,
            supersedes_version_id, status, slot_id, preference_snapshot_id,
            referral_version_id, hold_expires_at, confirmation_subject,
            confirmation_method, confirmation_language,
            confirmation_statement_version, confirmation_statement_hash,
            confirmed_at, change_reason, changed_by_membership_id,
            access_assignment_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, 'completed', ?7, ?8, ?9,
            null, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`)
          .bind(
            appointmentVersionId,
            this.scope.organizationId,
            this.scope.facilityId,
            appointment.id,
            appointment.currentVersion + 1,
            appointment.currentVersionId,
            appointment.slotId,
            appointment.preferenceSnapshotId,
            appointment.serviceRequestVersionId,
            appointment.confirmationSubject,
            appointment.confirmationMethod,
            appointment.confirmationLanguage,
            appointment.confirmationStatementVersion,
            appointment.confirmationStatementHash,
            appointment.confirmedAt,
            reason,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.database
          .prepare(`update appointment_heads
            set current_version_id = ?1, lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4
              and appointment_id = ?5 and current_version_id = ?6
              and lock_version = ?7`)
          .bind(
            appointmentVersionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            appointment.id,
            appointment.currentVersionId,
            appointment.currentVersion,
          ),
      );
    }
    try {
      return await this.commitCommand({
        operation,
        key: input.idempotencyKey,
        requestHash,
        resourceType: 'queue_ticket',
        resourceId: ticket.id,
        response,
        action: operation,
        entityType: 'queue_ticket',
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          action: input.action,
          queueVersion: response.current.version,
          appointmentCompleted: Boolean(appointment),
          dataMode: 'synthetic-only',
        },
        now,
        statements,
      });
    } catch (error) {
      if (
        error instanceof SchedulingConflictError ||
        error instanceof SchedulingAuditUnavailableError
      ) {
        throw error;
      }
      const current = await this.getQueueTicketRow(ticket.id);
      if (current && current.currentVersion !== input.expectedQueueVersion) {
        throw new SchedulingVersionConflictError(current.currentVersion, 'queue');
      }
      throw new SchedulingConflictError('Queue command could not commit');
    }
  }

  async getAppointment(appointmentId: string) {
    requireSchedulingPermission(this.scope.role, 'workspace.read');
    const row = await this.getAppointmentRow(appointmentId);
    return row ? toAppointment(row) : null;
  }

  async getQueueTicket(ticketId: string) {
    requireSchedulingPermission(this.scope.role, 'workspace.read');
    const row = await this.getQueueTicketRow(ticketId);
    return row ? toQueueTicket(row) : null;
  }

  async recordListRead(input: { resultCount: number; requestId: string }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: 'scheduling.workspace.read',
        purpose: 'synthetic_direct_patient_care',
        entityType: 'facility_schedule',
        entityId: this.scope.facilityId,
        requestId: input.requestId,
        metadata: {
          accessAssignmentId: this.scope.accessAssignmentId,
          resultCount: input.resultCount,
          dataMode: 'synthetic-only',
        },
        occurredAt: Date.now(),
      });
      try {
        const results = await this.database.batch([
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        this.assertCommitted(results, 2, 'Scheduling read audit did not commit');
        return;
      } catch {
        if (attempt === 2) throw new SchedulingAuditUnavailableError();
      }
    }
  }

  private async getCurrentPreference(preferenceId: string) {
    return this.database
      .prepare(`select preference.id,
        preference.referral_request_id as serviceRequestId,
        preference.referral_version_id as serviceRequestVersionId,
        preference.patient_id as patientId, preference.version,
        preference.preferred_date_from as preferredDateFrom,
        preference.preferred_date_to as preferredDateTo,
        preference.earliest_local_time as earliestLocalTime,
        preference.latest_local_time as latestLocalTime,
        preference.preferred_provider_id as preferredProviderId,
        preference.notes, preference.notice_language as noticeLanguage,
        preference.captured_at as capturedAt
        from scheduling_preference_snapshots preference
        where preference.organization_id = ?1 and preference.facility_id = ?2
          and preference.id = ?3
          and not exists (
            select 1 from scheduling_preference_snapshots newer
            where newer.organization_id = preference.organization_id
              and newer.facility_id = preference.facility_id
              and newer.referral_request_id = preference.referral_request_id
              and newer.version > preference.version
          ) limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId, preferenceId)
      .first<SchedulingPreferenceSnapshot>();
  }

  private async getSlotRow(slotId: string) {
    return this.database
      .prepare(`select slot.id, slot.schedule_id as scheduleId,
        slot.provider_id as providerId, slot.service_id as serviceId,
        service.specialty_id as specialtyId, slot.starts_at as startsAt,
        slot.ends_at as endsAt, slot.source_label as sourceLabel,
        head.current_version_id as currentVersionId,
        head.lock_version as currentVersion,
        current.status as currentStatus,
        current.appointment_id as appointmentId,
        current.patient_id as patientId,
        current.referral_request_id as referralRequestId,
        current.referral_version_id as referralVersionId,
        current.held_by_membership_id as heldByMembershipId,
        current.hold_expires_at as holdExpiresAt,
        provider.display_name as providerName,
        service.display_name as serviceName,
        specialty.display_name as specialtyName
        from appointment_slots slot
        join appointment_slot_heads head
          on head.organization_id = slot.organization_id
          and head.facility_id = slot.facility_id
          and head.slot_id = slot.id
        join appointment_slot_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.slot_id = head.slot_id
          and current.id = head.current_version_id
        join scheduling_providers provider
          on provider.organization_id = slot.organization_id
          and provider.facility_id = slot.facility_id
          and provider.id = slot.provider_id
        join scheduling_services service
          on service.organization_id = slot.organization_id
          and service.facility_id = slot.facility_id
          and service.id = slot.service_id
        join scheduling_specialties specialty
          on specialty.organization_id = service.organization_id
          and specialty.facility_id = service.facility_id
          and specialty.id = service.specialty_id
        where slot.organization_id = ?1 and slot.facility_id = ?2
          and slot.id = ?3 and slot.source_type = 'manual_test' limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId, slotId)
      .first<SlotRow>();
  }

  private async getAppointmentRow(appointmentId: string) {
    return this.database
      .prepare(this.appointmentSelectSql('and appointment.id = ?3'))
      .bind(this.scope.organizationId, this.scope.facilityId, appointmentId)
      .first<AppointmentRow>();
  }

  private async getQueueTicketRow(ticketId: string) {
    return this.database
      .prepare(this.queueSelectSql('and ticket.id = ?3'))
      .bind(this.scope.organizationId, this.scope.facilityId, ticketId)
      .first<QueueRow>();
  }

  private async getQueueByAppointment(appointmentId: string) {
    return this.database
      .prepare(this.queueSelectSql('and ticket.appointment_id = ?3'))
      .bind(this.scope.organizationId, this.scope.facilityId, appointmentId)
      .first<QueueRow>();
  }

  private appointmentSelectSql(extra = '') {
    return `select appointment.id,
      appointment.referral_request_id as serviceRequestId,
      appointment.patient_id as patientId,
      patient.display_name as patientDisplayName,
      patient.medical_record_number as medicalRecordNumber,
      current.slot_id as slotId, slot.provider_id as providerId,
      provider.display_name as providerName, slot.service_id as serviceId,
      service.display_name as serviceName,
      service.specialty_id as specialtyId,
      specialty.display_name as specialtyName,
      slot.starts_at as startsAt, slot.ends_at as endsAt,
      head.current_version_id as currentVersionId,
      head.lock_version as currentVersion, current.status as currentStatus,
      slot_head.lock_version as slotVersion,
      current.preference_snapshot_id as preferenceSnapshotId,
      current.referral_version_id as serviceRequestVersionId,
      current.hold_expires_at as holdExpiresAt,
      current.confirmed_at as confirmedAt,
      current.confirmation_subject as confirmationSubject,
      current.confirmation_method as confirmationMethod,
      current.confirmation_language as confirmationLanguage,
      current.confirmation_statement_version as confirmationStatementVersion,
      current.confirmation_statement_hash as confirmationStatementHash,
      current.change_reason as changeReason
      from appointments appointment
      join appointment_heads head
        on head.organization_id = appointment.organization_id
        and head.facility_id = appointment.facility_id
        and head.appointment_id = appointment.id
      join appointment_versions current
        on current.organization_id = head.organization_id
        and current.facility_id = head.facility_id
        and current.appointment_id = head.appointment_id
        and current.id = head.current_version_id
      join patients patient
        on patient.organization_id = appointment.organization_id
        and patient.facility_id = appointment.facility_id
        and patient.id = appointment.patient_id
      join appointment_slots slot
        on slot.organization_id = current.organization_id
        and slot.facility_id = current.facility_id
        and slot.id = current.slot_id
      join appointment_slot_heads slot_head
        on slot_head.organization_id = slot.organization_id
        and slot_head.facility_id = slot.facility_id
        and slot_head.slot_id = slot.id
      join scheduling_providers provider
        on provider.organization_id = slot.organization_id
        and provider.facility_id = slot.facility_id
        and provider.id = slot.provider_id
      join scheduling_services service
        on service.organization_id = slot.organization_id
        and service.facility_id = slot.facility_id
        and service.id = slot.service_id
      join scheduling_specialties specialty
        on specialty.organization_id = service.organization_id
        and specialty.facility_id = service.facility_id
        and specialty.id = service.specialty_id
      where appointment.organization_id = ?1 and appointment.facility_id = ?2
      ${extra}
      order by slot.starts_at desc, appointment.id`;
  }

  private queueSelectSql(extra = '') {
    return `select ticket.id, ticket.appointment_id as appointmentId,
      ticket.patient_id as patientId, patient.display_name as patientDisplayName,
      patient.medical_record_number as medicalRecordNumber,
      ticket.service_date as serviceDate, ticket.sequence,
      ticket.display_number as displayNumber,
      head.current_version_id as currentVersionId,
      head.lock_version as currentVersion, current.status as currentStatus,
      current.room_label as roomLabel,
      current.exception_code as exceptionCode,
      current.exception_note as exceptionNote,
      current.change_reason as changeReason
      from queue_tickets ticket
      join queue_ticket_heads head
        on head.organization_id = ticket.organization_id
        and head.facility_id = ticket.facility_id
        and head.queue_ticket_id = ticket.id
      join queue_ticket_versions current
        on current.organization_id = head.organization_id
        and current.facility_id = head.facility_id
        and current.queue_ticket_id = head.queue_ticket_id
        and current.id = head.current_version_id
      join patients patient
        on patient.organization_id = ticket.organization_id
        and patient.facility_id = ticket.facility_id
        and patient.id = ticket.patient_id
      where ticket.organization_id = ?1 and ticket.facility_id = ?2
      ${extra}
      order by ticket.service_date desc, ticket.sequence, ticket.id`;
  }

  private async requireAuditHead() {
    const row = await this.database
      .prepare(`select last_sequence as lastSequence,
        last_event_hash as lastEventHash, lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
    if (!row) throw new SchedulingAuditUnavailableError();
    return row;
  }

  private async createAudit(input: {
    auditHead: AuditHeadRow;
    action: string;
    purpose: string;
    entityType: string;
    entityId: string;
    requestId: string;
    metadata: Record<string, unknown>;
    occurredAt: number;
  }) {
    const sequence = input.auditHead.lastSequence + 1;
    const metadataJson = JSON.stringify(input.metadata);
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
      purpose: input.purpose,
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
    audit: Awaited<ReturnType<D1SchedulingWorkflowRepository['createAudit']>>,
  ) {
    return this.database
      .prepare(`insert into audit_events (
        id, organization_id, facility_id, sequence, actor_type, actor_id,
        actor_membership_id, action, outcome, purpose, schema_version,
        entity_type, entity_id, request_id, metadata_json, previous_hash,
        event_hash, occurred_at
      ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded', ?8,
        1, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`)
      .bind(
        audit.id,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.sequence,
        this.scope.userId,
        this.scope.membershipId,
        audit.action,
        audit.purpose,
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
    audit: Awaited<ReturnType<D1SchedulingWorkflowRepository['createAudit']>>,
  ) {
    return this.database
      .prepare(`update audit_stream_heads
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

  private assertCommitted(
    results: D1Result<unknown>[],
    expectedStatements: number,
    message: string,
  ) {
    if (
      results.length !== expectedStatements ||
      results.some((result) => result.meta.changes !== 1)
    ) {
      throw new SchedulingConflictError(message);
    }
  }

  private async findIdempotency(operation: string, key: string) {
    return this.database
      .prepare(`select id, request_hash as requestHash, status,
        result_resource_id as resultResourceId, response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = ?4
          and idempotency_key = ?5 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        operation,
        key,
      )
      .first<IdempotencyRow>();
  }

  private resolveReplay<T>(
    replay: IdempotencyRow,
    requestHash: string,
  ): T {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId ||
      !replay.responseJson
    ) {
      throw new SchedulingConflictError(
        'Idempotency key conflicts with an earlier scheduling command',
      );
    }
    try {
      const stored = JSON.parse(replay.responseJson) as T & { id?: string };
      if (stored.id !== replay.resultResourceId) {
        throw new Error('Stored resource does not match idempotency row');
      }
      return stored;
    } catch {
      throw new SchedulingConflictError('Stored scheduling response is invalid');
    }
  }

  private commandStart(input: {
    id: string;
    operation: string;
    key: string;
    requestHash: string;
    now: number;
  }) {
    return this.database
      .prepare(`insert into command_idempotency (
        id, organization_id, facility_id, actor_membership_id,
        access_assignment_id, operation, idempotency_key, request_hash,
        status, created_at
      ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'processing', ?9)`)
      .bind(
        input.id,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        this.scope.accessAssignmentId,
        input.operation,
        input.key,
        input.requestHash,
        input.now,
      );
  }

  private commandComplete(input: {
    id: string;
    resourceType: string;
    resourceId: string;
    responseJson: string;
    now: number;
  }) {
    return this.database
      .prepare(`update command_idempotency
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
    if (existing) {
      return this.resolveReplay<T>(existing, input.requestHash);
    }
    const commandId = `command-${crypto.randomUUID()}`;
    const responseJson = JSON.stringify(input.response);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: input.action,
        purpose: 'synthetic_direct_patient_care',
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
        this.assertCommitted(
          results,
          statements.length,
          'Scheduling command did not commit atomically',
        );
        return input.response;
      } catch (error) {
        const replay = await this.findIdempotency(input.operation, input.key);
        if (replay?.status === 'succeeded') {
          return this.resolveReplay<T>(replay, input.requestHash);
        }
        const currentAudit = await this.requireAuditHead();
        const auditContended =
          currentAudit.lastSequence !== auditHead.lastSequence ||
          currentAudit.lockVersion !== auditHead.lockVersion;
        if (auditContended && attempt < 2) continue;
        throw error;
      }
    }
    throw new SchedulingAuditUnavailableError();
  }

  private async requireEligibleReferral(
    serviceRequestId: string,
    serviceRequestVersionId?: string,
  ) {
    const row = await this.database
      .prepare(`select request.id as serviceRequestId,
        current.id as serviceRequestVersionId,
        request.encounter_id as encounterId, request.patient_id as patientId,
        patient.display_name as patientDisplayName,
        patient.medical_record_number as medicalRecordNumber,
        current.requested_service as requestedService,
        current.target_specialty as targetSpecialty,
        current.approved_by_membership_id as approvedByMembershipId,
        current.approved_at as approvedAt, request.request_kind as requestKind,
        current.status, encounter.clinician_membership_id as clinicianMembershipId,
        exists (
          select 1 from consent_heads consent_head
          join consent_events consent_event
            on consent_event.organization_id = consent_head.organization_id
            and consent_event.facility_id = consent_head.facility_id
            and consent_event.patient_id = consent_head.patient_id
            and consent_event.encounter_id = consent_head.encounter_id
            and consent_event.consent_type = consent_head.consent_type
            and consent_event.id = consent_head.current_consent_event_id
          where consent_head.organization_id = request.organization_id
            and consent_head.facility_id = request.facility_id
            and consent_head.encounter_id = request.encounter_id
            and consent_head.consent_type = 'care'
            and consent_event.decision = 'granted'
            and consent_event.effective_at <= ?4
            and (consent_event.expires_at is null or consent_event.expires_at > ?4)
        ) as careConsentEffective
        from service_requests request
        join service_request_heads head
          on head.organization_id = request.organization_id
          and head.facility_id = request.facility_id
          and head.service_request_id = request.id
        join service_request_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.service_request_id = head.service_request_id
          and current.id = head.current_version_id
        join patients patient
          on patient.organization_id = request.organization_id
          and patient.facility_id = request.facility_id
          and patient.id = request.patient_id
        join encounters encounter
          on encounter.organization_id = request.organization_id
          and encounter.facility_id = request.facility_id
          and encounter.id = request.encounter_id
        where request.organization_id = ?1 and request.facility_id = ?2
          and request.id = ?3 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        serviceRequestId,
        Date.now(),
      )
      .first<ReferralRow>();
    if (!row) throw new SchedulingNotFoundError();
    if (
      this.scope.role === 'clinician' &&
      row.clinicianMembershipId !== this.scope.membershipId
    ) {
      throw new SchedulingNotFoundError();
    }
    try {
      assertReferralEligibleForScheduling({
        requestKind: row.requestKind,
        status: row.status,
        approvedByMembershipId: row.approvedByMembershipId,
        approvedAt: row.approvedAt,
      });
    } catch (error) {
      throw new SchedulingLifecycleError((error as Error).message);
    }
    if (
      serviceRequestVersionId &&
      row.serviceRequestVersionId !== serviceRequestVersionId
    ) {
      throw new SchedulingVersionConflictError(0, 'preference');
    }
    if (row.careConsentEffective !== 1) {
      throw new SchedulingConsentRequiredError();
    }
    return row;
  }
}
