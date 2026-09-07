import { z } from 'zod';
import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import type { ProtocolVersionSummary } from '@/lib/repositories/protocol-review';

const sourceSectionSchema = z.object({
  sourceVersionId: z.string().min(1),
  code: z.string().min(1),
  reviewState: z.enum(['reviewed', 'explicitly_absent']),
});

const sourceTranscriptSchema = z.object({
  sourceVersionId: z.string().min(1),
  segmentIndex: z.number().int().positive(),
  role: z.enum(['doctor', 'patient', 'other']),
  state: z.enum(['final', 'corrected']),
});

const sourceRecommendationSchema = z.object({
  sourceSuggestionId: z.string().min(1),
  sourceAnalysisRunId: z.string().min(1),
  sourceDecisionId: z.string().min(1),
  sourceDerivativeVersionId: z.string().min(1).nullable(),
  state: z.enum(['accepted', 'edited_and_accepted']),
  original: z.object({
    title: z.string(),
    content: z.string(),
    evidence: z.array(
      z.object({ sourceId: z.string().min(1), quote: z.string().optional() }),
    ),
  }),
  effective: z.object({
    title: z.string(),
    content: z.string(),
    evidence: z.array(
      z.object({ sourceId: z.string().min(1), quote: z.string().optional() }),
    ),
  }),
  provenance: z.object({
    provider: z.string(),
    model: z.string(),
    modelVersion: z.string(),
    policyVersion: z.string(),
    inputHash: z.string(),
    sourceRecordIds: z.array(z.string()),
  }),
  reviewedByMembershipId: z.string().min(1),
  reviewedByDisplayName: z.string().min(1),
  reviewedAt: z.number(),
});

const protocolContentSchema = z.object({
  schemaVersion: z.literal(1),
  dataMode: z.literal('synthetic-only'),
  sections: z.array(sourceSectionSchema).length(8),
  recommendations: z.array(sourceRecommendationSchema).default([]),
  transcript: z.object({
    included: z.boolean(),
    consentEventId: z.string().nullable(),
    segments: z.array(sourceTranscriptSchema),
  }),
});

type EncounterRow = {
  encounterId: string;
  status: string;
  version: number;
  startedAt: number | null;
  endedAt: number | null;
};

type DraftRow = {
  id: string;
  version: number;
  contentJson: string;
  sourceHash: string;
  lockVersion: number;
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

type CurrentRecommendationSourceRow = {
  sourceDecisionId: string;
  sourceDerivativeVersionId: string | null;
};

export type SignProtocolResult = {
  protocol: ProtocolVersionSummary & { status: 'signed'; signedAt: number };
  transition: {
    encounterId: string;
    status: 'finalized';
    version: number;
    startedAt: number | null;
    endedAt: number;
    finalizedAt: number;
    updatedAt: number;
  };
};

export type SignProtocolCommand = {
  protocolId: string;
  expectedProtocolVersion: number;
  expectedEncounterVersion: number;
  expectedProtocolHeadVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export class ProtocolSigningConflictError extends Error {}
export class ProtocolSigningConsentRequiredError extends Error {}
export class ProtocolSigningLifecycleError extends Error {}
export class ProtocolSigningNotFoundError extends Error {}
export class ProtocolSigningSourceChangedError extends Error {}

async function sha256(value: string) {
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

function sameIds(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameRecommendationSources(
  left: readonly CurrentRecommendationSourceRow[],
  right: readonly CurrentRecommendationSourceRow[],
) {
  const serialize = (item: CurrentRecommendationSourceRow) =>
    `${item.sourceDecisionId}\u0000${item.sourceDerivativeVersionId ?? ''}`;
  return sameIds(left.map(serialize), right.map(serialize));
}

function parseProtocolContent(value: string) {
  try {
    return protocolContentSchema.safeParse(JSON.parse(value) as unknown);
  } catch {
    return protocolContentSchema.safeParse(null);
  }
}

function parseStoredResult(value: string | null) {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as SignProtocolResult;
    if (
      result.protocol?.status !== 'signed' ||
      typeof result.protocol.id !== 'string' ||
      typeof result.protocol.version !== 'number' ||
      typeof result.protocol.sourceHash !== 'string' ||
      typeof result.protocol.createdAt !== 'number' ||
      typeof result.protocol.signedAt !== 'number' ||
      typeof result.protocol.headVersion !== 'number' ||
      result.transition?.status !== 'finalized' ||
      typeof result.transition.encounterId !== 'string' ||
      typeof result.transition.version !== 'number' ||
      typeof result.transition.endedAt !== 'number' ||
      typeof result.transition.finalizedAt !== 'number' ||
      typeof result.transition.updatedAt !== 'number'
    ) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export class D1ProtocolSigningRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async sign(input: SignProtocolCommand) {
    await this.assertAuthorized(input.actorId);
    const requestHash = await sha256(
      JSON.stringify({
        encounterId: this.scope.encounterId,
        accessAssignmentId: this.scope.accessAssignmentId,
        protocolId: input.protocolId,
        expectedProtocolVersion: input.expectedProtocolVersion,
        expectedEncounterVersion: input.expectedEncounterVersion,
        expectedProtocolHeadVersion: input.expectedProtocolHeadVersion,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash, input.actorId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertAuthorized(input.actorId);
      const now = Date.now();
      const [encounter, draft, careConsent, transcriptConsent, auditHead] =
        await Promise.all([
          this.getEncounter(),
          this.getCurrentDraft(),
          this.getConsent('care'),
          this.getConsent('transcript_storage'),
          this.getAuditHead(),
        ]);
      if (!encounter || !draft || draft.id !== input.protocolId) {
        throw new ProtocolSigningNotFoundError('Protocol draft was not found');
      }
      if (
        encounter.version !== input.expectedEncounterVersion ||
        draft.version !== input.expectedProtocolVersion ||
        draft.lockVersion !== input.expectedProtocolHeadVersion
      ) {
        throw new ProtocolSigningConflictError('Protocol or encounter changed');
      }
      if (encounter.status !== 'review') {
        throw new ProtocolSigningLifecycleError('Encounter is not in review');
      }
      if (!isEffective(careConsent, now)) {
        throw new ProtocolSigningConsentRequiredError('Care consent is required');
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');

      const parsedContent = parseProtocolContent(draft.contentJson);
      if (!parsedContent.success || (await sha256(draft.contentJson)) !== draft.sourceHash) {
        throw new ProtocolSigningSourceChangedError(
          'Protocol source snapshot is invalid',
        );
      }
      const source = parsedContent.data;
      const currentSectionIds = await this.getCurrentSectionIds();
      if (
        !sameIds(
          source.sections.map((section) => section.sourceVersionId),
          currentSectionIds,
        )
      ) {
        throw new ProtocolSigningSourceChangedError(
          'Clinical sections changed after draft creation',
        );
      }

      const sourceRecommendationSources = source.recommendations.map(
        (recommendation) => ({
          sourceDecisionId: recommendation.sourceDecisionId,
          sourceDerivativeVersionId: recommendation.sourceDerivativeVersionId,
        }),
      );
      const currentRecommendationSources =
        await this.getCurrentAcceptedRecommendationSources();
      if (
        !sameRecommendationSources(
          sourceRecommendationSources,
          currentRecommendationSources,
        )
      ) {
        throw new ProtocolSigningSourceChangedError(
          'Accepted recommendations changed after draft creation',
        );
      }

      const sourceTranscriptIds = source.transcript.segments.map(
        (segment) => segment.sourceVersionId,
      );
      if (source.transcript.included) {
        if (
          !isEffective(transcriptConsent, now) ||
          transcriptConsent?.eventId !== source.transcript.consentEventId
        ) {
          throw new ProtocolSigningConsentRequiredError(
            'Transcript storage consent changed',
          );
        }
        const currentTranscriptIds = await this.getCurrentTranscriptIds();
        if (!sameIds(sourceTranscriptIds, currentTranscriptIds)) {
          throw new ProtocolSigningSourceChangedError(
            'Transcript changed after draft creation',
          );
        }
      } else if (isEffective(transcriptConsent, now)) {
        throw new ProtocolSigningSourceChangedError(
          'Transcript consent changed after draft creation',
        );
      }

      try {
        return await this.commit({
          input,
          requestHash,
          now,
          encounter,
          draft,
          careConsent: careConsent!,
          transcriptConsent,
          sectionIds: currentSectionIds,
          recommendationDecisionIds: sourceRecommendationSources.map(
            (recommendation) => recommendation.sourceDecisionId,
          ),
          transcriptIds: sourceTranscriptIds,
          transcriptIncluded: source.transcript.included,
          auditHead,
        });
      } catch (error) {
        await this.assertAuthorized(input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input.actorId);
        const latest = await this.getEncounter();
        if (!latest || latest.version !== input.expectedEncounterVersion) {
          throw new ProtocolSigningConflictError('Encounter changed');
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Protocol signing retry was exhausted');
  }

  private async commit(args: {
    input: SignProtocolCommand;
    requestHash: string;
    now: number;
    encounter: EncounterRow;
    draft: DraftRow;
    careConsent: ConsentRow;
    transcriptConsent: ConsentRow | null;
    sectionIds: string[];
    recommendationDecisionIds: string[];
    transcriptIds: string[];
    transcriptIncluded: boolean;
    auditHead: AuditHeadRow;
  }) {
    const {
      input,
      requestHash,
      now,
      encounter,
      draft,
      careConsent,
      transcriptConsent,
      sectionIds,
      recommendationDecisionIds,
      transcriptIds,
      transcriptIncluded,
      auditHead,
    } = args;
    const signedProtocolId = `protocol-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const nextProtocolVersion = draft.version + 1;
    const nextEncounterVersion = encounter.version + 1;
    const endedAt = encounter.endedAt ?? Math.max(now, encounter.startedAt ?? now);
    const auditSequence = auditHead.lastSequence + 1;
    const result: SignProtocolResult = {
      protocol: {
        id: signedProtocolId,
        version: nextProtocolVersion,
        status: 'signed',
        sourceHash: draft.sourceHash,
        createdAt: now,
        signedAt: now,
        headVersion: draft.lockVersion + 1,
      },
      transition: {
        encounterId: encounter.encounterId,
        status: 'finalized',
        version: nextEncounterVersion,
        startedAt: encounter.startedAt,
        endedAt,
        finalizedAt: now,
        updatedAt: now,
      },
    };
    const responseJson = JSON.stringify(result);
    const auditMetadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      draftProtocolVersionId: draft.id,
      signedProtocolVersionId: signedProtocolId,
      sourceHash: draft.sourceHash,
      previousProtocolVersion: draft.version,
      signedProtocolVersion: nextProtocolVersion,
      previousEncounterVersion: encounter.version,
      finalizedEncounterVersion: nextEncounterVersion,
      sectionVersionIds: sectionIds,
      recommendationDecisionIds,
      transcriptIncluded,
      transcriptSegmentVersionIds: transcriptIds,
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
      action: 'protocol.sign_and_finalize',
      outcome: 'succeeded',
      purpose: 'synthetic_clinical_documentation_signing',
      schemaVersion: 1,
      entityType: 'protocol_version',
      entityId: signedProtocolId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const sectionPlaceholders = sectionIds.map(() => '?').join(', ');
    const transcriptPlaceholders = transcriptIds.map(() => '?').join(', ');
    const recommendationPlaceholders = recommendationDecisionIds
      .map(() => '?')
      .join(', ');
    const recommendationGate = `
      and ? = (
        select count(*) from suggestion_review_heads recommendation_head
        where recommendation_head.organization_id = parent.organization_id
          and recommendation_head.facility_id = parent.facility_id
          and recommendation_head.encounter_id = parent.encounter_id
          and recommendation_head.state in ('accepted', 'edited_and_accepted')
      )
      and ? = (
        select count(*)
        from suggestion_review_heads recommendation_head
        join review_decisions recommendation_decision
          on recommendation_decision.organization_id = recommendation_head.organization_id
          and recommendation_decision.facility_id = recommendation_head.facility_id
          and recommendation_decision.encounter_id = recommendation_head.encounter_id
          and recommendation_decision.suggestion_id = recommendation_head.suggestion_id
          and recommendation_decision.id = recommendation_head.current_decision_id
        left join suggestion_derivative_heads derivative_head
          on derivative_head.organization_id = recommendation_head.organization_id
          and derivative_head.facility_id = recommendation_head.facility_id
          and derivative_head.encounter_id = recommendation_head.encounter_id
          and derivative_head.suggestion_id = recommendation_head.suggestion_id
        where recommendation_head.organization_id = parent.organization_id
          and recommendation_head.facility_id = parent.facility_id
          and recommendation_head.encounter_id = parent.encounter_id
          and recommendation_decision.id in (${recommendationPlaceholders || "''"})
          and (
            (
              recommendation_head.state = 'accepted'
              and recommendation_decision.result_state = 'accepted'
              and recommendation_decision.reviewed_derivative_version_id is null
            )
            or (
              recommendation_head.state = 'edited_and_accepted'
              and recommendation_decision.result_state = 'edited_and_accepted'
              and (
                recommendation_decision.reviewed_derivative_version_id =
                  derivative_head.current_derivative_version_id
                or (
                  recommendation_decision.reviewed_derivative_version_id is null
                  and recommendation_decision.decision = 'edit_and_accept'
                  and length(trim(coalesce(recommendation_decision.edited_content, ''))) > 0
                )
              )
            )
          )
      )`;
    const transcriptGate = transcriptIncluded
      ? `
          and exists (
            select 1 from consent_heads transcript_head
            join consent_events transcript_event
              on transcript_event.id = transcript_head.current_consent_event_id
              and transcript_event.organization_id = transcript_head.organization_id
              and transcript_event.facility_id = transcript_head.facility_id
              and transcript_event.encounter_id = transcript_head.encounter_id
            where transcript_head.organization_id = parent.organization_id
              and transcript_head.facility_id = parent.facility_id
              and transcript_head.encounter_id = parent.encounter_id
              and transcript_head.consent_type = 'transcript_storage'
              and transcript_event.id = ? and transcript_event.decision = 'granted'
              and transcript_event.effective_at <= ?
              and (transcript_event.expires_at is null or transcript_event.expires_at > ?)
          )
          and ? = (
            select count(*) from transcript_segments segment
            where segment.organization_id = parent.organization_id
              and segment.facility_id = parent.facility_id
              and segment.encounter_id = parent.encounter_id
              and not exists (
                select 1 from transcript_segments successor
                where successor.organization_id = segment.organization_id
                  and successor.facility_id = segment.facility_id
                  and successor.encounter_id = segment.encounter_id
                  and successor.supersedes_segment_id = segment.id
              )
          )
          and ? = (
            select count(*) from transcript_segments segment
            where segment.organization_id = parent.organization_id
              and segment.facility_id = parent.facility_id
              and segment.encounter_id = parent.encounter_id
              and segment.id in (${transcriptPlaceholders || "''"})
              and segment.state in ('final', 'corrected')
              and segment.speaker_role <> 'unknown'
              and not exists (
                select 1 from transcript_segments successor
                where successor.organization_id = segment.organization_id
                  and successor.facility_id = segment.facility_id
                  and successor.encounter_id = segment.encounter_id
                  and successor.supersedes_segment_id = segment.id
              )
          )`
      : `
          and not exists (
            select 1 from consent_heads transcript_head
            join consent_events transcript_event
              on transcript_event.id = transcript_head.current_consent_event_id
              and transcript_event.organization_id = transcript_head.organization_id
              and transcript_event.facility_id = transcript_head.facility_id
              and transcript_event.encounter_id = transcript_head.encounter_id
            where transcript_head.organization_id = parent.organization_id
              and transcript_head.facility_id = parent.facility_id
              and transcript_head.encounter_id = parent.encounter_id
              and transcript_head.consent_type = 'transcript_storage'
              and transcript_event.decision = 'granted'
              and transcript_event.effective_at <= ?
              and (transcript_event.expires_at is null or transcript_event.expires_at > ?)
          )`;
    const protocolBindings: unknown[] = [
      signedProtocolId,
      this.scope.reviewerMembershipId,
      this.scope.reviewerMembershipId,
      now,
      now,
      this.scope.organizationId,
      this.scope.facilityId,
      this.scope.encounterId,
      draft.id,
      draft.version,
      this.scope.reviewerMembershipId,
      encounter.version,
      draft.lockVersion,
      careConsent.eventId,
      now,
      now,
      ...sectionIds,
      recommendationDecisionIds.length,
      recommendationDecisionIds.length,
      ...recommendationDecisionIds,
    ];
    if (transcriptIncluded) {
      protocolBindings.push(
        transcriptConsent!.eventId,
        now,
        now,
        transcriptIds.length,
        transcriptIds.length,
        ...transcriptIds,
      );
    } else {
      protocolBindings.push(now, now);
    }

    await this.assertAuthorized(input.actorId);
    const batchResults = await this.database.batch([
      this.database
        .prepare(`
          insert into protocol_versions (
            id, organization_id, facility_id, encounter_id, version, status,
            content_json, source_hash, created_by_membership_id,
            signed_by_membership_id, signed_at, supersedes_protocol_version_id,
            created_at
          )
          select ?, parent.organization_id, parent.facility_id,
            parent.encounter_id, parent.version + 1, 'signed',
            parent.content_json, parent.source_hash, ?, ?, ?, parent.id, ?
          from protocol_versions parent
          join protocol_heads head
            on head.organization_id = parent.organization_id
            and head.facility_id = parent.facility_id
            and head.encounter_id = parent.encounter_id
            and head.current_protocol_version_id = parent.id
          join encounters encounter
            on encounter.organization_id = parent.organization_id
            and encounter.facility_id = parent.facility_id
            and encounter.id = parent.encounter_id
          where parent.organization_id = ? and parent.facility_id = ?
            and parent.encounter_id = ? and parent.id = ?
            and parent.status = 'draft' and parent.version = ?
            and encounter.clinician_membership_id = ?
            and encounter.status = 'review' and encounter.version = ?
            and head.lock_version = ?
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
                and care_event.id = ? and care_event.decision = 'granted'
                and care_event.effective_at <= ?
                and (care_event.expires_at is null or care_event.expires_at > ?)
            )
            and 8 = (
              select count(*) from clinical_section_heads section_head
              join clinical_section_versions section_version
                on section_version.organization_id = section_head.organization_id
                and section_version.facility_id = section_head.facility_id
                and section_version.encounter_id = section_head.encounter_id
                and section_version.code = section_head.code
                and section_version.id = section_head.current_version_id
              where section_head.organization_id = parent.organization_id
                and section_head.facility_id = parent.facility_id
                and section_head.encounter_id = parent.encounter_id
                and section_head.current_version_id in (${sectionPlaceholders})
                and section_version.review_state in ('reviewed', 'explicitly_absent')
            )
            ${recommendationGate}
            ${transcriptGate}
        `)
        .bind(...protocolBindings),
      this.database
        .prepare(`
          update protocol_heads
          set current_protocol_version_id = ?1,
            current_signed_protocol_version_id = ?1,
            lock_version = lock_version + 1, updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and encounter_id = ?5
            and current_protocol_version_id = ?6 and lock_version = ?7
            and exists (
              select 1 from protocol_versions
              where organization_id = ?3 and facility_id = ?4
                and encounter_id = ?5 and id = ?1 and status = 'signed'
                and supersedes_protocol_version_id = ?6
            )
        `)
        .bind(
          signedProtocolId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          draft.id,
          draft.lockVersion,
        ),
      this.database
        .prepare(`
          update encounters
          set status = 'finalized', version = version + 1,
            ended_at = coalesce(ended_at, ?1), finalized_at = ?2, updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and id = ?5
            and clinician_membership_id = ?6 and status = 'review' and version = ?7
            and exists (
              select 1 from protocol_heads
              where organization_id = ?3 and facility_id = ?4
                and encounter_id = ?5
                and current_protocol_version_id = ?8
                and current_signed_protocol_version_id = ?8
            )
        `)
        .bind(
          endedAt,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          this.scope.reviewerMembershipId,
          encounter.version,
          signedProtocolId,
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
            'protocol.sign_and_finalize', 'succeeded',
            'synthetic_clinical_documentation_signing', 1,
            'protocol_version', ?7, ?8, ?9, ?10, ?11, ?12
          where exists (
            select 1 from encounters encounter
            join protocol_heads head
              on head.organization_id = encounter.organization_id
              and head.facility_id = encounter.facility_id
              and head.encounter_id = encounter.id
            where encounter.organization_id = ?2 and encounter.facility_id = ?3
              and encounter.id = ?13 and encounter.status = 'finalized'
              and encounter.version = ?14 and encounter.updated_at = ?12
              and head.current_signed_protocol_version_id = ?7
          )
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          signedProtocolId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          this.scope.encounterId,
          nextEncounterVersion,
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
          ) select ?1, ?2, ?3, ?4, 'protocol.sign', ?5, ?6, 'processing', ?7, ?9
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
          set status = 'succeeded', result_resource_type = 'signed_protocol',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(signedProtocolId, responseJson, now, commandId, auditEventId),
    ]);

    if (batchResults.some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new ProtocolSigningSourceChangedError(
        'Protocol sources changed before signing commit',
      );
    }
    return result;
  }

  private async getEncounter() {
    return this.database
      .prepare(`
        select id as encounterId, status, version,
          started_at as startedAt, ended_at as endedAt
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
      .first<EncounterRow>();
  }

  private async getCurrentDraft() {
    return this.database
      .prepare(`
        select version.id, version.version,
          version.content_json as contentJson, version.source_hash as sourceHash,
          head.lock_version as lockVersion
        from protocol_heads head
        join protocol_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.id = head.current_protocol_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3 and version.status = 'draft'
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .first<DraftRow>();
  }

  private async getCurrentSectionIds() {
    const result = await this.database
      .prepare(`
        select version.id
        from clinical_section_heads head
        join clinical_section_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.code = head.code
          and version.id = head.current_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
          and version.review_state in ('reviewed', 'explicitly_absent')
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<{ id: string }>();
    return result.results.map((row) => row.id);
  }

  private async getCurrentAcceptedRecommendationSources() {
    const result = await this.database
      .prepare(`
        select decision.id as sourceDecisionId,
          decision.reviewed_derivative_version_id as sourceDerivativeVersionId
        from suggestion_review_heads head
        join review_decisions decision
          on decision.organization_id = head.organization_id
          and decision.facility_id = head.facility_id
          and decision.encounter_id = head.encounter_id
          and decision.suggestion_id = head.suggestion_id
          and decision.id = head.current_decision_id
        left join suggestion_derivative_heads derivative_head
          on derivative_head.organization_id = head.organization_id
          and derivative_head.facility_id = head.facility_id
          and derivative_head.encounter_id = head.encounter_id
          and derivative_head.suggestion_id = head.suggestion_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
          and (
            (
              head.state = 'accepted'
              and decision.result_state = 'accepted'
              and decision.reviewed_derivative_version_id is null
            )
            or (
              head.state = 'edited_and_accepted'
              and decision.result_state = 'edited_and_accepted'
              and (
                decision.reviewed_derivative_version_id =
                  derivative_head.current_derivative_version_id
                or (
                  decision.reviewed_derivative_version_id is null
                  and decision.decision = 'edit_and_accept'
                  and length(trim(coalesce(decision.edited_content, ''))) > 0
                )
              )
            )
          )
        order by decision.id
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<CurrentRecommendationSourceRow>();
    return result.results;
  }

  private async getCurrentTranscriptIds() {
    const result = await this.database
      .prepare(`
        select segment.id
        from transcript_segments segment
        where segment.organization_id = ?1 and segment.facility_id = ?2
          and segment.encounter_id = ?3
          and segment.state in ('final', 'corrected')
          and segment.speaker_role <> 'unknown'
          and not exists (
            select 1 from transcript_segments successor
            where successor.organization_id = segment.organization_id
              and successor.facility_id = segment.facility_id
              and successor.encounter_id = segment.encounter_id
              and successor.supersedes_segment_id = segment.id
          )
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<{ id: string }>();
    return result.results.map((row) => row.id);
  }

  private async getConsent(type: 'care' | 'transcript_storage') {
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
          and actor_membership_id = ?3 and operation = 'protocol.sign'
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
    const current = await this.getEncounter();
    if (!current || !["review","finalized","amended"].includes(current.status)) {
      throw new ProtocolSigningLifecycleError('Encounter lifecycle does not allow this command or replay');
    }
    if (!isEffective(await this.getConsent('care'), Date.now())) {
      throw new ProtocolSigningConsentRequiredError('Effective care consent is required');
    }
  }

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await this.assertAuthorized(actorId);
    const result = parseStoredResult(replay.responseJson);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'signed_protocol' ||
      !replay.resultResourceId ||
      result?.protocol.id !== replay.resultResourceId
    ) {
      throw new ProtocolSigningConflictError(
        'Idempotency key was already used for another signing command',
      );
    }
    return result;
  }
}
