import {
  hashAccessAuditEvent,
  type AccessAuditEventHashInput,
} from '@/lib/audit/access-event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterReadAccess } from '@/lib/auth/encounter-read-access';
import type {
  ExportArtifactKind,
} from '@/lib/documents/protocol-artifacts';

type AccessAuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type StoredAccessAuditRow = {
  organizationId: string;
  facilityId: string;
  accessAssignmentId: string | null;
  schemaVersion: number;
  action: AccessAuditEventHashInput['action'];
  actorUserId: string;
  actorMembershipId: string;
  encounterId: string;
  documentArtifactId: string | null;
  artifactKind: string | null;
  occurredAt: number;
};

type AccessAuditDetails =
  | {
      action: 'workspace.read';
      purposeCode: 'synthetic_direct_patient_care';
      routeCode: 'workspace';
      documentArtifactId: null;
      artifactKind: null;
    }
  | {
      action: 'document.download';
      purposeCode: 'synthetic_clinical_export_download';
      routeCode: 'document_export_download';
      documentArtifactId: string;
      artifactKind: ExportArtifactKind;
    };

type RecordAccessInput = {
  actorId: string;
  requestId: string;
};

export type AccessAuditReceipt = {
  action: AccessAuditEventHashInput['action'];
  recordedAt: number;
};

export class AccessAuditUnavailableError extends Error {
  constructor() {
    super('The protected response was not released because access audit failed');
    this.name = 'AccessAuditUnavailableError';
  }
}

export class AccessAuditRequestConflictError extends Error {
  constructor() {
    super('The request identifier is already bound to another access event');
    this.name = 'AccessAuditRequestConflictError';
  }
}

export class D1AccessAuditRepository {
  private readonly streamKey: string;

  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {
    this.streamKey = `membership:${scope.reviewerMembershipId}`;
  }

  recordWorkspaceRead(input: RecordAccessInput) {
    return this.append(
      {
        action: 'workspace.read',
        purposeCode: 'synthetic_direct_patient_care',
        routeCode: 'workspace',
        documentArtifactId: null,
        artifactKind: null,
      },
      input,
    );
  }

  recordDocumentDownload(
    artifact: { id: string; kind: ExportArtifactKind },
    input: RecordAccessInput,
  ) {
    return this.append(
      {
        action: 'document.download',
        purposeCode: 'synthetic_clinical_export_download',
        routeCode: 'document_export_download',
        documentArtifactId: artifact.id,
        artifactKind: artifact.kind,
      },
      input,
    );
  }

  private async append(
    details: AccessAuditDetails,
    input: RecordAccessInput,
  ): Promise<AccessAuditReceipt> {
    await this.assertCurrentAccess(details, input);
    const existing = await this.findExisting(input.requestId);
    if (existing) {
      await this.assertCurrentAccess(details, input);
      return this.receiptForExisting(existing, details, input);
    }

    await this.ensureHead(input.actorId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertCurrentAccess(details, input);
      const head = await this.getHead();
      if (!head) throw new AccessAuditUnavailableError();

      const occurredAt = Date.now();
      const sequence = head.lastSequence + 1;
      const eventId = `access-audit-${crypto.randomUUID()}`;
      const hashInput: AccessAuditEventHashInput = {
        previousHash: head.lastEventHash,
        organizationId: this.scope.organizationId,
        facilityId: this.scope.facilityId,
        streamKey: this.streamKey,
        sequence,
        actorUserId: input.actorId,
        actorMembershipId: this.scope.reviewerMembershipId,
        actorRole: 'clinician',
        action: details.action,
        outcome: 'succeeded',
        purposeCode: details.purposeCode,
        routeCode: details.routeCode,
        decisionCode: 'authorized_response_prepared',
        responseStatus: 200,
        encounterId: this.scope.encounterId,
        documentArtifactId: details.documentArtifactId,
        artifactKind: details.artifactKind,
        requestId: input.requestId,
        schemaVersion: 2,
        accessAssignmentId: this.scope.accessAssignmentId,
        occurredAt,
      };
      const eventHash = await hashAccessAuditEvent(hashInput);

      try {
        await this.assertCurrentAccess(details, input);
        const results = await this.database.batch([
          this.eventInsert(details, input, hashInput, eventId, eventHash),
          this.database
            .prepare(`
              update access_audit_stream_heads
              set last_sequence = ?1, last_event_hash = ?2,
                lock_version = lock_version + 1, updated_at = ?3
              where organization_id = ?4 and facility_id = ?5
                and stream_key = ?6 and actor_membership_id = ?7
                and last_sequence = ?8 and lock_version = ?9
                and exists (
                  select 1 from access_audit_events where id = ?10
                )
            `)
            .bind(
              sequence,
              eventHash,
              occurredAt,
              this.scope.organizationId,
              this.scope.facilityId,
              this.streamKey,
              this.scope.reviewerMembershipId,
              head.lastSequence,
              head.lockVersion,
              eventId,
            ),
          // A skipped head update must abort the entire batch, not leave an orphan event.
          this.database.prepare(`
            select case when exists (
              select 1 from access_audit_stream_heads
              where organization_id=?1 and facility_id=?2 and stream_key=?3
                and actor_membership_id=?4 and last_sequence=?5 and last_event_hash=?6
                and lock_version=?7
            ) then 1 else json('access_audit_head_not_published') end as verified
          `).bind(this.scope.organizationId, this.scope.facilityId, this.streamKey,
            this.scope.reviewerMembershipId, sequence, eventHash, head.lockVersion + 1),
        ]);
        if (results.slice(0, 2).every((result) => result.meta.changes === 1)) {
          await this.assertCurrentAccess(details, input);
          return { action: details.action, recordedAt: occurredAt };
        }
      } catch {
        await this.assertCurrentAccess(details, input);
        const committed = await this.findExisting(input.requestId);
        if (committed) {
          await this.assertCurrentAccess(details, input);
          return this.receiptForExisting(committed, details, input);
        }
      }
    }

    throw new AccessAuditUnavailableError();
  }

  private async assertCurrentAccess(details: AccessAuditDetails, input: RecordAccessInput) {
    await assertCurrentEncounterReadAccess(this.database, this.scope, input.actorId);
    if (details.action !== 'document.download') return;
    const artifact = await this.database.prepare(`
      select artifact.id from document_artifacts artifact
      join protocol_heads head on head.organization_id=artifact.organization_id and head.facility_id=artifact.facility_id
        and head.encounter_id=artifact.encounter_id and head.current_signed_protocol_version_id=artifact.protocol_version_id
      join protocol_versions version on version.id=artifact.protocol_version_id and version.status='signed'
      join encounters encounter on encounter.id=artifact.encounter_id and encounter.organization_id=artifact.organization_id
        and encounter.facility_id=artifact.facility_id and encounter.status in ('finalized','amended')
      where artifact.organization_id=?1 and artifact.facility_id=?2 and artifact.encounter_id=?3
        and artifact.id=?4 and artifact.kind=?5 and artifact.status='ready'
    `).bind(this.scope.organizationId, this.scope.facilityId, this.scope.encounterId,
      details.documentArtifactId, details.artifactKind).first();
    if (!artifact) throw new AccessAuditUnavailableError();
    await assertCurrentEncounterReadAccess(this.database, this.scope, input.actorId);
  }

  private eventInsert(
    details: AccessAuditDetails,
    input: RecordAccessInput,
    hashInput: AccessAuditEventHashInput,
    eventId: string,
    eventHash: string,
  ) {
    const resourcePredicate =
      details.action === 'document.download'
        ? `and exists (
            select 1 from document_artifacts artifact
            join protocol_heads protocol_head
              on protocol_head.organization_id = artifact.organization_id
              and protocol_head.facility_id = artifact.facility_id
              and protocol_head.encounter_id = artifact.encounter_id
              and protocol_head.current_signed_protocol_version_id = artifact.protocol_version_id
            where artifact.organization_id = ?2 and artifact.facility_id = ?3
              and artifact.encounter_id = ?8 and artifact.id = ?14
              and artifact.kind = ?15 and artifact.status = 'ready'
          )`
        : '';

    return this.database
      .prepare(`
        insert into access_audit_events (
          id, organization_id, facility_id, stream_key, sequence,
          actor_user_id, actor_membership_id, actor_role, action, outcome,
          purpose_code, route_code, decision_code, response_status,
          encounter_id, document_artifact_id, artifact_kind, request_id,
          schema_version, previous_hash, event_hash, occurred_at, access_assignment_id
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'clinician', ?9, 'succeeded',
          ?10, ?11, 'authorized_response_prepared', 200, ?8, ?14, ?15, ?12,
          ?18, ?13, ?16, ?17, ?19
        where exists (
          select 1
          from memberships membership
          join encounters encounter
            on encounter.organization_id = membership.organization_id
            and encounter.facility_id = membership.facility_id
            and encounter.clinician_membership_id = membership.id
          where membership.organization_id = ?2
            and membership.facility_id = ?3
            and membership.id = ?7
            and membership.user_id = ?6
            and membership.status = 'active'
            and encounter.id = ?8
        )
        ${resourcePredicate}
      `)
      .bind(
        eventId,
        this.scope.organizationId,
        this.scope.facilityId,
        this.streamKey,
        hashInput.sequence,
        input.actorId,
        this.scope.reviewerMembershipId,
        this.scope.encounterId,
        details.action,
        details.purposeCode,
        details.routeCode,
        input.requestId,
        hashInput.previousHash,
        details.documentArtifactId,
        details.artifactKind,
        eventHash,
        hashInput.occurredAt,
        hashInput.schemaVersion,
        hashInput.accessAssignmentId ?? null,
      );
  }

  private async ensureHead(actorId: string) {
    await this.database
      .prepare(`
        insert or ignore into access_audit_stream_heads (
          id, organization_id, facility_id, stream_key,
          actor_membership_id, last_sequence, last_event_hash, lock_version
        )
        select ?1, ?2, ?3, ?4, ?5, 0, null, 1
        from memberships membership
        where membership.organization_id = ?2
          and membership.facility_id = ?3
          and membership.id = ?5
          and membership.user_id = ?6
          and exists (
            select 1 from encounter_access_assignment_permissions access where access.assignment_id=?7
              and access.organization_id=membership.organization_id and access.facility_id=membership.facility_id
              and access.membership_id=membership.id and access.can_read=1
              and access.effective_from<=?8 and (access.effective_until is null or access.effective_until>?8)
          )
          and membership.status = 'active'
      `)
      .bind(
        `access-head-${this.scope.reviewerMembershipId}`,
        this.scope.organizationId,
        this.scope.facilityId,
        this.streamKey,
        this.scope.reviewerMembershipId,
        actorId,
        this.scope.accessAssignmentId ?? null,
        Date.now(),
      )
      .run();
  }

  private getHead() {
    return this.database
      .prepare(`
        select last_sequence as lastSequence,
          last_event_hash as lastEventHash, lock_version as lockVersion
        from access_audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
          and stream_key = ?3 and actor_membership_id = ?4
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.streamKey,
        this.scope.reviewerMembershipId,
      )
      .first<AccessAuditHeadRow>();
  }

  private findExisting(requestId: string) {
    return this.database
      .prepare(`
        select organization_id as organizationId, facility_id as facilityId,
          access_assignment_id as accessAssignmentId, schema_version as schemaVersion,
          action, actor_user_id as actorUserId,
          actor_membership_id as actorMembershipId,
          encounter_id as encounterId,
          document_artifact_id as documentArtifactId,
          artifact_kind as artifactKind, occurred_at as occurredAt
        from access_audit_events
        where request_id = ?1
        limit 1
      `)
      .bind(requestId)
      .first<StoredAccessAuditRow>();
  }

  private receiptForExisting(
    existing: StoredAccessAuditRow,
    details: AccessAuditDetails,
    input: RecordAccessInput,
  ): AccessAuditReceipt {
    if (
      existing.organizationId !== this.scope.organizationId || existing.facilityId !== this.scope.facilityId ||
      existing.schemaVersion !== 2 || existing.accessAssignmentId !== this.scope.accessAssignmentId ||
      existing.action !== details.action ||
      existing.actorUserId !== input.actorId ||
      existing.actorMembershipId !== this.scope.reviewerMembershipId ||
      existing.encounterId !== this.scope.encounterId ||
      existing.documentArtifactId !== details.documentArtifactId ||
      existing.artifactKind !== details.artifactKind
    ) {
      throw new AccessAuditRequestConflictError();
    }
    return { action: existing.action, recordedAt: existing.occurredAt };
  }
}
