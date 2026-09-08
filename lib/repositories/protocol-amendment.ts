import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import {
  signedProtocolContentSchema,
  type SignedProtocolContent,
} from '@/lib/documents/protocol-artifacts';
import type { ProtocolVersionSummary } from '@/lib/repositories/protocol-review';

type CurrentSignedRow = {
  protocolId: string;
  protocolVersion: number;
  contentJson: string;
  sourceHash: string;
  protocolHeadVersion: number;
  encounterStatus: string;
  encounterVersion: number;
  startedAt: number | null;
  endedAt: number | null;
  finalizedAt: number | null;
  clinicianDisplayName: string;
};

type ConsentRow = {
  eventId: string;
  decision: 'granted' | 'denied' | 'withdrawn';
  effectiveAt: number;
  expiresAt: number | null;
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type IdempotencyRow = {
  accessAssignmentId: string | null;
  requestHash: string;
  status: string;
  resultResourceType: string | null;
  resultResourceId: string | null;
  responseJson: string | null;
};

type AmendmentRow = {
  id: string;
  sequence: number;
  baseProtocolId: string;
  protocolId: string;
  protocolVersion: number;
  reason: string;
  text: string;
  signedByMembershipId: string;
  signedByDisplayName: string;
  signedAt: number;
};

export type ProtocolAmendmentSummary = AmendmentRow;

export type AmendProtocolResult = {
  protocol: ProtocolVersionSummary & { status: 'signed'; signedAt: number };
  amendment: ProtocolAmendmentSummary;
  transition: {
    encounterId: string;
    status: 'amended';
    version: number;
    startedAt: number | null;
    endedAt: number | null;
    finalizedAt: number | null;
    updatedAt: number;
  };
};

export type AmendProtocolCommand = {
  baseProtocolId: string;
  expectedProtocolVersion: number;
  expectedProtocolHeadVersion: number;
  expectedEncounterVersion: number;
  reason: string;
  text: string;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export class ProtocolAmendmentConflictError extends Error {}
export class ProtocolAmendmentConsentRequiredError extends Error {}
export class ProtocolAmendmentLifecycleError extends Error {}
export class ProtocolAmendmentNotFoundError extends Error {}
export class ProtocolAmendmentSourceChangedError extends Error {}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function isEffective(consent: ConsentRow | null, at: number) {
  return Boolean(
    consent &&
      consent.decision === 'granted' &&
      consent.effectiveAt <= at &&
      (consent.expiresAt === null || consent.expiresAt > at),
  );
}

function hasLinearAmendments(content: SignedProtocolContent) {
  return content.amendments.every(
    (amendment, index) => amendment.sequence === index + 1,
  );
}

function parseStoredResult(value: string | null) {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as AmendProtocolResult;
    if (
      result.protocol?.status !== 'signed' ||
      typeof result.protocol.id !== 'string' ||
      typeof result.protocol.version !== 'number' ||
      typeof result.protocol.sourceHash !== 'string' ||
      typeof result.protocol.createdAt !== 'number' ||
      typeof result.protocol.signedAt !== 'number' ||
      typeof result.protocol.headVersion !== 'number' ||
      typeof result.amendment?.id !== 'string' ||
      typeof result.amendment.sequence !== 'number' ||
      typeof result.amendment.baseProtocolId !== 'string' ||
      typeof result.amendment.protocolId !== 'string' ||
      typeof result.amendment.protocolVersion !== 'number' ||
      typeof result.amendment.reason !== 'string' ||
      typeof result.amendment.text !== 'string' ||
      typeof result.amendment.signedByMembershipId !== 'string' ||
      typeof result.amendment.signedByDisplayName !== 'string' ||
      typeof result.amendment.signedAt !== 'number' ||
      result.transition?.status !== 'amended' ||
      typeof result.transition.encounterId !== 'string' ||
      typeof result.transition.version !== 'number' ||
      typeof result.transition.updatedAt !== 'number'
    ) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export class D1ProtocolAmendmentRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async list(): Promise<ProtocolAmendmentSummary[]> {
    const result = await this.database
      .prepare(`
        select amendment.id,
          row_number() over (
            partition by amendment.organization_id, amendment.facility_id,
              amendment.encounter_id
            order by amended_version.version
          ) as sequence,
          amendment.base_protocol_version_id as baseProtocolId,
          amendment.amended_protocol_version_id as protocolId,
          amended_version.version as protocolVersion,
          amendment.reason,
          amendment.amendment_text as text,
          amendment.created_by_membership_id as signedByMembershipId,
          user.display_name as signedByDisplayName,
          amendment.created_at as signedAt
        from protocol_amendments amendment
        join memberships membership
          on membership.organization_id = amendment.organization_id
          and membership.facility_id = amendment.facility_id
          and membership.id = amendment.created_by_membership_id
        join users user on user.id = membership.user_id
        join protocol_versions amended_version
          on amended_version.organization_id = amendment.organization_id
          and amended_version.facility_id = amendment.facility_id
          and amended_version.encounter_id = amendment.encounter_id
          and amended_version.id = amendment.amended_protocol_version_id
        where amendment.organization_id = ?1 and amendment.facility_id = ?2
          and amendment.encounter_id = ?3
        order by amended_version.version
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<AmendmentRow>();
    return result.results;
  }

  async amend(input: AmendProtocolCommand) {
    await this.assertAuthorized(input.actorId);
    const reason = input.reason.trim();
    const text = input.text.trim();
    const requestHash = await sha256Text(
      JSON.stringify({
        encounterId: this.scope.encounterId,
        accessAssignmentId: this.scope.accessAssignmentId,
        baseProtocolId: input.baseProtocolId,
        expectedProtocolVersion: input.expectedProtocolVersion,
        expectedProtocolHeadVersion: input.expectedProtocolHeadVersion,
        expectedEncounterVersion: input.expectedEncounterVersion,
        reason,
        text,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash, input.actorId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertAuthorized(input.actorId);
      const now = Date.now();
      const [current, careConsent, auditHead] = await Promise.all([
        this.getCurrentSigned(),
        this.getCareConsent(),
        this.getAuditHead(),
      ]);
      if (!current || current.protocolId !== input.baseProtocolId) {
        throw new ProtocolAmendmentNotFoundError(
          'Current signed protocol was not found',
        );
      }
      if (
        current.protocolVersion !== input.expectedProtocolVersion ||
        current.protocolHeadVersion !== input.expectedProtocolHeadVersion ||
        current.encounterVersion !== input.expectedEncounterVersion
      ) {
        throw new ProtocolAmendmentConflictError(
          'Protocol or encounter changed on the server',
        );
      }
      if (!['finalized', 'amended'].includes(current.encounterStatus)) {
        throw new ProtocolAmendmentLifecycleError(
          'Only a signed finalized protocol can be amended',
        );
      }
      if (!isEffective(careConsent, now)) {
        throw new ProtocolAmendmentConsentRequiredError(
          'Effective care consent is required by the synthetic policy',
        );
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');

      let candidate: unknown;
      try {
        candidate = JSON.parse(current.contentJson) as unknown;
      } catch {
        throw new ProtocolAmendmentSourceChangedError(
          'Signed protocol content is invalid',
        );
      }
      const parsed = signedProtocolContentSchema.safeParse(candidate);
      if (
        !parsed.success ||
        parsed.data.encounter.id !== this.scope.encounterId ||
        !hasLinearAmendments(parsed.data) ||
        (await sha256Text(current.contentJson)) !== current.sourceHash
      ) {
        throw new ProtocolAmendmentSourceChangedError(
          'Signed protocol source failed integrity validation',
        );
      }

      try {
        return await this.commitAmendment({
          input,
          reason,
          text,
          requestHash,
          current,
          careConsent: careConsent!,
          auditHead,
          baseContent: parsed.data,
          now,
        });
      } catch (error) {
        await this.assertAuthorized(input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input.actorId);

        const [latest, latestConsent] = await Promise.all([
          this.getCurrentSigned(),
          this.getCareConsent(),
        ]);
        if (!isEffective(latestConsent, Date.now())) {
          throw new ProtocolAmendmentConsentRequiredError(
            'Effective care consent is required by the synthetic policy',
          );
        }
        if (
          !latest ||
          latest.protocolId !== input.baseProtocolId ||
          latest.protocolVersion !== input.expectedProtocolVersion ||
          latest.protocolHeadVersion !== input.expectedProtocolHeadVersion ||
          latest.encounterVersion !== input.expectedEncounterVersion
        ) {
          throw new ProtocolAmendmentConflictError(
            'Protocol or encounter changed on the server',
          );
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Protocol amendment retry was exhausted');
  }

  private async commitAmendment(args: {
    input: AmendProtocolCommand;
    reason: string;
    text: string;
    requestHash: string;
    current: CurrentSignedRow;
    careConsent: ConsentRow;
    auditHead: AuditHeadRow;
    baseContent: SignedProtocolContent;
    now: number;
  }) {
    const {
      input,
      reason,
      text,
      requestHash,
      current,
      careConsent,
      auditHead,
      baseContent,
      now,
    } = args;
    const amendmentId = `amendment-${crypto.randomUUID()}`;
    const amendedProtocolId = `protocol-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const nextProtocolVersion = current.protocolVersion + 1;
    const nextProtocolHeadVersion = current.protocolHeadVersion + 1;
    const nextEncounterVersion = current.encounterVersion + 1;
    const amendmentSequence = baseContent.amendments.length + 1;
    const amendment: ProtocolAmendmentSummary = {
      id: amendmentId,
      sequence: amendmentSequence,
      baseProtocolId: current.protocolId,
      protocolId: amendedProtocolId,
      protocolVersion: nextProtocolVersion,
      reason,
      text,
      signedByMembershipId: this.scope.reviewerMembershipId,
      signedByDisplayName: current.clinicianDisplayName,
      signedAt: now,
    };
    const amendedContent: SignedProtocolContent = {
      ...baseContent,
      encounter: {
        ...baseContent.encounter,
        sourceVersion: nextEncounterVersion,
      },
      amendments: [
        ...baseContent.amendments,
        {
          id: amendment.id,
          sequence: amendment.sequence,
          baseProtocolId: amendment.baseProtocolId,
          reason: amendment.reason,
          text: amendment.text,
          signedByMembershipId: amendment.signedByMembershipId,
          signedByDisplayName: amendment.signedByDisplayName,
          signedAt: amendment.signedAt,
        },
      ],
    };
    const contentJson = JSON.stringify(amendedContent);
    const sourceHash = await sha256Text(contentJson);
    const auditSequence = auditHead.lastSequence + 1;
    const result: AmendProtocolResult = {
      protocol: {
        id: amendedProtocolId,
        version: nextProtocolVersion,
        status: 'signed',
        sourceHash,
        createdAt: now,
        signedAt: now,
        headVersion: nextProtocolHeadVersion,
      },
      amendment,
      transition: {
        encounterId: this.scope.encounterId,
        status: 'amended',
        version: nextEncounterVersion,
        startedAt: current.startedAt,
        endedAt: current.endedAt,
        finalizedAt: current.finalizedAt,
        updatedAt: now,
      },
    };
    const responseJson = JSON.stringify(result);
    const auditMetadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      amendmentId,
      amendmentSequence,
      baseProtocolId: current.protocolId,
      baseProtocolVersion: current.protocolVersion,
      amendedProtocolId,
      amendedProtocolVersion: nextProtocolVersion,
      sourceHash,
      reasonLength: reason.length,
      amendmentTextLength: text.length,
      explicitClinicianConfirmation: true,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: 'protocol.amend_and_sign',
      outcome: 'succeeded',
      purpose: 'synthetic_clinical_documentation_amendment',
      schemaVersion: 1,
      entityType: 'protocol_amendment',
      entityId: amendmentId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    await this.assertAuthorized(input.actorId);
    const results = await this.database.batch([
      this.database
        .prepare(`
          insert into protocol_versions (
            id, organization_id, facility_id, encounter_id, version, status,
            content_json, source_hash, created_by_membership_id,
            signed_by_membership_id, signed_at, supersedes_protocol_version_id,
            created_at, access_assignment_id
          )
          select ?1, parent.organization_id, parent.facility_id,
            parent.encounter_id, parent.version + 1, 'signed', ?2, ?3, ?4,
            ?4, ?5, parent.id, ?5, ?15
          from protocol_versions parent
          join protocol_heads head
            on head.organization_id = parent.organization_id
            and head.facility_id = parent.facility_id
            and head.encounter_id = parent.encounter_id
            and head.current_protocol_version_id = parent.id
            and head.current_signed_protocol_version_id = parent.id
          join encounters encounter
            on encounter.organization_id = parent.organization_id
            and encounter.facility_id = parent.facility_id
            and encounter.id = parent.encounter_id
          where parent.organization_id = ?6 and parent.facility_id = ?7
            and parent.encounter_id = ?8 and parent.id = ?9
            and parent.status = 'signed' and parent.version = ?10
            and parent.source_hash = ?11 and head.lock_version = ?12
            and encounter.clinician_membership_id = ?4
            and encounter.status in ('finalized', 'amended')
            and encounter.version = ?13
            and exists (
              select 1 from consent_heads care_head
              join consent_events care_event
                on care_event.id = care_head.current_consent_event_id
                and care_event.organization_id = care_head.organization_id
                and care_event.facility_id = care_head.facility_id
                and care_event.encounter_id = care_head.encounter_id
              where care_head.organization_id = parent.organization_id
                and care_head.facility_id = parent.facility_id
                and care_head.encounter_id = parent.encounter_id
                and care_head.consent_type = 'care'
                and care_event.id = ?14 and care_event.decision = 'granted'
                and care_event.effective_at <= ?5
                and (care_event.expires_at is null or care_event.expires_at > ?5)
            )
        `)
        .bind(
          amendedProtocolId,
          contentJson,
          sourceHash,
          this.scope.reviewerMembershipId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          current.protocolId,
          current.protocolVersion,
          current.sourceHash,
          current.protocolHeadVersion,
          current.encounterVersion,
          careConsent.eventId,
          this.scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          insert into protocol_amendments (
            id, organization_id, facility_id, encounter_id,
            base_protocol_version_id, amended_protocol_version_id,
            reason, amendment_text, created_by_membership_id, created_at, access_assignment_id
          )
          select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
          where exists (
            select 1 from protocol_versions version
            where version.organization_id = ?2 and version.facility_id = ?3
              and version.encounter_id = ?4 and version.id = ?6
              and version.status = 'signed'
              and version.supersedes_protocol_version_id = ?5
          )
        `)
        .bind(
          amendmentId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          current.protocolId,
          amendedProtocolId,
          reason,
          text,
          this.scope.reviewerMembershipId,
          now,
          this.scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          update protocol_heads
          set current_protocol_version_id = ?1,
            current_signed_protocol_version_id = ?1,
            lock_version = lock_version + 1, updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and encounter_id = ?5
            and current_protocol_version_id = ?6
            and current_signed_protocol_version_id = ?6
            and lock_version = ?7
            and exists (
              select 1 from protocol_amendments
              where organization_id = ?3 and facility_id = ?4
                and encounter_id = ?5 and id = ?8
                and amended_protocol_version_id = ?1
            )
        `)
        .bind(
          amendedProtocolId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          current.protocolId,
          current.protocolHeadVersion,
          amendmentId,
        ),
      this.database
        .prepare(`
          update encounters
          set status = 'amended', version = version + 1, updated_at = ?1
          where organization_id = ?2 and facility_id = ?3 and id = ?4
            and clinician_membership_id = ?5
            and status in ('finalized', 'amended') and version = ?6
            and exists (
              select 1 from protocol_amendments amendment
              join protocol_heads head
                on head.organization_id = amendment.organization_id
                and head.facility_id = amendment.facility_id
                and head.encounter_id = amendment.encounter_id
                and head.current_protocol_version_id = amendment.amended_protocol_version_id
                and head.current_signed_protocol_version_id = amendment.amended_protocol_version_id
              where amendment.organization_id = ?2 and amendment.facility_id = ?3
                and amendment.encounter_id = ?4 and amendment.id = ?7
                and amendment.created_at = ?1
            )
        `)
        .bind(
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          this.scope.reviewerMembershipId,
          current.encounterVersion,
          amendmentId,
        ),
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6,
            'protocol.amend_and_sign', 'succeeded',
            'synthetic_clinical_documentation_amendment', 1,
            'protocol_amendment', ?7, ?8, ?9, ?10, ?11, ?12
          where exists (
            select 1 from encounters encounter
            join protocol_heads head
              on head.organization_id = encounter.organization_id
              and head.facility_id = encounter.facility_id
              and head.encounter_id = encounter.id
            where encounter.organization_id = ?2 and encounter.facility_id = ?3
              and encounter.id = ?13 and encounter.status = 'amended'
              and encounter.version = ?14 and encounter.updated_at = ?12
              and head.current_signed_protocol_version_id = ?15
              and exists (
                select 1 from protocol_amendments
                where organization_id = ?2 and facility_id = ?3
                  and encounter_id = ?13 and id = ?7
                  and amended_protocol_version_id = ?15
              )
          )
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          amendmentId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          this.scope.encounterId,
          nextEncounterVersion,
          amendedProtocolId,
        ),
      this.database
        .prepare(`
          update audit_stream_heads
          set last_sequence = ?1, last_event_hash = ?2,
            lock_version = lock_version + 1, updated_at = ?3
          where organization_id = ?4 and facility_id = ?5
            and last_sequence = ?6 and lock_version = ?7
            and exists (select 1 from audit_events where id = ?8)
        `)
        .bind(
          auditSequence,
          eventHash,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          auditHead.lastSequence,
          auditHead.lockVersion,
          auditEventId,
        ),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at, access_assignment_id
          ) select ?1, ?2, ?3, ?4, 'protocol.amend', ?5, ?6,
            'processing', ?7, ?9
          where exists (select 1 from audit_events where id = ?8)
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.reviewerMembershipId,
          input.idempotencyKey,
          requestHash,
          now,
          auditEventId,
          this.scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'protocol_amendment',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(amendmentId, responseJson, now, commandId, auditEventId),
    ]);

    if (results.some((result) => result.meta.changes !== 1)) {
      throw new ProtocolAmendmentSourceChangedError(
        'Protocol amendment sources changed before commit',
      );
    }
    return result;
  }

  private async getCurrentSigned() {
    return this.database
      .prepare(`
        select version.id as protocolId, version.version as protocolVersion,
          version.content_json as contentJson, version.source_hash as sourceHash,
          head.lock_version as protocolHeadVersion,
          encounter.status as encounterStatus,
          encounter.version as encounterVersion,
          encounter.started_at as startedAt, encounter.ended_at as endedAt,
          encounter.finalized_at as finalizedAt,
          user.display_name as clinicianDisplayName
        from protocol_heads head
        join protocol_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.id = head.current_protocol_version_id
          and version.id = head.current_signed_protocol_version_id
        join encounters encounter
          on encounter.organization_id = head.organization_id
          and encounter.facility_id = head.facility_id
          and encounter.id = head.encounter_id
        join memberships membership
          on membership.organization_id = encounter.organization_id
          and membership.facility_id = encounter.facility_id
          and membership.id = encounter.clinician_membership_id
        join users user on user.id = membership.user_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3 and version.status = 'signed'
          and encounter.clinician_membership_id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        this.scope.reviewerMembershipId,
      )
      .first<CurrentSignedRow>();
  }

  private async getCareConsent() {
    return this.database
      .prepare(`
        select event.id as eventId, event.decision,
          event.effective_at as effectiveAt, event.expires_at as expiresAt
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
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .first<ConsentRow>();
  }

  private async getAuditHead() {
    return this.database
      .prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash,
          lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
  }

  private async findIdempotency(idempotencyKey: string) {
    return this.database
      .prepare(`
        select request_hash as requestHash, status, access_assignment_id as accessAssignmentId,
          result_resource_type as resultResourceType,
          result_resource_id as resultResourceId,
          response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = 'protocol.amend'
          and idempotency_key = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.reviewerMembershipId,
        idempotencyKey,
      )
      .first<IdempotencyRow>();
  }

  private async assertAuthorized(actorId: string) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
    const current = await this.getCurrentSigned();
    if (!current || !["finalized","amended"].includes(current.encounterStatus)) {
      throw new ProtocolAmendmentLifecycleError('Encounter lifecycle does not allow this command or replay');
    }
    if (!isEffective(await this.getCareConsent(), Date.now())) {
      throw new ProtocolAmendmentConsentRequiredError('Effective care consent is required');
    }
  }

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await this.assertAuthorized(actorId);
    const result = parseStoredResult(replay.responseJson);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'protocol_amendment' ||
      !replay.resultResourceId ||
      result?.transition.encounterId !== this.scope.encounterId ||
      result?.amendment.id !== replay.resultResourceId
    ) {
      throw new ProtocolAmendmentConflictError(
        'Idempotency key was already used for another amendment',
      );
    }
    return result;
  }
}
