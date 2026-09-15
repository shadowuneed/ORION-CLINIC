import { hashAuditEvent } from '@/lib/audit/event-hash';
import { assertEncounterCreationAccess, type EncounterCreationScope } from '@/lib/auth/encounter-creation-access';
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
  accessAssignmentId: string | null;
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
    private readonly sourceScope: EncounterCreationScope,
  ) {}

  async create(input: CreateSyntheticEncounterCommand) {
    await assertEncounterCreationAccess(this.database, this.sourceScope, input.actorId);
    const patient = {
      ...input.patient,
      displayName: normalizeDisplayName(input.patient.displayName),
    };
    const reasonForVisit = input.reasonForVisit?.trim() || null;
    const requestHash = await sha256(
      JSON.stringify({
        schemaVersion: 2,
        accessAssignmentId: this.sourceScope.accessAssignmentId,
        organizationId: this.sourceScope.organizationId,
        facilityId: this.sourceScope.facilityId,
        actorId: input.actorId,
        patient,
        reasonForVisit,
        dataMode: 'synthetic-only',
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash, input.actorId);

    if (await this.hasPotentialDuplicate(patient)) {
      throw new PotentialPatientDuplicateError(
        'A matching active synthetic patient already exists',
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assertEncounterCreationAccess(this.database, this.sourceScope, input.actorId);
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
        await assertEncounterCreationAccess(this.database, this.sourceScope, input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input.actorId);
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
    const profileVersionId = `profile-${crypto.randomUUID()}`;
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
      commandId,
      accessAssignmentId: this.sourceScope.accessAssignmentId,
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
      this.database.prepare(`insert into encounter_creation_events
        (id,organization_id,facility_id,access_assignment_id,actor_membership_id,actor_id,
         patient_id,encounter_id,request_id,request_hash,response_json,occurred_at)
        values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`)
        .bind(commandId,this.sourceScope.organizationId,this.sourceScope.facilityId,
          this.sourceScope.accessAssignmentId!,this.sourceScope.reviewerMembershipId,input.actorId,
          patientId,encounterId,input.requestId,requestHash,responseJson,now),
      this.database
        .prepare(`
          insert into patients (
            id, organization_id, facility_id, medical_record_number,
            display_name, birth_date, sex_at_birth, status,
            created_at, updated_at, version, creation_command_id
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8, 1, ?9)
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
          commandId,
        ),
      this.database
        .prepare(`
          insert into encounters (
            id, organization_id, facility_id, patient_id,
            clinician_membership_id, status, reason_for_visit,
            created_at, updated_at, version, creation_command_id
          ) values (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?7, 1, ?8)
        `)
        .bind(
          encounterId,
          this.sourceScope.organizationId,
          this.sourceScope.facilityId,
          patientId,
          this.sourceScope.reviewerMembershipId,
          reasonForVisit,
          now,
          commandId,
        ),
    ];

    statements.push(
      this.database.prepare(`insert into patient_profile_versions (
        id, organization_id, facility_id, patient_id, version, display_name,
        birth_date, sex_at_birth, phone, email, address, status,
        created_by_membership_id, change_reason, created_at
      ) values (?1,?2,?3,?4,1,?5,?6,?7,null,null,null,'active',?8,'initial_registration',?9)`)
        .bind(profileVersionId,this.sourceScope.organizationId,this.sourceScope.facilityId,
          patientId,patient.displayName,patient.birthDate,patient.sexAtBirth,this.sourceScope.reviewerMembershipId,now),
      this.database.prepare(`insert into patient_profile_heads (
        id,organization_id,facility_id,patient_id,current_version_id,lock_version,updated_at
      ) values (?1,?2,?3,?4,?5,1,?6)`)
        .bind(`profile-head-${crypto.randomUUID()}`,this.sourceScope.organizationId,
          this.sourceScope.facilityId,patientId,profileVersionId,now),
    );

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
            operation, idempotency_key, request_hash, status, created_at, access_assignment_id
          ) select ?1, ?2, ?3, ?4, 'encounter.create_synthetic', ?5, ?6,
            'processing', ?7, ?9
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
          this.sourceScope.accessAssignmentId!,
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

    // A skipped write must roll back the complete batch, not leave a partial patient/encounter.
    statements.push(this.database.prepare(`select case when exists (
      select 1 from command_idempotency command join audit_events audit
        on audit.id=?2 join audit_stream_heads head on head.organization_id=audit.organization_id
        and head.facility_id=audit.facility_id and head.last_sequence=audit.sequence
        and head.last_event_hash=audit.event_hash
      where command.id=?1 and command.status='succeeded' and command.response_json=?3
        and command.access_assignment_id=?4 and head.lock_version=?5
    ) then 1 else json('encounter_creation_not_published') end as verified`)
      .bind(commandId,auditEventId,responseJson,this.sourceScope.accessAssignmentId!,auditHead.lockVersion+1));
    await assertEncounterCreationAccess(this.database, this.sourceScope, input.actorId);
    const batchResults = await this.database.batch(statements);
    if (batchResults.slice(0,-1).some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new EncounterCreationConflictError(
        'Synthetic encounter creation was not committed',
      );
    }

    await assertEncounterCreationAccess(this.database, this.sourceScope, input.actorId);
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
        select request_hash as requestHash, status, access_assignment_id as accessAssignmentId,
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

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await assertEncounterCreationAccess(this.database, this.sourceScope, actorId);
    const storedResult = parseStoredResult(replay.responseJson);
    if (
      replay.requestHash !== requestHash ||
      replay.accessAssignmentId !== this.sourceScope.accessAssignmentId ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'synthetic_encounter' ||
      replay.resultResourceId !== storedResult?.encounter.id ||
      !storedResult
    ) {
      throw new EncounterCreationConflictError(
        'Idempotency key was already used for another encounter creation',
      );
    }
    const current = await this.database.prepare(`select encounter.id from encounters encounter
      join patients patient on patient.id=encounter.patient_id and patient.organization_id=encounter.organization_id
        and patient.facility_id=encounter.facility_id and patient.status='active'
      where encounter.id=?1 and encounter.patient_id=?2 and encounter.organization_id=?3
        and encounter.facility_id=?4 and encounter.clinician_membership_id=?5`)
      .bind(storedResult.encounter.id,storedResult.patient.id,this.sourceScope.organizationId,
        this.sourceScope.facilityId,this.sourceScope.reviewerMembershipId).first();
    if (!current) throw new EncounterCreationConflictError('Created encounter is no longer accessible');
    await assertEncounterCreationAccess(this.database, this.sourceScope, actorId);
    return storedResult;
  }
}
