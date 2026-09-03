import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import type {
  SpeechSession,
  SpeechTranscription,
} from '@/lib/providers/speech-to-text';
import type { PersistedTranscriptTurn } from './transcript';

const requiredSpeechConsentTypes = [
  'care',
  'transient_audio_processing',
  'transcript_storage',
] as const;

type EffectiveConsentRow = {
  id: string;
  type: (typeof requiredSpeechConsentTypes)[number];
};

type CaptureRunRow = {
  id: string;
  upstreamSessionId: string;
  provider: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  consentEventIdsJson: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  nextUtteranceIndex: number;
  startedByMembershipId: string;
};

type ReplayRow = {
  inputHash: string;
  segmentId: string;
  segmentIndex: number;
  version: number;
  role: PersistedTranscriptTurn['role'];
  roleSource: PersistedTranscriptTurn['roleSource'];
  language: PersistedTranscriptTurn['language'];
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  state: PersistedTranscriptTurn['state'];
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type TimelineRow = {
  nextSegmentIndex: number;
  timelineStartMs: number;
};

export type SpeechCaptureSession = {
  id: string;
  provider: string;
  model: string;
  modelVersion: string;
  status: CaptureRunRow['status'];
  nextUtteranceIndex: number;
};

export class SpeechCaptureConsentRequiredError extends Error {}
export class SpeechCaptureLifecycleError extends Error {}
export class SpeechCaptureNotFoundError extends Error {}
export class SpeechCaptureConflictError extends Error {}

async function sha256(value: string | Uint8Array) {
  const payload =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : Uint8Array.from(value);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function mapReplay(row: ReplayRow): PersistedTranscriptTurn {
  return {
    id: row.segmentId,
    segmentIndex: row.segmentIndex,
    version: row.version,
    role: row.role,
    roleSource: row.roleSource,
    language: row.language,
    text: row.text,
    startedAtMs: row.startedAtMs,
    endedAtMs: row.endedAtMs,
    state: row.state,
  };
}

export class D1TranscriptIngestionRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async preflightStart() {
    const [consentIds, status] = await Promise.all([
      this.getEffectiveSpeechConsentIds(),
      this.getEncounterStatus(),
    ]);
    if (status !== 'in_progress') {
      throw new SpeechCaptureLifecycleError('Encounter is not in progress');
    }
    if (consentIds.length !== requiredSpeechConsentTypes.length) {
      throw new SpeechCaptureConsentRequiredError(
        'Care, transient audio processing and transcript storage consent are required',
      );
    }
    return consentIds;
  }

  async persistStartedSession(input: {
    speechSession: SpeechSession;
    consentEventIds: string[];
    actorId: string;
    requestId: string;
  }): Promise<SpeechCaptureSession> {
    const now = Date.now();
    const id = `speech-run-${crypto.randomUUID()}`;
    const consentJson = JSON.stringify([...input.consentEventIds].sort());
    const result = await this.database
      .prepare(`
        insert into transcription_runs (
          id, organization_id, facility_id, encounter_id,
          upstream_session_id, provider, model, model_version, policy_version,
          consent_event_ids_json, status, next_utterance_index,
          started_by_membership_id, request_id, started_at, created_at, updated_at
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'local-speech-v1',
          ?9, 'running', 0, ?10, ?11, ?12, ?12, ?12
        where exists (
          select 1 from encounters encounter
          where encounter.organization_id = ?2 and encounter.facility_id = ?3
            and encounter.id = ?4 and encounter.status = 'in_progress'
            and encounter.clinician_membership_id = ?10
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
                'care', 'transient_audio_processing', 'transcript_storage'
              )
              and event.decision = 'granted'
              and event.effective_at <= ?12
              and (event.expires_at is null or event.expires_at > ?12)
              and event.id in (select value from json_each(?9))
          )
      `)
      .bind(
        id,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        input.speechSession.upstreamSessionId,
        input.speechSession.provider,
        input.speechSession.model,
        input.speechSession.modelVersion,
        consentJson,
        this.scope.reviewerMembershipId,
        input.requestId,
        now,
      )
      .run();
    if (result.meta.changes !== 1) {
      const [status, consentIds] = await Promise.all([
        this.getEncounterStatus(),
        this.getEffectiveSpeechConsentIds(),
      ]);
      if (status !== 'in_progress') throw new SpeechCaptureLifecycleError();
      if (consentIds.length !== 3) throw new SpeechCaptureConsentRequiredError();
      throw new SpeechCaptureConflictError('Speech session could not be persisted');
    }
    return {
      id,
      provider: input.speechSession.provider,
      model: input.speechSession.model,
      modelVersion: input.speechSession.modelVersion,
      status: 'running',
      nextUtteranceIndex: 0,
    };
  }

  async prepareTranscription(input: {
    sessionId: string;
    utteranceIndex: number;
    audio: Uint8Array;
  }) {
    const inputHash = await sha256(input.audio);
    const replay = await this.getReplay(input.sessionId, input.utteranceIndex);
    if (replay) {
      if (replay.inputHash !== inputHash) {
        throw new SpeechCaptureConflictError(
          'Utterance index was already used for different audio',
        );
      }
      return { replay: mapReplay(replay), run: null, inputHash } as const;
    }
    const run = await this.getRun(input.sessionId);
    if (!run) throw new SpeechCaptureNotFoundError();
    if (run.status !== 'running') throw new SpeechCaptureLifecycleError();
    if (run.nextUtteranceIndex !== input.utteranceIndex) {
      throw new SpeechCaptureConflictError('Utterances must be processed in order');
    }
    const consentIds = await this.getEffectiveSpeechConsentIds();
    if (consentIds.length !== 3) throw new SpeechCaptureConsentRequiredError();
    if ((await this.getEncounterStatus()) !== 'in_progress') {
      throw new SpeechCaptureLifecycleError();
    }
    return { replay: null, run, inputHash } as const;
  }

  async commitTranscription(input: {
    sessionId: string;
    utteranceIndex: number;
    inputHash: string;
    result: SpeechTranscription;
    actorId: string;
    requestId: string;
  }): Promise<PersistedTranscriptTurn> {
    const existing = await this.getReplay(input.sessionId, input.utteranceIndex);
    if (existing) {
      if (existing.inputHash !== input.inputHash) throw new SpeechCaptureConflictError();
      return mapReplay(existing);
    }
    const [run, consentIds, auditHead, timeline] = await Promise.all([
      this.getRun(input.sessionId),
      this.getEffectiveSpeechConsentIds(),
      this.getAuditHead(),
      this.getTimeline(),
    ]);
    if (!run) throw new SpeechCaptureNotFoundError();
    if (run.status !== 'running' || run.nextUtteranceIndex !== input.utteranceIndex) {
      throw new SpeechCaptureConflictError();
    }
    if (consentIds.length !== 3) throw new SpeechCaptureConsentRequiredError();
    if (!auditHead) throw new Error('Audit stream is unavailable');
    if ((await this.getEncounterStatus()) !== 'in_progress') {
      throw new SpeechCaptureLifecycleError();
    }

    const now = Date.now();
    const segmentId = `transcript-${crypto.randomUUID()}`;
    const sourceId = `transcription-result-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const consentJson = JSON.stringify([...consentIds].sort());
    const responseHash = await sha256(JSON.stringify(input.result.providerPayload));
    const durationMs = Math.max(1, input.result.durationMs);
    const endedAtMs = timeline.timelineStartMs + durationMs;
    const result: PersistedTranscriptTurn = {
      id: segmentId,
      segmentIndex: timeline.nextSegmentIndex,
      version: 1,
      role: input.result.role,
      roleSource: input.result.roleSource,
      language: input.result.language,
      text: input.result.text.trim(),
      startedAtMs: timeline.timelineStartMs,
      endedAtMs,
      state: 'final',
    };
    const auditSequence = auditHead.lastSequence + 1;
    const auditMetadata = JSON.stringify({
      transcriptionRunId: run.id,
      utteranceIndex: input.utteranceIndex,
      provider: run.provider,
      model: run.model,
      inputHash: input.inputHash,
      responseHash,
      consentEventIds: consentIds,
      role: result.role,
      roleSource: result.roleSource,
      state: result.state,
      rawAudioRetained: false,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: 'transcript.ingest.stt',
      outcome: 'succeeded',
      purpose: 'synthetic_transient_speech_processing',
      schemaVersion: 1,
      entityType: 'transcript_segment',
      entityId: segmentId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const statements = [
      this.database
        .prepare(`
          insert into transcript_segments (
            id, organization_id, facility_id, encounter_id, segment_index,
            version, speaker_role, speaker_role_source,
            speaker_confidence_basis_points, language_code, text,
            started_at_ms, ended_at_ms, state, created_at
          )
          select ?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, 'final', ?13
          where exists (
            select 1 from transcription_runs run
            join encounters encounter
              on encounter.organization_id = run.organization_id
              and encounter.facility_id = run.facility_id
              and encounter.id = run.encounter_id
            where run.organization_id = ?2 and run.facility_id = ?3
              and run.encounter_id = ?4 and run.id = ?14
              and run.started_by_membership_id = ?15
              and run.status = 'running' and run.next_utterance_index = ?16
              and encounter.status = 'in_progress'
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
                  'care', 'transient_audio_processing', 'transcript_storage'
                )
                and event.decision = 'granted'
                and event.effective_at <= ?13
                and (event.expires_at is null or event.expires_at > ?13)
                and event.id in (select value from json_each(?17))
            )
        `)
        .bind(
          segmentId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          result.segmentIndex,
          result.role,
          result.roleSource,
          input.result.speakerConfidenceBasisPoints,
          result.language,
          result.text,
          result.startedAtMs,
          result.endedAtMs,
          now,
          input.sessionId,
          this.scope.reviewerMembershipId,
          input.utteranceIndex,
          consentJson,
        ),
      this.database
        .prepare(`
          insert into transcription_results (
            id, organization_id, facility_id, encounter_id,
            transcription_run_id, transcript_segment_id, utterance_index,
            input_hash, response_hash, consent_event_ids_json,
            duration_ms, processing_ms, created_at
          )
          select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
          where exists (
            select 1 from transcript_segments segment
            where segment.organization_id = ?2 and segment.facility_id = ?3
              and segment.encounter_id = ?4 and segment.id = ?6
          )
        `)
        .bind(
          sourceId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          input.sessionId,
          segmentId,
          input.utteranceIndex,
          input.inputHash,
          responseHash,
          consentJson,
          input.result.durationMs,
          input.result.processingMs,
          now,
        ),
      this.database
        .prepare(`
          update transcription_runs
          set next_utterance_index = next_utterance_index + 1, updated_at = ?1
          where organization_id = ?2 and facility_id = ?3 and encounter_id = ?4
            and id = ?5 and status = 'running' and next_utterance_index = ?6
            and exists (select 1 from transcription_results where id = ?7)
        `)
        .bind(
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          input.sessionId,
          input.utteranceIndex,
          sourceId,
        ),
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6, 'transcript.ingest.stt',
            'succeeded', 'synthetic_transient_speech_processing', 1,
            'transcript_segment', ?7, ?8, ?9, ?10, ?11, ?12
          where exists (select 1 from transcription_results where id = ?13)
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          segmentId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          sourceId,
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
    ];
    const batch = await this.database.batch(statements);
    if (batch.some((entry) => entry.meta.changes !== 1)) {
      const replay = await this.getReplay(input.sessionId, input.utteranceIndex);
      if (replay && replay.inputHash === input.inputHash) return mapReplay(replay);
      const consentNow = await this.getEffectiveSpeechConsentIds();
      if (consentNow.length !== 3) throw new SpeechCaptureConsentRequiredError();
      throw new SpeechCaptureConflictError('Speech result was not committed');
    }
    return result;
  }

  async finishSession(sessionId: string, status: 'completed' | 'cancelled') {
    const now = Date.now();
    const result = await this.database
      .prepare(`
        update transcription_runs
        set status = ?1, completed_at = ?2, updated_at = ?2
        where organization_id = ?3 and facility_id = ?4 and encounter_id = ?5
          and id = ?6 and started_by_membership_id = ?7 and status = 'running'
      `)
      .bind(
        status,
        now,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        sessionId,
        this.scope.reviewerMembershipId,
      )
      .run();
    if (result.meta.changes !== 1) {
      const run = await this.getRun(sessionId);
      if (!run) throw new SpeechCaptureNotFoundError();
      if (run.status === status) return;
      throw new SpeechCaptureLifecycleError();
    }
  }

  async getUpstreamSessionId(sessionId: string) {
    const run = await this.getRun(sessionId);
    if (!run) throw new SpeechCaptureNotFoundError();
    return run.upstreamSessionId;
  }

  private async getRun(id: string) {
    return this.database
      .prepare(`
        select id, upstream_session_id as upstreamSessionId, provider, model,
          model_version as modelVersion, policy_version as policyVersion,
          consent_event_ids_json as consentEventIdsJson, status,
          next_utterance_index as nextUtteranceIndex,
          started_by_membership_id as startedByMembershipId
        from transcription_runs
        where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
          and id = ?4 and started_by_membership_id = ?5
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        id,
        this.scope.reviewerMembershipId,
      )
      .first<CaptureRunRow>();
  }

  private async getReplay(sessionId: string, utteranceIndex: number) {
    return this.database
      .prepare(`
        select result.input_hash as inputHash,
          segment.id as segmentId, segment.segment_index as segmentIndex,
          segment.version, segment.speaker_role as role,
          segment.speaker_role_source as roleSource,
          segment.language_code as language, segment.text,
          segment.started_at_ms as startedAtMs,
          segment.ended_at_ms as endedAtMs, segment.state
        from transcription_results result
        join transcription_runs run
          on run.organization_id = result.organization_id
          and run.facility_id = result.facility_id
          and run.encounter_id = result.encounter_id
          and run.id = result.transcription_run_id
        join transcript_segments segment
          on segment.organization_id = result.organization_id
          and segment.facility_id = result.facility_id
          and segment.encounter_id = result.encounter_id
          and segment.id = result.transcript_segment_id
        where result.organization_id = ?1 and result.facility_id = ?2
          and result.encounter_id = ?3 and result.transcription_run_id = ?4
          and result.utterance_index = ?5 and run.started_by_membership_id = ?6
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        sessionId,
        utteranceIndex,
        this.scope.reviewerMembershipId,
      )
      .first<ReplayRow>();
  }

  private async getEffectiveSpeechConsentIds(at = Date.now()) {
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
            'care', 'transient_audio_processing', 'transcript_storage'
          )
          and event.decision = 'granted' and event.effective_at <= ?4
          and (event.expires_at is null or event.expires_at > ?4)
        order by event.consent_type
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        at,
      )
      .all<EffectiveConsentRow>();
    const types = new Set(result.results.map((row) => row.type));
    if (requiredSpeechConsentTypes.some((type) => !types.has(type))) return [];
    return result.results.map((row) => row.id).sort();
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

  private async getTimeline() {
    const row = await this.database
      .prepare(`
        select coalesce(max(segment_index), -1) + 1 as nextSegmentIndex,
          coalesce(max(ended_at_ms), 0) as timelineStartMs
        from transcript_segments
        where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .first<TimelineRow>();
    return row ?? { nextSegmentIndex: 0, timelineStartMs: 0 };
  }
}
