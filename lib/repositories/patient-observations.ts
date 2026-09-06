import { hashAuditEvent } from '@/lib/audit/event-hash';
import {
  observationCapabilities,
  requireObservationPermission,
  type ObservationPermission,
  type ObservationScope,
} from '@/lib/auth/observation-access';
import {
  LOCAL_OBSERVATION_SOURCE_LABEL,
  observationContexts,
  observationValuesSchema,
  toStoredObservationValues,
  fromStoredObservationValues,
  validateMeasuredAt,
  type ObservationContext,
  type ObservationInputValues,
  type StoredObservationValues,
} from '@/lib/domain/observations';

export type ObservationPatient = {
  id: string;
  displayName: string;
  medicalRecordNumber: string;
};

export type ObservationVersionRecord = {
  id: string;
  version: number;
  supersedesVersionId: string | null;
  measuredAt: number;
  context: ObservationContext;
  values: ObservationInputValues & { bmi: number | null };
  units: {
    height: 'cm';
    weight: 'kg';
    bmi: 'kg/m²';
    pressure: 'мм рт. ст.';
    temperature: '°C';
  };
  note: string | null;
  sourceType: 'manual_test';
  sourceLabel: string;
  recordedByMembershipId: string;
  accessAssignmentId: string | null;
  recordedBy: string;
  recordedAt: number;
  changeReason: string;
  inputHash: string;
};

export type PatientObservationRecord = {
  id: string;
  patient: ObservationPatient;
  current: ObservationVersionRecord;
  history: ObservationVersionRecord[];
};

export type ObservationWorkspace = {
  dataMode: 'synthetic-only';
  role: ObservationScope['role'];
  timeZone: string;
  sourceLabel: string;
  patients: ObservationPatient[];
  observations: PatientObservationRecord[];
  capabilities: Record<ObservationPermission, boolean>;
  clinicalInterpretation: 'not_performed';
  thresholdPolicy: {
    status: 'not_configured';
    decision: 'DEC-006';
    message: string;
  };
};

export type CreatePatientObservationCommand = {
  patientId: string;
  measuredAt: number;
  context: ObservationContext;
  values: ObservationInputValues;
  note: string | null;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export type CorrectPatientObservationCommand =
  CreatePatientObservationCommand & {
    observationId: string;
    expectedVersion: number;
  };

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type IdempotencyRow = {
  id: string;
  requestHash: string;
  status: string;
  resultResourceId: string | null;
  responseJson: string | null;
};

type PatientRow = {
  id: string;
  displayName: string;
  medicalRecordNumber: string;
};

type ObservationRow = StoredObservationValues & {
  observationId: string;
  patientId: string;
  patientDisplayName: string;
  medicalRecordNumber: string;
  sourceType: 'manual_test';
  sourceLabel: string;
  versionId: string;
  version: number;
  supersedesVersionId: string | null;
  measuredAt: number;
  measurementContext: ObservationContext;
  note: string | null;
  recordedByMembershipId: string;
  accessAssignmentId: string | null;
  recordedBy: string;
  recordedAt: number;
  changeReason: string;
  inputHash: string;
  headLockVersion: number;
};

export class ObservationNotFoundError extends Error {
  constructor() {
    super('The observation or patient is unavailable in this scope');
    this.name = 'ObservationNotFoundError';
  }
}

export class ObservationVersionConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super('The observation changed before this command was saved');
    this.name = 'ObservationVersionConflictError';
  }
}

export class ObservationConflictError extends Error {
  constructor(message = 'The observation command conflicts with stored state') {
    super(message);
    this.name = 'ObservationConflictError';
  }
}

export class ObservationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservationValidationError';
  }
}

export class ObservationCorrectionForbiddenError extends Error {
  constructor() {
    super('A nurse can correct only a measurement they recorded');
    this.name = 'ObservationCorrectionForbiddenError';
  }
}

export class ObservationAuditUnavailableError extends Error {
  constructor() {
    super('The observation audit stream is unavailable');
    this.name = 'ObservationAuditUnavailableError';
  }
}

function normalizeText(value: string, minimum: number, maximum: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ObservationValidationError('Текстовое поле заполнено некорректно');
  }
  return normalized;
}

function normalizeNullable(value: string | null) {
  return value === null ? null : normalizeText(value, 3, 1_000);
}

function normalizeContext(value: ObservationContext) {
  if (!observationContexts.includes(value)) {
    throw new ObservationValidationError('Контекст измерения не поддерживается');
  }
  return value;
}

function normalizeValues(values: ObservationInputValues) {
  const parsed = observationValuesSchema.safeParse(values);
  if (!parsed.success) {
    throw new ObservationValidationError(
      parsed.error.issues[0]?.message ?? 'Проверьте значения показателей',
    );
  }
  return parsed.data;
}

async function sha256Json(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function versionFromRow(row: ObservationRow): ObservationVersionRecord {
  return {
    id: row.versionId,
    version: row.version,
    supersedesVersionId: row.supersedesVersionId,
    measuredAt: row.measuredAt,
    context: row.measurementContext,
    values: fromStoredObservationValues({
      heightMm: row.heightMm,
      weightGrams: row.weightGrams,
      bmiHundredths: row.bmiHundredths,
      systolicMmhg: row.systolicMmhg,
      diastolicMmhg: row.diastolicMmhg,
      temperatureMilliC: row.temperatureMilliC,
    }),
    units: {
      height: 'cm',
      weight: 'kg',
      bmi: 'kg/m²',
      pressure: 'мм рт. ст.',
      temperature: '°C',
    },
    note: row.note,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
    recordedByMembershipId: row.recordedByMembershipId,
    accessAssignmentId: row.accessAssignmentId,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt,
    changeReason: row.changeReason,
    inputHash: row.inputHash,
  };
}

function recordFromRows(current: ObservationRow, history: ObservationRow[]) {
  return {
    id: current.observationId,
    patient: {
      id: current.patientId,
      displayName: current.patientDisplayName,
      medicalRecordNumber: current.medicalRecordNumber,
    },
    current: versionFromRow(current),
    history: history
      .sort((left, right) => right.version - left.version)
      .map(versionFromRow),
  } satisfies PatientObservationRecord;
}

const observationSelect = `
  select record.id as observationId, record.patient_id as patientId,
    coalesce(profile.display_name, patient.display_name) as patientDisplayName,
    patient.medical_record_number as medicalRecordNumber,
    record.source_type as sourceType, record.source_label as sourceLabel,
    version.id as versionId, version.version,
    version.supersedes_version_id as supersedesVersionId,
    version.measured_at as measuredAt,
    version.measurement_context as measurementContext,
    version.height_mm as heightMm, version.weight_grams as weightGrams,
    version.bmi_hundredths as bmiHundredths,
    version.systolic_mmhg as systolicMmhg,
    version.diastolic_mmhg as diastolicMmhg,
    version.temperature_milli_c as temperatureMilliC,
    version.note, version.recorded_by_membership_id as recordedByMembershipId,
    version.access_assignment_id as accessAssignmentId,
    recorder_user.display_name as recordedBy, version.recorded_at as recordedAt,
    version.change_reason as changeReason, version.input_hash as inputHash,
    head.lock_version as headLockVersion
  from patient_observation_records record
  join patients patient
    on patient.organization_id = record.organization_id
    and patient.facility_id = record.facility_id
    and patient.id = record.patient_id
  left join patient_profile_heads profile_head
    on profile_head.organization_id = patient.organization_id
    and profile_head.facility_id = patient.facility_id
    and profile_head.patient_id = patient.id
  left join patient_profile_versions profile
    on profile.organization_id = profile_head.organization_id
    and profile.facility_id = profile_head.facility_id
    and profile.patient_id = profile_head.patient_id
    and profile.id = profile_head.current_version_id
  join patient_observation_heads head
    on head.organization_id = record.organization_id
    and head.facility_id = record.facility_id
    and head.observation_id = record.id
    and head.patient_id = record.patient_id
  join patient_observation_versions version
    on version.organization_id = record.organization_id
    and version.facility_id = record.facility_id
    and version.observation_id = record.id
    and version.patient_id = record.patient_id
  join memberships recorder
    on recorder.organization_id = version.organization_id
    and recorder.facility_id = version.facility_id
    and recorder.id = version.recorded_by_membership_id
  join users recorder_user on recorder_user.id = recorder.user_id
`;

export class D1PatientObservationRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: ObservationScope,
  ) {}

  async list(input: {
    patientId?: string;
    limit?: number;
  } = {}): Promise<ObservationWorkspace> {
    requireObservationPermission(this.scope.role, 'workspace.read');
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const [facility, patientResult, currentResult] = await Promise.all([
      this.database
        .prepare(`select timezone from facilities
          where organization_id = ?1 and id = ?2 and status = 'active' limit 1`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .first<{ timezone: string }>(),
      this.database
        .prepare(`select patient.id,
            coalesce(profile.display_name, patient.display_name) as displayName,
            patient.medical_record_number as medicalRecordNumber
          from patients patient
          left join patient_profile_heads profile_head
            on profile_head.organization_id = patient.organization_id
            and profile_head.facility_id = patient.facility_id
            and profile_head.patient_id = patient.id
          left join patient_profile_versions profile
            on profile.organization_id = profile_head.organization_id
            and profile.facility_id = profile_head.facility_id
            and profile.patient_id = profile_head.patient_id
            and profile.id = profile_head.current_version_id
          where patient.organization_id = ?1 and patient.facility_id = ?2
            and patient.status = 'active'
          order by displayName, patient.id limit 200`)
        .bind(this.scope.organizationId, this.scope.facilityId)
        .all<PatientRow>(),
      this.database
        .prepare(`${observationSelect}
          where record.organization_id = ?1 and record.facility_id = ?2
            and version.id = head.current_version_id
            and patient.status = 'active'
            and (?3 is null or record.patient_id = ?3)
          order by version.measured_at desc, version.recorded_at desc, record.id
          limit ?4`)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          input.patientId ?? null,
          limit,
        )
        .all<ObservationRow>(),
    ]);
    if (!facility) throw new ObservationNotFoundError();
    if (
      input.patientId &&
      !patientResult.results.some((patient) => patient.id === input.patientId)
    ) {
      throw new ObservationNotFoundError();
    }

    const currentRows = currentResult.results;
    let historyRows: ObservationRow[] = [];
    if (currentRows.length > 0) {
      const placeholders = currentRows.map((_, index) => `?${index + 3}`).join(', ');
      historyRows = (
        await this.database
          .prepare(`${observationSelect}
            where record.organization_id = ?1 and record.facility_id = ?2
              and version.observation_id in (${placeholders})
            order by version.observation_id, version.version desc`)
          .bind(
            this.scope.organizationId,
            this.scope.facilityId,
            ...currentRows.map((row) => row.observationId),
          )
          .all<ObservationRow>()
      ).results;
    }
    const historyByObservation = new Map<string, ObservationRow[]>();
    for (const row of historyRows) {
      const rows = historyByObservation.get(row.observationId) ?? [];
      rows.push(row);
      historyByObservation.set(row.observationId, rows);
    }

    return {
      dataMode: 'synthetic-only',
      role: this.scope.role,
      timeZone: facility.timezone,
      sourceLabel: LOCAL_OBSERVATION_SOURCE_LABEL,
      patients: patientResult.results,
      observations: currentRows.map((row) =>
        recordFromRows(row, historyByObservation.get(row.observationId) ?? [row]),
      ),
      capabilities: observationCapabilities(this.scope.role),
      clinicalInterpretation: 'not_performed',
      thresholdPolicy: {
        status: 'not_configured',
        decision: 'DEC-006',
        message:
          'Порог критичности и SLA не утверждены клиникой. ORION сохраняет значения без медицинской классификации.',
      },
    };
  }

  async recordListRead(input: {
    patientId: string | null;
    resultCount: number;
    requestId: string;
  }) {
    requireObservationPermission(this.scope.role, 'workspace.read');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: 'observation.workspace.read',
        entityType: 'patient_observation_workspace',
        entityId: input.patientId ?? this.scope.facilityId,
        requestId: input.requestId,
        metadata: {
          patientScoped: input.patientId !== null,
          resultCount: input.resultCount,
          role: this.scope.role,
          accessAssignmentId: this.scope.accessAssignmentId,
          dataMode: 'synthetic-only',
        },
        occurredAt: Date.now(),
      });
      try {
        const results = await this.database.batch([
          this.auditInsert(audit),
          this.auditHeadUpdate(audit),
        ]);
        if (
          results.length !== 2 ||
          results.some((result) => result.meta.changes !== 1)
        ) {
          throw new Error('Observation read audit did not commit');
        }
        return;
      } catch {
        if (attempt === 2) throw new ObservationAuditUnavailableError();
      }
    }
  }

  async create(
    input: CreatePatientObservationCommand,
  ): Promise<PatientObservationRecord> {
    requireObservationPermission(this.scope.role, 'observation.record');
    const normalized = this.normalizeCommand(input);
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      ...normalized,
      patientId: input.patientId,
      dataMode: 'synthetic-only',
    });
    const replay = await this.findIdempotency(
      'observation.create',
      input.idempotencyKey,
    );
    if (replay) {
      return this.resolveReplay<PatientObservationRecord>(replay, requestHash);
    }
    const patient = await this.requireActivePatient(input.patientId);
    const recorder = await this.requireCurrentUserDisplayName();
    const now = Date.now();
    this.requireValidMeasuredAt(normalized.measuredAt, now);
    const observationId = `observation-${crypto.randomUUID()}`;
    const versionId = `observation-version-${crypto.randomUUID()}`;
    const stored = toStoredObservationValues(normalized.values);
    const inputHash = await sha256Json({
      patientId: input.patientId,
      measuredAt: normalized.measuredAt,
      context: normalized.context,
      values: stored,
      note: normalized.note,
      sourceType: 'manual_test',
      sourceLabel: LOCAL_OBSERVATION_SOURCE_LABEL,
    });
    const row = this.responseRow({
      observationId,
      patient,
      versionId,
      version: 1,
      supersedesVersionId: null,
      normalized,
      stored,
      inputHash,
      recorder,
      recordedAt: now,
      headLockVersion: 1,
    });
    const response = recordFromRows(row, [row]);

    return this.commitCommand({
      operation: 'observation.create',
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'patient_observation',
      resourceId: observationId,
      response,
      action: 'observation.recorded',
      entityType: 'patient_observation',
      requestId: input.requestId,
      metadata: {
        accessAssignmentId: this.scope.accessAssignmentId,
        patientId: input.patientId,
        version: 1,
        sourceType: 'manual_test',
        measurementGroups: this.measurementGroups(stored),
        clinicalInterpretation: 'not_performed',
      },
      now,
      statements: [
        this.database
          .prepare(`insert into patient_observation_records (
            id, organization_id, facility_id, patient_id, source_type,
            source_label, created_by_membership_id, access_assignment_id,
            created_at
          ) values (?1, ?2, ?3, ?4, 'manual_test', ?5, ?6, ?7, ?8)`)
          .bind(
            observationId,
            this.scope.organizationId,
            this.scope.facilityId,
            input.patientId,
            LOCAL_OBSERVATION_SOURCE_LABEL,
            this.scope.membershipId,
            this.scope.accessAssignmentId,
            now,
          ),
        this.versionInsert({
          observationId,
          patientId: input.patientId,
          versionId,
          version: 1,
          supersedesVersionId: null,
          normalized,
          stored,
          inputHash,
          recordedAt: now,
        }),
        this.database
          .prepare(`insert into patient_observation_heads (
            id, organization_id, facility_id, observation_id, patient_id,
            current_version_id, lock_version, created_at, updated_at
          ) values (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)`)
          .bind(
            `observation-head-${crypto.randomUUID()}`,
            this.scope.organizationId,
            this.scope.facilityId,
            observationId,
            input.patientId,
            versionId,
            now,
          ),
      ],
    });
  }

  async correct(
    input: CorrectPatientObservationCommand,
  ): Promise<PatientObservationRecord> {
    requireObservationPermission(this.scope.role, 'observation.correct');
    const normalized = this.normalizeCommand(input);
    const requestHash = await sha256Json({
      accessAssignmentId: this.scope.accessAssignmentId,
      ...normalized,
      patientId: input.patientId,
      observationId: input.observationId,
      expectedVersion: input.expectedVersion,
      dataMode: 'synthetic-only',
    });
    const replay = await this.findIdempotency(
      'observation.correct',
      input.idempotencyKey,
    );
    if (replay) {
      return this.resolveReplay<PatientObservationRecord>(replay, requestHash);
    }
    const current = await this.requireCurrentObservation(
      input.observationId,
      input.patientId,
    );
    if (current.version !== input.expectedVersion) {
      throw new ObservationVersionConflictError(current.version);
    }
    if (
      this.scope.role === 'nurse' &&
      current.recordedByMembershipId !== this.scope.membershipId
    ) {
      throw new ObservationCorrectionForbiddenError();
    }
    const now = Date.now();
    this.requireValidMeasuredAt(normalized.measuredAt, now);
    const stored = toStoredObservationValues(normalized.values);
    const inputHash = await sha256Json({
      patientId: input.patientId,
      measuredAt: normalized.measuredAt,
      context: normalized.context,
      values: stored,
      note: normalized.note,
      sourceType: 'manual_test',
      sourceLabel: LOCAL_OBSERVATION_SOURCE_LABEL,
    });
    if (inputHash === current.inputHash) {
      throw new ObservationValidationError(
        'Исправление должно изменить время, контекст, значения или примечание',
      );
    }
    const recorder = await this.requireCurrentUserDisplayName();
    const versionId = `observation-version-${crypto.randomUUID()}`;
    const nextVersion = current.version + 1;
    const nextRow = this.responseRow({
      observationId: input.observationId,
      patient: {
        id: current.patientId,
        displayName: current.patientDisplayName,
        medicalRecordNumber: current.medicalRecordNumber,
      },
      versionId,
      version: nextVersion,
      supersedesVersionId: current.versionId,
      normalized,
      stored,
      inputHash,
      recorder,
      recordedAt: now,
      headLockVersion: current.headLockVersion + 1,
    });
    const history = await this.listHistory(input.observationId);
    const response = recordFromRows(nextRow, [nextRow, ...history]);

    return this.commitCommand({
      operation: 'observation.correct',
      key: input.idempotencyKey,
      requestHash,
      resourceType: 'patient_observation',
      resourceId: input.observationId,
      response,
      action: 'observation.corrected',
      entityType: 'patient_observation',
      requestId: input.requestId,
      metadata: {
        accessAssignmentId: this.scope.accessAssignmentId,
        patientId: input.patientId,
        version: nextVersion,
        supersedesVersionId: current.versionId,
        sourceType: 'manual_test',
        measurementGroups: this.measurementGroups(stored),
        clinicalInterpretation: 'not_performed',
      },
      now,
      statements: [
        this.versionInsert({
          observationId: input.observationId,
          patientId: input.patientId,
          versionId,
          version: nextVersion,
          supersedesVersionId: current.versionId,
          normalized,
          stored,
          inputHash,
          recordedAt: now,
        }),
        this.database
          .prepare(`update patient_observation_heads
            set current_version_id = ?1, lock_version = lock_version + 1,
              updated_at = ?2
            where organization_id = ?3 and facility_id = ?4
              and observation_id = ?5 and patient_id = ?6
              and current_version_id = ?7 and lock_version = ?8`)
          .bind(
            versionId,
            now,
            this.scope.organizationId,
            this.scope.facilityId,
            input.observationId,
            input.patientId,
            current.versionId,
            current.headLockVersion,
          ),
      ],
    });
  }

  private normalizeCommand(input: CreatePatientObservationCommand) {
    try {
      return {
        measuredAt: input.measuredAt,
        context: normalizeContext(input.context),
        values: normalizeValues(input.values),
        note: normalizeNullable(input.note),
        reason: normalizeText(input.reason, 3, 500),
      };
    } catch (error) {
      if (error instanceof ObservationValidationError) throw error;
      throw new ObservationValidationError('Проверьте данные измерения');
    }
  }

  private requireValidMeasuredAt(measuredAt: number, now: number) {
    try {
      validateMeasuredAt(measuredAt, now);
    } catch {
      throw new ObservationValidationError(
        'Время измерения находится вне допустимого диапазона',
      );
    }
  }

  private async requireActivePatient(patientId: string) {
    const patient = await this.database
      .prepare(`select patient.id,
          coalesce(profile.display_name, patient.display_name) as displayName,
          patient.medical_record_number as medicalRecordNumber
        from patients patient
        left join patient_profile_heads profile_head
          on profile_head.organization_id = patient.organization_id
          and profile_head.facility_id = patient.facility_id
          and profile_head.patient_id = patient.id
        left join patient_profile_versions profile
          on profile.organization_id = profile_head.organization_id
          and profile.facility_id = profile_head.facility_id
          and profile.patient_id = profile_head.patient_id
          and profile.id = profile_head.current_version_id
        where patient.organization_id = ?1 and patient.facility_id = ?2
          and patient.id = ?3 and patient.status = 'active' limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId, patientId)
      .first<PatientRow>();
    if (!patient) throw new ObservationNotFoundError();
    return patient;
  }

  private async requireCurrentObservation(
    observationId: string,
    patientId: string,
  ) {
    const row = await this.database
      .prepare(`${observationSelect}
        where record.organization_id = ?1 and record.facility_id = ?2
          and record.id = ?3 and record.patient_id = ?4
          and patient.status = 'active' and version.id = head.current_version_id
        limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        observationId,
        patientId,
      )
      .first<ObservationRow>();
    if (!row) throw new ObservationNotFoundError();
    return row;
  }

  private async listHistory(observationId: string) {
    return (
      await this.database
        .prepare(`${observationSelect}
          where record.organization_id = ?1 and record.facility_id = ?2
            and record.id = ?3
          order by version.version desc`)
        .bind(this.scope.organizationId, this.scope.facilityId, observationId)
        .all<ObservationRow>()
    ).results;
  }

  private async requireCurrentUserDisplayName() {
    const row = await this.database
      .prepare(`select user.display_name as displayName
        from memberships membership join users user on user.id = membership.user_id
        where membership.organization_id = ?1 and membership.facility_id = ?2
          and membership.id = ?3 and membership.status = 'active'
          and user.status = 'active' limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
      )
      .first<{ displayName: string }>();
    if (!row) throw new ObservationNotFoundError();
    return row.displayName;
  }

  private responseRow(input: {
    observationId: string;
    patient: ObservationPatient;
    versionId: string;
    version: number;
    supersedesVersionId: string | null;
    normalized: ReturnType<D1PatientObservationRepository['normalizeCommand']>;
    stored: StoredObservationValues;
    inputHash: string;
    recorder: string;
    recordedAt: number;
    headLockVersion: number;
  }): ObservationRow {
    return {
      observationId: input.observationId,
      patientId: input.patient.id,
      patientDisplayName: input.patient.displayName,
      medicalRecordNumber: input.patient.medicalRecordNumber,
      sourceType: 'manual_test',
      sourceLabel: LOCAL_OBSERVATION_SOURCE_LABEL,
      versionId: input.versionId,
      version: input.version,
      supersedesVersionId: input.supersedesVersionId,
      measuredAt: input.normalized.measuredAt,
      measurementContext: input.normalized.context,
      ...input.stored,
      note: input.normalized.note,
      recordedByMembershipId: this.scope.membershipId,
      accessAssignmentId: this.scope.accessAssignmentId,
      recordedBy: input.recorder,
      recordedAt: input.recordedAt,
      changeReason: input.normalized.reason,
      inputHash: input.inputHash,
      headLockVersion: input.headLockVersion,
    };
  }

  private versionInsert(input: {
    observationId: string;
    patientId: string;
    versionId: string;
    version: number;
    supersedesVersionId: string | null;
    normalized: ReturnType<D1PatientObservationRepository['normalizeCommand']>;
    stored: StoredObservationValues;
    inputHash: string;
    recordedAt: number;
  }) {
    const hasAnthropometry = input.stored.heightMm !== null;
    const hasPressure = input.stored.systolicMmhg !== null;
    const hasTemperature = input.stored.temperatureMilliC !== null;
    return this.database
      .prepare(`insert into patient_observation_versions (
        id, organization_id, facility_id, observation_id, patient_id,
        version, supersedes_version_id, measured_at, measurement_context,
        height_mm, height_unit, weight_grams, weight_unit,
        bmi_hundredths, bmi_unit, systolic_mmhg, diastolic_mmhg,
        pressure_unit, temperature_milli_c, temperature_unit, note,
        recorded_by_membership_id, access_assignment_id, recorded_at,
        change_reason, input_hash, created_at
      ) values (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
        ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
        ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?24
      )`)
      .bind(
        input.versionId,
        this.scope.organizationId,
        this.scope.facilityId,
        input.observationId,
        input.patientId,
        input.version,
        input.supersedesVersionId,
        input.normalized.measuredAt,
        input.normalized.context,
        input.stored.heightMm,
        hasAnthropometry ? 'mm' : null,
        input.stored.weightGrams,
        hasAnthropometry ? 'g' : null,
        input.stored.bmiHundredths,
        hasAnthropometry ? 'kg_m2' : null,
        input.stored.systolicMmhg,
        input.stored.diastolicMmhg,
        hasPressure ? 'mmHg' : null,
        input.stored.temperatureMilliC,
        hasTemperature ? 'milli_celsius' : null,
        input.normalized.note,
        this.scope.membershipId,
        this.scope.accessAssignmentId,
        input.recordedAt,
        input.normalized.reason,
        input.inputHash,
      );
  }

  private measurementGroups(values: StoredObservationValues) {
    return [
      values.heightMm === null ? null : 'anthropometry',
      values.systolicMmhg === null ? null : 'blood_pressure',
      values.temperatureMilliC === null ? null : 'temperature',
    ].filter((value): value is string => value !== null);
  }

  private async requireAuditHead() {
    const row = await this.database
      .prepare(`select last_sequence as lastSequence,
        last_event_hash as lastEventHash, lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2 limit 1`)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
    if (!row) throw new ObservationAuditUnavailableError();
    return row;
  }

  private async createAudit(input: {
    auditHead: AuditHeadRow;
    action: string;
    entityType: string;
    entityId: string;
    requestId: string;
    metadata: Record<string, unknown>;
    occurredAt: number;
  }) {
    const sequence = input.auditHead.lastSequence + 1;
    const metadataJson = JSON.stringify({
      ...input.metadata,
      accessAssignmentId: this.scope.accessAssignmentId,
    });
    const eventHash = await hashAuditEvent({
      previousHash: input.auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: this.scope.userId,
      actorMembershipId: this.scope.membershipId,
      action: input.action,
      outcome: 'succeeded',
      purpose: 'synthetic_patient_observation',
      schemaVersion: 1,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      metadataJson,
      occurredAt: input.occurredAt,
    });
    return {
      ...input,
      id: `audit-${crypto.randomUUID()}`,
      sequence,
      metadataJson,
      eventHash,
    };
  }

  private auditInsert(
    audit: Awaited<ReturnType<D1PatientObservationRepository['createAudit']>>,
  ) {
    return this.database
      .prepare(`insert into audit_events (
        id, organization_id, facility_id, sequence, actor_type, actor_id,
        actor_membership_id, action, outcome, purpose, schema_version,
        entity_type, entity_id, request_id, metadata_json, previous_hash,
        event_hash, occurred_at
      ) values (?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
        'synthetic_patient_observation', 1, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
      .bind(
        audit.id,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.sequence,
        this.scope.userId,
        this.scope.membershipId,
        audit.action,
        audit.entityType,
        audit.entityId,
        audit.requestId,
        audit.metadataJson,
        audit.auditHead.lastEventHash,
        audit.eventHash,
        audit.occurredAt,
      );
  }

  private auditHeadUpdate(
    audit: Awaited<ReturnType<D1PatientObservationRepository['createAudit']>>,
  ) {
    return this.database
      .prepare(`update audit_stream_heads
        set last_sequence = ?1, last_event_hash = ?2,
          lock_version = lock_version + 1, updated_at = ?3
        where organization_id = ?4 and facility_id = ?5
          and last_sequence = ?6 and lock_version = ?7
          and exists (select 1 from audit_events where id = ?8)`)
      .bind(
        audit.sequence,
        audit.eventHash,
        audit.occurredAt,
        this.scope.organizationId,
        this.scope.facilityId,
        audit.auditHead.lastSequence,
        audit.auditHead.lockVersion,
        audit.id,
      );
  }

  private async findIdempotency(operation: string, key: string) {
    return this.database
      .prepare(`select id, request_hash as requestHash, status,
        result_resource_id as resultResourceId, response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3 and operation = ?4
          and idempotency_key = ?5 limit 1`)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        operation,
        key,
      )
      .first<IdempotencyRow>();
  }

  private resolveReplay<T>(replay: IdempotencyRow, requestHash: string): T {
    if (
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      !replay.resultResourceId ||
      !replay.responseJson
    ) {
      throw new ObservationConflictError(
        'Idempotency key conflicts with an earlier observation command',
      );
    }
    try {
      const stored = JSON.parse(replay.responseJson) as T & { id?: string };
      if (stored.id !== replay.resultResourceId) throw new Error('Resource mismatch');
      return stored;
    } catch {
      throw new ObservationConflictError('Stored observation response is invalid');
    }
  }

  private commandStart(input: {
    id: string;
    operation: string;
    key: string;
    requestHash: string;
    now: number;
  }) {
    return this.database
      .prepare(`insert into command_idempotency (
        id, organization_id, facility_id, actor_membership_id,
        access_assignment_id, operation, idempotency_key, request_hash,
        status, created_at
      ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'processing', ?9)`)
      .bind(
        input.id,
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.membershipId,
        this.scope.accessAssignmentId,
        input.operation,
        input.key,
        input.requestHash,
        input.now,
      );
  }

  private commandComplete(input: {
    id: string;
    resourceType: string;
    resourceId: string;
    responseJson: string;
    now: number;
  }) {
    return this.database
      .prepare(`update command_idempotency
        set status = 'succeeded', result_resource_type = ?1,
          result_resource_id = ?2, response_json = ?3, completed_at = ?4
        where id = ?5 and status = 'processing'`)
      .bind(
        input.resourceType,
        input.resourceId,
        input.responseJson,
        input.now,
        input.id,
      );
  }

  private async commitCommand<T>(input: {
    operation: string;
    key: string;
    requestHash: string;
    resourceType: string;
    resourceId: string;
    response: T;
    action: string;
    entityType: string;
    requestId: string;
    metadata: Record<string, unknown>;
    now: number;
    statements: D1PreparedStatement[];
  }): Promise<T> {
    const existing = await this.findIdempotency(input.operation, input.key);
    if (existing) return this.resolveReplay<T>(existing, input.requestHash);
    const commandId = `command-${crypto.randomUUID()}`;
    const responseJson = JSON.stringify(input.response);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const auditHead = await this.requireAuditHead();
      const audit = await this.createAudit({
        auditHead,
        action: input.action,
        entityType: input.entityType,
        entityId: input.resourceId,
        requestId: input.requestId,
        metadata: input.metadata,
        occurredAt: input.now,
      });
      const statements = [
        this.commandStart({
          id: commandId,
          operation: input.operation,
          key: input.key,
          requestHash: input.requestHash,
          now: input.now,
        }),
        ...input.statements,
        this.auditInsert(audit),
        this.auditHeadUpdate(audit),
        this.commandComplete({
          id: commandId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          responseJson,
          now: input.now,
        }),
      ];
      try {
        const results = await this.database.batch(statements);
        if (
          results.length !== statements.length ||
          results.some((result) => result.meta.changes !== 1)
        ) {
          throw new ObservationConflictError(
            'Observation command did not commit atomically',
          );
        }
        return input.response;
      } catch (error) {
        const replay = await this.findIdempotency(input.operation, input.key);
        if (replay?.status === 'succeeded') {
          return this.resolveReplay<T>(replay, input.requestHash);
        }
        const currentAudit = await this.requireAuditHead();
        const contended =
          currentAudit.lastSequence !== auditHead.lastSequence ||
          currentAudit.lockVersion !== auditHead.lockVersion;
        if (contended && attempt < 2) continue;
        throw error;
      }
    }
    throw new ObservationAuditUnavailableError();
  }
}
