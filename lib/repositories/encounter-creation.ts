import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { clinicalSectionCodeSchema } from '@/lib/domain/encounter';

export type SyntheticPatientInput = {
  displayName: string;
  birthDate: string | null;
  sexAtBirth: 'female' | 'male' | 'unknown' | 'not_recorded';
};

export type CreateSyntheticEncounterCommand = {
  patient: SyntheticPatientInput;
  reasonForVisit: string | null;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type CreatedSyntheticEncounter = {
  patient: {
    id: string;
    medicalRecordNumber: string;
    displayName: string;
    birthDate: string | null;
    sexAtBirth: SyntheticPatientInput['sexAtBirth'];
  };
  encounter: {
    id: string;
    status: 'draft';
    version: 1;
    reasonForVisit: string | null;
    startedAt: null;
  };
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

export class EncounterCreationConflictError extends Error {}
export class PotentialPatientDuplicateError extends Error {}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function parseStoredResult(value: string | null) {
  if (!value) return null;

  try {
    const candidate = JSON.parse(value) as CreatedSyntheticEncounter;
    if (
      typeof candidate.patient?.id !== 'string' ||
      typeof candidate.patient?.medicalRecordNumber !== 'string' ||
      typeof candidate.patient?.displayName !== 'string' ||
      typeof candidate.encounter?.id !== 'string' ||
      candidate.encounter?.status !== 'draft' ||
      candidate.encounter?.version !== 1
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export class D1EncounterCreationRepository {
  constructor(
    private readonly database: D1Database,
    private readonly sourceScope: WorkspaceScope,
  ) {}

  async create(input: CreateSyntheticEncounterCommand) {
    const patient = {
      ...input.patient,
      displayName: normalizeDisplayName(input.patient.displayName),
    };
    const reasonForVisit = input.reasonForVisit?.trim() || null;
    const requestHash = await sha256(
      JSON.stringify({
        sourceEncounterId: this.sourceScope.encounterId,
        patient,
        reasonForVisit,
        dataMode: 'synthetic-only',
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash);

    if (await this.hasPotentialDuplicate(patient)) {
      throw new PotentialPatientDuplicateError(
        'A matching active synthetic patient already exists',
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.getAuditHead();
      if (!auditHead) throw new Error('Audit stream is unavailable');

      try {
        return await this.commitCreation({
          input,
          patient,
          reasonForVisit,
          requestHash,
          auditHead,
        });
      } catch (error) {
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash);
        if (await this.hasPotentialDuplicate(patient)) {
          throw new PotentialPatientDuplicateError(
            'A matching active synthetic patient already exists',
          );
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Synthetic encounter creation retry was exhausted');
  }

  private async commitCreation(args: {
    input: CreateSyntheticEncounterCommand;
    patient: SyntheticPatientInput;
    reasonForVisit: string | null;
    requestHash: string;
    auditHead: AuditHeadRow;
  }) {
    const { input, patient, reasonForVisit, requestHash, auditHead } = args;
    const now = Date.now();
    const patientId = `patient-${crypto.randomUUID()}`;
    const encounterId = `encounter-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const medicalRecordNumber = `SYN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const auditSequence = auditHead.lastSequence + 1;
    const sectionVersions = clinicalSectionCodeSchema.options.map((code) => ({
      code,
      versionId: `section-${crypto.randomUUID()}`,
      headId: `section-head-${crypto.randomUUID()}`,
    }));
    const result: CreatedSyntheticEncounter = {
      patient: {
        id: patientId,
        medicalRecordNumber,
        displayName: patient.displayName,
        birthDate: patient.birthDate,
        sexAtBirth: patient.sexAtBirth,
      },
      encounter: {
        id: encounterId,
        status: 'draft',
        version: 1,
        reasonForVisit,
        startedAt: null,
      },
    };
    const responseJson = JSON.stringify(result);
    const auditMetadata = JSON.stringify({
      dataMode: 'synthetic-only',
      patientCreated: true,
      encounterVersion: 1,
      initializedClinicalSectionCount: sectionVersions.length,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.sourceScope.organizationId,
      facilityId: this.sourceScope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.sourceScope.reviewerMembershipId,
      action: 'encounter.create_synthetic',
      outcome: 'succeeded',
      purpose: 'synthetic_encounter_creation',
      schemaVersion: 1,
      entityType: 'encounter',
      entityId: encounterId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });
    const provenanceJson = JSON.stringify({
      sourceType: 'synthetic_fixture',
      sourceIds: [],
    });

    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(`
          insert into patients (
            id, organization_id, facility_id, medical_record_number,
            display_name, birth_date, sex_at_birth, status,
            created_at, updated_at, version
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8, 1)
        `)
        .bind(
          patientId,
          this.sourceScope.organizationId,
          this.sourceScope.facilityId,
          medicalRecordNumber,
          patient.displayName,
          patient.birthDate,
          patient.sexAtBirth,
          now,
        ),
      this.database
        .prepare(`
          insert into encounters (
            id, organization_id, facility_id, patient_id,
            clinician_membership_id, status, reason_for_visit,
            created_at, updated_at, version
          ) values (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?7, 1)
        `)
        .bind(
          encounterId,
          this.sourceScope.organizationId,
          this.sourceScope.facilityId,
          patientId,
          this.sourceScope.reviewerMembershipId,
          reasonForVisit,
          now,
        ),
    ];

    for (const section of sectionVersions) {
      statements.push(
        this.database
          .prepare(`
            insert into clinical_section_versions (
              id, organization_id, facility_id, encounter_id, code, content,
              review_state, provenance_json, created_by_type, created_by_id,
              created_at, version
            ) values (
              ?1, ?2, ?3, ?4, ?5, '', 'empty', ?6, 'service',
              'synthetic-encounter-creation', ?7, 1
            )
          `)
          .bind(
            section.versionId,
            this.sourceScope.organizationId,
            this.sourceScope.facilityId,
            encounterId,
            section.code,
            provenanceJson,
            now,
          ),
      );
    }

    for (const section of sectionVersions) {
      statements.push(
        this.database
          .prepare(`
            insert into clinical_section_heads (
              id, organization_id, facility_id, encounter_id, code,
              current_version_id, lock_version, updated_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
          `)
          .bind(
            section.headId,
            this.sourceScope.organizationId,
            this.sourceScope.facilityId,
            encounterId,
            section.code,
            section.versionId,
            now,
          ),
      );
    }

    statements.push(
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6,
            'encounter.create_synthetic', 'succeeded',
            'synthetic_encounter_creation', 1, 'encounter', ?7, ?8,
            ?9, ?10, ?11, ?12
          where exists (
            select 1 from encounters
            where organization_id = ?2 and facility_id = ?3 and id = ?7
              and patient_id = ?13 and clinician_membership_id = ?6
              and status = 'draft' and version = 1
          ) and (
            select count(*) from clinical_section_heads
            where organization_id = ?2 and facility_id = ?3
              and encounter_id = ?7
          ) = 8
        `)
        .bind(
          auditEventId,
          this.sourceScope.organizationId,
          this.sourceScope.facilityId,
          auditSequence,
          input.actorId,
          this.sourceScope.reviewerMembershipId,
          encounterId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          patientId,
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
          this.sourceScope.organizationId,
          this.sourceScope.facilityId,
          auditHead.lastSequence,
          auditHead.lockVersion,
          auditEventId,
        ),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at
          ) select ?1, ?2, ?3, ?4, 'encounter.create_synthetic', ?5, ?6,
            'processing', ?7
          where exists (select 1 from audit_events where id = ?8)
        `)
        .bind(
          commandId,
          this.sourceScope.organizationId,
          this.sourceScope.facilityId,
          this.sourceScope.reviewerMembershipId,
          input.idempotencyKey,
          requestHash,
          now,
          auditEventId,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded',
            result_resource_type = 'synthetic_encounter',
            result_resource_id = ?1,
            response_json = ?2,
            completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(encounterId, responseJson, now, commandId, auditEventId),
    );

    const batchResults = await this.database.batch(statements);
    if (batchResults.some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new EncounterCreationConflictError(
        'Synthetic encounter creation was not committed',
      );
    }

    return result;
  }

  private async hasPotentialDuplicate(patient: SyntheticPatientInput) {
    const duplicate = await this.database
      .prepare(`
        select 1 as present
        from patients
        where organization_id = ?1 and facility_id = ?2 and status = 'active'
          and lower(trim(display_name)) = lower(trim(?3))
          and birth_date is ?4
        limit 1
      `)
      .bind(
        this.sourceScope.organizationId,
        this.sourceScope.facilityId,
        patient.displayName,
        patient.birthDate,
      )
      .first<{ present: number }>();
    return duplicate?.present === 1;
  }

  private async getAuditHead() {
    return this.database
      .prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash,
          lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
      `)
      .bind(this.sourceScope.organizationId, this.sourceScope.facilityId)
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
          and actor_membership_id = ?3
          and operation = 'encounter.create_synthetic'
          and idempotency_key = ?4
      `)
      .bind(
        this.sourceScope.organizationId,
        this.sourceScope.facilityId,
        this.sourceScope.reviewerMembershipId,
        idempotencyKey,
      )
      .first<IdempotencyRow>();
  }

  private resolveReplay(replay: IdempotencyRow, requestHash: string) {
    const storedResult = parseStoredResult(replay.responseJson);
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'synthetic_encounter' ||
      replay.resultResourceId !== storedResult?.encounter.id ||
      !storedResult
    ) {
      throw new EncounterCreationConflictError(
        'Idempotency key was already used for another encounter creation',
      );
    }
    return storedResult;
  }
}
