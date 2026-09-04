import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { FacilityAccessScope } from '@/lib/auth/facility-access';
import {
  assertDiagnosticReportTransition,
  canCompleteServiceRequest,
  nextServiceRequestStatus,
  type DiagnosticArtifactMimeType,
  type DiagnosticReportStatus,
  type DiagnosticReviewState,
  type ServiceRequestKind,
  type ServiceRequestPriority,
  type ServiceRequestStatus,
} from '@/lib/domain/orders';

export type OrderEncounterOption = {
  id: string;
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  status: string;
  reasonForVisit: string | null;
  updatedAt: number;
  careConsentEffective: boolean;
};

export type ServiceRequestHistoryEntry = {
  id: string;
  version: number;
  status: ServiceRequestStatus;
  priority: ServiceRequestPriority;
  requestedService: string;
  targetSpecialty: string | null;
  medicalJustification: string;
  clinicianNote: string | null;
  statusReason: string | null;
  authoredBy: string;
  approvedBy: string | null;
  approvedAt: number | null;
  createdAt: number;
};

export type DiagnosticArtifactMetadata = {
  id: string;
  objectKey: string;
  fileName: string;
  mimeType: DiagnosticArtifactMimeType;
  sha256: string;
  byteSize: number;
  createdAt: number;
};

export type DiagnosticReportHistoryEntry = {
  id: string;
  version: number;
  reportStatus: DiagnosticReportStatus;
  conclusion: string | null;
  reviewState: DiagnosticReviewState;
  reconciliationNote: string | null;
  changeReason: string;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
  artifact: DiagnosticArtifactMetadata | null;
};

export type ServiceRequestRecord = {
  id: string;
  kind: ServiceRequestKind;
  patient: {
    id: string;
    displayName: string;
    medicalRecordNumber: string;
  };
  encounter: {
    id: string;
    status: string;
    reasonForVisit: string | null;
  };
  current: ServiceRequestHistoryEntry;
  history: ServiceRequestHistoryEntry[];
  report: {
    id: string;
    current: DiagnosticReportHistoryEntry;
    history: DiagnosticReportHistoryEntry[];
  } | null;
  canComplete: boolean;
};

export type CreateServiceRequestCommand = {
  encounterId: string;
  kind: ServiceRequestKind;
  priority: ServiceRequestPriority;
  requestedService: string;
  targetSpecialty: string | null;
  medicalJustification: string;
  clinicianNote: string | null;
  idempotencyKey: string;
  requestId: string;
};

export type ServiceRequestTransitionCommand = {
  requestIdValue: string;
  action: 'approve' | 'hold' | 'resume' | 'revoke' | 'complete' | 'mark_error';
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
};

export type AttachDiagnosticResultCommand = {
  requestIdValue: string;
  reportStatus: Exclude<
    DiagnosticReportStatus,
    'cancelled' | 'entered_in_error'
  >;
  conclusion: string | null;
  changeReason: string;
  expectedReportVersion: number;
  artifact: Omit<DiagnosticArtifactMetadata, 'createdAt'>;
  idempotencyKey: string;
  requestId: string;
};

export type ReviewDiagnosticResultCommand = {
  requestIdValue: string;
  decision: Exclude<DiagnosticReviewState, 'pending'>;
  note: string | null;
  expectedReportVersion: number;
  idempotencyKey: string;
  requestId: string;
};

export type DiagnosticResultUploadReservation =
  | { kind: 'reserved'; commandId: string }
  | { kind: 'replayed'; record: ServiceRequestRecord };

export type DiagnosticResultUploadIntent = {
  id: string;
  commandId: string;
  serviceRequestId: string;
  artifactId: string;
  objectKey: string;
  fileName: string;
  mimeType: DiagnosticArtifactMimeType;
  sha256: string;
  byteSize: number;
  status:
    | 'reserved'
    | 'object_stored'
    | 'committed'
    | 'cleanup_pending'
    | 'cleaned';
  failureCode: string | null;
  updatedAt: number;
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

type OrderCommandResponseSnapshot = {
  requestId: string;
  requestVersionId: string;
  reportVersionId: string | null;
  patient: {
    id: string;
    displayName: string;
    medicalRecordNumber: string;
  };
  encounter: {
    id: string;
    status: string;
    reasonForVisit: string | null;
  };
};

type RequestRow = {
  id: string;
  kind: ServiceRequestKind;
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  patientStatus: string;
  encounterId: string;
  encounterStatus: string;
  reasonForVisit: string | null;
  currentVersionId: string;
  lockVersion: number;
  status: ServiceRequestStatus;
  priority: ServiceRequestPriority;
  requestedService: string;
  targetSpecialty: string | null;
  medicalJustification: string;
  clinicianNote: string | null;
  statusReason: string | null;
  approvedByMembershipId: string | null;
  approvedAt: number | null;
  reportId: string | null;
  reportVersionId: string | null;
  reportVersion: number | null;
  reportStatus: DiagnosticReportStatus | null;
  reviewState: DiagnosticReviewState | null;
};

type EncounterRow = {
  id: string;
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  status: string;
  reasonForVisit: string | null;
  updatedAt: number;
};

type ReportHeadRow = {
  reportId: string;
  currentVersionId: string;
  version: number;
  reportStatus: DiagnosticReportStatus;
  conclusion: string | null;
  artifactId: string | null;
  reviewState: DiagnosticReviewState;
  reconciliationNote: string | null;
};

export class OrderWorkflowConflictError extends Error {}
export class OrderWorkflowNotFoundError extends Error {}
export class OrderWorkflowClinicianRequiredError extends Error {}
export class OrderWorkflowConsentRequiredError extends Error {}
export class OrderWorkflowLifecycleError extends Error {}
export class OrderWorkflowAuditUnavailableError extends Error {}
export class OrderWorkflowVersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly resource: 'request' | 'report',
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function sha256DiagnosticBytes(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class D1OrderWorkflowRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: FacilityAccessScope,
  ) {}

  async listEncounterOptions(): Promise<OrderEncounterOption[]> {
    this.requireClinician();
    const now = Date.now();
    const rows = await this.database
      .prepare(`
        select encounter.id, encounter.patient_id as patientId,
          coalesce(profile.display_name, patient.display_name) as patientName,
          patient.medical_record_number as medicalRecordNumber,
          encounter.status, encounter.reason_for_visit as reasonForVisit,
          encounter.updated_at as updatedAt,
          exists (
            select 1 from consent_heads consent_head
            join consent_events consent_event
              on consent_event.organization_id = consent_head.organization_id
              and consent_event.facility_id = consent_head.facility_id
              and consent_event.patient_id = consent_head.patient_id
              and consent_event.encounter_id = consent_head.encounter_id
              and consent_event.consent_type = consent_head.consent_type
              and consent_event.id = consent_head.current_consent_event_id
            where consent_head.organization_id = encounter.organization_id
              and consent_head.facility_id = encounter.facility_id
              and consent_head.encounter_id = encounter.id
              and consent_head.consent_type = 'care'
              and consent_event.decision = 'granted'
              and consent_event.effective_at <= ?4
              and (consent_event.expires_at is null or consent_event.expires_at > ?4)
          ) as careConsentEffective
        from encounters encounter
        join patients patient
          on patient.organization_id = encounter.organization_id
          and patient.facility_id = encounter.facility_id
          and patient.id = encounter.patient_id
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        where encounter.organization_id = ?1 and encounter.facility_id = ?2
          and encounter.clinician_membership_id = ?3
          and encounter.status <> 'cancelled'
          and patient.status = 'active'
          and coalesce(profile.status, patient.status) = 'active'
        order by encounter.updated_at desc, encounter.id desc
        limit 100
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        now,
      )
      .all<EncounterRow & { careConsentEffective: number }>();
    return rows.results.map((row) => ({
      ...row,
      careConsentEffective: row.careConsentEffective === 1,
    }));
  }

  async list(input: {
    status?: ServiceRequestStatus | 'all';
    kind?: ServiceRequestKind | 'all';
    query?: string;
    limit?: number;
  } = {}) {
    this.requireClinician();
    const search = normalizeNullable(input.query ?? null);
    const like = search ? `%${search}%` : null;
    const result = await this.database
      .prepare(`
        select request.id
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
        join encounters encounter
          on encounter.organization_id = request.organization_id
          and encounter.facility_id = request.facility_id
          and encounter.id = request.encounter_id
        join patients patient
          on patient.organization_id = request.organization_id
          and patient.facility_id = request.facility_id
          and patient.id = request.patient_id
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        where request.organization_id = ?1 and request.facility_id = ?2
          and encounter.clinician_membership_id = ?3
          and (?4 = 'all' or current.status = ?4)
          and (?5 = 'all' or request.request_kind = ?5)
          and (
            ?6 is null or current.requested_service like ?6
            or coalesce(profile.display_name, patient.display_name) like ?6
            or patient.medical_record_number like ?6
          )
        order by head.updated_at desc, request.id desc
        limit ?7
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        input.status ?? 'all',
        input.kind ?? 'all',
        like,
        Math.min(Math.max(input.limit ?? 50, 1), 100),
      )
      .all<{ id: string }>();
    const records = await Promise.all(result.results.map((row) => this.get(row.id)));
    return records.filter((record): record is ServiceRequestRecord => record !== null);
  }

  async recordListRead(input: { resultCount: number; requestId: string }) {
    this.requireClinician();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const auditHead = await this.requireAuditHead();
        const audit = await this.createAudit({
          auditHead,
          action: 'service_request.list',
          purpose: 'clinical_service_request_access',
          entityType: 'facility',
          entityId: this.scope.facilityId,
          requestId: input.requestId,
          metadata: { resultCount: input.resultCount },
          occurredAt: Date.now(),
        });
        const results = await this.database.batch([
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        this.assertCommitted(results, 2, 'Service request list audit failed');
        return;
      } catch (error) {
        if (attempt === 2) {
          throw new OrderWorkflowAuditUnavailableError(
            error instanceof Error ? error.message : 'Service request list audit failed',
          );
        }
      }
    }
  }

  async get(requestIdValue: string): Promise<ServiceRequestRecord | null> {
    this.requireClinician();
    const row = await this.getRequestRow(requestIdValue);
    if (!row) return null;
    return this.hydrateRecord(row);
  }

  private async hydrateRecord(
    row: RequestRow,
    requestVersion = row.lockVersion,
    reportVersion = row.reportVersion,
  ): Promise<ServiceRequestRecord> {
    const history = await this.getRequestHistory(row.id, requestVersion);
    const reportHistory = row.reportId && reportVersion !== null
      ? await this.getReportHistory(row.reportId, reportVersion)
      : [];
    const current = history[0];
    if (!current) {
      throw new OrderWorkflowConflictError('Stored request snapshot is incomplete');
    }
    return {
      id: row.id,
      kind: row.kind,
      patient: {
        id: row.patientId,
        displayName: row.patientName,
        medicalRecordNumber: row.medicalRecordNumber,
      },
      encounter: {
        id: row.encounterId,
        status: row.encounterStatus,
        reasonForVisit: row.reasonForVisit,
      },
      current,
      history,
      report:
        row.reportId && reportHistory[0]
          ? { id: row.reportId, current: reportHistory[0], history: reportHistory }
          : null,
      canComplete: canCompleteServiceRequest({
        reportStatus: row.reportStatus,
        reviewState: row.reviewState,
      }),
    };
  }

  private responseSnapshot(
    context: Pick<
      RequestRow,
      | 'patientId'
      | 'patientName'
      | 'medicalRecordNumber'
      | 'encounterId'
      | 'encounterStatus'
      | 'reasonForVisit'
    >,
    requestId: string,
    requestVersionId: string,
    reportVersionId: string | null,
  ): OrderCommandResponseSnapshot {
    return {
      requestId,
      requestVersionId,
      reportVersionId,
      patient: {
        id: context.patientId,
        displayName: context.patientName,
        medicalRecordNumber: context.medicalRecordNumber,
      },
      encounter: {
        id: context.encounterId,
        status: context.encounterStatus,
        reasonForVisit: context.reasonForVisit,
      },
    };
  }

  private async getRecordSnapshot(snapshot: OrderCommandResponseSnapshot) {
    const row = await this.getRequestRowAt(
      snapshot.requestId,
      snapshot.requestVersionId,
      snapshot.reportVersionId,
    );
    if (!row) {
      throw new OrderWorkflowConflictError('Stored order command snapshot is unavailable');
    }
    return this.hydrateRecord(
      {
        ...row,
        patientId: snapshot.patient.id,
        patientName: snapshot.patient.displayName,
        medicalRecordNumber: snapshot.patient.medicalRecordNumber,
        encounterId: snapshot.encounter.id,
        encounterStatus: snapshot.encounter.status,
        reasonForVisit: snapshot.encounter.reasonForVisit,
      },
      row.lockVersion,
      row.reportVersion,
    );
  }

  async createDraft(input: CreateServiceRequestCommand) {
    this.requireClinician();
    const normalized = {
      ...input,
      requestedService: normalizeText(input.requestedService),
      targetSpecialty: normalizeNullable(input.targetSpecialty),
      medicalJustification: normalizeText(input.medicalJustification),
      clinicianNote: normalizeNullable(input.clinicianNote),
    };
    const requestHash = await sha256(
      JSON.stringify({
        encounterId: normalized.encounterId,
        kind: normalized.kind,
        priority: normalized.priority,
        requestedService: normalized.requestedService,
        targetSpecialty: normalized.targetSpecialty,
        medicalJustification: normalized.medicalJustification,
        clinicianNote: normalized.clinicianNote,
        dataMode: 'synthetic-only',
      }),
    );
    const replay = await this.findIdempotency('order.create', input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash);

    const encounter = await this.getEncounter(normalized.encounterId);
    if (!encounter) throw new OrderWorkflowNotFoundError('Encounter unavailable');
    if (!(await this.hasEffectiveCareConsent(encounter.id))) {
      throw new OrderWorkflowConsentRequiredError('Care consent is required');
    }
    const auditHead = await this.requireAuditHead();
    const now = Date.now();
    const serviceRequestId = `service-request-${crypto.randomUUID()}`;
    const versionId = `service-request-version-${crypto.randomUUID()}`;
    const headId = `service-request-head-${crypto.randomUUID()}`;
    const responseSnapshot = this.responseSnapshot(
      {
        patientId: encounter.patientId,
        patientName: encounter.patientName,
        medicalRecordNumber: encounter.medicalRecordNumber,
        encounterId: encounter.id,
        encounterStatus: encounter.status,
        reasonForVisit: encounter.reasonForVisit,
      },
      serviceRequestId,
      versionId,
      null,
    );
    const audit = await this.createAudit({
      auditHead,
      action: 'service_request.create_draft',
      purpose: 'clinical_service_request',
      entityType: 'service_request',
      entityId: serviceRequestId,
      requestId: input.requestId,
      metadata: {
        kind: normalized.kind,
        status: 'draft',
        encounterId: encounter.id,
        dataMode: 'synthetic-only',
      },
      occurredAt: now,
    });
    const commandId = `command-${crypto.randomUUID()}`;
    const replayRecord = await this.commitIdempotentCommand({
      operation: 'order.create',
      key: input.idempotencyKey,
      requestHash,
      statements: [
      this.database
        .prepare(`
          insert into service_requests (
            id, organization_id, facility_id, patient_id, encounter_id,
            request_kind, created_by_membership_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `)
        .bind(
          serviceRequestId,
          this.scope.organizationId,
          this.scope.facilityId,
          encounter.patientId,
          encounter.id,
          normalized.kind,
          this.scope.membershipId,
          now,
        ),
      this.database
        .prepare(`
          insert into service_request_versions (
            id, organization_id, facility_id, service_request_id, version,
            supersedes_version_id, status, priority, requested_service,
            target_specialty, medical_justification, clinician_note,
            status_reason, authored_by_membership_id,
            approved_by_membership_id, approved_at, created_at
          ) values (?1, ?2, ?3, ?4, 1, null, 'draft', ?5, ?6, ?7, ?8,
            ?9, 'Черновик создан врачом', ?10, null, null, ?11)
        `)
        .bind(
          versionId,
          this.scope.organizationId,
          this.scope.facilityId,
          serviceRequestId,
          normalized.priority,
          normalized.requestedService,
          normalized.targetSpecialty,
          normalized.medicalJustification,
          normalized.clinicianNote,
          this.scope.membershipId,
          now,
        ),
      this.database
        .prepare(`
          insert into service_request_heads (
            id, organization_id, facility_id, service_request_id,
            current_version_id, lock_version, created_at, updated_at
          ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
        `)
        .bind(
          headId,
          this.scope.organizationId,
          this.scope.facilityId,
          serviceRequestId,
          versionId,
          now,
        ),
      this.auditInsert(audit),
      this.auditHeadUpdate(audit),
      this.commandStart({
        id: commandId,
        operation: 'order.create',
        key: input.idempotencyKey,
        requestHash,
        now,
      }),
      this.commandComplete({
        id: commandId,
        resourceId: serviceRequestId,
        responseJson: JSON.stringify(responseSnapshot),
        now,
      }),
      ],
      expectedStatements: 7,
      message: 'Service request draft was not committed',
    });
    if (replayRecord) return replayRecord;
    return this.getRecordSnapshot(responseSnapshot);
  }

  async transition(input: ServiceRequestTransitionCommand) {
    this.requireClinician();
    const reason = normalizeText(input.reason);
    const requestHash = await sha256(
      JSON.stringify({
        requestId: input.requestIdValue,
        action: input.action,
        reason,
        expectedVersion: input.expectedVersion,
      }),
    );
    const replay = await this.findIdempotency('order.transition', input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash);
    const current = await this.getRequestRow(input.requestIdValue);
    if (!current) throw new OrderWorkflowNotFoundError('Service request unavailable');
    this.requireMutableRequest(current);
    if (current.lockVersion !== input.expectedVersion) {
      throw new OrderWorkflowVersionConflictError(current.lockVersion, 'request');
    }
    if (!(await this.hasEffectiveCareConsent(current.encounterId))) {
      throw new OrderWorkflowConsentRequiredError('Care consent is required');
    }
    let nextStatus: ServiceRequestStatus;
    try {
      nextStatus = nextServiceRequestStatus(current.status, input.action);
    } catch (error) {
      throw new OrderWorkflowLifecycleError(
        error instanceof Error ? error.message : 'Invalid request transition',
      );
    }
    if (
      nextStatus === 'completed' &&
      !canCompleteServiceRequest({
        reportStatus: current.reportStatus,
        reviewState: current.reviewState,
      })
    ) {
      throw new OrderWorkflowLifecycleError(
        'Завершить можно только после проверки врачом финального результата',
      );
    }
    const auditHead = await this.requireAuditHead();
    const now = Date.now();
    const versionId = `service-request-version-${crypto.randomUUID()}`;
    const audit = await this.createAudit({
      auditHead,
      action: `service_request.${input.action}`,
      purpose: 'clinical_service_request',
      entityType: 'service_request',
      entityId: current.id,
      requestId: input.requestId,
      metadata: {
        previousStatus: current.status,
        nextStatus,
        previousVersion: current.lockVersion,
      },
      occurredAt: now,
    });
    const commandId = `command-${crypto.randomUUID()}`;
    const approver = input.action === 'approve'
      ? this.scope.membershipId
      : current.approvedByMembershipId;
    const approvedAt = input.action === 'approve' ? now : current.approvedAt;
    const responseSnapshot = this.responseSnapshot(
      current,
      current.id,
      versionId,
      current.reportVersionId,
    );
    const replayRecord = await this.commitIdempotentCommand({
      operation: 'order.transition',
      key: input.idempotencyKey,
      requestHash,
      statements: [
      this.database
        .prepare(`
          insert into service_request_versions (
            id, organization_id, facility_id, service_request_id, version,
            supersedes_version_id, status, priority, requested_service,
            target_specialty, medical_justification, clinician_note,
            status_reason, authored_by_membership_id,
            approved_by_membership_id, approved_at, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, ?17)
        `)
        .bind(
          versionId,
          this.scope.organizationId,
          this.scope.facilityId,
          current.id,
          current.lockVersion + 1,
          current.currentVersionId,
          nextStatus,
          current.priority,
          current.requestedService,
          current.targetSpecialty,
          current.medicalJustification,
          current.clinicianNote,
          reason,
          this.scope.membershipId,
          approver,
          approvedAt,
          now,
        ),
      this.database
        .prepare(`
          update service_request_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and service_request_id = ?5 and current_version_id = ?6
            and lock_version = ?7
        `)
        .bind(
          versionId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          current.id,
          current.currentVersionId,
          current.lockVersion,
        ),
      this.auditInsert(audit),
      this.auditHeadUpdate(audit),
      this.commandStart({
        id: commandId,
        operation: 'order.transition',
        key: input.idempotencyKey,
        requestHash,
        now,
      }),
      this.commandComplete({
        id: commandId,
        resourceId: current.id,
        responseJson: JSON.stringify(responseSnapshot),
        now,
      }),
      ],
      expectedStatements: 6,
      message: 'Service request transition was not committed',
    });
    if (replayRecord) return replayRecord;
    return this.getRecordSnapshot(responseSnapshot);
  }

  async attachResult(input: AttachDiagnosticResultCommand) {
    const reservation = await this.reserveResultUpload(input);
    if (reservation.kind === 'replayed') return reservation.record;
    await this.markResultUploadObjectStored(reservation.commandId);
    return this.commitReservedResult(input, reservation.commandId);
  }

  async reserveResultUpload(
    input: AttachDiagnosticResultCommand,
  ): Promise<DiagnosticResultUploadReservation> {
    this.requireClinician();
    const requestHash = await this.resultAttachmentHash(input);
    const existing = await this.findIdempotency(
      'order.result.attach',
      input.idempotencyKey,
    );
    if (existing) return this.resolveResultReservation(existing, requestHash);

    const { request } = await this.validateResultAttachment(input);
    const commandId = `command-${crypto.randomUUID()}`;
    const intentId = `diagnostic-upload-intent-${crypto.randomUUID()}`;
    const now = Date.now();
    try {
      const results = await this.database.batch([
        this.commandStart({
          id: commandId,
          operation: 'order.result.attach',
          key: input.idempotencyKey,
          requestHash,
          now,
        }),
        this.database
          .prepare(`
            insert into diagnostic_result_upload_intents (
              id, organization_id, facility_id, command_id, service_request_id,
              artifact_id, object_key, file_name, mime_type, sha256, byte_size,
              status, failure_code, created_by_membership_id, created_at, updated_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
              'reserved', null, ?12, ?13, ?13)
          `)
          .bind(
            intentId,
            this.scope.organizationId,
            this.scope.facilityId,
            commandId,
            request.id,
            input.artifact.id,
            input.artifact.objectKey,
            input.artifact.fileName,
            input.artifact.mimeType,
            input.artifact.sha256,
            input.artifact.byteSize,
            this.scope.membershipId,
            now,
          ),
      ]);
      this.assertCommitted(results, 2, 'Result upload reservation failed');
      return { kind: 'reserved', commandId };
    } catch (error) {
      const collided = await this.findIdempotency(
        'order.result.attach',
        input.idempotencyKey,
      );
      if (collided) return this.resolveResultReservation(collided, requestHash);
      throw error;
    }
  }

  async markResultUploadObjectStored(commandId: string) {
    this.requireClinician();
    const intent = await this.getResultUploadIntent(commandId);
    if (!intent) {
      throw new OrderWorkflowConflictError('Result upload intent is unavailable');
    }
    if (intent.status === 'object_stored' || intent.status === 'committed') {
      return intent;
    }
    if (intent.status !== 'reserved') {
      throw new OrderWorkflowConflictError('Result upload intent is not writable');
    }
    const result = await this.database
      .prepare(`
        update diagnostic_result_upload_intents
        set status = 'object_stored', updated_at = ?1
        where organization_id = ?2 and facility_id = ?3
          and command_id = ?4 and status = 'reserved'
      `)
      .bind(
        Date.now(),
        this.scope.organizationId,
        this.scope.facilityId,
        commandId,
      )
      .run();
    if (result.meta.changes === 1) {
      const stored = await this.getResultUploadIntent(commandId);
      if (stored) return stored;
    }
    const collided = await this.getResultUploadIntent(commandId);
    if (collided?.status === 'object_stored' || collided?.status === 'committed') {
      return collided;
    }
    throw new OrderWorkflowConflictError('Result object state could not be recorded');
  }

  async listExpiredResultUploads(input: { before: number; limit?: number }) {
    this.requireClinician();
    const result = await this.database
      .prepare(`
        select intent.id, intent.command_id as commandId,
          intent.service_request_id as serviceRequestId,
          intent.artifact_id as artifactId, intent.object_key as objectKey,
          intent.file_name as fileName, intent.mime_type as mimeType,
          intent.sha256, intent.byte_size as byteSize, intent.status,
          intent.failure_code as failureCode, intent.updated_at as updatedAt
        from diagnostic_result_upload_intents intent
        join service_requests request
          on request.organization_id = intent.organization_id
          and request.facility_id = intent.facility_id
          and request.id = intent.service_request_id
        join encounters encounter
          on encounter.organization_id = request.organization_id
          and encounter.facility_id = request.facility_id
          and encounter.id = request.encounter_id
        where intent.organization_id = ?1 and intent.facility_id = ?2
          and encounter.clinician_membership_id = ?3
          and intent.status in ('reserved', 'object_stored', 'cleanup_pending')
          and intent.updated_at <= ?4
        order by intent.updated_at asc, intent.id asc
        limit ?5
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        input.before,
        Math.min(Math.max(input.limit ?? 25, 1), 100),
      )
      .all<DiagnosticResultUploadIntent>();
    return result.results;
  }

  async beginResultUploadCleanup(input: {
    commandId: string;
    failureCode: string;
    requestId: string;
  }) {
    this.requireClinician();
    const failureCode = normalizeText(input.failureCode).slice(0, 80);
    if (!failureCode) {
      throw new OrderWorkflowConflictError('Cleanup failure code is required');
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const intent = await this.getResultUploadIntent(input.commandId);
      if (!intent || intent.status === 'committed' || intent.status === 'cleaned') {
        return null;
      }
      if (intent.status === 'cleanup_pending') return intent;
      try {
        const now = Date.now();
        const auditHead = await this.requireAuditHead();
        const audit = await this.createAudit({
          auditHead,
          action: 'diagnostic_result_upload.cleanup_started',
          purpose: 'diagnostic_result_retention_reconciliation',
          entityType: 'diagnostic_result_upload_intent',
          entityId: intent.id,
          requestId: input.requestId,
          metadata: {
            serviceRequestId: intent.serviceRequestId,
            commandId: intent.commandId,
            failureCode,
          },
          occurredAt: now,
        });
        const results = await this.database.batch([
          this.commandFail({
            id: input.commandId,
            responseJson: JSON.stringify({ code: failureCode }),
            now,
          }),
          this.database
            .prepare(`
              update diagnostic_result_upload_intents
              set status = 'cleanup_pending', failure_code = ?1, updated_at = ?2
              where organization_id = ?3 and facility_id = ?4
                and command_id = ?5 and status in ('reserved', 'object_stored')
                and not exists (
                  select 1 from diagnostic_report_artifacts artifact
                  where artifact.organization_id = diagnostic_result_upload_intents.organization_id
                    and artifact.facility_id = diagnostic_result_upload_intents.facility_id
                    and artifact.id = diagnostic_result_upload_intents.artifact_id
                )
            `)
            .bind(
              failureCode,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              input.commandId,
            ),
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        this.assertCommitted(results, 4, 'Result upload cleanup was not started');
        return this.getResultUploadIntent(input.commandId);
      } catch (error) {
        const current = await this.getResultUploadIntent(input.commandId);
        if (!current || current.status === 'committed' || current.status === 'cleaned') {
          return null;
        }
        if (current.status === 'cleanup_pending') return current;
        if (attempt === 2) {
          throw new OrderWorkflowAuditUnavailableError(
            error instanceof Error
              ? error.message
              : 'Result upload cleanup could not be audited',
          );
        }
      }
    }
    return null;
  }

  async completeResultUploadCleanup(input: {
    commandId: string;
    requestId: string;
  }) {
    this.requireClinician();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const intent = await this.getResultUploadIntent(input.commandId);
      if (!intent || intent.status === 'committed') return null;
      if (intent.status === 'cleaned') return intent;
      if (intent.status !== 'cleanup_pending') {
        throw new OrderWorkflowConflictError('Result upload cleanup was not started');
      }
      try {
        const now = Date.now();
        const auditHead = await this.requireAuditHead();
        const audit = await this.createAudit({
          auditHead,
          action: 'diagnostic_result_upload.cleanup_completed',
          purpose: 'diagnostic_result_retention_reconciliation',
          entityType: 'diagnostic_result_upload_intent',
          entityId: intent.id,
          requestId: input.requestId,
          metadata: {
            serviceRequestId: intent.serviceRequestId,
            commandId: intent.commandId,
          },
          occurredAt: now,
        });
        const results = await this.database.batch([
          this.database
            .prepare(`
              update diagnostic_result_upload_intents
              set status = 'cleaned', updated_at = ?1
              where organization_id = ?2 and facility_id = ?3
                and command_id = ?4 and status = 'cleanup_pending'
            `)
            .bind(
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              input.commandId,
            ),
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        this.assertCommitted(results, 3, 'Result upload cleanup was not completed');
        return this.getResultUploadIntent(input.commandId);
      } catch (error) {
        const current = await this.getResultUploadIntent(input.commandId);
        if (!current || current.status === 'committed') return null;
        if (current.status === 'cleaned') return current;
        if (attempt === 2) {
          throw new OrderWorkflowAuditUnavailableError(
            error instanceof Error
              ? error.message
              : 'Result upload cleanup could not be audited',
          );
        }
      }
    }
    return null;
  }

  async commitReservedResult(
    input: AttachDiagnosticResultCommand,
    commandId: string,
  ): Promise<ServiceRequestRecord> {
    this.requireClinician();
    const requestHash = await this.resultAttachmentHash(input);
    const reservation = await this.findIdempotency(
      'order.result.attach',
      input.idempotencyKey,
    );
    if (!reservation) {
      throw new OrderWorkflowConflictError('Result upload is not reserved');
    }
    if (reservation.requestHash !== requestHash || reservation.id !== commandId) {
      throw new OrderWorkflowConflictError(
        'Idempotency key conflicts with an earlier result upload',
      );
    }
    if (reservation.status === 'succeeded') {
      return this.resolveReplay(reservation, requestHash);
    }
    if (reservation.status !== 'processing') {
      throw new OrderWorkflowConflictError('Result upload reservation is not active');
    }
    const intent = await this.getResultUploadIntent(commandId);
    if (
      !intent ||
      intent.serviceRequestId !== input.requestIdValue ||
      intent.artifactId !== input.artifact.id ||
      intent.objectKey !== input.artifact.objectKey ||
      intent.fileName !== input.artifact.fileName ||
      intent.mimeType !== input.artifact.mimeType ||
      intent.sha256 !== input.artifact.sha256 ||
      intent.byteSize !== input.artifact.byteSize
    ) {
      throw new OrderWorkflowConflictError(
        'Result upload intent does not match the reserved artifact',
      );
    }
    if (intent.status !== 'object_stored') {
      throw new OrderWorkflowConflictError(
        'Result object must be durably recorded before the clinical record is committed',
      );
    }

    const { normalized, request, currentReport, currentVersion } =
      await this.validateResultAttachment(input);
    const auditHead = await this.requireAuditHead();
    const now = Date.now();
    const reportId = currentReport?.reportId ?? `diagnostic-report-${crypto.randomUUID()}`;
    const reportVersionId = `diagnostic-report-version-${crypto.randomUUID()}`;
    const reportHeadId = `diagnostic-report-head-${crypto.randomUUID()}`;
    const responseSnapshot = this.responseSnapshot(
      request,
      request.id,
      request.currentVersionId,
      reportVersionId,
    );
    const audit = await this.createAudit({
      auditHead,
      action: currentReport ? 'diagnostic_report.revise' : 'diagnostic_report.attach',
      purpose: 'diagnostic_result_management',
      entityType: 'diagnostic_report',
      entityId: reportId,
      requestId: input.requestId,
      metadata: {
        serviceRequestId: request.id,
        reportStatus: input.reportStatus,
        reportVersion: currentVersion + 1,
        artifactSha256: input.artifact.sha256,
      },
      occurredAt: now,
    });
    const statements: D1PreparedStatement[] = [];
    if (!currentReport) {
      statements.push(
        this.database
          .prepare(`
            insert into diagnostic_reports (
              id, organization_id, facility_id, service_request_id,
              created_by_membership_id, created_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6)
          `)
          .bind(
            reportId,
            this.scope.organizationId,
            this.scope.facilityId,
            request.id,
            this.scope.membershipId,
            now,
          ),
      );
    }
    statements.push(
      this.database
        .prepare(`
          insert into diagnostic_report_artifacts (
            id, organization_id, facility_id, service_request_id,
            diagnostic_report_id, object_key, file_name, mime_type, sha256,
            byte_size, source, created_by_membership_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            'manual_upload', ?11, ?12)
        `)
        .bind(
          input.artifact.id,
          this.scope.organizationId,
          this.scope.facilityId,
          request.id,
          reportId,
          input.artifact.objectKey,
          input.artifact.fileName,
          input.artifact.mimeType,
          input.artifact.sha256,
          input.artifact.byteSize,
          this.scope.membershipId,
          now,
        ),
      this.database
        .prepare(`
          insert into diagnostic_report_versions (
            id, organization_id, facility_id, service_request_id,
            diagnostic_report_id, version, supersedes_version_id,
            report_status, conclusion, artifact_id, review_state,
            reconciliation_note, change_reason, created_by_membership_id,
            reviewed_by_membership_id, reviewed_at, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            'pending', null, ?11, ?12, null, null, ?13)
        `)
        .bind(
          reportVersionId,
          this.scope.organizationId,
          this.scope.facilityId,
          request.id,
          reportId,
          currentVersion + 1,
          currentReport?.currentVersionId ?? null,
          input.reportStatus,
          normalized.conclusion,
          input.artifact.id,
          normalized.changeReason,
          this.scope.membershipId,
          now,
        ),
    );
    statements.push(
      currentReport
        ? this.database
            .prepare(`
              update diagnostic_report_heads
              set current_version_id = ?1, lock_version = lock_version + 1,
                updated_at = ?2
              where organization_id = ?3 and facility_id = ?4
                and diagnostic_report_id = ?5 and current_version_id = ?6
                and lock_version = ?7
            `)
            .bind(
              reportVersionId,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              reportId,
              currentReport.currentVersionId,
              currentVersion,
            )
        : this.database
            .prepare(`
              insert into diagnostic_report_heads (
                id, organization_id, facility_id, service_request_id,
                diagnostic_report_id, current_version_id, lock_version,
                created_at, updated_at
              ) values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
            `)
            .bind(
              reportHeadId,
              this.scope.organizationId,
              this.scope.facilityId,
              request.id,
              reportId,
              reportVersionId,
              now,
            ),
      this.auditInsert(audit),
      this.auditHeadUpdate(audit),
      this.commandComplete({
        id: commandId,
        resourceId: request.id,
        responseJson: JSON.stringify(responseSnapshot),
        now,
      }),
      this.database
        .prepare(`
          update diagnostic_result_upload_intents
          set status = 'committed', updated_at = ?1
          where organization_id = ?2 and facility_id = ?3
            and command_id = ?4 and status = 'object_stored'
        `)
        .bind(
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          commandId,
        ),
    );
    try {
      const results = await this.database.batch(statements);
      this.assertCommitted(
        results,
        currentReport ? 7 : 8,
        'Diagnostic result was not committed',
      );
    } catch (error) {
      const replay = await this.findIdempotency(
        'order.result.attach',
        input.idempotencyKey,
      );
      if (replay?.status === 'succeeded') {
        return this.resolveReplay(replay, requestHash);
      }
      throw error;
    }
    return this.getRecordSnapshot(responseSnapshot);
  }

  private async resultAttachmentHash(input: AttachDiagnosticResultCommand) {
    return sha256(
      JSON.stringify({
        requestId: input.requestIdValue,
        reportStatus: input.reportStatus,
        conclusion: normalizeNullable(input.conclusion),
        changeReason: normalizeText(input.changeReason),
        expectedReportVersion: input.expectedReportVersion,
        artifact: input.artifact,
      }),
    );
  }

  private async validateResultAttachment(input: AttachDiagnosticResultCommand) {
    const normalized = {
      conclusion: normalizeNullable(input.conclusion),
      changeReason: normalizeText(input.changeReason),
    };
    const request = await this.getRequestRow(input.requestIdValue);
    if (!request) throw new OrderWorkflowNotFoundError('Service request unavailable');
    this.requireMutableRequest(request);
    if (!['active', 'on_hold', 'completed'].includes(request.status)) {
      throw new OrderWorkflowLifecycleError(
        'Результат можно прикрепить только к подтверждённому направлению',
      );
    }
    if (!(await this.hasEffectiveCareConsent(request.encounterId))) {
      throw new OrderWorkflowConsentRequiredError('Care consent is required');
    }
    const currentReport = await this.getReportHead(request.id);
    const currentVersion = currentReport?.version ?? 0;
    if (currentVersion !== input.expectedReportVersion) {
      throw new OrderWorkflowVersionConflictError(currentVersion, 'report');
    }
    if (!currentReport && !['registered', 'preliminary', 'final'].includes(input.reportStatus)) {
      throw new OrderWorkflowLifecycleError(
        'Первый результат не может быть исправлением или дополнением',
      );
    }
    if (currentReport) {
      try {
        assertDiagnosticReportTransition(currentReport.reportStatus, input.reportStatus);
      } catch (error) {
        throw new OrderWorkflowLifecycleError(
          error instanceof Error ? error.message : 'Invalid report transition',
        );
      }
      if (
        request.status === 'completed' &&
        !['amended', 'corrected'].includes(input.reportStatus)
      ) {
        throw new OrderWorkflowLifecycleError(
          'После завершения направления допускается только дополненный или исправленный результат',
        );
      }
    }
    return { normalized, request, currentReport, currentVersion };
  }

  private async resolveResultReservation(
    row: IdempotencyRow,
    requestHash: string,
  ): Promise<DiagnosticResultUploadReservation> {
    if (row.requestHash !== requestHash) {
      throw new OrderWorkflowConflictError(
        'Idempotency key conflicts with an earlier result upload',
      );
    }
    if (row.status === 'succeeded') {
      return { kind: 'replayed', record: await this.resolveReplay(row, requestHash) };
    }
    if (row.status === 'processing') {
      const intent = await this.getResultUploadIntent(row.id);
      if (intent?.status === 'reserved' || intent?.status === 'object_stored') {
        return { kind: 'reserved', commandId: row.id };
      }
      throw new OrderWorkflowConflictError(
        'Processing result upload has no durable artifact intent',
      );
    }
    throw new OrderWorkflowConflictError('Result upload reservation is not reusable');
  }

  async reviewResult(input: ReviewDiagnosticResultCommand) {
    this.requireClinician();
    const note = normalizeNullable(input.note);
    const requestHash = await sha256(
      JSON.stringify({
        requestId: input.requestIdValue,
        decision: input.decision,
        note,
        expectedReportVersion: input.expectedReportVersion,
      }),
    );
    const replay = await this.findIdempotency('order.result.review', input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash);
    const request = await this.getRequestRow(input.requestIdValue);
    if (!request) throw new OrderWorkflowNotFoundError('Service request unavailable');
    this.requireMutableRequest(request);
    if (!['active', 'on_hold', 'completed'].includes(request.status)) {
      throw new OrderWorkflowLifecycleError(
        'Результат терминального или неподтверждённого направления нельзя проверить',
      );
    }
    if (!(await this.hasEffectiveCareConsent(request.encounterId))) {
      throw new OrderWorkflowConsentRequiredError('Care consent is required');
    }
    const current = await this.getReportHead(request.id);
    if (!current) throw new OrderWorkflowNotFoundError('Diagnostic report unavailable');
    if (current.version !== input.expectedReportVersion) {
      throw new OrderWorkflowVersionConflictError(current.version, 'report');
    }
    if (['cancelled', 'entered_in_error'].includes(current.reportStatus)) {
      throw new OrderWorkflowLifecycleError('Этот результат нельзя проверить');
    }
    if (current.reviewState !== 'pending') {
      throw new OrderWorkflowLifecycleError(
        'Повторная проверка возможна только после новой версии результата',
      );
    }
    if (input.decision === 'needs_reconciliation' && !note) {
      throw new OrderWorkflowLifecycleError('Опишите найденное расхождение');
    }
    const auditHead = await this.requireAuditHead();
    const now = Date.now();
    const versionId = `diagnostic-report-version-${crypto.randomUUID()}`;
    const audit = await this.createAudit({
      auditHead,
      action: `diagnostic_report.${input.decision}`,
      purpose: 'diagnostic_result_review',
      entityType: 'diagnostic_report',
      entityId: current.reportId,
      requestId: input.requestId,
      metadata: {
        serviceRequestId: request.id,
        reportVersion: current.version + 1,
        reviewState: input.decision,
      },
      occurredAt: now,
    });
    const commandId = `command-${crypto.randomUUID()}`;
    const responseSnapshot = this.responseSnapshot(
      request,
      request.id,
      request.currentVersionId,
      versionId,
    );
    const replayRecord = await this.commitIdempotentCommand({
      operation: 'order.result.review',
      key: input.idempotencyKey,
      requestHash,
      statements: [
      this.database
        .prepare(`
          insert into diagnostic_report_versions (
            id, organization_id, facility_id, service_request_id,
            diagnostic_report_id, version, supersedes_version_id,
            report_status, conclusion, artifact_id, review_state,
            reconciliation_note, change_reason, created_by_membership_id,
            reviewed_by_membership_id, reviewed_at, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?14, ?15, ?15)
        `)
        .bind(
          versionId,
          this.scope.organizationId,
          this.scope.facilityId,
          request.id,
          current.reportId,
          current.version + 1,
          current.currentVersionId,
          current.reportStatus,
          current.conclusion,
          current.artifactId,
          input.decision,
          input.decision === 'needs_reconciliation' ? note : null,
          input.decision === 'reviewed'
            ? 'Результат проверен врачом'
            : 'Врач запросил устранение расхождения',
          this.scope.membershipId,
          now,
        ),
      this.database
        .prepare(`
          update diagnostic_report_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and diagnostic_report_id = ?5 and current_version_id = ?6
            and lock_version = ?7
        `)
        .bind(
          versionId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          current.reportId,
          current.currentVersionId,
          current.version,
        ),
      this.auditInsert(audit),
      this.auditHeadUpdate(audit),
      this.commandStart({
        id: commandId,
        operation: 'order.result.review',
        key: input.idempotencyKey,
        requestHash,
        now,
      }),
      this.commandComplete({
        id: commandId,
        resourceId: request.id,
        responseJson: JSON.stringify(responseSnapshot),
        now,
      }),
      ],
      expectedStatements: 6,
      message: 'Diagnostic result review was not committed',
    });
    if (replayRecord) return replayRecord;
    return this.getRecordSnapshot(responseSnapshot);
  }

  async getCurrentArtifact(requestIdValue: string) {
    this.requireClinician();
    const request = await this.getRequestRow(requestIdValue);
    if (!request) return null;
    return this.database
      .prepare(`
        select artifact.id, artifact.object_key as objectKey,
          artifact.file_name as fileName, artifact.mime_type as mimeType,
          artifact.sha256, artifact.byte_size as byteSize,
          artifact.created_at as createdAt
        from diagnostic_report_heads head
        join diagnostic_report_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.diagnostic_report_id = head.diagnostic_report_id
          and version.id = head.current_version_id
        join diagnostic_report_artifacts artifact
          on artifact.organization_id = version.organization_id
          and artifact.facility_id = version.facility_id
          and artifact.diagnostic_report_id = version.diagnostic_report_id
          and artifact.id = version.artifact_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.service_request_id = ?3
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, request.id)
      .first<DiagnosticArtifactMetadata>();
  }

  async recordArtifactRead(input: {
    requestIdValue: string;
    artifactId: string;
    requestId: string;
  }) {
    this.requireClinician();
    const request = await this.getRequestRow(input.requestIdValue);
    if (!request) throw new OrderWorkflowNotFoundError('Service request unavailable');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const auditHead = await this.requireAuditHead();
        const audit = await this.createAudit({
          auditHead,
          action: 'diagnostic_report.artifact.read',
          purpose: 'diagnostic_result_access',
          entityType: 'diagnostic_report_artifact',
          entityId: input.artifactId,
          requestId: input.requestId,
          metadata: { serviceRequestId: request.id },
          occurredAt: Date.now(),
        });
        const results = await this.database.batch([
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        this.assertCommitted(results, 2, 'Diagnostic result read audit failed');
        return;
      } catch (error) {
        if (attempt === 2) {
          throw new OrderWorkflowAuditUnavailableError(
            error instanceof Error
              ? error.message
              : 'Diagnostic result read audit failed',
          );
        }
      }
    }
  }

  private requireClinician() {
    if (this.scope.role !== 'clinician') {
      throw new OrderWorkflowClinicianRequiredError('Clinician role is required');
    }
  }

  private requireMutableRequest(request: RequestRow) {
    if (request.encounterStatus === 'cancelled') {
      throw new OrderWorkflowLifecycleError(
        'Отменённый приём нельзя изменять. История направления сохранена.',
      );
    }
    if (request.patientStatus !== 'active') {
      throw new OrderWorkflowLifecycleError(
        'Архивную карточку пациента нельзя изменять. История направления сохранена.',
      );
    }
  }

  private async getEncounter(encounterId: string) {
    return this.database
      .prepare(`
        select encounter.id, encounter.patient_id as patientId,
          coalesce(profile.display_name, patient.display_name) as patientName,
          patient.medical_record_number as medicalRecordNumber,
          encounter.status, encounter.reason_for_visit as reasonForVisit,
          encounter.updated_at as updatedAt
        from encounters encounter
        join patients patient
          on patient.organization_id = encounter.organization_id
          and patient.facility_id = encounter.facility_id
          and patient.id = encounter.patient_id
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        where encounter.organization_id = ?1 and encounter.facility_id = ?2
          and encounter.id = ?3 and encounter.clinician_membership_id = ?4
          and encounter.status <> 'cancelled'
          and patient.status = 'active'
          and coalesce(profile.status, patient.status) = 'active'
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        encounterId,
        this.scope.membershipId,
      )
      .first<EncounterRow>();
  }

  private async getRequestRow(requestIdValue: string) {
    return this.database
      .prepare(`
        select request.id, request.request_kind as kind,
          request.patient_id as patientId,
          coalesce(profile.display_name, patient.display_name) as patientName,
          patient.medical_record_number as medicalRecordNumber,
          coalesce(profile.status, patient.status) as patientStatus,
          request.encounter_id as encounterId,
          encounter.status as encounterStatus,
          encounter.reason_for_visit as reasonForVisit,
          head.current_version_id as currentVersionId,
          head.lock_version as lockVersion,
          current.status, current.priority,
          current.requested_service as requestedService,
          current.target_specialty as targetSpecialty,
          current.medical_justification as medicalJustification,
          current.clinician_note as clinicianNote,
          current.status_reason as statusReason,
          current.approved_by_membership_id as approvedByMembershipId,
          current.approved_at as approvedAt,
          report.id as reportId,
          report_head.current_version_id as reportVersionId,
          report_head.lock_version as reportVersion,
          report_current.report_status as reportStatus,
          report_current.review_state as reviewState
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
        join encounters encounter
          on encounter.organization_id = request.organization_id
          and encounter.facility_id = request.facility_id
          and encounter.id = request.encounter_id
        join patients patient
          on patient.organization_id = request.organization_id
          and patient.facility_id = request.facility_id
          and patient.id = request.patient_id
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        left join diagnostic_reports report
          on report.organization_id = request.organization_id
          and report.facility_id = request.facility_id
          and report.service_request_id = request.id
        left join diagnostic_report_heads report_head
          on report_head.organization_id = report.organization_id
          and report_head.facility_id = report.facility_id
          and report_head.diagnostic_report_id = report.id
        left join diagnostic_report_versions report_current
          on report_current.organization_id = report_head.organization_id
          and report_current.facility_id = report_head.facility_id
          and report_current.diagnostic_report_id = report_head.diagnostic_report_id
          and report_current.id = report_head.current_version_id
        where request.organization_id = ?1 and request.facility_id = ?2
          and request.id = ?3 and encounter.clinician_membership_id = ?4
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        requestIdValue,
        this.scope.membershipId,
      )
      .first<RequestRow>();
  }

  private async getRequestRowAt(
    requestIdValue: string,
    requestVersionId: string,
    reportVersionId: string | null,
  ) {
    return this.database
      .prepare(`
        select request.id, request.request_kind as kind,
          request.patient_id as patientId,
          coalesce(profile.display_name, patient.display_name) as patientName,
          patient.medical_record_number as medicalRecordNumber,
          coalesce(profile.status, patient.status) as patientStatus,
          request.encounter_id as encounterId,
          encounter.status as encounterStatus,
          encounter.reason_for_visit as reasonForVisit,
          current.id as currentVersionId,
          current.version as lockVersion,
          current.status, current.priority,
          current.requested_service as requestedService,
          current.target_specialty as targetSpecialty,
          current.medical_justification as medicalJustification,
          current.clinician_note as clinicianNote,
          current.status_reason as statusReason,
          current.approved_by_membership_id as approvedByMembershipId,
          current.approved_at as approvedAt,
          report.id as reportId,
          report_current.id as reportVersionId,
          report_current.version as reportVersion,
          report_current.report_status as reportStatus,
          report_current.review_state as reviewState
        from service_requests request
        join service_request_versions current
          on current.organization_id = request.organization_id
          and current.facility_id = request.facility_id
          and current.service_request_id = request.id
          and current.id = ?4
        join encounters encounter
          on encounter.organization_id = request.organization_id
          and encounter.facility_id = request.facility_id
          and encounter.id = request.encounter_id
        join patients patient
          on patient.organization_id = request.organization_id
          and patient.facility_id = request.facility_id
          and patient.id = request.patient_id
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        left join diagnostic_reports report
          on report.organization_id = request.organization_id
          and report.facility_id = request.facility_id
          and report.service_request_id = request.id
          and ?5 is not null
        left join diagnostic_report_versions report_current
          on report_current.organization_id = report.organization_id
          and report_current.facility_id = report.facility_id
          and report_current.diagnostic_report_id = report.id
          and report_current.id = ?5
        where request.organization_id = ?1 and request.facility_id = ?2
          and request.id = ?3 and encounter.clinician_membership_id = ?6
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        requestIdValue,
        requestVersionId,
        reportVersionId,
        this.scope.membershipId,
      )
      .first<RequestRow>();
  }

  private async getRequestHistory(requestIdValue: string, throughVersion?: number) {
    const result = await this.database
      .prepare(`
        select version.id, version.version, version.status, version.priority,
          version.requested_service as requestedService,
          version.target_specialty as targetSpecialty,
          version.medical_justification as medicalJustification,
          version.clinician_note as clinicianNote,
          version.status_reason as statusReason,
          author_user.display_name as authoredBy,
          approver_user.display_name as approvedBy,
          version.approved_at as approvedAt,
          version.created_at as createdAt
        from service_request_versions version
        join memberships author_membership
          on author_membership.organization_id = version.organization_id
          and author_membership.facility_id = version.facility_id
          and author_membership.id = version.authored_by_membership_id
        join users author_user on author_user.id = author_membership.user_id
        left join memberships approver_membership
          on approver_membership.organization_id = version.organization_id
          and approver_membership.facility_id = version.facility_id
          and approver_membership.id = version.approved_by_membership_id
        left join users approver_user on approver_user.id = approver_membership.user_id
        where version.organization_id = ?1 and version.facility_id = ?2
          and version.service_request_id = ?3
          and (?4 is null or version.version <= ?4)
        order by version.version desc
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        requestIdValue,
        throughVersion ?? null,
      )
      .all<ServiceRequestHistoryEntry>();
    return result.results;
  }

  private async getReportHistory(reportId: string, throughVersion?: number) {
    const result = await this.database
      .prepare(`
        select version.id, version.version,
          version.report_status as reportStatus,
          version.conclusion, version.review_state as reviewState,
          version.reconciliation_note as reconciliationNote,
          version.change_reason as changeReason,
          creator_user.display_name as createdBy,
          reviewer_user.display_name as reviewedBy,
          version.reviewed_at as reviewedAt,
          version.created_at as createdAt,
          artifact.id as artifactId,
          artifact.object_key as objectKey,
          artifact.file_name as fileName,
          artifact.mime_type as mimeType,
          artifact.sha256,
          artifact.byte_size as byteSize,
          artifact.created_at as artifactCreatedAt
        from diagnostic_report_versions version
        join memberships creator_membership
          on creator_membership.organization_id = version.organization_id
          and creator_membership.facility_id = version.facility_id
          and creator_membership.id = version.created_by_membership_id
        join users creator_user on creator_user.id = creator_membership.user_id
        left join memberships reviewer_membership
          on reviewer_membership.organization_id = version.organization_id
          and reviewer_membership.facility_id = version.facility_id
          and reviewer_membership.id = version.reviewed_by_membership_id
        left join users reviewer_user on reviewer_user.id = reviewer_membership.user_id
        left join diagnostic_report_artifacts artifact
          on artifact.organization_id = version.organization_id
          and artifact.facility_id = version.facility_id
          and artifact.diagnostic_report_id = version.diagnostic_report_id
          and artifact.id = version.artifact_id
        where version.organization_id = ?1 and version.facility_id = ?2
          and version.diagnostic_report_id = ?3
          and (?4 is null or version.version <= ?4)
        order by version.version desc
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        reportId,
        throughVersion ?? null,
      )
      .all<DiagnosticReportHistoryEntry & {
        artifactId: string | null;
        objectKey: string | null;
        fileName: string | null;
        mimeType: DiagnosticArtifactMimeType | null;
        sha256: string | null;
        byteSize: number | null;
        artifactCreatedAt: number | null;
      }>();
    return result.results.map((row) => ({
      id: row.id,
      version: row.version,
      reportStatus: row.reportStatus,
      conclusion: row.conclusion,
      reviewState: row.reviewState,
      reconciliationNote: row.reconciliationNote,
      changeReason: row.changeReason,
      createdBy: row.createdBy,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      artifact:
        row.artifactId && row.objectKey && row.fileName && row.mimeType &&
        row.sha256 && row.byteSize !== null && row.artifactCreatedAt !== null
          ? {
              id: row.artifactId,
              objectKey: row.objectKey,
              fileName: row.fileName,
              mimeType: row.mimeType,
              sha256: row.sha256,
              byteSize: row.byteSize,
              createdAt: row.artifactCreatedAt,
            }
          : null,
    }));
  }

  private async getReportHead(requestIdValue: string) {
    return this.database
      .prepare(`
        select report.id as reportId,
          head.current_version_id as currentVersionId,
          head.lock_version as version,
          current.report_status as reportStatus,
          current.conclusion, current.artifact_id as artifactId,
          current.review_state as reviewState,
          current.reconciliation_note as reconciliationNote
        from diagnostic_reports report
        join diagnostic_report_heads head
          on head.organization_id = report.organization_id
          and head.facility_id = report.facility_id
          and head.diagnostic_report_id = report.id
        join diagnostic_report_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.diagnostic_report_id = head.diagnostic_report_id
          and current.id = head.current_version_id
        where report.organization_id = ?1 and report.facility_id = ?2
          and report.service_request_id = ?3
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, requestIdValue)
      .first<ReportHeadRow>();
  }

  private async hasEffectiveCareConsent(encounterId: string, at = Date.now()) {
    const row = await this.database
      .prepare(`
        select 1 as present
        from consent_heads head
        join consent_events event
          on event.organization_id = head.organization_id
          and event.facility_id = head.facility_id
          and event.patient_id = head.patient_id
          and event.encounter_id = head.encounter_id
          and event.consent_type = head.consent_type
          and event.id = head.current_consent_event_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3 and head.consent_type = 'care'
          and event.decision = 'granted' and event.effective_at <= ?4
          and (event.expires_at is null or event.expires_at > ?4)
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, encounterId, at)
      .first<{ present: number }>();
    return row?.present === 1;
  }

  private async resolveReplay(replay: IdempotencyRow, requestHash: string) {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId ||
      !replay.responseJson
    ) {
      throw new OrderWorkflowConflictError(
        'Idempotency key conflicts with an earlier order command',
      );
    }
    let stored: Partial<OrderCommandResponseSnapshot>;
    try {
      stored = JSON.parse(replay.responseJson) as Partial<OrderCommandResponseSnapshot>;
    } catch {
      throw new OrderWorkflowConflictError('Stored order command response is invalid');
    }
    if (stored.requestId !== replay.resultResourceId) {
      throw new OrderWorkflowConflictError('Stored order command scope is invalid');
    }
    if (
      !stored.requestVersionId ||
      stored.reportVersionId === undefined ||
      !stored.patient?.id ||
      !stored.patient.displayName ||
      !stored.patient.medicalRecordNumber ||
      !stored.encounter?.id ||
      !stored.encounter.status ||
      stored.encounter.reasonForVisit === undefined
    ) {
      throw new OrderWorkflowConflictError(
        'Stored legacy command cannot be replayed as an exact response',
      );
    }
    return this.getRecordSnapshot(stored as OrderCommandResponseSnapshot);
  }

  private async findIdempotency(operation: string, key: string) {
    return this.database
      .prepare(`
        select id, request_hash as requestHash, status,
          result_resource_id as resultResourceId,
          response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = ?4
          and idempotency_key = ?5
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        operation,
        key,
      )
      .first<IdempotencyRow>();
  }

  private async getResultUploadIntent(commandId: string) {
    return this.database
      .prepare(`
        select id, command_id as commandId,
          service_request_id as serviceRequestId,
          artifact_id as artifactId, object_key as objectKey,
          file_name as fileName, mime_type as mimeType, sha256, byte_size as byteSize,
          status, failure_code as failureCode, updated_at as updatedAt
        from diagnostic_result_upload_intents
        where organization_id = ?1 and facility_id = ?2 and command_id = ?3
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        commandId,
      )
      .first<DiagnosticResultUploadIntent>();
  }

  private async requireAuditHead() {
    const row = await this.database
      .prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash,
          lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
    if (!row) throw new OrderWorkflowConflictError('Audit stream unavailable');
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

  private auditInsert(audit: Awaited<ReturnType<D1OrderWorkflowRepository['createAudit']>>) {
    return this.database
      .prepare(`
        insert into audit_events (
          id, organization_id, facility_id, sequence, actor_type, actor_id,
          actor_membership_id, action, outcome, purpose, schema_version,
          entity_type, entity_id, request_id, metadata_json, previous_hash,
          event_hash, occurred_at
        ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded', ?8,
          1, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
      `)
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

  private auditHeadUpdate(audit: Awaited<ReturnType<D1OrderWorkflowRepository['createAudit']>>) {
    return this.database
      .prepare(`
        update audit_stream_heads
        set last_sequence = ?1, last_event_hash = ?2,
          lock_version = lock_version + 1, updated_at = ?3
        where organization_id = ?4 and facility_id = ?5
          and last_sequence = ?6 and lock_version = ?7
          and exists (select 1 from audit_events where id = ?8)
      `)
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

  private commandStart(input: {
    id: string;
    operation: string;
    key: string;
    requestHash: string;
    now: number;
  }) {
    return this.database
      .prepare(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id,
          operation, idempotency_key, request_hash, status, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'processing', ?8)
      `)
      .bind(
        input.id,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        input.operation,
        input.key,
        input.requestHash,
        input.now,
      );
  }

  private commandComplete(input: {
    id: string;
    resourceId: string;
    responseJson: string;
    now: number;
  }) {
    return this.database
      .prepare(`
        update command_idempotency
        set status = 'succeeded', result_resource_type = 'service_request',
          result_resource_id = ?1, response_json = ?2, completed_at = ?3
        where id = ?4 and status = 'processing'
      `)
      .bind(input.resourceId, input.responseJson, input.now, input.id);
  }

  private commandFail(input: { id: string; responseJson: string; now: number }) {
    return this.database
      .prepare(`
        update command_idempotency
        set status = 'failed', result_resource_type = null,
          result_resource_id = null, response_json = ?1, completed_at = ?2
        where id = ?3 and status = 'processing'
      `)
      .bind(input.responseJson, input.now, input.id);
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
      throw new OrderWorkflowConflictError(message);
    }
  }

  private async commitIdempotentCommand(input: {
    operation: string;
    key: string;
    requestHash: string;
    statements: D1PreparedStatement[];
    expectedStatements: number;
    message: string;
  }): Promise<ServiceRequestRecord | null> {
    try {
      const results = await this.database.batch(input.statements);
      this.assertCommitted(results, input.expectedStatements, input.message);
      return null;
    } catch (error) {
      const replay = await this.findIdempotency(input.operation, input.key);
      if (replay?.status === 'succeeded') {
        return this.resolveReplay(replay, input.requestHash);
      }
      throw error;
    }
  }
}
