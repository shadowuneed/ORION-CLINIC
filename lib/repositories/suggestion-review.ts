import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';

export type RecommendationDecision = 'accept' | 'reject' | 'restore';
export type RecommendationState = 'pending' | 'accepted' | 'rejected' | 'expired';
export type RecommendationReviewState =
  | 'pending'
  | 'accepted'
  | 'edited_and_accepted'
  | 'rejected'
  | 'expired';
export type RecommendationEvidence = { sourceId: string; quote?: string };
export type RecommendationProvenance = {
  analysisRunId: string;
  provider: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  inputHash: string;
  sourceRecordIds: string[];
};
export type RecommendationDerivative = {
  id: string;
  version: number;
  title: string;
  content: string;
  contentHash: string;
  evidence: RecommendationEvidence[];
  provenance: RecommendationProvenance;
  reason: string;
  authoredByMembershipId: string;
  authoredByDisplayName: string;
  createdAt: number;
};
export type PersistedRecommendation = {
  id: string;
  eyebrow: string;
  tone: 'question' | 'safety' | 'action';
  original: {
    title: string;
    content: string;
    evidence: RecommendationEvidence[];
    provenance: RecommendationProvenance;
  };
  currentDerivative: RecommendationDerivative | null;
  review: {
    state: RecommendationReviewState;
    version: number;
    currentDecisionId: string | null;
    reviewedDerivativeVersionId: string | null;
    reviewerDisplayName: string | null;
    decidedAt: number | null;
  };
  effectiveContent: string | null;
  effectiveTitle: string | null;
  // Compatibility fields are removed when the Stage 3 UI consumes the rich shape.
  title: string;
  body: string;
  evidence: string;
  state: RecommendationState;
  version: number;
};
export type CreateRecommendationDerivative = {
  recommendationId: string;
  title: string;
  content: string;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};
export type RecordRecommendationDecision = {
  recommendationId: string;
  derivativeVersionId: string | null;
  decision: RecommendationDecision;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

type SuggestionRow = {
  id: string;
  category: string;
  riskLevel: string;
  title: string;
  originalContent: string;
  evidenceJson: string;
  analysisRunId: string;
  provider: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  inputHash: string;
  sourceRecordIdsJson: string;
  reviewState: string;
  reviewLockVersion: number;
  reviewUpdatedAt: number;
  currentDecisionId: string | null;
  reviewedDerivativeVersionId: string | null;
  reviewerDisplayName: string | null;
  decidedAt: number | null;
  legacyEditedContent: string | null;
  derivativeId: string | null;
  derivativeVersion: number | null;
  derivativeTitle: string | null;
  derivativeContent: string | null;
  derivativeContentHash: string | null;
  derivativeEvidenceJson: string | null;
  derivativeProvenanceJson: string | null;
  derivativeReason: string | null;
  derivativeAuthorMembershipId: string | null;
  derivativeAuthorDisplayName: string | null;
  derivativeCreatedAt: number | null;
  derivativeUpdatedAt: number | null;
  encounterStatus: string;
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
type ExistingDecisionRow = {
  suggestionId: string;
  derivativeVersionId: string | null;
  decision: string;
  expectedVersion: number;
};

export class SuggestionNotFoundError extends Error {}
export class SuggestionConflictError extends Error {}
export class SuggestionLifecycleError extends Error {}
export class SuggestionConsentRequiredError extends Error {}
export class SuggestionValidationError extends Error {}
export class SuggestionEditUnchangedError extends Error {}

export interface SuggestionReviewRepository {
  list(): Promise<PersistedRecommendation[]>;
  createDerivative(
    input: CreateRecommendationDerivative,
  ): Promise<PersistedRecommendation>;
  recordDecision(
    input: RecordRecommendationDecision,
  ): Promise<PersistedRecommendation>;
}

const suggestionSelect = `
  select suggestion.id, suggestion.category,
    suggestion.risk_level as riskLevel, suggestion.title,
    suggestion.original_content as originalContent,
    suggestion.evidence_json as evidenceJson,
    suggestion.analysis_run_id as analysisRunId,
    analysis.provider, analysis.model, analysis.model_version as modelVersion,
    analysis.policy_version as policyVersion, analysis.input_hash as inputHash,
    analysis.source_record_ids_json as sourceRecordIdsJson,
    review_head.state as reviewState,
    review_head.lock_version as reviewLockVersion,
    review_head.updated_at as reviewUpdatedAt,
    review_head.current_decision_id as currentDecisionId,
    decision.reviewed_derivative_version_id as reviewedDerivativeVersionId,
    reviewer.display_name as reviewerDisplayName,
    decision.decided_at as decidedAt,
    decision.edited_content as legacyEditedContent,
    derivative.id as derivativeId, derivative.version as derivativeVersion,
    derivative.title as derivativeTitle, derivative.content as derivativeContent,
    derivative.content_hash as derivativeContentHash,
    derivative.evidence_json as derivativeEvidenceJson,
    derivative.provenance_json as derivativeProvenanceJson,
    derivative.reason as derivativeReason,
    derivative.authored_by_membership_id as derivativeAuthorMembershipId,
    derivative_author.display_name as derivativeAuthorDisplayName,
    derivative.created_at as derivativeCreatedAt,
    derivative_head.updated_at as derivativeUpdatedAt,
    encounter.status as encounterStatus
  from clinical_suggestions suggestion
  join analysis_runs analysis
    on analysis.organization_id = suggestion.organization_id
    and analysis.facility_id = suggestion.facility_id
    and analysis.encounter_id = suggestion.encounter_id
    and analysis.id = suggestion.analysis_run_id
  join suggestion_review_heads review_head
    on review_head.organization_id = suggestion.organization_id
    and review_head.facility_id = suggestion.facility_id
    and review_head.encounter_id = suggestion.encounter_id
    and review_head.suggestion_id = suggestion.id
  join encounters encounter
    on encounter.organization_id = suggestion.organization_id
    and encounter.facility_id = suggestion.facility_id
    and encounter.id = suggestion.encounter_id
  left join review_decisions decision
    on decision.organization_id = review_head.organization_id
    and decision.facility_id = review_head.facility_id
    and decision.encounter_id = review_head.encounter_id
    and decision.suggestion_id = review_head.suggestion_id
    and decision.id = review_head.current_decision_id
  left join memberships reviewer_membership
    on reviewer_membership.organization_id = decision.organization_id
    and reviewer_membership.facility_id = decision.facility_id
    and reviewer_membership.id = decision.reviewer_membership_id
  left join users reviewer on reviewer.id = reviewer_membership.user_id
  left join suggestion_derivative_heads derivative_head
    on derivative_head.organization_id = suggestion.organization_id
    and derivative_head.facility_id = suggestion.facility_id
    and derivative_head.encounter_id = suggestion.encounter_id
    and derivative_head.suggestion_id = suggestion.id
  left join suggestion_derivative_versions derivative
    on derivative.organization_id = derivative_head.organization_id
    and derivative.facility_id = derivative_head.facility_id
    and derivative.encounter_id = derivative_head.encounter_id
    and derivative.suggestion_id = derivative_head.suggestion_id
    and derivative.id = derivative_head.current_derivative_version_id
  left join memberships derivative_author_membership
    on derivative_author_membership.organization_id = derivative.organization_id
    and derivative_author_membership.facility_id = derivative.facility_id
    and derivative_author_membership.id = derivative.authored_by_membership_id
  left join users derivative_author
    on derivative_author.id = derivative_author_membership.user_id
`;

function parseEvidence(value: string | null): RecommendationEvidence[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (
        typeof item !== 'object' || item === null ||
        !('sourceId' in item) || typeof item.sourceId !== 'string'
      ) return [];
      const quote =
        'quote' in item && typeof item.quote === 'string' ? item.quote : undefined;
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
function parseProvenance(
  value: string | null,
  fallback: RecommendationProvenance,
): RecommendationProvenance {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as Partial<RecommendationProvenance>;
    if (
      typeof parsed.analysisRunId !== 'string' ||
      typeof parsed.provider !== 'string' ||
      typeof parsed.model !== 'string' ||
      typeof parsed.modelVersion !== 'string' ||
      typeof parsed.policyVersion !== 'string' ||
      typeof parsed.inputHash !== 'string' ||
      !Array.isArray(parsed.sourceRecordIds)
    ) return fallback;
    return {
      analysisRunId: parsed.analysisRunId,
      provider: parsed.provider,
      model: parsed.model,
      modelVersion: parsed.modelVersion,
      policyVersion: parsed.policyVersion,
      inputHash: parsed.inputHash,
      sourceRecordIds: parsed.sourceRecordIds.filter(
        (item): item is string => typeof item === 'string',
      ),
    };
  } catch {
    return fallback;
  }
}
function detailState(state: string): RecommendationReviewState {
  if (state === 'accepted' || state === 'edited_and_accepted' ||
      state === 'rejected' || state === 'expired') return state;
  return 'pending';
}
function clientState(state: string): RecommendationState {
  if (state === 'accepted' || state === 'edited_and_accepted') return 'accepted';
  if (state === 'rejected' || state === 'expired') return state;
  return 'pending';
}
function toneFor(row: SuggestionRow): PersistedRecommendation['tone'] {
  if (row.category === 'safety' || row.riskLevel === 'urgent') return 'safety';
  if (row.category === 'action' || row.category === 'medication') return 'action';
  return 'question';
}
function eyebrowFor(row: SuggestionRow) {
  if (row.category === 'safety') return 'Безопасность';
  if (row.category === 'medication') return 'Лекарственный вариант';
  if (row.category === 'action') return 'Следующий шаг';
  return 'Нужно уточнить';
}
function mapSuggestion(row: SuggestionRow): PersistedRecommendation {
  const evidence = parseEvidence(row.evidenceJson);
  const provenance: RecommendationProvenance = {
    analysisRunId: row.analysisRunId,
    provider: row.provider,
    model: row.model,
    modelVersion: row.modelVersion,
    policyVersion: row.policyVersion,
    inputHash: row.inputHash,
    sourceRecordIds: parseStringArray(row.sourceRecordIdsJson),
  };
  const derivative: RecommendationDerivative | null =
    row.derivativeId && row.derivativeVersion !== null &&
    row.derivativeTitle !== null && row.derivativeContent !== null &&
    row.derivativeContentHash !== null && row.derivativeReason !== null &&
    row.derivativeAuthorMembershipId !== null &&
    row.derivativeAuthorDisplayName !== null && row.derivativeCreatedAt !== null
      ? {
          id: row.derivativeId,
          version: row.derivativeVersion,
          title: row.derivativeTitle,
          content: row.derivativeContent,
          contentHash: row.derivativeContentHash,
          evidence: parseEvidence(row.derivativeEvidenceJson),
          provenance: parseProvenance(row.derivativeProvenanceJson, provenance),
          reason: row.derivativeReason,
          authoredByMembershipId: row.derivativeAuthorMembershipId,
          authoredByDisplayName: row.derivativeAuthorDisplayName,
          createdAt: row.derivativeCreatedAt,
        }
      : null;
  const reviewState = detailState(row.reviewState);
  const effectiveContent = reviewState === 'accepted'
    ? row.originalContent
    : reviewState === 'edited_and_accepted'
      ? derivative?.content ?? row.legacyEditedContent
      : null;
  const effectiveTitle = reviewState === 'accepted'
    ? row.title
    : reviewState === 'edited_and_accepted'
      ? derivative?.title ?? row.title
      : null;
  return {
    id: row.id,
    eyebrow: eyebrowFor(row),
    tone: toneFor(row),
    original: { title: row.title, content: row.originalContent, evidence, provenance },
    currentDerivative: derivative,
    review: {
      state: reviewState,
      version: row.reviewLockVersion,
      currentDecisionId: row.currentDecisionId,
      reviewedDerivativeVersionId: row.reviewedDerivativeVersionId,
      reviewerDisplayName: row.reviewerDisplayName,
      decidedAt: row.decidedAt,
    },
    effectiveContent,
    effectiveTitle,
    title: row.title,
    body: effectiveContent ?? row.originalContent,
    evidence: evidence.find((item) => item.quote)?.quote ??
      'Основание сохранено в аудите',
    state: clientState(row.reviewState),
    version: row.reviewLockVersion,
  };
}
function normalize(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class D1SuggestionReviewRepository implements SuggestionReviewRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async list() {
    const result = await this.database.prepare(`${suggestionSelect}
      where suggestion.organization_id = ?1 and suggestion.facility_id = ?2
        and suggestion.encounter_id = ?3
      order by suggestion.created_at, suggestion.id
    `).bind(
      this.scope.organizationId, this.scope.facilityId, this.scope.encounterId,
    ).all<SuggestionRow>();
    return result.results.map(mapSuggestion);
  }

  async createDerivative(input: CreateRecommendationDerivative) {
    await this.assertWriteAccess(input.actorId);
    const title = normalize(input.title);
    const content = normalize(input.content);
    const reason = normalize(input.reason);
    this.assertDerivativeFields(title, content, reason);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertWriteAccess(input.actorId);
      const current = await this.getRow(input.recommendationId);
      if (!current) throw new SuggestionNotFoundError('Recommendation was not found');
      const requestHash = await sha256(JSON.stringify({
        accessAssignmentId: this.scope.accessAssignmentId,
        encounterId: this.scope.encounterId,
        recommendationId: input.recommendationId,
        expectedVersion: input.expectedVersion,
        title, content, reason,
        evidenceSourceIds: parseEvidence(current.evidenceJson).map((item) => item.sourceId),
        analysisRunId: current.analysisRunId,
      }));
      const replay = await this.findCommand(
        'suggestion.derivative.create', input.idempotencyKey,
      );
      if (replay) return this.resolveCommandReplay(replay, requestHash, input.actorId);

      this.assertMutable(current, input.expectedVersion);
      if (current.reviewState !== 'proposed' || current.currentDecisionId) {
        throw new SuggestionConflictError('Restore the recommendation before editing');
      }
      if (
        normalize(current.derivativeTitle ?? current.title) === title &&
        normalize(current.derivativeContent ?? current.originalContent) === content
      ) throw new SuggestionEditUnchangedError('Clinician edit is unchanged');

      const [auditHead, consent] = await Promise.all([
        this.getAuditHead(), this.hasEffectiveCareConsent(),
      ]);
      if (!auditHead) throw new Error('Audit stream is unavailable');
      if (!consent) throw new SuggestionConsentRequiredError('Care consent required');
      try {
        return await this.commitDerivative({
          input, current, auditHead, title, content, reason, requestHash,
        });
      } catch (error) {
        await this.assertWriteAccess(input.actorId);
        const raced = await this.findCommand(
          'suggestion.derivative.create', input.idempotencyKey,
        );
        if (raced) return this.resolveCommandReplay(raced, requestHash, input.actorId);
        await this.throwCurrentFailure(input.recommendationId, input.expectedVersion);
        if (attempt === 2) throw error;
      }
    }
    throw new Error('Suggestion derivative retry was exhausted');
  }

  async recordDecision(input: RecordRecommendationDecision) {
    await this.assertWriteAccess(input.actorId);
    const requestHash = await sha256(JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      encounterId: this.scope.encounterId,
      recommendationId: input.recommendationId,
      derivativeVersionId: input.derivativeVersionId,
      decision: input.decision,
      expectedVersion: input.expectedVersion,
    }));
    const replay = await this.findCommand('suggestion.decision', input.idempotencyKey);
    if (replay) return this.resolveCommandReplay(replay, requestHash, input.actorId);
    const legacy = await this.findLegacyDecision(input.idempotencyKey);
    if (legacy) return this.resolveLegacyReplay(input);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertWriteAccess(input.actorId);
      const current = await this.getRow(input.recommendationId);
      if (!current) throw new SuggestionNotFoundError('Recommendation was not found');
      this.assertMutable(current, input.expectedVersion);
      if (current.derivativeId !== input.derivativeVersionId) {
        throw new SuggestionConflictError('Decision target is not current');
      }
      this.assertTransition(current.reviewState, input.decision);
      const [auditHead, consent] = await Promise.all([
        this.getAuditHead(), this.hasEffectiveCareConsent(),
      ]);
      if (!auditHead) throw new Error('Audit stream is unavailable');
      if (!consent) throw new SuggestionConsentRequiredError('Care consent required');
      try {
        return await this.commitDecision({ input, current, auditHead, requestHash });
      } catch (error) {
        await this.assertWriteAccess(input.actorId);
        const raced = await this.findCommand('suggestion.decision', input.idempotencyKey);
        if (raced) return this.resolveCommandReplay(raced, requestHash, input.actorId);
        const racedLegacy = await this.findLegacyDecision(input.idempotencyKey);
        if (racedLegacy) return this.resolveLegacyReplay(input);
        await this.throwCurrentFailure(input.recommendationId, input.expectedVersion);
        if (attempt === 2) throw error;
      }
    }
    throw new Error('Suggestion decision retry was exhausted');
  }

  private async commitDerivative(args: {
    input: CreateRecommendationDerivative;
    current: SuggestionRow;
    auditHead: AuditHeadRow;
    title: string;
    content: string;
    reason: string;
    requestHash: string;
  }) {
    const { input, current, auditHead, title, content, reason, requestHash } = args;
    const scope = this.scope;
    const now = Math.max(
      Date.now(), current.reviewUpdatedAt + 1, (current.derivativeUpdatedAt ?? 0) + 1,
    );
    const derivativeId = `suggestion-derivative-${crypto.randomUUID()}`;
    const derivativeHeadId = `suggestion-derivative-head-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const derivativeVersion = (current.derivativeVersion ?? 0) + 1;
    const auditSequence = auditHead.lastSequence + 1;
    const contentHash = await sha256(content);
    const metadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      recommendationId: input.recommendationId,
      derivativeVersionId: derivativeId,
      derivativeVersion,
      previousDerivativeVersionId: current.derivativeId,
      previousReviewVersion: input.expectedVersion,
      resultingReviewVersion: input.expectedVersion + 1,
      contentHash,
      evidenceSourceIds: parseEvidence(current.evidenceJson).map((item) => item.sourceId),
      analysisRunId: current.analysisRunId,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: scope.organizationId,
      facilityId: scope.facilityId,
      sequence: auditSequence,
      actorType: 'user', actorId: input.actorId,
      actorMembershipId: scope.reviewerMembershipId,
      action: 'suggestion.derivative.create', outcome: 'succeeded',
      purpose: 'synthetic_clinical_review', schemaVersion: 1,
      entityType: 'suggestion_derivative_version', entityId: derivativeId,
      requestId: input.requestId, metadataJson: metadata, occurredAt: now,
    });
    const derivativeHeadStatement = current.derivativeId
      ? this.database.prepare(`
          update suggestion_derivative_heads
          set current_derivative_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and encounter_id = ?5
            and suggestion_id = ?6 and current_derivative_version_id = ?7
            and lock_version = ?8
        `).bind(
          derivativeId, now, scope.organizationId, scope.facilityId,
          scope.encounterId, input.recommendationId, current.derivativeId,
          current.derivativeVersion,
        )
      : this.database.prepare(`
          insert into suggestion_derivative_heads (
            id, organization_id, facility_id, encounter_id, suggestion_id,
            current_derivative_version_id, lock_version, updated_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
        `).bind(
          derivativeHeadId, scope.organizationId, scope.facilityId,
          scope.encounterId, input.recommendationId, derivativeId, now,
        );

    await this.assertWriteAccess(input.actorId);
    const results = await this.database.batch([
      this.database.prepare(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id, operation,
          idempotency_key, request_hash, status, created_at, access_assignment_id
        ) values (?1, ?2, ?3, ?4, 'suggestion.derivative.create', ?5, ?6,
          'processing', ?7, ?8)
      `).bind(
        commandId, scope.organizationId, scope.facilityId,
        scope.reviewerMembershipId, input.idempotencyKey, requestHash, now,
        scope.accessAssignmentId!,
      ),
      this.database.prepare(`
        insert into suggestion_derivative_versions (
          id, organization_id, facility_id, encounter_id, suggestion_id,
          version, title, content, content_hash, evidence_json, provenance_json,
          reason, authored_by_membership_id, supersedes_derivative_version_id,
          created_at, access_assignment_id
        )
        select ?1, suggestion.organization_id, suggestion.facility_id,
          suggestion.encounter_id, suggestion.id, ?2, ?3, ?4, ?5,
          suggestion.evidence_json,
          json_object(
            'analysisRunId', analysis.id, 'provider', analysis.provider,
            'model', analysis.model, 'modelVersion', analysis.model_version,
            'policyVersion', analysis.policy_version,
            'inputHash', analysis.input_hash,
            'sourceRecordIds', json(analysis.source_record_ids_json)
          ), ?6, ?7, ?8, ?9, ?14
        from clinical_suggestions suggestion
        join analysis_runs analysis
          on analysis.organization_id = suggestion.organization_id
          and analysis.facility_id = suggestion.facility_id
          and analysis.encounter_id = suggestion.encounter_id
          and analysis.id = suggestion.analysis_run_id
        where suggestion.organization_id = ?10 and suggestion.facility_id = ?11
          and suggestion.encounter_id = ?12 and suggestion.id = ?13
      `).bind(
        derivativeId, derivativeVersion, title, content, contentHash, reason,
        scope.reviewerMembershipId, current.derivativeId, now,
        scope.organizationId, scope.facilityId, scope.encounterId,
        input.recommendationId, scope.accessAssignmentId!,
      ),
      derivativeHeadStatement,
      this.database.prepare(`
        update suggestion_review_heads
        set lock_version = lock_version + 1, updated_at = ?1
        where organization_id = ?2 and facility_id = ?3 and encounter_id = ?4
          and suggestion_id = ?5 and state = 'proposed'
          and current_decision_id is null and lock_version = ?6
      `).bind(
        now, scope.organizationId, scope.facilityId, scope.encounterId,
        input.recommendationId, input.expectedVersion,
      ),
      this.auditInsert({
        auditEventId, auditSequence, actorId: input.actorId,
        action: 'suggestion.derivative.create', entityType: 'suggestion_derivative_version',
        entityId: derivativeId, requestId: input.requestId, metadata,
        previousHash: auditHead.lastEventHash, eventHash, now,
      }),
      this.auditHeadUpdate(auditHead, auditSequence, eventHash, now),
      this.database.prepare(`
        update command_idempotency set status = 'succeeded',
          result_resource_type = 'suggestion_derivative_version',
          result_resource_id = ?1, response_json = ?2, completed_at = ?3
        where id = ?4 and status = 'processing'
      `).bind(
        derivativeId,
        JSON.stringify({ recommendationId: input.recommendationId,
          reviewVersion: input.expectedVersion + 1 }),
        now, commandId,
      ),
    ]);
    if (results.some((result) => result.meta.changes !== 1)) {
      throw new SuggestionConflictError('Derivative command was not committed');
    }
    return this.getById(input.recommendationId);
  }

  private async commitDecision(args: {
    input: RecordRecommendationDecision;
    current: SuggestionRow;
    auditHead: AuditHeadRow;
    requestHash: string;
  }) {
    const { input, current, auditHead, requestHash } = args;
    const scope = this.scope;
    const now = Math.max(Date.now(), current.reviewUpdatedAt + 1);
    const decisionId = `decision-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const resultState = input.decision === 'accept'
      ? input.derivativeVersionId ? 'edited_and_accepted' : 'accepted'
      : input.decision === 'reject' ? 'rejected' : 'proposed';
    const auditSequence = auditHead.lastSequence + 1;
    const metadata = JSON.stringify({
      decisionId,
      accessAssignmentId: this.scope.accessAssignmentId,
      recommendationId: input.recommendationId,
      decision: input.decision,
      reviewedDerivativeVersionId: input.derivativeVersionId,
      previousReviewVersion: input.expectedVersion,
      resultingReviewVersion: input.expectedVersion + 1,
      originalInputHash: current.inputHash,
      effectiveContentHash: input.derivativeVersionId === null
        ? await sha256(current.originalContent) : current.derivativeContentHash,
    });
    const action = `suggestion.${input.decision}`;
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: scope.organizationId, facilityId: scope.facilityId,
      sequence: auditSequence, actorType: 'user', actorId: input.actorId,
      actorMembershipId: scope.reviewerMembershipId,
      action, outcome: 'succeeded', purpose: 'synthetic_clinical_review',
      schemaVersion: 1, entityType: 'clinical_suggestion',
      entityId: input.recommendationId, requestId: input.requestId,
      metadataJson: metadata, occurredAt: now,
    });
    await this.assertWriteAccess(input.actorId);
    const results = await this.database.batch([
      this.database.prepare(`
        insert into command_idempotency (
          id, organization_id, facility_id, actor_membership_id, operation,
          idempotency_key, request_hash, status, created_at, access_assignment_id
        ) values (?1, ?2, ?3, ?4, 'suggestion.decision', ?5, ?6,
          'processing', ?7, ?8)
      `).bind(
        commandId, scope.organizationId, scope.facilityId,
        scope.reviewerMembershipId, input.idempotencyKey, requestHash, now,
        scope.accessAssignmentId!,
      ),
      this.database.prepare(`
        insert into review_decisions (
          id, organization_id, facility_id, encounter_id, suggestion_id,
          reviewer_membership_id, sequence, expected_version, idempotency_key,
          decision, result_state, reviewed_derivative_version_id, decided_at,
          created_at, access_assignment_id
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)
      `).bind(
        decisionId, scope.organizationId, scope.facilityId, scope.encounterId,
        input.recommendationId, scope.reviewerMembershipId,
        input.expectedVersion, input.idempotencyKey, input.decision,
        resultState, input.derivativeVersionId, now,
        scope.accessAssignmentId!,
      ),
      this.database.prepare(`
        update suggestion_review_heads set state = ?1,
          current_decision_id = ?2, lock_version = lock_version + 1,
          updated_at = ?3
        where organization_id = ?4 and facility_id = ?5 and encounter_id = ?6
          and suggestion_id = ?7 and lock_version = ?8
      `).bind(
        resultState, input.decision === 'restore' ? null : decisionId, now,
        scope.organizationId, scope.facilityId, scope.encounterId,
        input.recommendationId, input.expectedVersion,
      ),
      this.auditInsert({
        auditEventId, auditSequence, actorId: input.actorId, action,
        entityType: 'clinical_suggestion', entityId: input.recommendationId,
        requestId: input.requestId, metadata,
        previousHash: auditHead.lastEventHash, eventHash, now,
      }),
      this.auditHeadUpdate(auditHead, auditSequence, eventHash, now),
      this.database.prepare(`
        update command_idempotency set status = 'succeeded',
          result_resource_type = 'review_decision', result_resource_id = ?1,
          response_json = ?2, completed_at = ?3
        where id = ?4 and status = 'processing'
      `).bind(
        decisionId,
        JSON.stringify({ recommendationId: input.recommendationId,
          reviewVersion: input.expectedVersion + 1 }),
        now, commandId,
      ),
    ]);
    if (results.some((result) => result.meta.changes !== 1)) {
      throw new SuggestionConflictError('Decision command was not committed');
    }
    return this.getById(input.recommendationId);
  }

  private auditInsert(input: {
    auditEventId: string; auditSequence: number; actorId: string; action: string;
    entityType: string; entityId: string; requestId: string; metadata: string;
    previousHash: string | null; eventHash: string; now: number;
  }) {
    return this.database.prepare(`
      insert into audit_events (
        id, organization_id, facility_id, sequence, actor_type, actor_id,
        actor_membership_id, action, outcome, purpose, schema_version,
        entity_type, entity_id, request_id, metadata_json, previous_hash,
        event_hash, occurred_at
      ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
        'synthetic_clinical_review', 1, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
    `).bind(
      input.auditEventId, this.scope.organizationId, this.scope.facilityId,
      input.auditSequence, input.actorId, this.scope.reviewerMembershipId,
      input.action, input.entityType, input.entityId, input.requestId,
      input.metadata, input.previousHash, input.eventHash, input.now,
    );
  }

  private auditHeadUpdate(
    auditHead: AuditHeadRow, sequence: number, eventHash: string, now: number,
  ) {
    return this.database.prepare(`
      update audit_stream_heads set last_sequence = ?1, last_event_hash = ?2,
        lock_version = lock_version + 1, updated_at = ?3
      where organization_id = ?4 and facility_id = ?5
        and last_sequence = ?6 and lock_version = ?7
    `).bind(
      sequence, eventHash, now, this.scope.organizationId, this.scope.facilityId,
      auditHead.lastSequence, auditHead.lockVersion,
    );
  }

  private assertDerivativeFields(title: string, content: string, reason: string) {
    if (title.length < 1 || title.length > 300) {
      throw new SuggestionValidationError('Title must contain 1 to 300 characters');
    }
    if (content.length < 1 || content.length > 8000) {
      throw new SuggestionValidationError('Content must contain 1 to 8000 characters');
    }
    if (reason.length < 3 || reason.length > 500) {
      throw new SuggestionValidationError('Reason must contain 3 to 500 characters');
    }
  }
  private assertMutable(current: SuggestionRow, expectedVersion: number) {
    if (current.encounterStatus !== 'in_progress') {
      throw new SuggestionLifecycleError('Recommendation review is locked');
    }
    if (current.reviewLockVersion !== expectedVersion) {
      throw new SuggestionConflictError('Recommendation changed on the server');
    }
  }
  private assertTransition(state: string, decision: RecommendationDecision) {
    if (state === 'expired') {
      throw new SuggestionLifecycleError('Expired recommendations are immutable');
    }
    if (decision === 'restore') {
      if (!['accepted', 'edited_and_accepted', 'rejected'].includes(state)) {
        throw new SuggestionConflictError('Recommendation is already pending');
      }
    } else if (state !== 'proposed') {
      throw new SuggestionConflictError('Restore the recommendation first');
    }
  }
  private async throwCurrentFailure(id: string, expectedVersion: number) {
    const latest = await this.getRow(id);
    if (!latest) throw new SuggestionNotFoundError('Recommendation was not found');
    if (latest.encounterStatus !== 'in_progress') {
      throw new SuggestionLifecycleError('Recommendation review is locked');
    }
    if (!(await this.hasEffectiveCareConsent())) {
      throw new SuggestionConsentRequiredError('Care consent required');
    }
    if (latest.reviewLockVersion !== expectedVersion) {
      throw new SuggestionConflictError('Recommendation changed on the server');
    }
  }
  private async getAuditHead() {
    return this.database.prepare(`
      select last_sequence as lastSequence, last_event_hash as lastEventHash,
        lock_version as lockVersion from audit_stream_heads
      where organization_id = ?1 and facility_id = ?2
    `).bind(
      this.scope.organizationId, this.scope.facilityId,
    ).first<AuditHeadRow>();
  }
  private async hasEffectiveCareConsent() {
    const now = Date.now();
    const row = await this.database.prepare(`
      select 1 as present from consent_heads head
      join consent_events event
        on event.organization_id = head.organization_id
        and event.facility_id = head.facility_id
        and event.encounter_id = head.encounter_id
        and event.id = head.current_consent_event_id
      where head.organization_id = ?1 and head.facility_id = ?2
        and head.encounter_id = ?3 and head.consent_type = 'care'
        and event.decision = 'granted' and event.effective_at <= ?4
        and (event.expires_at is null or event.expires_at > ?4)
    `).bind(
      this.scope.organizationId, this.scope.facilityId,
      this.scope.encounterId, now,
    ).first<{ present: number }>();
    return Boolean(row);
  }
  private async findCommand(operation: string, key: string) {
    return this.database.prepare(`
      select request_hash as requestHash, status, access_assignment_id as accessAssignmentId,
        result_resource_type as resultResourceType,
        result_resource_id as resultResourceId
      from command_idempotency
      where organization_id = ?1 and facility_id = ?2
        and actor_membership_id = ?3 and operation = ?4
        and idempotency_key = ?5
    `).bind(
      this.scope.organizationId, this.scope.facilityId,
      this.scope.reviewerMembershipId, operation, key,
    ).first<IdempotencyRow>();
  }
  private async assertWriteAccess(actorId: string) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
    if (!await this.hasEffectiveCareConsent()) throw new SuggestionConsentRequiredError('Care consent required');
    const encounter = await this.database.prepare('select status from encounters where id=?1 and organization_id=?2 and facility_id=?3')
      .bind(this.scope.encounterId, this.scope.organizationId, this.scope.facilityId).first<{status: string}>();
    if (encounter?.status !== 'in_progress') throw new SuggestionLifecycleError('Recommendation review is locked');
  }

  private async resolveCommandReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await this.assertWriteAccess(actorId);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash || replay.status !== 'succeeded' ||
      !replay.resultResourceId
    ) throw new SuggestionConflictError('Idempotency key was already used');
    const id = await this.findRecommendationIdForResource(
      replay.resultResourceType, replay.resultResourceId,
    );
    if (!id) throw new Error('Stored recommendation command is unavailable');
    return this.getById(id);
  }
  private async findRecommendationIdForResource(
    type: string | null, resourceId: string,
  ) {
    const table = type === 'suggestion_derivative_version'
      ? 'suggestion_derivative_versions'
      : type === 'review_decision' ? 'review_decisions' : null;
    if (!table) return null;
    const row = await this.database.prepare(`
      select suggestion_id as suggestionId from ${table}
      where organization_id = ?1 and facility_id = ?2
        and encounter_id = ?3 and id = ?4
    `).bind(
      this.scope.organizationId, this.scope.facilityId,
      this.scope.encounterId, resourceId,
    ).first<{ suggestionId: string }>();
    return row?.suggestionId ?? null;
  }
  private async findLegacyDecision(key: string) {
    return this.database.prepare(`
      select suggestion_id as suggestionId,
        reviewed_derivative_version_id as derivativeVersionId,
        decision, expected_version as expectedVersion
      from review_decisions
      where organization_id = ?1 and facility_id = ?2 and idempotency_key = ?3
    `).bind(
      this.scope.organizationId, this.scope.facilityId, key,
    ).first<ExistingDecisionRow>();
  }
  private async resolveLegacyReplay(
    input: RecordRecommendationDecision,
  ): Promise<never> {
    await this.assertWriteAccess(input.actorId);
    // Historical decisions have no exact-assignment command attribution.
    // Preserve history but require reloading state rather than adopting a replay.
    throw new SuggestionConflictError('Legacy decision cannot be replayed without assignment attribution');
  }
  private async getRow(id: string) {
    return this.database.prepare(`${suggestionSelect}
      where suggestion.organization_id = ?1 and suggestion.facility_id = ?2
        and suggestion.encounter_id = ?3 and suggestion.id = ?4
    `).bind(
      this.scope.organizationId, this.scope.facilityId,
      this.scope.encounterId, id,
    ).first<SuggestionRow>();
  }
  private async getById(id: string) {
    const row = await this.getRow(id);
    if (!row) throw new SuggestionNotFoundError('Recommendation was not found');
    return mapSuggestion(row);
  }
}
