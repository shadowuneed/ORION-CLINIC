import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import {
  analysisPolicyVersion,
  type AnalysisTranscriptSegment,
  type ClinicalAnalysisProviderResult,
} from '@/lib/providers/clinical-analysis';

type SnapshotReference = { id: string; version: number };
type AnalysisConsentRow = { id: string; type: string };
type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};
type IdempotencyRow = {
  accessAssignmentId: string | null;
  requestHash: string;
  status: 'processing' | 'succeeded' | 'failed';
  resultResourceType: string | null;
  resultResourceId: string | null;
};
type AnalysisRunRow = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'superseded';
  inputHash: string;
};
type SectionHeadRow = {
  code: string;
  currentVersionId: string;
  lockVersion: number;
  reviewState: string;
};

export type PreparedClinicalAnalysis = {
  replayRunId: string | null;
  runId: string;
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  inputHash: string;
  segments: AnalysisTranscriptSegment[];
  sourceIds: string[];
  consentEventIds: string[];
  sectionHeads: SectionHeadRow[];
  acknowledgedAt: number;
};

export class ClinicalAnalysisConsentRequiredError extends Error {}
export class ClinicalAnalysisLifecycleError extends Error {}
export class ClinicalAnalysisSnapshotConflictError extends Error {}
export class ClinicalAnalysisCommandConflictError extends Error {}
export class ClinicalAnalysisCommitError extends Error {}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function sameSnapshot(
  segments: readonly AnalysisTranscriptSegment[],
  expected: readonly SnapshotReference[],
) {
  if (segments.length !== expected.length) return false;
  return segments.every(
    (segment, index) =>
      segment.id === expected[index]?.id && segment.version === expected[index]?.version,
  );
}

export class D1ClinicalAnalysisRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async prepare(input: {
    snapshot: SnapshotReference[];
    idempotencyKey: string;
    actorId: string;
    requestId: string;
    acknowledged: true;
    provider: string;
    model: string;
    modelVersion: string;
  }): Promise<PreparedClinicalAnalysis> {
    await this.assertAnalysisAccess(input.actorId);
    const [segments, consents, encounterStatus] = await Promise.all([
      this.getCanonicalTranscript(),
      this.getAnalysisConsentIds(),
      this.getEncounterStatus(),
    ]);
    if (encounterStatus !== 'in_progress') {
      throw new ClinicalAnalysisLifecycleError();
    }
    if (consents.length !== 3) {
      throw new ClinicalAnalysisConsentRequiredError();
    }
    if (segments.length === 0 || !sameSnapshot(segments, input.snapshot)) {
      throw new ClinicalAnalysisSnapshotConflictError();
    }
    const acknowledgedAt = Date.now();
    const canonicalInput = JSON.stringify({
      policyVersion: analysisPolicyVersion,
      segments,
    });
    const inputHash = await sha256(canonicalInput);
    const requestHash = await sha256(
      JSON.stringify({
        accessAssignmentId: this.scope.accessAssignmentId,
        encounterId: this.scope.encounterId,
        snapshot: input.snapshot,
        acknowledged: input.acknowledged,
        provider: input.provider,
        model: input.model,
        policyVersion: analysisPolicyVersion,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) {
      if (
        replay.accessAssignmentId !== this.scope.accessAssignmentId ||
        replay.requestHash !== requestHash ||
        replay.status !== 'succeeded' ||
        replay.resultResourceType !== 'analysis_run' ||
        !replay.resultResourceId
      ) {
        throw new ClinicalAnalysisCommandConflictError();
      }
      const run = await this.getRun(replay.resultResourceId);
      if (!run || run.status !== 'succeeded' || run.inputHash !== inputHash) {
        throw new ClinicalAnalysisCommandConflictError();
      }
      return {
        replayRunId: run.id,
        runId: run.id,
        commandId: '',
        idempotencyKey: input.idempotencyKey,
        requestHash,
        inputHash,
        segments,
        sourceIds: segments.map((segment) => segment.id),
        consentEventIds: consents,
        sectionHeads: [],
        acknowledgedAt,
      };
    }

    const runId = `analysis-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const sourceIds = segments.map((segment) => segment.id);
    const sourceJson = JSON.stringify(sourceIds);
    const consentJson = JSON.stringify([...consents].sort());
    await this.assertAnalysisAccess(input.actorId);
    const results = await this.database.batch([
      this.database
        .prepare(`
          insert into analysis_runs (
            id, organization_id, facility_id, encounter_id, kind,
            provider, model, model_version, policy_version, input_hash,
            source_record_ids_json, requested_by_membership_id, request_id,
            consent_event_ids_json, transcript_acknowledged_at, status,
            started_at, created_at, access_assignment_id
          )
          select ?1, ?2, ?3, ?4, 'suggestions', ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14, 'running', ?14, ?14, ?16
          where exists (
            select 1 from encounters encounter
            where encounter.organization_id = ?2 and encounter.facility_id = ?3
              and encounter.id = ?4 and encounter.status = 'in_progress'
              and encounter.clinician_membership_id = ?11
          )
            and ?15 = (
              select count(*) from transcript_segments segment
              where segment.organization_id = ?2 and segment.facility_id = ?3
                and segment.encounter_id = ?4
                and segment.state in ('final', 'corrected')
                and segment.id in (select value from json_each(?10))
                and not exists (
                  select 1 from transcript_segments successor
                  where successor.organization_id = segment.organization_id
                    and successor.facility_id = segment.facility_id
                    and successor.encounter_id = segment.encounter_id
                    and successor.supersedes_segment_id = segment.id
                )
            )
            and ?15 = (
              select count(*) from transcript_segments segment
              where segment.organization_id = ?2 and segment.facility_id = ?3
                and segment.encounter_id = ?4
                and segment.state in ('final', 'corrected')
                and not exists (
                  select 1 from transcript_segments successor
                  where successor.organization_id = segment.organization_id
                    and successor.facility_id = segment.facility_id
                    and successor.encounter_id = segment.encounter_id
                    and successor.supersedes_segment_id = segment.id
                )
            )
            and 3 = (
              select count(distinct event.consent_type)
              from consent_heads head
              join consent_events event
                on event.organization_id = head.organization_id
                and event.facility_id = head.facility_id
                and event.patient_id = head.patient_id
                and event.encounter_id = head.encounter_id
                and event.consent_type = head.consent_type
                and event.id = head.current_consent_event_id
              where head.organization_id = ?2 and head.facility_id = ?3
                and head.encounter_id = ?4
                and head.consent_type in (
                  'care', 'transcript_storage', 'external_ai_processing'
                )
                and event.decision = 'granted'
                and event.effective_at <= ?14
                and (event.expires_at is null or event.expires_at > ?14)
                and event.id in (select value from json_each(?13))
                and (
                  event.consent_type <> 'external_ai_processing'
                  or event.external_processor = 'groq'
                )
            )
        `)
        .bind(
          runId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          input.provider,
          input.model,
          input.modelVersion,
          analysisPolicyVersion,
          inputHash,
          sourceJson,
          this.scope.reviewerMembershipId,
          input.requestId,
          consentJson,
          acknowledgedAt,
          sourceIds.length,
          this.scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at, access_assignment_id
          )
          select ?1, ?2, ?3, ?4, 'analysis.generate', ?5, ?6,
            'processing', ?7, ?10
          where exists (
            select 1 from analysis_runs where organization_id = ?2
              and facility_id = ?3 and encounter_id = ?8 and id = ?9
              and status = 'running'
          )
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.reviewerMembershipId,
          input.idempotencyKey,
          requestHash,
          acknowledgedAt,
          this.scope.encounterId,
          runId,
          this.scope.accessAssignmentId!,
        ),
    ]);
    if (results.some((result) => result.meta.changes !== 1)) {
      const raced = await this.findIdempotency(input.idempotencyKey);
      if (raced) throw new ClinicalAnalysisCommandConflictError();
      const consentNow = await this.getAnalysisConsentIds();
      if (consentNow.length !== 3) throw new ClinicalAnalysisConsentRequiredError();
      throw new ClinicalAnalysisSnapshotConflictError();
    }

    return {
      replayRunId: null,
      runId,
      commandId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      inputHash,
      segments,
      sourceIds,
      consentEventIds: consents,
      sectionHeads: await this.getSectionHeads(),
      acknowledgedAt,
    };
  }

  async complete(
    prepared: PreparedClinicalAnalysis,
    providerResult: ClinicalAnalysisProviderResult,
    input: { actorId: string; requestId: string },
  ) {
    await this.assertAnalysisAccess(input.actorId);
    const ownedRun = await this.getRun(prepared.runId);
    if (!ownedRun || ownedRun.inputHash !== prepared.inputHash) throw new ClinicalAnalysisCommandConflictError();
    if (prepared.replayRunId) {
      return { runId: prepared.replayRunId, suggestionCount: 0, sectionDraftCount: 0 };
    }
    const [segments, consents, auditHead] = await Promise.all([
      this.getCanonicalTranscript(),
      this.getAnalysisConsentIds(),
      this.getAuditHead(),
    ]);
    if (!sameSnapshot(segments, prepared.segments)) {
      throw new ClinicalAnalysisSnapshotConflictError();
    }
    if (
      consents.length !== 3 ||
      JSON.stringify(consents) !== JSON.stringify([...prepared.consentEventIds].sort())
    ) {
      throw new ClinicalAnalysisConsentRequiredError();
    }
    if ((await this.getEncounterStatus()) !== 'in_progress') {
      throw new ClinicalAnalysisLifecycleError();
    }
    if (!auditHead) throw new Error('Audit stream is unavailable');

    const now = Date.now();
    const sourceJson = JSON.stringify(prepared.sourceIds);
    const consentJson = JSON.stringify([...prepared.consentEventIds].sort());
    const suggestionRecords = providerResult.output.suggestions.map((suggestion) => ({
      id: `suggestion-${crypto.randomUUID()}`,
      headId: `suggestion-head-${crypto.randomUUID()}`,
      ...suggestion,
    }));
    const sectionHeadByCode = new Map(
      prepared.sectionHeads.map((head) => [head.code, head]),
    );
    const sectionRecords = providerResult.output.sections.flatMap((section) => {
      const head = sectionHeadByCode.get(section.code);
      if (!head || !['empty', 'ai_draft'].includes(head.reviewState)) return [];
      return [
        {
          ...section,
          head,
          versionId: `section-${section.code}-${crypto.randomUUID()}`,
        },
      ];
    });
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const auditSequence = auditHead.lastSequence + 1;
    const auditMetadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      analysisRunId: prepared.runId,
      provider: providerResult.provider,
      model: providerResult.model,
      policyVersion: providerResult.policyVersion,
      inputHash: prepared.inputHash,
      sourceRecordIds: prepared.sourceIds,
      consentEventIds: prepared.consentEventIds,
      suggestionCount: suggestionRecords.length,
      requestedSectionDraftCount: sectionRecords.length,
      clinicianTranscriptAcknowledgedAt: prepared.acknowledgedAt,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: 'analysis.generate',
      outcome: 'succeeded',
      purpose: 'synthetic_clinical_draft_generation',
      schemaVersion: 1,
      entityType: 'analysis_run',
      entityId: prepared.runId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const statements: D1PreparedStatement[] = [];
    const requiredIndexes: number[] = [];
    const addRequired = (statement: D1PreparedStatement) => {
      requiredIndexes.push(statements.length);
      statements.push(statement);
    };
    addRequired(
      this.database
        .prepare(`
          update analysis_runs
          set status = 'succeeded', raw_result_json = ?1,
            validation_result_json = ?2, metrics_json = ?3,
            completed_at = ?4
          where organization_id = ?5 and facility_id = ?6 and encounter_id = ?7
            and id = ?8 and status = 'running' and input_hash = ?9
            and source_record_ids_json = ?10 and consent_event_ids_json = ?11
            and exists (
              select 1 from encounters encounter
              where encounter.organization_id = ?5 and encounter.facility_id = ?6
                and encounter.id = ?7 and encounter.status = 'in_progress'
                and encounter.clinician_membership_id = ?12
            )
            and ?13 = (
              select count(*) from transcript_segments segment
              where segment.organization_id = ?5 and segment.facility_id = ?6
                and segment.encounter_id = ?7
                and segment.state in ('final', 'corrected')
                and segment.id in (select value from json_each(?10))
                and not exists (
                  select 1 from transcript_segments successor
                  where successor.organization_id = segment.organization_id
                    and successor.facility_id = segment.facility_id
                    and successor.encounter_id = segment.encounter_id
                    and successor.supersedes_segment_id = segment.id
                )
            )
            and ?13 = (
              select count(*) from transcript_segments segment
              where segment.organization_id = ?5 and segment.facility_id = ?6
                and segment.encounter_id = ?7
                and segment.state in ('final', 'corrected')
                and not exists (
                  select 1 from transcript_segments successor
                  where successor.organization_id = segment.organization_id
                    and successor.facility_id = segment.facility_id
                    and successor.encounter_id = segment.encounter_id
                    and successor.supersedes_segment_id = segment.id
                )
            )
            and 3 = (
              select count(distinct event.consent_type)
              from consent_heads head
              join consent_events event on event.id = head.current_consent_event_id
              where head.organization_id = ?5 and head.facility_id = ?6
                and head.encounter_id = ?7
                and head.consent_type in (
                  'care', 'transcript_storage', 'external_ai_processing'
                )
                and event.decision = 'granted'
                and event.effective_at <= ?4
                and (event.expires_at is null or event.expires_at > ?4)
                and event.id in (select value from json_each(?11))
                and (
                  event.consent_type <> 'external_ai_processing'
                  or event.external_processor = 'groq'
                )
            )
        `)
        .bind(
          JSON.stringify(providerResult.output),
          JSON.stringify({ exactEvidenceValidated: true, schemaValidated: true }),
          JSON.stringify({ durationMs: providerResult.durationMs }),
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          prepared.runId,
          prepared.inputHash,
          sourceJson,
          consentJson,
          this.scope.reviewerMembershipId,
          prepared.sourceIds.length,
        ),
    );

    for (const suggestion of suggestionRecords) {
      addRequired(
        this.database
          .prepare(`
            insert into clinical_suggestions (
              id, organization_id, facility_id, encounter_id, analysis_run_id,
              category, risk_level, title, original_content, evidence_json,
              created_at
            )
            select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
            where exists (
              select 1 from analysis_runs where organization_id = ?2
                and facility_id = ?3 and encounter_id = ?4 and id = ?5
                and status = 'succeeded'
            )
          `)
          .bind(
            suggestion.id,
            this.scope.organizationId,
            this.scope.facilityId,
            this.scope.encounterId,
            prepared.runId,
            suggestion.category,
            suggestion.riskLevel,
            suggestion.title,
            suggestion.content,
            JSON.stringify(suggestion.evidence.map((item) => ({
              sourceId: item.sourceId,
              quote: item.quote,
            }))),
            now,
          ),
      );
      addRequired(
        this.database
          .prepare(`
            insert into suggestion_review_heads (
              id, organization_id, facility_id, encounter_id, suggestion_id,
              state, current_decision_id, lock_version, updated_at
            )
            select ?1, ?2, ?3, ?4, ?5, 'proposed', null, 1, ?6
            where exists (
              select 1 from clinical_suggestions where organization_id = ?2
                and facility_id = ?3 and encounter_id = ?4 and id = ?5
            )
          `)
          .bind(
            suggestion.headId,
            this.scope.organizationId,
            this.scope.facilityId,
            this.scope.encounterId,
            suggestion.id,
            now,
          ),
      );
    }

    for (const section of sectionRecords) {
      const provenance = JSON.stringify({
        sourceType: 'ai_draft',
        sourceIds: [prepared.runId, ...section.evidence.map((item) => item.sourceId)],
        analysisRunId: prepared.runId,
        inputHash: prepared.inputHash,
      });
      statements.push(
        this.database
          .prepare(`
            insert into clinical_section_versions (
              id, organization_id, facility_id, encounter_id, code, content,
              review_state, provenance_json, created_by_type, created_by_id,
              version, supersedes_section_version_id, created_at
            )
            select ?1, ?2, ?3, ?4, ?5, ?6, 'ai_draft', ?7,
              'service', 'groq', ?8, ?9, ?10
            where exists (
              select 1 from clinical_section_heads head
              join clinical_section_versions current
                on current.organization_id = head.organization_id
                and current.facility_id = head.facility_id
                and current.encounter_id = head.encounter_id
                and current.code = head.code and current.id = head.current_version_id
              where head.organization_id = ?2 and head.facility_id = ?3
                and head.encounter_id = ?4 and head.code = ?5
                and head.current_version_id = ?9 and head.lock_version = ?11
                and current.review_state in ('empty', 'ai_draft')
            )
          `)
          .bind(
            section.versionId,
            this.scope.organizationId,
            this.scope.facilityId,
            this.scope.encounterId,
            section.code,
            section.content,
            provenance,
            section.head.lockVersion + 1,
            section.head.currentVersionId,
            now,
            section.head.lockVersion,
          ),
      );
      statements.push(
        this.database
          .prepare(`
            update clinical_section_heads
            set current_version_id = ?1, lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4 and encounter_id = ?5
              and code = ?6 and current_version_id = ?7 and lock_version = ?8
              and exists (select 1 from clinical_section_versions where id = ?1)
          `)
          .bind(
            section.versionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            this.scope.encounterId,
            section.code,
            section.head.currentVersionId,
            section.head.lockVersion,
          ),
      );
    }

    addRequired(
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6, 'analysis.generate',
            'succeeded', 'synthetic_clinical_draft_generation', 1,
            'analysis_run', ?7, ?8, ?9, ?10, ?11, ?12
          where exists (
            select 1 from analysis_runs where organization_id = ?2
              and facility_id = ?3 and encounter_id = ?13 and id = ?7
              and status = 'succeeded'
          )
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          prepared.runId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          this.scope.encounterId,
        ),
    );
    addRequired(
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
    );
    addRequired(
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'analysis_run',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and organization_id = ?5 and facility_id = ?6
            and actor_membership_id = ?7 and operation = 'analysis.generate'
            and idempotency_key = ?8 and request_hash = ?9
            and status = 'processing'
            and exists (select 1 from audit_events where id = ?10)
        `)
        .bind(
          prepared.runId,
          JSON.stringify({
            runId: prepared.runId,
            suggestionCount: suggestionRecords.length,
          }),
          now,
          prepared.commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.reviewerMembershipId,
          prepared.idempotencyKey,
          prepared.requestHash,
          auditEventId,
        ),
    );

    await this.assertAnalysisAccess(input.actorId);
    const results = await this.database.batch(statements);
    if (requiredIndexes.some((index) => results[index]?.meta.changes !== 1)) {
      throw new ClinicalAnalysisCommitError();
    }
    const sectionDraftCount = sectionRecords.reduce((count, _, index) => {
      const firstSectionIndex = statements.length - 3 - sectionRecords.length * 2;
      const insertResult = results[firstSectionIndex + index * 2];
      const headResult = results[firstSectionIndex + index * 2 + 1];
      return count + Number(insertResult?.meta.changes === 1 && headResult?.meta.changes === 1);
    }, 0);
    return {
      runId: prepared.runId,
      suggestionCount: suggestionRecords.length,
      sectionDraftCount,
    };
  }

  async fail(prepared: PreparedClinicalAnalysis, errorCode: string) {
    if (prepared.replayRunId) return;
    if (!await this.getRun(prepared.runId)) throw new ClinicalAnalysisCommandConflictError();
    const now = Date.now();
    await this.database.batch([
      this.database
        .prepare(`
          update analysis_runs
          set status = 'failed', error_code = ?1, completed_at = ?2
          where organization_id = ?3 and facility_id = ?4 and encounter_id = ?5
            and id = ?6 and status = 'running'
        `)
        .bind(
          errorCode.slice(0, 100),
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          prepared.runId,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'failed', response_json = ?1, completed_at = ?2
          where id = ?3 and organization_id = ?4 and facility_id = ?5
            and actor_membership_id = ?6 and operation = 'analysis.generate'
            and idempotency_key = ?7 and request_hash = ?8
            and status = 'processing'
        `)
        .bind(
          JSON.stringify({ errorCode: errorCode.slice(0, 100) }),
          now,
          prepared.commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.reviewerMembershipId,
          prepared.idempotencyKey,
          prepared.requestHash,
        ),
    ]);
  }

  private async assertAnalysisAccess(actorId: string) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
    if ((await this.getEncounterStatus()) !== 'in_progress') throw new ClinicalAnalysisLifecycleError();
    if ((await this.getAnalysisConsentIds()).length !== 3) throw new ClinicalAnalysisConsentRequiredError();
  }

  private async getCanonicalTranscript() {
    const result = await this.database
      .prepare(`
        select segment.id, segment.version, segment.speaker_role as role,
          segment.language_code as language, segment.text
        from transcript_segments segment
        where segment.organization_id = ?1 and segment.facility_id = ?2
          and segment.encounter_id = ?3
          and segment.state in ('final', 'corrected')
          and not exists (
            select 1 from transcript_segments successor
            where successor.organization_id = segment.organization_id
              and successor.facility_id = segment.facility_id
              and successor.encounter_id = segment.encounter_id
              and successor.supersedes_segment_id = segment.id
          )
        order by segment.segment_index, segment.version
        limit 24
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<AnalysisTranscriptSegment>();
    return result.results;
  }

  private async getAnalysisConsentIds(at = Date.now()) {
    const result = await this.database
      .prepare(`
        select event.id, event.consent_type as type
        from consent_heads head
        join consent_events event
          on event.organization_id = head.organization_id
          and event.facility_id = head.facility_id
          and event.patient_id = head.patient_id
          and event.encounter_id = head.encounter_id
          and event.consent_type = head.consent_type
          and event.id = head.current_consent_event_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
          and head.consent_type in (
            'care', 'transcript_storage', 'external_ai_processing'
          )
          and event.decision = 'granted' and event.effective_at <= ?4
          and (event.expires_at is null or event.expires_at > ?4)
          and (
            event.consent_type <> 'external_ai_processing'
            or event.external_processor = 'groq'
          )
        order by event.consent_type
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        at,
      )
      .all<AnalysisConsentRow>();
    const required = new Set([
      'care',
      'transcript_storage',
      'external_ai_processing',
    ]);
    for (const row of result.results) required.delete(row.type);
    return required.size === 0 ? result.results.map((row) => row.id).sort() : [];
  }

  private async getSectionHeads() {
    const result = await this.database
      .prepare(`
        select head.code, head.current_version_id as currentVersionId,
          head.lock_version as lockVersion, current.review_state as reviewState
        from clinical_section_heads head
        join clinical_section_versions current
          on current.organization_id = head.organization_id
          and current.facility_id = head.facility_id
          and current.encounter_id = head.encounter_id
          and current.code = head.code and current.id = head.current_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<SectionHeadRow>();
    return result.results;
  }

  private async getEncounterStatus() {
    const row = await this.database
      .prepare(`
        select status from encounters
        where organization_id = ?1 and facility_id = ?2 and id = ?3
          and clinician_membership_id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        this.scope.reviewerMembershipId,
      )
      .first<{ status: string }>();
    return row?.status ?? null;
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
          and actor_membership_id = ?3 and operation = 'analysis.generate'
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

  private async getRun(id: string) {
    return this.database
      .prepare(`
        select id, status, input_hash as inputHash from analysis_runs
        where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
          and id = ?4 and requested_by_membership_id = ?5 and access_assignment_id = ?6
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        id,
        this.scope.reviewerMembershipId,
        this.scope.accessAssignmentId!,
      )
      .first<AnalysisRunRow>();
  }
}
