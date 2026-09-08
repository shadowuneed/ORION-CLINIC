import { hashAuditEvent } from '@/lib/audit/event-hash';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import {
  assertEncounterTransition,
  encounterStatusSchema,
  type EncounterStatus,
} from '@/lib/domain/encounter';

export type PersistedEncounterTransition = {
  encounterId: string;
  status: EncounterStatus;
  version: number;
  startedAt: number | null;
  updatedAt: number;
};

export type TransitionEncounterCommand = {
  nextStatus: EncounterStatus;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

type EncounterRow = PersistedEncounterTransition & {
  currentStatus: EncounterStatus;
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

export class EncounterTransitionConflictError extends Error {}
export class EncounterTransitionValidationError extends Error {}
export class EncounterCareConsentRequiredError extends Error {}
export class EncounterLifecycleNotFoundError extends Error {}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function parseStoredResult(value: string | null) {
  if (!value) return null;

  try {
    const candidate = JSON.parse(value) as Partial<PersistedEncounterTransition>;
    const status = encounterStatusSchema.safeParse(candidate.status);
    if (
      typeof candidate.encounterId !== 'string' ||
      !status.success ||
      typeof candidate.version !== 'number' ||
      typeof candidate.updatedAt !== 'number' ||
      !(
        candidate.startedAt === null ||
        typeof candidate.startedAt === 'number'
      )
    ) {
      return null;
    }

    return {
      encounterId: candidate.encounterId,
      status: status.data,
      version: candidate.version,
      startedAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    } as PersistedEncounterTransition;
  } catch {
    return null;
  }
}

export class D1EncounterLifecycleRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async recordTransition(input: TransitionEncounterCommand) {
    await this.assertAuthorized(input.actorId);
    if (!['ready', 'in_progress', 'cancelled'].includes(input.nextStatus)) {
      throw new EncounterTransitionValidationError('Protocol transitions require protocol commands');
    }
    const requestHash = await sha256(
      JSON.stringify({
        accessAssignmentId: this.scope.accessAssignmentId,
        encounterId: this.scope.encounterId,
        nextStatus: input.nextStatus,
        expectedVersion: input.expectedVersion,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash, input.actorId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertAuthorized(input.actorId);
      const [encounter, auditHead, hasCareConsent] = await Promise.all([
        this.getCurrent(),
        this.getAuditHead(),
        this.hasEffectiveCareConsent(),
      ]);

      if (!encounter) {
        throw new EncounterLifecycleNotFoundError('Encounter was not found');
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');
      if (encounter.version !== input.expectedVersion) {
        throw new EncounterTransitionConflictError(
          'Encounter changed on the server',
        );
      }
      if (!hasCareConsent) {
        throw new EncounterCareConsentRequiredError(
          'Effective care consent is required',
        );
      }

      try {
        assertEncounterTransition(encounter.currentStatus, input.nextStatus);
      } catch {
        throw new EncounterTransitionValidationError(
          'Encounter transition is invalid',
        );
      }

      try {
        return await this.commitTransition({
          input,
          requestHash,
          encounter,
          auditHead,
        });
      } catch (error) {
        await this.assertAuthorized(input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input.actorId);

        const [latest, stillConsented] = await Promise.all([
          this.getCurrent(),
          this.hasEffectiveCareConsent(),
        ]);
        if (!latest) {
          throw new EncounterLifecycleNotFoundError('Encounter was not found');
        }
        if (latest.version !== input.expectedVersion) {
          throw new EncounterTransitionConflictError(
            'Encounter changed on the server',
          );
        }
        if (!stillConsented) {
          throw new EncounterCareConsentRequiredError(
            'Effective care consent is required',
          );
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Encounter transition retry was exhausted');
  }

  private async commitTransition(args: {
    input: TransitionEncounterCommand;
    requestHash: string;
    encounter: EncounterRow;
    auditHead: AuditHeadRow;
  }) {
    const { input, requestHash, encounter, auditHead } = args;
    const now = Date.now();
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const nextVersion = encounter.version + 1;
    const auditSequence = auditHead.lastSequence + 1;
    const startedAt =
      input.nextStatus === 'in_progress'
        ? (encounter.startedAt ?? now)
        : encounter.startedAt;
    const result: PersistedEncounterTransition = {
      encounterId: this.scope.encounterId,
      status: input.nextStatus,
      version: nextVersion,
      startedAt,
      updatedAt: now,
    };
    const responseJson = JSON.stringify(result);
    const auditMetadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      commandId,
      previousStatus: encounter.currentStatus,
      resultingStatus: input.nextStatus,
      previousVersion: encounter.version,
      resultingVersion: nextVersion,
      careConsentRequired: true,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: `encounter.transition.${input.nextStatus}`,
      outcome: 'succeeded',
      purpose: 'synthetic_encounter_lifecycle',
      schemaVersion: 1,
      entityType: 'encounter',
      entityId: this.scope.encounterId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    await this.assertAuthorized(input.actorId);
    const results = await this.database.batch([
      this.database.prepare(`
        insert into encounter_transition_events (
          id, organization_id, facility_id, encounter_id, access_assignment_id,
          actor_membership_id, actor_id, previous_status, previous_version,
          resulting_status, resulting_version, started_at, occurred_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      `).bind(commandId, this.scope.organizationId, this.scope.facilityId,
        this.scope.encounterId, this.scope.accessAssignmentId!, this.scope.reviewerMembershipId,
        input.actorId, encounter.currentStatus, encounter.version, input.nextStatus,
        nextVersion, startedAt, now),
      this.database
        .prepare(`
          update encounters
          set status = ?1,
            version = version + 1,
            started_at = case
              when ?1 = 'in_progress' then coalesce(started_at, ?2)
              else started_at end,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and id = ?5
            and clinician_membership_id = ?6 and status = ?7 and version = ?8
            and exists (
              select 1
              from consent_heads head
              join consent_events event
                on event.organization_id = head.organization_id
                and event.facility_id = head.facility_id
                and event.patient_id = head.patient_id
                and event.encounter_id = head.encounter_id
                and event.consent_type = head.consent_type
                and event.id = head.current_consent_event_id
              where head.organization_id = encounters.organization_id
                and head.facility_id = encounters.facility_id
                and head.patient_id = encounters.patient_id
                and head.encounter_id = encounters.id
                and head.consent_type = 'care'
                and event.decision = 'granted'
                and event.effective_at <= ?2
                and (event.expires_at is null or event.expires_at > ?2)
            )
        `)
        .bind(
          input.nextStatus,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          this.scope.reviewerMembershipId,
          encounter.currentStatus,
          encounter.version,
        ),
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
            'synthetic_encounter_lifecycle', 1, 'encounter', ?8, ?9,
            ?10, ?11, ?12, ?13
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          `encounter.transition.${input.nextStatus}`,
          this.scope.encounterId,
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
          ) select ?1, ?2, ?3, ?4, 'encounter.transition', ?5, ?6,
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
          set status = 'succeeded',
            result_resource_type = 'encounter_transition',
            result_resource_id = ?1,
            response_json = ?2,
            completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(
          this.scope.encounterId,
          responseJson,
          now,
          commandId,
          auditEventId,
        ),
    ]);

    if (results.some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new EncounterTransitionConflictError(
        'Encounter transition was not committed',
      );
    }

    return result;
  }

  private async getCurrent() {
    return this.database
      .prepare(`
        select id as encounterId, status as currentStatus, status,
          version, started_at as startedAt, updated_at as updatedAt
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

  private async hasEffectiveCareConsent(at = Date.now()) {
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
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        at,
      )
      .first<{ present: number }>();
    return row?.present === 1;
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
          and actor_membership_id = ?3 and operation = 'encounter.transition'
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
    if (!(await this.hasEffectiveCareConsent())) {
      throw new EncounterCareConsentRequiredError('Effective care consent is required');
    }
  }

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await this.assertAuthorized(actorId);
    const storedResult = parseStoredResult(replay.responseJson);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'encounter_transition' ||
      replay.resultResourceId !== this.scope.encounterId ||
      storedResult?.encounterId !== this.scope.encounterId
    ) {
      throw new EncounterTransitionConflictError(
        'Idempotency key was already used for another encounter transition',
      );
    }

    return storedResult;
  }
}
