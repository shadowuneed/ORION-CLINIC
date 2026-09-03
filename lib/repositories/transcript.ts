import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import {
  encounterStatusSchema,
  isEncounterClinicalRecordEditable,
} from '@/lib/domain/encounter';

export type PersistedTranscriptTurn = {
  id: string;
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

type TranscriptRow = {
  id: string;
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

type IdempotencyRow = {
  requestHash: string;
  status: string;
  resultResourceType: string | null;
  resultResourceId: string | null;
};

export type CorrectTranscriptCommand = {
  segmentId: string;
  expectedVersion: number;
  text: string;
  role: PersistedTranscriptTurn['role'];
  language: PersistedTranscriptTurn['language'];
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export class TranscriptConflictError extends Error {}
export class TranscriptConsentRequiredError extends Error {}
export class TranscriptLifecycleError extends Error {}
export class TranscriptNotFoundError extends Error {}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class D1TranscriptRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async listCurrent(): Promise<PersistedTranscriptTurn[]> {
    const result = await this.database
      .prepare(`
        select
          segment.id,
          segment.segment_index as segmentIndex,
          segment.version,
          segment.speaker_role as role,
          segment.speaker_role_source as roleSource,
          segment.language_code as language,
          segment.text,
          segment.started_at_ms as startedAtMs,
          segment.ended_at_ms as endedAtMs,
          segment.state
        from transcript_segments segment
        where segment.organization_id = ?1
          and segment.facility_id = ?2
          and segment.encounter_id = ?3
          and not exists (
            select 1
            from transcript_segments successor
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
      .all<TranscriptRow>();

    return result.results;
  }

  async correct(input: CorrectTranscriptCommand) {
    const text = input.text.trim();
    const requestHash = await sha256(
      JSON.stringify({
        encounterId: this.scope.encounterId,
        segmentId: input.segmentId,
        expectedVersion: input.expectedVersion,
        text,
        role: input.role,
        language: input.language,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [current, auditHead, hasRequiredConsents, encounterStatus] =
        await Promise.all([
        this.getCurrentById(input.segmentId),
        this.getAuditHead(),
        this.hasEffectiveRequiredConsents(),
        this.getEncounterStatus(),
      ]);
      if (!current) {
        const exists = await this.getById(input.segmentId);
        if (exists) {
          throw new TranscriptConflictError(
            'Transcript segment changed on the server',
          );
        }
        throw new TranscriptNotFoundError('Transcript segment was not found');
      }
      if (current.version !== input.expectedVersion) {
        throw new TranscriptConflictError(
          'Transcript segment changed on the server',
        );
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');
      if (
        !encounterStatus ||
        !isEncounterClinicalRecordEditable(encounterStatus)
      ) {
        throw new TranscriptLifecycleError(
          'Transcript cannot be changed after protocol finalization',
        );
      }
      if (!hasRequiredConsents) {
        throw new TranscriptConsentRequiredError(
          'Care and transcript storage consent are required',
        );
      }

      try {
        return await this.commitCorrection({
          input,
          text,
          requestHash,
          current,
          auditHead,
        });
      } catch (error) {
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash);

        const [latest, stillConsented, latestEncounterStatus] = await Promise.all([
          this.getCurrentByIndex(current.segmentIndex),
          this.hasEffectiveRequiredConsents(),
          this.getEncounterStatus(),
        ]);
        if (
          !latestEncounterStatus ||
          !isEncounterClinicalRecordEditable(latestEncounterStatus)
        ) {
          throw new TranscriptLifecycleError(
            'Transcript cannot be changed after protocol finalization',
          );
        }
        if (!latest || latest.id !== input.segmentId) {
          throw new TranscriptConflictError(
            'Transcript segment changed on the server',
          );
        }
        if (!stillConsented) {
          throw new TranscriptConsentRequiredError(
            'Care and transcript storage consent are required',
          );
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Transcript correction retry was exhausted');
  }

  private async commitCorrection(args: {
    input: CorrectTranscriptCommand;
    text: string;
    requestHash: string;
    current: TranscriptRow;
    auditHead: AuditHeadRow;
  }) {
    const { input, text, requestHash, current, auditHead } = args;
    const now = Date.now();
    const versionId = `transcript-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const nextVersion = current.version + 1;
    const auditSequence = auditHead.lastSequence + 1;
    const result: PersistedTranscriptTurn = {
      id: versionId,
      segmentIndex: current.segmentIndex,
      version: nextVersion,
      role: input.role,
      roleSource: 'manual',
      language: input.language,
      text,
      startedAtMs: current.startedAtMs,
      endedAtMs: current.endedAtMs,
      state: 'corrected',
    };
    const auditMetadata = JSON.stringify({
      segmentIndex: current.segmentIndex,
      previousVersion: current.version,
      resultingVersion: nextVersion,
      previousRole: current.role,
      resultingRole: input.role,
      previousLanguage: current.language,
      resultingLanguage: input.language,
      textChanged: current.text !== text,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: 'transcript.correct',
      outcome: 'succeeded',
      purpose: 'clinical_documentation_review',
      schemaVersion: 1,
      entityType: 'transcript_segment',
      entityId: versionId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const batchResults = await this.database.batch([
      this.database
        .prepare(`
          insert into transcript_segments (
            id, organization_id, facility_id, encounter_id, segment_index,
            version, speaker_role, speaker_role_source, speaker_confidence_basis_points,
            language_code, text, started_at_ms, ended_at_ms, state,
            corrected_by_membership_id, supersedes_segment_id, created_at
          )
          select ?1, organization_id, facility_id, encounter_id, segment_index,
            version + 1, ?2, 'manual', null, ?3, ?4, started_at_ms, ended_at_ms,
            'corrected', ?5, id, ?6
          from transcript_segments parent
          where parent.organization_id = ?7 and parent.facility_id = ?8
            and parent.encounter_id = ?9 and parent.id = ?10 and parent.version = ?11
            and not exists (
              select 1 from transcript_segments successor
              where successor.organization_id = parent.organization_id
                and successor.facility_id = parent.facility_id
                and successor.encounter_id = parent.encounter_id
              and successor.supersedes_segment_id = parent.id
            )
            and exists (
              select 1 from encounters encounter
              where encounter.organization_id = parent.organization_id
                and encounter.facility_id = parent.facility_id
                and encounter.id = parent.encounter_id
                and encounter.status in ('in_progress', 'review')
            )
            and 2 = (
              select count(distinct event.consent_type)
              from consent_heads head
              join consent_events event
                on event.organization_id = head.organization_id
                and event.facility_id = head.facility_id
                and event.patient_id = head.patient_id
                and event.encounter_id = head.encounter_id
                and event.consent_type = head.consent_type
                and event.id = head.current_consent_event_id
              where head.organization_id = parent.organization_id
                and head.facility_id = parent.facility_id
                and head.encounter_id = parent.encounter_id
                and head.consent_type in ('care', 'transcript_storage')
                and event.decision = 'granted'
                and event.effective_at <= ?6
                and (event.expires_at is null or event.expires_at > ?6)
            )
        `)
        .bind(
          versionId,
          input.role,
          input.language,
          text,
          this.scope.reviewerMembershipId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          input.segmentId,
          input.expectedVersion,
        ),
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6, 'transcript.correct',
            'succeeded', 'clinical_documentation_review', 1,
            'transcript_segment', ?7, ?8, ?9, ?10, ?11, ?12
          where exists (
            select 1 from transcript_segments
            where organization_id = ?2 and facility_id = ?3
              and encounter_id = ?13 and id = ?7 and version = ?14
          )
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          versionId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          this.scope.encounterId,
          nextVersion,
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
          ) select ?1, ?2, ?3, ?4, 'transcript.correct', ?5, ?6,
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
          set status = 'succeeded',
            result_resource_type = 'transcript_segment_version',
            result_resource_id = ?1,
            response_json = ?2,
            completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(
          versionId,
          JSON.stringify({ resourceVersionId: versionId }),
          now,
          commandId,
          auditEventId,
        ),
    ]);

    if (batchResults.some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new TranscriptConflictError(
        'Transcript correction was not committed',
      );
    }
    return result;
  }

  private async getCurrentById(id: string) {
    return this.database
      .prepare(`
        select id, segment_index as segmentIndex, version,
          speaker_role as role, speaker_role_source as roleSource,
          language_code as language, text, started_at_ms as startedAtMs,
          ended_at_ms as endedAtMs, state
        from transcript_segments segment
        where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
          and id = ?4
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
        id,
      )
      .first<TranscriptRow>();
  }

  private async getCurrentByIndex(segmentIndex: number) {
    return this.database
      .prepare(`
        select id, segment_index as segmentIndex, version,
          speaker_role as role, speaker_role_source as roleSource,
          language_code as language, text, started_at_ms as startedAtMs,
          ended_at_ms as endedAtMs, state
        from transcript_segments segment
        where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
          and segment_index = ?4
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
        segmentIndex,
      )
      .first<TranscriptRow>();
  }

  private async getById(id: string) {
    return this.database
      .prepare(`
        select id, segment_index as segmentIndex, version,
          speaker_role as role, speaker_role_source as roleSource,
          language_code as language, text, started_at_ms as startedAtMs,
          ended_at_ms as endedAtMs, state
        from transcript_segments
        where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
          and id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        id,
      )
      .first<TranscriptRow>();
  }

  private async hasEffectiveRequiredConsents(at = Date.now()) {
    const row = await this.database
      .prepare(`
        select count(distinct event.consent_type) as consentCount
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
          and head.consent_type in ('care', 'transcript_storage')
          and event.decision = 'granted' and event.effective_at <= ?4
          and (event.expires_at is null or event.expires_at > ?4)
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        at,
      )
      .first<{ consentCount: number }>();
    return row?.consentCount === 2;
  }

  private async getEncounterStatus() {
    const row = await this.database
      .prepare(`
        select status
        from encounters
        where organization_id = ?1 and facility_id = ?2 and id = ?3
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .first<{ status: string }>();

    return row ? encounterStatusSchema.parse(row.status) : null;
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
          result_resource_id as resultResourceId
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = 'transcript.correct'
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

  private async resolveReplay(replay: IdempotencyRow, requestHash: string) {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'transcript_segment_version' ||
      !replay.resultResourceId
    ) {
      throw new TranscriptConflictError(
        'Idempotency key was already used for another transcript correction',
      );
    }
    const stored = await this.getById(replay.resultResourceId);
    if (!stored) throw new Error('Stored transcript correction is unavailable');
    return stored;
  }
}
