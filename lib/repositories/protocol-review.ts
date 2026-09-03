import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import {
  getProtocolReadiness,
  type ClinicalSectionCode,
  type ClinicalSectionReviewState,
  type EncounterStatus,
} from '@/lib/domain/encounter';

type EncounterSnapshot = {
  encounterId: string;
  patientId: string;
  status: EncounterStatus;
  version: number;
  reasonForVisit: string | null;
  startedAt: number | null;
  endedAt: number | null;
  patientMedicalRecordNumber: string;
  patientDisplayName: string;
  patientBirthDate: string | null;
  patientSexAtBirth: 'female' | 'male' | 'unknown' | 'not_recorded';
};

type SectionSnapshot = {
  sourceVersionId: string;
  code: ClinicalSectionCode;
  version: number;
  content: string;
  reviewState: ClinicalSectionReviewState;
  reviewedByMembershipId: string | null;
  reviewedAt: number | null;
};

type TranscriptSnapshot = {
  sourceVersionId: string;
  segmentIndex: number;
  version: number;
  role: 'doctor' | 'patient' | 'other' | 'unknown';
  roleSource: 'unassigned' | 'model' | 'voice_calibration' | 'manual';
  language: 'ru' | 'kk' | 'mixed' | 'unknown';
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  state: 'provisional' | 'final' | 'corrected';
};

type RecommendationEvidenceSnapshot = {
  sourceId: string;
  quote?: string;
};

export type RecommendationSnapshot = {
  sourceSuggestionId: string;
  sourceAnalysisRunId: string;
  sourceDecisionId: string;
  sourceDerivativeVersionId: string | null;
  state: 'accepted' | 'edited_and_accepted';
  original: {
    title: string;
    content: string;
    evidence: RecommendationEvidenceSnapshot[];
  };
  effective: {
    title: string;
    content: string;
    evidence: RecommendationEvidenceSnapshot[];
  };
  provenance: {
    provider: string;
    model: string;
    modelVersion: string;
    policyVersion: string;
    inputHash: string;
    sourceRecordIds: string[];
  };
  reviewedByMembershipId: string;
  reviewedByDisplayName: string;
  reviewedAt: number;
};

type RecommendationSnapshotRow = {
  sourceSuggestionId: string;
  sourceAnalysisRunId: string;
  sourceDecisionId: string;
  sourceDerivativeVersionId: string | null;
  state: 'accepted' | 'edited_and_accepted';
  originalTitle: string;
  originalContent: string;
  originalEvidenceJson: string;
  derivativeTitle: string | null;
  derivativeContent: string | null;
  derivativeEvidenceJson: string | null;
  legacyEditedContent: string | null;
  provider: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  inputHash: string;
  sourceRecordIdsJson: string;
  reviewedByMembershipId: string;
  reviewedByDisplayName: string;
  reviewedAt: number;
};

type ConsentSnapshot = {
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
  requestHash: string;
  status: string;
  resultResourceType: string | null;
  resultResourceId: string | null;
  responseJson: string | null;
};

export type ProtocolVersionSummary = {
  id: string;
  version: number;
  status: 'draft' | 'signed';
  sourceHash: string;
  createdAt: number;
  signedAt: number | null;
  headVersion: number;
};

export type ProtocolDraftSummary = Omit<
  ProtocolVersionSummary,
  'status' | 'signedAt'
> & {
  status: 'draft';
  signedAt: null;
};

export type BeginProtocolReviewResult = {
  protocol: ProtocolDraftSummary;
  transition: {
    encounterId: string;
    status: 'review';
    version: number;
    startedAt: number | null;
    endedAt: number;
    updatedAt: number;
  };
};

export type BeginProtocolReviewCommand = {
  expectedEncounterVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export class ProtocolReviewConflictError extends Error {}
export class ProtocolReviewConsentRequiredError extends Error {}
export class ProtocolReviewLifecycleError extends Error {}
export class ProtocolReviewNotFoundError extends Error {}

export class ProtocolReviewReadinessError extends Error {
  constructor(readonly unresolved: ClinicalSectionCode[]) {
    super('Mandatory clinical sections require clinician review');
  }
}

export class ProtocolTranscriptReadinessError extends Error {
  constructor(readonly unresolvedSegmentIndexes: number[]) {
    super('Transcript contains provisional or unassigned speaker segments');
  }
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

function isEffective(consent: ConsentSnapshot | null, at: number) {
  return Boolean(
    consent &&
      consent.decision === 'granted' &&
      consent.effectiveAt <= at &&
      (consent.expiresAt === null || consent.expiresAt > at),
  );
}

function parseEvidence(value: string): RecommendationEvidenceSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('sourceId' in item) ||
        typeof item.sourceId !== 'string'
      ) {
        return [];
      }
      const quote =
        'quote' in item && typeof item.quote === 'string'
          ? item.quote
          : undefined;
      return [{ sourceId: item.sourceId, ...(quote ? { quote } : {}) }];
    });
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapRecommendationSnapshot(
  row: RecommendationSnapshotRow,
): RecommendationSnapshot {
  const originalEvidence = parseEvidence(row.originalEvidenceJson);
  const effectiveContent =
    row.state === 'accepted'
      ? row.originalContent
      : row.derivativeContent ?? row.legacyEditedContent;
  if (!effectiveContent) {
    throw new ProtocolReviewConflictError(
      'Accepted clinician recommendation has no immutable content',
    );
  }
  return {
    sourceSuggestionId: row.sourceSuggestionId,
    sourceAnalysisRunId: row.sourceAnalysisRunId,
    sourceDecisionId: row.sourceDecisionId,
    sourceDerivativeVersionId: row.sourceDerivativeVersionId,
    state: row.state,
    original: {
      title: row.originalTitle,
      content: row.originalContent,
      evidence: originalEvidence,
    },
    effective: {
      title:
        row.state === 'accepted'
          ? row.originalTitle
          : row.derivativeTitle ?? row.originalTitle,
      content: effectiveContent,
      evidence: row.derivativeEvidenceJson
        ? parseEvidence(row.derivativeEvidenceJson)
        : originalEvidence,
    },
    provenance: {
      provider: row.provider,
      model: row.model,
      modelVersion: row.modelVersion,
      policyVersion: row.policyVersion,
      inputHash: row.inputHash,
      sourceRecordIds: parseStringArray(row.sourceRecordIdsJson),
    },
    reviewedByMembershipId: row.reviewedByMembershipId,
    reviewedByDisplayName: row.reviewedByDisplayName,
    reviewedAt: row.reviewedAt,
  };
}

function parseStoredResult(value: string | null) {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as BeginProtocolReviewResult;
    if (
      candidate.protocol?.status !== 'draft' ||
      typeof candidate.protocol.id !== 'string' ||
      typeof candidate.protocol.version !== 'number' ||
      typeof candidate.protocol.sourceHash !== 'string' ||
      typeof candidate.protocol.createdAt !== 'number' ||
      candidate.protocol.signedAt !== null ||
      typeof candidate.protocol.headVersion !== 'number' ||
      candidate.transition?.status !== 'review' ||
      typeof candidate.transition.encounterId !== 'string' ||
      typeof candidate.transition.version !== 'number' ||
      typeof candidate.transition.endedAt !== 'number' ||
      typeof candidate.transition.updatedAt !== 'number'
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export class D1ProtocolReviewRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async getCurrentSummary(): Promise<ProtocolVersionSummary | null> {
    return this.database
      .prepare(`
        select version.id, version.version, version.status,
          version.source_hash as sourceHash, version.created_at as createdAt,
          version.signed_at as signedAt, head.lock_version as headVersion
        from protocol_heads head
        join protocol_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.id = head.current_protocol_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .first<ProtocolVersionSummary>();
  }

  async beginReview(input: BeginProtocolReviewCommand) {
    const requestHash = await sha256(
      JSON.stringify({
        encounterId: this.scope.encounterId,
        expectedEncounterVersion: input.expectedEncounterVersion,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = Date.now();
      const [
        encounter,
        sections,
        recommendations,
        careConsent,
        transcriptConsent,
        auditHead,
        protocol,
      ] =
        await Promise.all([
          this.getEncounter(),
          this.getSections(),
          this.getAcceptedRecommendations(),
          this.getConsent('care'),
          this.getConsent('transcript_storage'),
          this.getAuditHead(),
          this.getCurrentSummary(),
        ]);

      if (!encounter) throw new ProtocolReviewNotFoundError('Encounter not found');
      if (encounter.version !== input.expectedEncounterVersion || protocol) {
        throw new ProtocolReviewConflictError('Encounter or protocol changed');
      }
      if (encounter.status !== 'in_progress') {
        throw new ProtocolReviewLifecycleError('Encounter is not in progress');
      }
      if (!isEffective(careConsent, now)) {
        throw new ProtocolReviewConsentRequiredError('Care consent is required');
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');

      const readiness = getProtocolReadiness(
        sections.map((section) => ({
          code: section.code,
          state: section.reviewState,
        })),
      );
      if (!readiness.ready) {
        throw new ProtocolReviewReadinessError(readiness.unresolved);
      }

      const includeTranscript = isEffective(transcriptConsent, now);
      const transcript = includeTranscript ? await this.getTranscript() : [];
      const unresolvedTranscript = transcript
        .filter(
          (segment) =>
            segment.state === 'provisional' || segment.role === 'unknown',
        )
        .map((segment) => segment.segmentIndex);
      if (unresolvedTranscript.length > 0) {
        throw new ProtocolTranscriptReadinessError(unresolvedTranscript);
      }

      try {
        return await this.commit({
          input,
          requestHash,
          now,
          encounter,
          sections,
          recommendations,
          transcript,
          careConsent: careConsent!,
          transcriptConsent,
          includeTranscript,
          auditHead,
        });
      } catch (error) {
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash);

        const latest = await this.getEncounter();
        if (!latest || latest.version !== input.expectedEncounterVersion) {
          throw new ProtocolReviewConflictError('Encounter changed');
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Protocol review retry was exhausted');
  }

  private async commit(args: {
    input: BeginProtocolReviewCommand;
    requestHash: string;
    now: number;
    encounter: EncounterSnapshot;
    sections: SectionSnapshot[];
    recommendations: RecommendationSnapshot[];
    transcript: TranscriptSnapshot[];
    careConsent: ConsentSnapshot;
    transcriptConsent: ConsentSnapshot | null;
    includeTranscript: boolean;
    auditHead: AuditHeadRow;
  }) {
    const {
      input,
      requestHash,
      now,
      encounter,
      sections,
      recommendations,
      transcript,
      careConsent,
      transcriptConsent,
      includeTranscript,
      auditHead,
    } = args;
    const protocolId = `protocol-${crypto.randomUUID()}`;
    const protocolHeadId = `protocol-head-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const endedAt = Math.max(now, encounter.startedAt ?? now);
    const content = {
      schemaVersion: 1,
      dataMode: 'synthetic-only',
      encounter: {
        id: encounter.encounterId,
        sourceVersion: encounter.version,
        reasonForVisit: encounter.reasonForVisit,
        startedAt: encounter.startedAt,
        endedAt,
      },
      patient: {
        medicalRecordNumber: encounter.patientMedicalRecordNumber,
        displayName: encounter.patientDisplayName,
        birthDate: encounter.patientBirthDate,
        sexAtBirth: encounter.patientSexAtBirth,
      },
      clinicianMembershipId: this.scope.reviewerMembershipId,
      sections,
      recommendations,
      transcript: {
        included: includeTranscript,
        consentEventId: includeTranscript ? transcriptConsent?.eventId ?? null : null,
        segments: transcript,
      },
    };
    const contentJson = JSON.stringify(content);
    const sourceHash = await sha256(contentJson);
    const nextEncounterVersion = encounter.version + 1;
    const auditSequence = auditHead.lastSequence + 1;
    const result: BeginProtocolReviewResult = {
      protocol: {
        id: protocolId,
        version: 1,
        status: 'draft',
        sourceHash,
        createdAt: now,
        signedAt: null,
        headVersion: 1,
      },
      transition: {
        encounterId: encounter.encounterId,
        status: 'review',
        version: nextEncounterVersion,
        startedAt: encounter.startedAt,
        endedAt,
        updatedAt: now,
      },
    };
    const responseJson = JSON.stringify(result);
    const auditMetadata = JSON.stringify({
      sourceHash,
      protocolVersion: 1,
      previousEncounterVersion: encounter.version,
      resultingEncounterVersion: nextEncounterVersion,
      sectionVersionIds: sections.map((section) => section.sourceVersionId),
      recommendationDecisionIds: recommendations.map(
        (recommendation) => recommendation.sourceDecisionId,
      ),
      recommendationDerivativeVersionIds: recommendations.flatMap(
        (recommendation) =>
          recommendation.sourceDerivativeVersionId
            ? [recommendation.sourceDerivativeVersionId]
            : [],
      ),
      transcriptIncluded: includeTranscript,
      transcriptSegmentVersionIds: transcript.map(
        (segment) => segment.sourceVersionId,
      ),
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: 'protocol.draft.create_and_begin_review',
      outcome: 'succeeded',
      purpose: 'synthetic_clinical_documentation_review',
      schemaVersion: 1,
      entityType: 'protocol_version',
      entityId: protocolId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const sectionIds = sections.map((section) => section.sourceVersionId);
    const sectionPlaceholders = sectionIds.map(() => '?').join(', ');
    const transcriptIds = transcript.map((segment) => segment.sourceVersionId);
    const transcriptPlaceholders = transcriptIds.map(() => '?').join(', ');
    const recommendationDecisionIds = recommendations.map(
      (recommendation) => recommendation.sourceDecisionId,
    );
    const recommendationPlaceholders = recommendationDecisionIds
      .map(() => '?')
      .join(', ');
    const recommendationGate = `
      and ? = (
        select count(*) from suggestion_review_heads recommendation_head
        where recommendation_head.organization_id = encounter.organization_id
          and recommendation_head.facility_id = encounter.facility_id
          and recommendation_head.encounter_id = encounter.id
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
        where recommendation_head.organization_id = encounter.organization_id
          and recommendation_head.facility_id = encounter.facility_id
          and recommendation_head.encounter_id = encounter.id
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
    const transcriptGate = includeTranscript
      ? `
          and exists (
            select 1 from consent_heads transcript_head
            join consent_events transcript_event
              on transcript_event.id = transcript_head.current_consent_event_id
              and transcript_event.organization_id = transcript_head.organization_id
              and transcript_event.facility_id = transcript_head.facility_id
              and transcript_event.encounter_id = transcript_head.encounter_id
            where transcript_head.organization_id = encounter.organization_id
              and transcript_head.facility_id = encounter.facility_id
              and transcript_head.encounter_id = encounter.id
              and transcript_head.consent_type = 'transcript_storage'
              and transcript_event.id = ? and transcript_event.decision = 'granted'
              and transcript_event.effective_at <= ?
              and (transcript_event.expires_at is null or transcript_event.expires_at > ?)
          )
          and ? = (
            select count(*) from transcript_segments segment
            where segment.organization_id = encounter.organization_id
              and segment.facility_id = encounter.facility_id
              and segment.encounter_id = encounter.id
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
            where segment.organization_id = encounter.organization_id
              and segment.facility_id = encounter.facility_id
              and segment.encounter_id = encounter.id
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
            where transcript_head.organization_id = encounter.organization_id
              and transcript_head.facility_id = encounter.facility_id
              and transcript_head.encounter_id = encounter.id
              and transcript_head.consent_type = 'transcript_storage'
              and transcript_event.decision = 'granted'
              and transcript_event.effective_at <= ?
              and (transcript_event.expires_at is null or transcript_event.expires_at > ?)
          )`;

    const protocolInsertBindings: unknown[] = [
      protocolId,
      contentJson,
      sourceHash,
      this.scope.reviewerMembershipId,
      now,
      this.scope.organizationId,
      this.scope.facilityId,
      this.scope.encounterId,
      this.scope.reviewerMembershipId,
      encounter.version,
      careConsent.eventId,
      now,
      now,
      ...sectionIds,
      recommendations.length,
      recommendations.length,
      ...recommendationDecisionIds,
    ];
    if (includeTranscript) {
      protocolInsertBindings.push(
        transcriptConsent!.eventId,
        now,
        now,
        transcriptIds.length,
        transcriptIds.length,
        ...transcriptIds,
      );
    } else {
      protocolInsertBindings.push(now, now);
    }

    const batchResults = await this.database.batch([
      this.database
        .prepare(`
          insert into protocol_versions (
            id, organization_id, facility_id, encounter_id, version, status,
            content_json, source_hash, created_by_membership_id, created_at
          )
          select ?, encounter.organization_id, encounter.facility_id,
            encounter.id, 1, 'draft', ?, ?, ?, ?
          from encounters encounter
          where encounter.organization_id = ? and encounter.facility_id = ?
            and encounter.id = ? and encounter.clinician_membership_id = ?
            and encounter.status = 'in_progress' and encounter.version = ?
            and not exists (
              select 1 from protocol_heads head
              where head.organization_id = encounter.organization_id
                and head.facility_id = encounter.facility_id
                and head.encounter_id = encounter.id
            )
            and exists (
              select 1 from consent_heads care_head
              join consent_events care_event
                on care_event.id = care_head.current_consent_event_id
                and care_event.organization_id = care_head.organization_id
                and care_event.facility_id = care_head.facility_id
                and care_event.encounter_id = care_head.encounter_id
              where care_head.organization_id = encounter.organization_id
                and care_head.facility_id = encounter.facility_id
                and care_head.encounter_id = encounter.id
                and care_head.consent_type = 'care'
                and care_event.id = ? and care_event.decision = 'granted'
                and care_event.effective_at <= ?
                and (care_event.expires_at is null or care_event.expires_at > ?)
            )
            and 8 = (
              select count(*)
              from clinical_section_heads section_head
              join clinical_section_versions section_version
                on section_version.organization_id = section_head.organization_id
                and section_version.facility_id = section_head.facility_id
                and section_version.encounter_id = section_head.encounter_id
                and section_version.code = section_head.code
                and section_version.id = section_head.current_version_id
              where section_head.organization_id = encounter.organization_id
                and section_head.facility_id = encounter.facility_id
                and section_head.encounter_id = encounter.id
                and section_head.current_version_id in (${sectionPlaceholders})
                and section_version.review_state in ('reviewed', 'explicitly_absent')
            )
            ${recommendationGate}
            ${transcriptGate}
        `)
        .bind(...protocolInsertBindings),
      this.database
        .prepare(`
          insert into protocol_heads (
            id, organization_id, facility_id, encounter_id,
            current_protocol_version_id, lock_version, updated_at
          )
          select ?1, ?2, ?3, ?4, ?5, 1, ?6
          where exists (
            select 1 from protocol_versions
            where organization_id = ?2 and facility_id = ?3
              and encounter_id = ?4 and id = ?5 and version = 1
          )
            and not exists (
              select 1 from protocol_heads
              where organization_id = ?2 and facility_id = ?3 and encounter_id = ?4
            )
        `)
        .bind(
          protocolHeadId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          protocolId,
          now,
        ),
      this.database
        .prepare(`
          update encounters
          set status = 'review', version = version + 1,
            ended_at = coalesce(ended_at, ?1), updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and id = ?5
            and clinician_membership_id = ?6 and status = 'in_progress'
            and version = ?7
            and exists (
              select 1 from protocol_heads
              where organization_id = ?3 and facility_id = ?4
                and encounter_id = ?5 and current_protocol_version_id = ?8
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
          protocolId,
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
            'protocol.draft.create_and_begin_review', 'succeeded',
            'synthetic_clinical_documentation_review', 1, 'protocol_version',
            ?7, ?8, ?9, ?10, ?11, ?12
          where exists (
            select 1 from encounters encounter
            join protocol_heads head
              on head.organization_id = encounter.organization_id
              and head.facility_id = encounter.facility_id
              and head.encounter_id = encounter.id
            where encounter.organization_id = ?2 and encounter.facility_id = ?3
              and encounter.id = ?13 and encounter.status = 'review'
              and encounter.version = ?14 and encounter.updated_at = ?12
              and head.current_protocol_version_id = ?7
          )
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          protocolId,
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
            operation, idempotency_key, request_hash, status, created_at
          ) select ?1, ?2, ?3, ?4, 'protocol.begin_review', ?5, ?6,
            'processing', ?7
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
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'protocol_draft',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(protocolId, responseJson, now, commandId, auditEventId),
    ]);

    if (batchResults.some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new ProtocolReviewConflictError(
        'Protocol draft source changed before commit',
      );
    }
    return result;
  }

  private async getEncounter() {
    return this.database
      .prepare(`
        select encounter.id as encounterId, encounter.patient_id as patientId,
          encounter.status, encounter.version,
          encounter.reason_for_visit as reasonForVisit,
          encounter.started_at as startedAt, encounter.ended_at as endedAt,
          patient.medical_record_number as patientMedicalRecordNumber,
          patient.display_name as patientDisplayName,
          patient.birth_date as patientBirthDate,
          patient.sex_at_birth as patientSexAtBirth
        from encounters encounter
        join patients patient
          on patient.organization_id = encounter.organization_id
          and patient.facility_id = encounter.facility_id
          and patient.id = encounter.patient_id
        where encounter.organization_id = ?1 and encounter.facility_id = ?2
          and encounter.id = ?3 and encounter.clinician_membership_id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        this.scope.reviewerMembershipId,
      )
      .first<EncounterSnapshot>();
  }

  private async getSections() {
    const result = await this.database
      .prepare(`
        select version.id as sourceVersionId, version.code, version.version,
          version.content, version.review_state as reviewState,
          version.reviewed_by_membership_id as reviewedByMembershipId,
          version.reviewed_at as reviewedAt
        from clinical_section_heads head
        join clinical_section_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.code = head.code
          and version.id = head.current_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
        order by case version.code
          when 'complaints' then 1
          when 'history_of_present_illness' then 2
          when 'past_medical_history' then 3
          when 'allergy_status' then 4
          when 'objective_findings' then 5
          when 'preliminary_diagnosis' then 6
          when 'examination_plan' then 7
          when 'treatment_plan' then 8
          else 99 end
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<SectionSnapshot>();
    return result.results;
  }

  private async getAcceptedRecommendations() {
    const result = await this.database
      .prepare(`
        select suggestion.id as sourceSuggestionId,
          suggestion.analysis_run_id as sourceAnalysisRunId,
          decision.id as sourceDecisionId,
          decision.reviewed_derivative_version_id as sourceDerivativeVersionId,
          head.state,
          suggestion.title as originalTitle,
          suggestion.original_content as originalContent,
          suggestion.evidence_json as originalEvidenceJson,
          derivative.title as derivativeTitle,
          derivative.content as derivativeContent,
          derivative.evidence_json as derivativeEvidenceJson,
          decision.edited_content as legacyEditedContent,
          analysis.provider, analysis.model,
          analysis.model_version as modelVersion,
          analysis.policy_version as policyVersion,
          analysis.input_hash as inputHash,
          analysis.source_record_ids_json as sourceRecordIdsJson,
          decision.reviewer_membership_id as reviewedByMembershipId,
          reviewer.display_name as reviewedByDisplayName,
          decision.decided_at as reviewedAt
        from suggestion_review_heads head
        join clinical_suggestions suggestion
          on suggestion.organization_id = head.organization_id
          and suggestion.facility_id = head.facility_id
          and suggestion.encounter_id = head.encounter_id
          and suggestion.id = head.suggestion_id
        join analysis_runs analysis
          on analysis.organization_id = suggestion.organization_id
          and analysis.facility_id = suggestion.facility_id
          and analysis.encounter_id = suggestion.encounter_id
          and analysis.id = suggestion.analysis_run_id
        join review_decisions decision
          on decision.organization_id = head.organization_id
          and decision.facility_id = head.facility_id
          and decision.encounter_id = head.encounter_id
          and decision.suggestion_id = head.suggestion_id
          and decision.id = head.current_decision_id
        join memberships reviewer_membership
          on reviewer_membership.organization_id = decision.organization_id
          and reviewer_membership.facility_id = decision.facility_id
          and reviewer_membership.id = decision.reviewer_membership_id
        join users reviewer on reviewer.id = reviewer_membership.user_id
        left join suggestion_derivative_versions derivative
          on derivative.organization_id = decision.organization_id
          and derivative.facility_id = decision.facility_id
          and derivative.encounter_id = decision.encounter_id
          and derivative.suggestion_id = decision.suggestion_id
          and derivative.id = decision.reviewed_derivative_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
          and head.state in ('accepted', 'edited_and_accepted')
        order by suggestion.created_at, suggestion.id
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<RecommendationSnapshotRow>();
    return result.results.map(mapRecommendationSnapshot);
  }

  private async getTranscript() {
    const result = await this.database
      .prepare(`
        select segment.id as sourceVersionId,
          segment.segment_index as segmentIndex, segment.version,
          segment.speaker_role as role,
          segment.speaker_role_source as roleSource,
          segment.language_code as language, segment.text,
          segment.started_at_ms as startedAtMs,
          segment.ended_at_ms as endedAtMs, segment.state
        from transcript_segments segment
        where segment.organization_id = ?1 and segment.facility_id = ?2
          and segment.encounter_id = ?3
          and not exists (
            select 1 from transcript_segments successor
            where successor.organization_id = segment.organization_id
              and successor.facility_id = segment.facility_id
              and successor.encounter_id = segment.encounter_id
              and successor.supersedes_segment_id = segment.id
          )
        order by segment.segment_index, segment.version
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<TranscriptSnapshot>();
    return result.results;
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
      .first<ConsentSnapshot>();
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
        select request_hash as requestHash, status,
          result_resource_type as resultResourceType,
          result_resource_id as resultResourceId,
          response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = 'protocol.begin_review'
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

  private resolveReplay(replay: IdempotencyRow, requestHash: string) {
    const result = parseStoredResult(replay.responseJson);
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'protocol_draft' ||
      !replay.resultResourceId ||
      result?.protocol.id !== replay.resultResourceId
    ) {
      throw new ProtocolReviewConflictError(
        'Idempotency key was already used for another protocol command',
      );
    }
    return result;
  }
}
