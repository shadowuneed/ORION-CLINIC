import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { FacilityAccessScope } from '@/lib/auth/facility-access';
import { clinicalSectionCodeSchema } from '@/lib/domain/encounter';

export type PatientSexAtBirth = 'female' | 'male' | 'unknown' | 'not_recorded';
export type PatientStatus = 'active' | 'inactive' | 'merged';

export type PatientSummary = {
  id: string;
  medicalRecordNumber: string;
  displayName: string;
  birthDate: string | null;
  sexAtBirth: PatientSexAtBirth;
  status: PatientStatus;
  testIin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  photoUrl: string | null;
  encounterCount: number;
  latestEncounter: {
    id: string;
    status: EncounterSummary['status'];
    reasonForVisit: string | null;
    updatedAt: number;
  } | null;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type PatientProfileHistoryEntry = {
  id: string;
  version: number;
  status: PatientStatus;
  changeReason: string;
  createdAt: number;
  actorDisplayName: string;
};

export type EncounterSummary = {
  id: string;
  status:
    | 'draft'
    | 'ready'
    | 'in_progress'
    | 'review'
    | 'finalized'
    | 'amended'
    | 'cancelled';
  reasonForVisit: string | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type PatientDetail = PatientSummary & {
  encounters: EncounterSummary[];
  profileHistory: PatientProfileHistoryEntry[];
};

export type CreatePatientInput = {
  displayName: string;
  birthDate: string | null;
  sexAtBirth: PatientSexAtBirth;
  testIin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type CreatePatientEncounterInput = {
  patientId: string;
  reasonForVisit: string | null;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type UpdatePatientProfileInput = {
  patientId: string;
  displayName: string;
  birthDate: string | null;
  sexAtBirth: PatientSexAtBirth;
  phone: string | null;
  email: string | null;
  address: string | null;
  changeReason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type ArchivePatientProfileInput = {
  patientId: string;
  changeReason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type PatientPhotoMetadata = {
  id: string;
  objectKey: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
};

export type PatientReadAuditAction =
  | 'patient.list'
  | 'patient.read'
  | 'patient.photo.read';

type PatientRow = {
  id: string;
  medicalRecordNumber: string;
  displayName: string;
  birthDate: string | null;
  sexAtBirth: PatientSexAtBirth;
  status: PatientStatus;
  testIin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  photoAssetId: string | null;
  encounterCount: number;
  latestEncounterId: string | null;
  latestEncounterStatus: EncounterSummary['status'] | null;
  latestReasonForVisit: string | null;
  latestEncounterUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
  version: number;
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type IdempotencyRow = {
  requestHash: string;
  status: string;
  resultResourceId: string | null;
  responseJson: string | null;
};

type CurrentProfileRow = {
  currentVersionId: string;
  lockVersion: number;
  displayName: string;
  birthDate: string | null;
  sexAtBirth: PatientSexAtBirth;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: PatientStatus;
};

export class PatientRegistryConflictError extends Error {}
export class PatientDuplicateCandidateError extends Error {}
export class PatientNotFoundError extends Error {}
export class PatientEncounterRoleRequiredError extends Error {}
export class PatientReadAuditUnavailableError extends Error {}
export class PatientProfileUnavailableError extends Error {}
export class PatientProfileUnchangedError extends Error {}
export class PatientAlreadyArchivedError extends Error {}
export class PatientProfileStateError extends Error {}
export class PatientProfileVersionConflictError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly currentStatus: PatientStatus,
  ) {
    super('Patient profile version conflict');
  }
}

async function sha256(value: string | ArrayBuffer) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeNullable(value: string | null) {
  const normalized = value ? normalizeText(value) : '';
  return normalized || null;
}

function toPatientSummary(row: PatientRow, facilityId: string): PatientSummary {
  return {
    id: row.id,
    medicalRecordNumber: row.medicalRecordNumber,
    displayName: row.displayName,
    birthDate: row.birthDate,
    sexAtBirth: row.sexAtBirth,
    status: row.status,
    testIin: row.testIin,
    phone: row.phone,
    email: row.email,
    address: row.address,
    photoUrl: row.photoAssetId
      ? `/api/patients/${encodeURIComponent(row.id)}/photo?facilityId=${encodeURIComponent(facilityId)}`
      : null,
    encounterCount: Number(row.encounterCount),
    latestEncounter:
      row.latestEncounterId &&
      row.latestEncounterStatus &&
      row.latestEncounterUpdatedAt !== null
        ? {
            id: row.latestEncounterId,
            status: row.latestEncounterStatus,
            reasonForVisit: row.latestReasonForVisit,
            updatedAt: row.latestEncounterUpdatedAt,
          }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

const patientSelect = `
  select patient.id,
    patient.medical_record_number as medicalRecordNumber,
    coalesce(profile.display_name, patient.display_name) as displayName,
    coalesce(profile.birth_date, patient.birth_date) as birthDate,
    coalesce(profile.sex_at_birth, patient.sex_at_birth) as sexAtBirth,
    coalesce(profile.status, patient.status) as status,
    identifier.normalized_value as testIin,
    profile.phone,
    profile.email,
    profile.address,
    photo.id as photoAssetId,
    (select count(*) from encounters encounter_count
      where encounter_count.organization_id = patient.organization_id
        and encounter_count.facility_id = patient.facility_id
        and encounter_count.patient_id = patient.id) as encounterCount,
    (select latest.id from encounters latest
      where latest.organization_id = patient.organization_id
        and latest.facility_id = patient.facility_id
        and latest.patient_id = patient.id
      order by latest.updated_at desc, latest.id desc limit 1) as latestEncounterId,
    (select latest.status from encounters latest
      where latest.organization_id = patient.organization_id
        and latest.facility_id = patient.facility_id
        and latest.patient_id = patient.id
      order by latest.updated_at desc, latest.id desc limit 1) as latestEncounterStatus,
    (select latest.reason_for_visit from encounters latest
      where latest.organization_id = patient.organization_id
        and latest.facility_id = patient.facility_id
        and latest.patient_id = patient.id
      order by latest.updated_at desc, latest.id desc limit 1) as latestReasonForVisit,
    (select latest.updated_at from encounters latest
      where latest.organization_id = patient.organization_id
        and latest.facility_id = patient.facility_id
        and latest.patient_id = patient.id
      order by latest.updated_at desc, latest.id desc limit 1) as latestEncounterUpdatedAt,
    patient.created_at as createdAt,
    coalesce(profile_head.updated_at, patient.updated_at) as updatedAt,
    coalesce(profile_head.lock_version, patient.version) as version
  from patients patient
  left join patient_profile_heads profile_head
    on profile_head.organization_id = patient.organization_id
    and profile_head.facility_id = patient.facility_id
    and profile_head.patient_id = patient.id
  left join patient_profile_versions profile
    on profile.organization_id = patient.organization_id
    and profile.facility_id = patient.facility_id
    and profile.patient_id = patient.id
    and profile.id = profile_head.current_version_id
  left join patient_identifiers identifier
    on identifier.organization_id = patient.organization_id
    and identifier.facility_id = patient.facility_id
    and identifier.patient_id = patient.id
    and identifier.kind = 'test_iin'
    and identifier.status = 'active'
  left join patient_photo_heads photo_head
    on photo_head.organization_id = patient.organization_id
    and photo_head.facility_id = patient.facility_id
    and photo_head.patient_id = patient.id
  left join patient_photo_assets photo
    on photo.organization_id = patient.organization_id
    and photo.facility_id = patient.facility_id
    and photo.patient_id = patient.id
    and photo.id = photo_head.current_photo_asset_id
    and photo.status = 'ready'
`;

export class D1PatientRegistryRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: FacilityAccessScope,
  ) {}

  async list(input: {
    query?: string;
    status?: PatientStatus | 'all';
    limit?: number;
  } = {}) {
    const query = normalizeNullable(input.query ?? null);
    // A literal substring avoids D1's short LIKE-pattern limit (UTF-8 names
    // reach it quickly) and does not interpret patient input as SQL wildcards.
    const search = query || null;
    const status = input.status ?? 'active';
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const rows = await this.database
      .prepare(`
        ${patientSelect}
        where patient.organization_id = ?1 and patient.facility_id = ?2
          and (?3 = 'all' or coalesce(profile.status, patient.status) = ?3)
          and (
            ?4 is null
            or instr(lower(coalesce(profile.display_name, patient.display_name)), lower(?4)) > 0
            or instr(lower(patient.medical_record_number), lower(?4)) > 0
            or instr(lower(identifier.normalized_value), lower(?4)) > 0
            or instr(lower(coalesce(profile.phone, '')), lower(?4)) > 0
          )
        order by coalesce(profile_head.updated_at, patient.updated_at) desc,
          patient.id desc
        limit ?5
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        status,
        search,
        limit,
      )
      .all<PatientRow>();

    return rows.results.map((row) => toPatientSummary(row, this.scope.facilityId));
  }

  async get(patientId: string): Promise<PatientDetail | null> {
    const row = await this.database
      .prepare(`
        ${patientSelect}
        where patient.organization_id = ?1 and patient.facility_id = ?2
          and patient.id = ?3
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, patientId)
      .first<PatientRow>();
    if (!row) return null;

    const encounters = await this.database
      .prepare(`
        select id, status, reason_for_visit as reasonForVisit,
          started_at as startedAt, ended_at as endedAt,
          created_at as createdAt, updated_at as updatedAt, version
        from encounters
        where organization_id = ?1 and facility_id = ?2 and patient_id = ?3
        order by updated_at desc, id desc
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, patientId)
      .all<EncounterSummary>();

    return {
      ...toPatientSummary(row, this.scope.facilityId),
      encounters: encounters.results,
      profileHistory: await this.getProfileHistory(patientId),
    };
  }

  async recordRead(input: {
    action: PatientReadAuditAction;
    actorId: string;
    requestId: string;
    patientId?: string;
    resultCount?: number;
  }) {
    const entityType = input.patientId ? 'patient' : 'facility';
    const entityId = input.patientId ?? this.scope.facilityId;
    const metadataJson = JSON.stringify({
      routeAction: input.action,
      ...(typeof input.resultCount === 'number'
        ? { resultCount: input.resultCount }
        : {}),
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.getAuditHead();
      if (!auditHead) {
        throw new PatientReadAuditUnavailableError('Patient read audit stream unavailable');
      }
      const now = Date.now();
      const auditEventId = `audit-${crypto.randomUUID()}`;
      const sequence = auditHead.lastSequence + 1;
      const eventHash = await hashAuditEvent({
        previousHash: auditHead.lastEventHash,
        organizationId: this.scope.organizationId,
        facilityId: this.scope.facilityId,
        sequence,
        actorType: 'user',
        actorId: input.actorId,
        actorMembershipId: this.scope.membershipId,
        action: input.action,
        outcome: 'succeeded',
        purpose: 'patient_directory_access',
        schemaVersion: 1,
        entityType,
        entityId,
        requestId: input.requestId,
        metadataJson,
        occurredAt: now,
      });
      try {
        const results = await this.database.batch([
          this.auditInsert({
            auditEventId,
            auditHead,
            sequence,
            eventHash,
            actorId: input.actorId,
            action: input.action,
            purpose: 'patient_directory_access',
            entityType,
            entityId,
            requestId: input.requestId,
            metadataJson,
            occurredAt: now,
          }),
          this.auditHeadUpdate(auditHead, sequence, eventHash, auditEventId, now),
        ]);
        if (results.every((result) => result.meta.changes === 1)) return;
      } catch (error) {
        if (attempt === 2) {
          throw new PatientReadAuditUnavailableError(
            error instanceof Error ? error.message : 'Patient read audit failed',
          );
        }
      }
    }
    throw new PatientReadAuditUnavailableError('Patient read audit retry exhausted');
  }

  async create(input: CreatePatientInput) {
    const normalized = {
      displayName: normalizeText(input.displayName),
      birthDate: input.birthDate,
      sexAtBirth: input.sexAtBirth,
      testIin: normalizeNullable(input.testIin)?.replace(/\D/g, '') ?? null,
      phone: normalizeNullable(input.phone),
      email: normalizeNullable(input.email)?.toLowerCase() ?? null,
      address: normalizeNullable(input.address),
    };
    const requestHash = await sha256(
      JSON.stringify({ operation: 'patient.create', ...normalized }),
    );
    const replay = await this.findIdempotency('patient.create', input.idempotencyKey);
    if (replay) return this.resolvePatientReplay(replay, requestHash);

    if (await this.hasDuplicate(normalized.displayName, normalized.birthDate, normalized.testIin)) {
      throw new PatientDuplicateCandidateError();
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.getAuditHead();
      if (!auditHead) throw new PatientRegistryConflictError('Audit stream unavailable');
      try {
        const patientId = await this.commitPatientCreate(input, normalized, requestHash, auditHead);
        const patient = await this.get(patientId);
        if (!patient) throw new PatientRegistryConflictError('Patient was not readable after create');
        return patient;
      } catch (error) {
        const racedReplay = await this.findIdempotency('patient.create', input.idempotencyKey);
        if (racedReplay) return this.resolvePatientReplay(racedReplay, requestHash);
        if (attempt === 2) throw error;
      }
    }
    throw new PatientRegistryConflictError('Patient creation retry exhausted');
  }

  async updateProfile(input: UpdatePatientProfileInput) {
    const normalized = {
      displayName: normalizeText(input.displayName),
      birthDate: input.birthDate,
      sexAtBirth: input.sexAtBirth,
      phone: normalizeNullable(input.phone),
      email: normalizeNullable(input.email)?.toLowerCase() ?? null,
      address: normalizeNullable(input.address),
      changeReason: normalizeText(input.changeReason),
    };
    const requestHash = await sha256(
      JSON.stringify({
        operation: 'patient.update',
        patientId: input.patientId,
        expectedVersion: input.expectedVersion,
        ...normalized,
      }),
    );
    const replay = await this.findIdempotency('patient.update', input.idempotencyKey);
    if (replay) return this.resolveProfileReplay(replay, requestHash);

    const patient = await this.get(input.patientId);
    if (!patient) throw new PatientNotFoundError();
    const current = await this.getCurrentProfile(input.patientId);
    if (!current) throw new PatientProfileUnavailableError();
    this.assertMutableProfile(current, input.expectedVersion);
    if (
      current.displayName === normalized.displayName &&
      current.birthDate === normalized.birthDate &&
      current.sexAtBirth === normalized.sexAtBirth &&
      current.phone === normalized.phone &&
      current.email === normalized.email &&
      current.address === normalized.address
    ) {
      throw new PatientProfileUnchangedError();
    }
    if (
      await this.hasDuplicate(
        normalized.displayName,
        normalized.birthDate,
        patient.testIin,
        input.patientId,
      )
    ) {
      throw new PatientDuplicateCandidateError();
    }

    return this.commitProfileWithRetry({
      operation: 'patient.update',
      input,
      current,
      next: { ...normalized, status: 'active' },
      requestHash,
    });
  }

  async archiveProfile(input: ArchivePatientProfileInput) {
    const changeReason = normalizeText(input.changeReason);
    const requestHash = await sha256(
      JSON.stringify({
        operation: 'patient.archive',
        patientId: input.patientId,
        expectedVersion: input.expectedVersion,
        changeReason,
      }),
    );
    const replay = await this.findIdempotency('patient.archive', input.idempotencyKey);
    if (replay) return this.resolveProfileReplay(replay, requestHash);

    const patient = await this.get(input.patientId);
    if (!patient) throw new PatientNotFoundError();
    const current = await this.getCurrentProfile(input.patientId);
    if (!current) throw new PatientProfileUnavailableError();
    if (current.status === 'inactive') throw new PatientAlreadyArchivedError();
    this.assertMutableProfile(current, input.expectedVersion);

    return this.commitProfileWithRetry({
      operation: 'patient.archive',
      input,
      current,
      next: {
        displayName: current.displayName,
        birthDate: current.birthDate,
        sexAtBirth: current.sexAtBirth,
        phone: current.phone,
        email: current.email,
        address: current.address,
        changeReason,
        status: 'inactive',
      },
      requestHash,
    });
  }

  async createEncounter(input: CreatePatientEncounterInput) {
    if (this.scope.role !== 'clinician') {
      throw new PatientEncounterRoleRequiredError();
    }
    const patient = await this.get(input.patientId);
    if (!patient || patient.status !== 'active') throw new PatientNotFoundError();
    const reasonForVisit = normalizeNullable(input.reasonForVisit);
    const requestHash = await sha256(
      JSON.stringify({
        operation: 'encounter.create_for_patient',
        patientId: input.patientId,
        reasonForVisit,
      }),
    );
    const replay = await this.findIdempotency(
      'encounter.create_for_patient',
      input.idempotencyKey,
    );
    if (replay) return this.resolveEncounterReplay(replay, requestHash);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.getAuditHead();
      if (!auditHead) throw new PatientRegistryConflictError('Audit stream unavailable');
      try {
        return await this.commitEncounterCreate(input, reasonForVisit, requestHash, auditHead);
      } catch (error) {
        const racedReplay = await this.findIdempotency(
          'encounter.create_for_patient',
          input.idempotencyKey,
        );
        if (racedReplay) return this.resolveEncounterReplay(racedReplay, requestHash);
        if (attempt === 2) throw error;
      }
    }
    throw new PatientRegistryConflictError('Encounter creation retry exhausted');
  }

  async getPhoto(patientId: string): Promise<PatientPhotoMetadata | null> {
    return this.database
      .prepare(`
        select photo.id, photo.object_key as objectKey, photo.mime_type as mimeType,
          photo.sha256, photo.byte_size as byteSize
        from patient_photo_heads head
        join patient_photo_assets photo
          on photo.organization_id = head.organization_id
          and photo.facility_id = head.facility_id
          and photo.patient_id = head.patient_id
          and photo.id = head.current_photo_asset_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.patient_id = ?3 and photo.status = 'ready'
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, patientId)
      .first<PatientPhotoMetadata>();
  }

  async registerPhoto(input: {
    patientId: string;
    objectKey: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
    actorId: string;
    requestId: string;
  }) {
    const patient = await this.get(input.patientId);
    if (!patient || patient.status !== 'active') throw new PatientNotFoundError();
    const existing = await this.getPhoto(input.patientId);
    if (existing?.sha256 === input.sha256) return existing;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.getAuditHead();
      if (!auditHead) throw new PatientRegistryConflictError('Audit stream unavailable');
      const now = Date.now();
      const photoId = `patient-photo-${crypto.randomUUID()}`;
      const headId = `patient-photo-head-${crypto.randomUUID()}`;
      const auditEventId = `audit-${crypto.randomUUID()}`;
      const auditSequence = auditHead.lastSequence + 1;
      const metadataJson = JSON.stringify({
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        replaced: Boolean(existing),
      });
      const eventHash = await hashAuditEvent({
        previousHash: auditHead.lastEventHash,
        organizationId: this.scope.organizationId,
        facilityId: this.scope.facilityId,
        sequence: auditSequence,
        actorType: 'user',
        actorId: input.actorId,
        actorMembershipId: this.scope.membershipId,
        action: 'patient.photo.replace',
        outcome: 'succeeded',
        purpose: 'patient_identity_management',
        schemaVersion: 1,
        entityType: 'patient',
        entityId: input.patientId,
        requestId: input.requestId,
        metadataJson,
        occurredAt: now,
      });
      const statements: D1PreparedStatement[] = [];
      if (existing) {
        statements.push(
          this.database
            .prepare(`
              update patient_photo_assets set status = 'deleted',
                updated_at = ?1, version = version + 1
              where organization_id = ?2 and facility_id = ?3 and id = ?4
                and status = 'ready'
            `)
            .bind(now, this.scope.organizationId, this.scope.facilityId, existing.id),
        );
      }
      statements.push(
        this.database
          .prepare(`
            insert into patient_photo_assets (
              id, organization_id, facility_id, patient_id, object_key,
              mime_type, sha256, byte_size, status, created_by_membership_id,
              created_at, updated_at, version
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10, ?10, 1)
          `)
          .bind(
            photoId,
            this.scope.organizationId,
            this.scope.facilityId,
            input.patientId,
            input.objectKey,
            input.mimeType,
            input.sha256,
            input.byteSize,
            this.scope.membershipId,
            now,
          ),
        this.database
          .prepare(`
            insert into patient_photo_heads (
              id, organization_id, facility_id, patient_id,
              current_photo_asset_id, lock_version, updated_at
            ) values (?1, ?2, ?3, ?4, ?5, 1, ?6)
            on conflict(organization_id, facility_id, patient_id) do update set
              current_photo_asset_id = excluded.current_photo_asset_id,
              lock_version = patient_photo_heads.lock_version + 1,
              updated_at = excluded.updated_at
          `)
          .bind(
            headId,
            this.scope.organizationId,
            this.scope.facilityId,
            input.patientId,
            photoId,
            now,
          ),
        this.auditInsert({
          auditEventId,
          auditHead,
          sequence: auditSequence,
          eventHash,
          actorId: input.actorId,
          action: 'patient.photo.replace',
          purpose: 'patient_identity_management',
          entityType: 'patient',
          entityId: input.patientId,
          requestId: input.requestId,
          metadataJson,
          occurredAt: now,
        }),
        this.auditHeadUpdate(auditHead, auditSequence, eventHash, auditEventId, now),
      );
      try {
        const results = await this.database.batch(statements);
        if (results.some((result) => result.meta.changes !== 1)) {
          throw new PatientRegistryConflictError('Photo metadata was not committed');
        }
        return {
          id: photoId,
          objectKey: input.objectKey,
          mimeType: input.mimeType,
          sha256: input.sha256,
          byteSize: input.byteSize,
        } satisfies PatientPhotoMetadata;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    throw new PatientRegistryConflictError('Photo registration retry exhausted');
  }

  private async getProfileHistory(patientId: string) {
    const rows = await this.database
      .prepare(`
        select profile.id, profile.version, profile.status,
          profile.change_reason as changeReason,
          profile.created_at as createdAt,
          coalesce(actor.display_name, 'Неизвестный сотрудник') as actorDisplayName
        from patient_profile_versions profile
        left join memberships membership
          on membership.organization_id = profile.organization_id
          and membership.facility_id = profile.facility_id
          and membership.id = profile.created_by_membership_id
        left join users actor on actor.id = membership.user_id
        where profile.organization_id = ?1 and profile.facility_id = ?2
          and profile.patient_id = ?3
        order by profile.version desc
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, patientId)
      .all<PatientProfileHistoryEntry>();
    return rows.results;
  }

  private async getCurrentProfile(patientId: string) {
    return this.database
      .prepare(`
        select head.current_version_id as currentVersionId,
          head.lock_version as lockVersion,
          profile.display_name as displayName,
          profile.birth_date as birthDate,
          profile.sex_at_birth as sexAtBirth,
          profile.phone, profile.email, profile.address, profile.status
        from patient_profile_heads head
        join patient_profile_versions profile
          on profile.organization_id = head.organization_id
          and profile.facility_id = head.facility_id
          and profile.patient_id = head.patient_id
          and profile.id = head.current_version_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.patient_id = ?3
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, patientId)
      .first<CurrentProfileRow>();
  }

  private assertMutableProfile(
    current: CurrentProfileRow,
    expectedVersion: number,
  ) {
    if (current.lockVersion !== expectedVersion) {
      throw new PatientProfileVersionConflictError(
        current.lockVersion,
        current.status,
      );
    }
    if (current.status !== 'active') throw new PatientProfileStateError();
  }

  private async commitProfileWithRetry(input: {
    operation: 'patient.update' | 'patient.archive';
    input: UpdatePatientProfileInput | ArchivePatientProfileInput;
    current: CurrentProfileRow;
    next: {
      displayName: string;
      birthDate: string | null;
      sexAtBirth: PatientSexAtBirth;
      phone: string | null;
      email: string | null;
      address: string | null;
      changeReason: string;
      status: 'active' | 'inactive';
    };
    requestHash: string;
  }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.getAuditHead();
      if (!auditHead) {
        throw new PatientRegistryConflictError('Audit stream unavailable');
      }
      try {
        await this.commitProfileMutation(input, auditHead);
        const patient = await this.get(input.input.patientId);
        if (!patient) {
          throw new PatientRegistryConflictError(
            'Patient was not readable after profile mutation',
          );
        }
        return patient;
      } catch (error) {
        const racedReplay = await this.findIdempotency(
          input.operation,
          input.input.idempotencyKey,
        );
        if (racedReplay) {
          return this.resolveProfileReplay(racedReplay, input.requestHash);
        }
        const latest = await this.getCurrentProfile(input.input.patientId);
        if (latest && latest.lockVersion !== input.input.expectedVersion) {
          throw new PatientProfileVersionConflictError(
            latest.lockVersion,
            latest.status,
          );
        }
        if (attempt === 2) {
          throw error instanceof PatientRegistryConflictError
            ? error
            : new PatientRegistryConflictError('Patient profile mutation failed');
        }
      }
    }
    throw new PatientRegistryConflictError('Patient profile mutation retry exhausted');
  }

  private async commitProfileMutation(
    input: {
      operation: 'patient.update' | 'patient.archive';
      input: UpdatePatientProfileInput | ArchivePatientProfileInput;
      current: CurrentProfileRow;
      next: {
        displayName: string;
        birthDate: string | null;
        sexAtBirth: PatientSexAtBirth;
        phone: string | null;
        email: string | null;
        address: string | null;
        changeReason: string;
        status: 'active' | 'inactive';
      };
      requestHash: string;
    },
    auditHead: AuditHeadRow,
  ) {
    const now = Date.now();
    const nextVersion = input.input.expectedVersion + 1;
    const profileVersionId = `patient-profile-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const sequence = auditHead.lastSequence + 1;
    const changedFields = [
      'displayName',
      'birthDate',
      'sexAtBirth',
      'phone',
      'email',
      'address',
      'status',
    ].filter((field) => {
      const key = field as keyof Pick<
        CurrentProfileRow,
        | 'displayName'
        | 'birthDate'
        | 'sexAtBirth'
        | 'phone'
        | 'email'
        | 'address'
        | 'status'
      >;
      return input.current[key] !== input.next[key];
    });
    const metadataJson = JSON.stringify({
      previousVersion: input.input.expectedVersion,
      resultingVersion: nextVersion,
      changedFields,
      resultingStatus: input.next.status,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: input.input.actorId,
      actorMembershipId: this.scope.membershipId,
      action: input.operation,
      outcome: 'succeeded',
      purpose: 'patient_identity_management',
      schemaVersion: 1,
      entityType: 'patient',
      entityId: input.input.patientId,
      requestId: input.input.requestId,
      metadataJson,
      occurredAt: now,
    });
    const responseJson = JSON.stringify({
      patientId: input.input.patientId,
      profileVersionId,
      previousVersion: input.input.expectedVersion,
      version: nextVersion,
      status: input.next.status,
    });
    const results = await this.database.batch([
      this.database
        .prepare(`
          insert into patient_profile_versions (
            id, organization_id, facility_id, patient_id, version,
            display_name, birth_date, sex_at_birth, phone, email, address,
            status, created_by_membership_id, change_reason,
            supersedes_profile_version_id, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15, ?16)
        `)
        .bind(
          profileVersionId,
          this.scope.organizationId,
          this.scope.facilityId,
          input.input.patientId,
          nextVersion,
          input.next.displayName,
          input.next.birthDate,
          input.next.sexAtBirth,
          input.next.phone,
          input.next.email,
          input.next.address,
          input.next.status,
          this.scope.membershipId,
          input.next.changeReason,
          input.current.currentVersionId,
          now,
        ),
      this.database
        .prepare(`
          update patient_profile_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4 and patient_id = ?5
            and current_version_id = ?6 and lock_version = ?7
        `)
        .bind(
          profileVersionId,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          input.input.patientId,
          input.current.currentVersionId,
          input.input.expectedVersion,
        ),
      this.auditInsert({
        auditEventId,
        auditHead,
        sequence,
        eventHash,
        actorId: input.input.actorId,
        action: input.operation,
        purpose: 'patient_identity_management',
        entityType: 'patient',
        entityId: input.input.patientId,
        requestId: input.input.requestId,
        metadataJson,
        occurredAt: now,
      }),
      this.auditHeadUpdate(auditHead, sequence, eventHash, auditEventId, now),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'processing', ?8)
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.membershipId,
          input.operation,
          input.input.idempotencyKey,
          input.requestHash,
          now,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'patient',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
        `)
        .bind(input.input.patientId, responseJson, now, commandId),
    ]);
    if (results.some((result) => result.meta.changes !== 1)) {
      throw new PatientRegistryConflictError('Patient profile was not committed');
    }
  }

  private async commitPatientCreate(
    input: CreatePatientInput,
    patient: Omit<CreatePatientInput, 'idempotencyKey' | 'actorId' | 'requestId'>,
    requestHash: string,
    auditHead: AuditHeadRow,
  ) {
    const now = Date.now();
    const patientId = `patient-${crypto.randomUUID()}`;
    const profileVersionId = `patient-profile-${crypto.randomUUID()}`;
    const profileHeadId = `patient-profile-head-${crypto.randomUUID()}`;
    const identifierId = `patient-identifier-${crypto.randomUUID()}`;
    const medicalRecordNumber = `OR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const sequence = auditHead.lastSequence + 1;
    const metadataJson = JSON.stringify({
      profileVersion: 1,
      hasTestIin: Boolean(patient.testIin),
      hasContact: Boolean(patient.phone || patient.email || patient.address),
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.membershipId,
      action: 'patient.create',
      outcome: 'succeeded',
      purpose: 'patient_identity_management',
      schemaVersion: 1,
      entityType: 'patient',
      entityId: patientId,
      requestId: input.requestId,
      metadataJson,
      occurredAt: now,
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
          this.scope.organizationId,
          this.scope.facilityId,
          medicalRecordNumber,
          patient.displayName,
          patient.birthDate,
          patient.sexAtBirth,
          now,
        ),
      this.database
        .prepare(`
          insert into patient_profile_versions (
            id, organization_id, facility_id, patient_id, version,
            display_name, birth_date, sex_at_birth, phone, email, address,
            status, created_by_membership_id, change_reason, created_at
          ) values (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10,
            'active', ?11, 'initial_registration', ?12)
        `)
        .bind(
          profileVersionId,
          this.scope.organizationId,
          this.scope.facilityId,
          patientId,
          patient.displayName,
          patient.birthDate,
          patient.sexAtBirth,
          patient.phone,
          patient.email,
          patient.address,
          this.scope.membershipId,
          now,
        ),
      this.database
        .prepare(`
          insert into patient_profile_heads (
            id, organization_id, facility_id, patient_id,
            current_version_id, lock_version, updated_at
          ) values (?1, ?2, ?3, ?4, ?5, 1, ?6)
        `)
        .bind(
          profileHeadId,
          this.scope.organizationId,
          this.scope.facilityId,
          patientId,
          profileVersionId,
          now,
        ),
    ];
    if (patient.testIin) {
      statements.push(
        this.database
          .prepare(`
            insert into patient_identifiers (
              id, organization_id, facility_id, patient_id, kind,
              normalized_value, display_last4, status,
              created_by_membership_id, created_at, updated_at, version
            ) values (?1, ?2, ?3, ?4, 'test_iin', ?5, ?6, 'active', ?7, ?8, ?8, 1)
          `)
          .bind(
            identifierId,
            this.scope.organizationId,
            this.scope.facilityId,
            patientId,
            patient.testIin,
            patient.testIin.slice(-4),
            this.scope.membershipId,
            now,
          ),
      );
    }
    statements.push(
      this.auditInsert({
        auditEventId,
        auditHead,
        sequence,
        eventHash,
        actorId: input.actorId,
        action: 'patient.create',
        purpose: 'patient_identity_management',
        entityType: 'patient',
        entityId: patientId,
        requestId: input.requestId,
        metadataJson,
        occurredAt: now,
      }),
      this.auditHeadUpdate(auditHead, sequence, eventHash, auditEventId, now),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at
          ) values (?1, ?2, ?3, ?4, 'patient.create', ?5, ?6, 'processing', ?7)
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.membershipId,
          input.idempotencyKey,
          requestHash,
          now,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'patient',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
        `)
        .bind(patientId, JSON.stringify({ patientId }), now, commandId),
    );
    const results = await this.database.batch(statements);
    if (results.some((result) => result.meta.changes !== 1)) {
      throw new PatientRegistryConflictError('Patient was not committed');
    }
    return patientId;
  }

  private async commitEncounterCreate(
    input: CreatePatientEncounterInput,
    reasonForVisit: string | null,
    requestHash: string,
    auditHead: AuditHeadRow,
  ) {
    const now = Date.now();
    const encounterId = `encounter-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const sequence = auditHead.lastSequence + 1;
    const sections = clinicalSectionCodeSchema.options.map((code) => ({
      code,
      versionId: `section-${crypto.randomUUID()}`,
      headId: `section-head-${crypto.randomUUID()}`,
    }));
    const metadataJson = JSON.stringify({
      encounterVersion: 1,
      initializedClinicalSectionCount: sections.length,
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.membershipId,
      action: 'encounter.create_for_patient',
      outcome: 'succeeded',
      purpose: 'direct_patient_care',
      schemaVersion: 1,
      entityType: 'encounter',
      entityId: encounterId,
      requestId: input.requestId,
      metadataJson,
      occurredAt: now,
    });
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(`
          insert into encounters (
            id, organization_id, facility_id, patient_id,
            clinician_membership_id, status, reason_for_visit,
            created_at, updated_at, version
          ) select ?1, ?2, ?3, patient.id, ?4, 'draft', ?5, ?6, ?6, 1
          from patients patient
          left join patient_profile_heads profile_head
            on profile_head.organization_id = patient.organization_id
            and profile_head.facility_id = patient.facility_id
            and profile_head.patient_id = patient.id
          left join patient_profile_versions profile
            on profile.organization_id = patient.organization_id
            and profile.facility_id = patient.facility_id
            and profile.patient_id = patient.id
            and profile.id = profile_head.current_version_id
          where patient.organization_id = ?2 and patient.facility_id = ?3
            and patient.id = ?7
            and coalesce(profile.status, patient.status) = 'active'
        `)
        .bind(
          encounterId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.membershipId,
          reasonForVisit,
          now,
          input.patientId,
        ),
    ];
    const provenance = JSON.stringify({ sourceType: 'clinician', sourceIds: [] });
    for (const section of sections) {
      statements.push(
        this.database
          .prepare(`
            insert into clinical_section_versions (
              id, organization_id, facility_id, encounter_id, code, content,
              review_state, provenance_json, created_by_type, created_by_id,
              created_at, version
            ) values (?1, ?2, ?3, ?4, ?5, '', 'empty', ?6, 'service',
              'patient-encounter-creation', ?7, 1)
          `)
          .bind(
            section.versionId,
            this.scope.organizationId,
            this.scope.facilityId,
            encounterId,
            section.code,
            provenance,
            now,
          ),
      );
    }
    for (const section of sections) {
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
            this.scope.organizationId,
            this.scope.facilityId,
            encounterId,
            section.code,
            section.versionId,
            now,
          ),
      );
    }
    statements.push(
      this.auditInsert({
        auditEventId,
        auditHead,
        sequence,
        eventHash,
        actorId: input.actorId,
        action: 'encounter.create_for_patient',
        purpose: 'direct_patient_care',
        entityType: 'encounter',
        entityId: encounterId,
        requestId: input.requestId,
        metadataJson,
        occurredAt: now,
      }),
      this.auditHeadUpdate(auditHead, sequence, eventHash, auditEventId, now),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at
          ) values (?1, ?2, ?3, ?4, 'encounter.create_for_patient', ?5, ?6,
            'processing', ?7)
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.membershipId,
          input.idempotencyKey,
          requestHash,
          now,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'encounter',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
        `)
        .bind(encounterId, JSON.stringify({ encounterId }), now, commandId),
    );
    const results = await this.database.batch(statements);
    if (results.some((result) => result.meta.changes !== 1)) {
      throw new PatientRegistryConflictError('Encounter was not committed');
    }
    return {
      id: encounterId,
      status: 'draft' as const,
      reasonForVisit,
      startedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }

  private async hasDuplicate(
    displayName: string,
    birthDate: string | null,
    testIin: string | null,
    excludePatientId: string | null = null,
  ) {
    const row = await this.database
      .prepare(`
        select patient.id
        from patients patient
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = patient.organization_id
          and profile.facility_id = patient.facility_id
          and profile.patient_id = patient.id
          and profile.id = profile_head.current_version_id
        left join patient_identifiers identifier
          on identifier.organization_id = patient.organization_id
          and identifier.facility_id = patient.facility_id
          and identifier.patient_id = patient.id
          and identifier.kind = 'test_iin' and identifier.status = 'active'
        where patient.organization_id = ?1 and patient.facility_id = ?2
          and coalesce(profile.status, patient.status) = 'active'
          and (?6 is null or patient.id <> ?6)
          and (
            (?3 is not null and identifier.normalized_value = ?3)
            or (lower(coalesce(profile.display_name, patient.display_name)) = lower(?4)
              and coalesce(profile.birth_date, patient.birth_date) is ?5)
          )
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        testIin,
        displayName,
        birthDate,
        excludePatientId,
      )
      .first<{ id: string }>();
    return Boolean(row);
  }

  private async getAuditHead() {
    return this.database
      .prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash,
          lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
  }

  private async findIdempotency(operation: string, key: string) {
    return this.database
      .prepare(`
        select request_hash as requestHash, status,
          result_resource_id as resultResourceId,
          response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = ?4
          and idempotency_key = ?5
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        operation,
        key,
      )
      .first<IdempotencyRow>();
  }

  private async resolvePatientReplay(replay: IdempotencyRow, requestHash: string) {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId
    ) {
      throw new PatientRegistryConflictError('Patient command conflicts with an earlier request');
    }
    const patient = await this.get(replay.resultResourceId);
    if (!patient) throw new PatientRegistryConflictError('Replayed patient no longer resolves');
    return patient;
  }

  private async resolveProfileReplay(
    replay: IdempotencyRow,
    requestHash: string,
  ) {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId ||
      !replay.responseJson
    ) {
      throw new PatientRegistryConflictError(
        'Patient profile command conflicts with an earlier request',
      );
    }
    let response: { patientId?: string };
    try {
      response = JSON.parse(replay.responseJson) as { patientId?: string };
    } catch {
      throw new PatientRegistryConflictError(
        'Patient profile replay response is invalid',
      );
    }
    if (response.patientId !== replay.resultResourceId) {
      throw new PatientRegistryConflictError(
        'Patient profile replay scope is inconsistent',
      );
    }
    const patient = await this.get(replay.resultResourceId);
    if (!patient) {
      throw new PatientRegistryConflictError(
        'Replayed patient profile no longer resolves',
      );
    }
    return patient;
  }

  private async resolveEncounterReplay(replay: IdempotencyRow, requestHash: string) {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId
    ) {
      throw new PatientRegistryConflictError('Encounter command conflicts with an earlier request');
    }
    const row = await this.database
      .prepare(`
        select id, status, reason_for_visit as reasonForVisit,
          started_at as startedAt, ended_at as endedAt,
          created_at as createdAt, updated_at as updatedAt, version
        from encounters
        where organization_id = ?1 and facility_id = ?2 and id = ?3
        limit 1
      `)
      .bind(this.scope.organizationId, this.scope.facilityId, replay.resultResourceId)
      .first<EncounterSummary>();
    if (!row) throw new PatientRegistryConflictError('Replayed encounter no longer resolves');
    return row;
  }

  private auditInsert(input: {
    auditEventId: string;
    auditHead: AuditHeadRow;
    sequence: number;
    eventHash: string;
    actorId: string;
    action: string;
    purpose: string;
    entityType: string;
    entityId: string;
    requestId: string;
    metadataJson: string;
    occurredAt: number;
  }) {
    return this.database
      .prepare(`
        insert into audit_events (
          id, organization_id, facility_id, sequence, actor_type, actor_id,
          actor_membership_id, action, outcome, purpose, schema_version,
          entity_type, entity_id, request_id, metadata_json, previous_hash,
          event_hash, occurred_at
        ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded', ?8,
          1, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
      `)
      .bind(
        input.auditEventId,
        this.scope.organizationId,
        this.scope.facilityId,
        input.sequence,
        input.actorId,
        this.scope.membershipId,
        input.action,
        input.purpose,
        input.entityType,
        input.entityId,
        input.requestId,
        input.metadataJson,
        input.auditHead.lastEventHash,
        input.eventHash,
        input.occurredAt,
      );
  }

  private auditHeadUpdate(
    auditHead: AuditHeadRow,
    sequence: number,
    eventHash: string,
    auditEventId: string,
    now: number,
  ) {
    return this.database
      .prepare(`
        update audit_stream_heads
        set last_sequence = ?1, last_event_hash = ?2,
          lock_version = lock_version + 1, updated_at = ?3
        where organization_id = ?4 and facility_id = ?5
          and last_sequence = ?6 and lock_version = ?7
          and exists (select 1 from audit_events where id = ?8)
      `)
      .bind(
        sequence,
        eventHash,
        now,
        this.scope.organizationId,
        this.scope.facilityId,
        auditHead.lastSequence,
        auditHead.lockVersion,
        auditEventId,
      );
  }
}

export async function sha256Bytes(bytes: ArrayBuffer) {
  return sha256(bytes);
}
