import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import {
  assertConsentDecisionTransition,
  type ConsentDecision,
  type ConsentType,
  isConsentEffective,
} from '@/lib/domain/consent';
import { SYNTHETIC_CONSENT_POLICY } from '@/lib/policies/synthetic-consent';

export type PersistedConsent = {
  id: string;
  type: ConsentType;
  decision: ConsentDecision;
  version: number;
  noticeLanguage: 'ru' | 'kk';
  source: 'written' | 'verbal' | 'digital';
  policyVersion: string;
  policyHash: string;
  externalProcessor: string | null;
  capturedBy: string;
  occurredAt: number;
  effectiveAt: number;
  expiresAt: number | null;
};

export type RecordConsentCommand = {
  consentType: ConsentType;
  decision: ConsentDecision;
  noticeLanguage: 'ru' | 'kk';
  source: 'written' | 'verbal' | 'digital';
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

type ConsentRow = {
  id: string;
  type: ConsentType;
  decision: ConsentDecision;
  version: number;
  noticeLanguage: 'ru' | 'kk';
  source: 'written' | 'verbal' | 'digital';
  policyVersion: string;
  policyHash: string;
  externalProcessor: string | null;
  capturedBy: string;
  occurredAt: number;
  effectiveAt: number;
  expiresAt: number | null;
  currentEventId: string;
  lockVersion: number;
};

type EncounterPatientRow = {
  patientId: string;
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
};

export class ConsentConflictError extends Error {}
export class ConsentValidationError extends Error {}
export class ConsentEncounterNotFoundError extends Error {}

function mapConsent(row: ConsentRow): PersistedConsent {
  return {
    id: row.id,
    type: row.type,
    decision: row.decision,
    version: row.version,
    noticeLanguage: row.noticeLanguage,
    source: row.source,
    policyVersion: row.policyVersion,
    policyHash: row.policyHash,
    externalProcessor: row.externalProcessor,
    capturedBy: row.capturedBy,
    occurredAt: row.occurredAt,
    effectiveAt: row.effectiveAt,
    expiresAt: row.expiresAt,
  };
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

export class D1ConsentRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async listCurrent() {
    const result = await this.database
      .prepare(`
        select
          event.id,
          event.consent_type as type,
          event.decision,
          event.version,
          event.notice_language as noticeLanguage,
          event.source,
          event.policy_version as policyVersion,
          event.policy_hash as policyHash,
          event.external_processor as externalProcessor,
          user.display_name as capturedBy,
          event.occurred_at as occurredAt,
          event.effective_at as effectiveAt,
          event.expires_at as expiresAt,
          head.current_consent_event_id as currentEventId,
          head.lock_version as lockVersion
        from consent_heads head
        join consent_events event
          on event.organization_id = head.organization_id
          and event.facility_id = head.facility_id
          and event.patient_id = head.patient_id
          and event.encounter_id = head.encounter_id
          and event.consent_type = head.consent_type
          and event.id = head.current_consent_event_id
        join memberships membership
          on membership.organization_id = event.organization_id
          and membership.facility_id = event.facility_id
          and membership.id = event.captured_by_membership_id
        join users user on user.id = membership.user_id
        where head.organization_id = ?1
          and head.facility_id = ?2
          and head.encounter_id = ?3
        order by case event.consent_type
          when 'care' then 1
          when 'transient_audio_processing' then 2
          when 'audio_retention' then 3
          when 'transcript_storage' then 4
          when 'external_ai_processing' then 5
          when 'data_exchange' then 6
          when 'notifications' then 7
          else 99 end
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<ConsentRow>();

    return result.results.map(mapConsent);
  }

  async hasEffectiveConsent(type: ConsentType, at = Date.now()) {
    const current = await this.getCurrent(type);
    return isConsentEffective(current ? mapConsent(current) : null, at);
  }

  async recordCommand(input: RecordConsentCommand) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, input.actorId);
    const requestHash = await sha256(
      JSON.stringify({
        accessAssignmentId: this.scope.accessAssignmentId,
        encounterId: this.scope.encounterId,
        consentType: input.consentType,
        decision: input.decision,
        noticeLanguage: input.noticeLanguage,
        source: input.source,
        expectedVersion: input.expectedVersion,
        policyVersion: SYNTHETIC_CONSENT_POLICY.version,
        policyHash: SYNTHETIC_CONSENT_POLICY.sha256,
        externalProcessor:
          input.consentType === 'external_ai_processing' ? 'groq' : null,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash, input.actorId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assertCurrentEncounterWriteAccess(this.database, this.scope, input.actorId);
      const [encounter, current, auditHead] = await Promise.all([
        this.getEncounterPatient(),
        this.getCurrent(input.consentType),
        this.getAuditHead(),
      ]);

      if (!encounter) {
        throw new ConsentEncounterNotFoundError('Encounter was not found');
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');

      const currentVersion = current?.lockVersion ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw new ConsentConflictError('Consent changed on the server');
      }

      try {
        assertConsentDecisionTransition(
          current?.decision ?? null,
          input.decision,
        );
      } catch {
        throw new ConsentValidationError('Consent transition is invalid');
      }

      try {
        return await this.commitCommand({
          input,
          requestHash,
          patientId: encounter.patientId,
          current,
          auditHead,
        });
      } catch (error) {
        await assertCurrentEncounterWriteAccess(this.database, this.scope, input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input.actorId);

        const latest = await this.getCurrent(input.consentType);
        if ((latest?.lockVersion ?? 0) !== input.expectedVersion) {
          throw new ConsentConflictError('Consent changed on the server');
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Consent command retry was exhausted');
  }

  private async commitCommand(args: {
    input: RecordConsentCommand;
    requestHash: string;
    patientId: string;
    current: ConsentRow | null;
    auditHead: AuditHeadRow;
  }) {
    const { input, requestHash, patientId, current, auditHead } = args;
    const now = Date.now();
    const eventId = `consent-${crypto.randomUUID()}`;
    const headId = `consent-head-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const nextVersion = (current?.lockVersion ?? 0) + 1;
    const externalProcessor =
      input.consentType === 'external_ai_processing' ? 'groq' : null;
    const auditSequence = auditHead.lastSequence + 1;
    const auditMetadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      consentType: input.consentType,
      decision: input.decision,
      previousVersion: input.expectedVersion,
      resultingVersion: nextVersion,
      policyVersion: SYNTHETIC_CONSENT_POLICY.version,
      policyHash: SYNTHETIC_CONSENT_POLICY.sha256,
      noticeLanguage: input.noticeLanguage,
      source: input.source,
      externalProcessor,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: `consent.${input.decision}`,
      outcome: 'succeeded',
      purpose: 'synthetic_consent_capture',
      schemaVersion: 1,
      entityType: 'consent_event',
      entityId: eventId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const insertEvent = current
      ? this.database
          .prepare(`
            insert into consent_events (
              id, organization_id, facility_id, patient_id, encounter_id,
              version, consent_type, decision, captured_by_membership_id,
              policy_version, policy_hash, notice_language, external_processor, source,
              occurred_at, effective_at, supersedes_consent_event_id, created_at, access_assignment_id
            )
            select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
              ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?20
            from consent_heads
            where organization_id = ?2 and facility_id = ?3
              and patient_id = ?4 and encounter_id = ?5 and consent_type = ?7
              and current_consent_event_id = ?17 and lock_version = ?19
          `)
          .bind(
            eventId,
            this.scope.organizationId,
            this.scope.facilityId,
            patientId,
            this.scope.encounterId,
            nextVersion,
            input.consentType,
            input.decision,
            this.scope.reviewerMembershipId,
            SYNTHETIC_CONSENT_POLICY.version,
            SYNTHETIC_CONSENT_POLICY.sha256,
            input.noticeLanguage,
            externalProcessor,
            input.source,
            now,
            now,
            current.currentEventId,
            now,
            input.expectedVersion,
            this.scope.accessAssignmentId!,
          )
      : this.database
          .prepare(`
            insert into consent_events (
              id, organization_id, facility_id, patient_id, encounter_id,
              version, consent_type, decision, captured_by_membership_id,
              policy_version, policy_hash, notice_language, external_processor, source,
              occurred_at, effective_at, created_at, access_assignment_id
            ) values (
              ?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8,
              ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
            )
          `)
          .bind(
            eventId,
            this.scope.organizationId,
            this.scope.facilityId,
            patientId,
            this.scope.encounterId,
            input.consentType,
            input.decision,
            this.scope.reviewerMembershipId,
            SYNTHETIC_CONSENT_POLICY.version,
            SYNTHETIC_CONSENT_POLICY.sha256,
            input.noticeLanguage,
            externalProcessor,
            input.source,
            now,
            now,
            now,
            this.scope.accessAssignmentId!,
          );

    const advanceHead = current
      ? this.database
          .prepare(`
            update consent_heads
            set current_consent_event_id = ?1,
              lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4
              and patient_id = ?5 and encounter_id = ?6 and consent_type = ?7
              and current_consent_event_id = ?8 and lock_version = ?9
              and exists (select 1 from consent_events where id = ?1)
          `)
          .bind(
            eventId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            patientId,
            this.scope.encounterId,
            input.consentType,
            current.currentEventId,
            input.expectedVersion,
          )
      : this.database
          .prepare(`
            insert into consent_heads (
              id, organization_id, facility_id, patient_id, encounter_id,
              consent_type, current_consent_event_id, lock_version,
              created_at, updated_at
            ) select ?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8
            where exists (select 1 from consent_events where id = ?7)
          `)
          .bind(
            headId,
            this.scope.organizationId,
            this.scope.facilityId,
            patientId,
            this.scope.encounterId,
            input.consentType,
            eventId,
            now,
          );

    await assertCurrentEncounterWriteAccess(this.database, this.scope, input.actorId);
    const results = await this.database.batch([
      insertEvent,
      advanceHead,
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
            'synthetic_consent_capture', 1, 'consent_event', ?8, ?9,
            ?10, ?11, ?12, ?13
          where exists (select 1 from consent_events where id = ?8)
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          `consent.${input.decision}`,
          eventId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
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
          ) select ?1, ?2, ?3, ?4, 'consent.command', ?5, ?6,
            'processing', ?8, ?10
          where exists (select 1 from consent_events where id = ?7)
            and exists (select 1 from audit_events where id = ?9)
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.reviewerMembershipId,
          input.idempotencyKey,
          requestHash,
          eventId,
          now,
          auditEventId,
          this.scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded',
            result_resource_type = 'consent_event',
            result_resource_id = ?1,
            response_json = ?2,
            completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from consent_events where id = ?1)
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(
          eventId,
          JSON.stringify({ resourceEventId: eventId }),
          now,
          commandId,
          auditEventId,
        ),
    ]);

    if (results.some((result) => result.meta.changes !== 1)) {
      throw new ConsentConflictError('Consent command was not committed');
    }

    const committed = await this.getByEventId(eventId);
    if (!committed) throw new Error('Committed consent is unavailable');
    return mapConsent(committed);
  }

  private async getEncounterPatient() {
    return this.database
      .prepare(`
        select patient_id as patientId
        from encounters
        where organization_id = ?1 and facility_id = ?2 and id = ?3
          and clinician_membership_id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        this.scope.reviewerMembershipId,
      )
      .first<EncounterPatientRow>();
  }

  private async getCurrent(type: ConsentType) {
    return this.database
      .prepare(`
        select
          event.id,
          event.consent_type as type,
          event.decision,
          event.version,
          event.notice_language as noticeLanguage,
          event.source,
          event.policy_version as policyVersion,
          event.policy_hash as policyHash,
          event.external_processor as externalProcessor,
          user.display_name as capturedBy,
          event.occurred_at as occurredAt,
          event.effective_at as effectiveAt,
          event.expires_at as expiresAt,
          head.current_consent_event_id as currentEventId,
          head.lock_version as lockVersion
        from consent_heads head
        join consent_events event on event.id = head.current_consent_event_id
        join memberships membership
          on membership.organization_id = event.organization_id
          and membership.facility_id = event.facility_id
          and membership.id = event.captured_by_membership_id
        join users user on user.id = membership.user_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3 and head.consent_type = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        type,
      )
      .first<ConsentRow>();
  }

  private async getByEventId(eventId: string) {
    return this.database
      .prepare(`
        select
          event.id,
          event.consent_type as type,
          event.decision,
          event.version,
          event.notice_language as noticeLanguage,
          event.source,
          event.policy_version as policyVersion,
          event.policy_hash as policyHash,
          event.external_processor as externalProcessor,
          user.display_name as capturedBy,
          event.occurred_at as occurredAt,
          event.effective_at as effectiveAt,
          event.expires_at as expiresAt,
          event.id as currentEventId,
          event.version as lockVersion
        from consent_events event
        join memberships membership
          on membership.organization_id = event.organization_id
          and membership.facility_id = event.facility_id
          and membership.id = event.captured_by_membership_id
        join users user on user.id = membership.user_id
        where event.organization_id = ?1 and event.facility_id = ?2
          and event.encounter_id = ?3 and event.id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        eventId,
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
          result_resource_id as resultResourceId
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = 'consent.command'
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

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'consent_event' ||
      !replay.resultResourceId
    ) {
      throw new ConsentConflictError(
        'Idempotency key was already used for another consent command',
      );
    }

    const event = await this.getByEventId(replay.resultResourceId);
    if (!event) throw new Error('Stored consent result is unavailable');
    return mapConsent(event);
  }
}
