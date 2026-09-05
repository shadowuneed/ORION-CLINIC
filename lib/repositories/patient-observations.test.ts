import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObservationScope } from '@/lib/auth/observation-access';
import {
  D1PatientObservationRepository,
  ObservationConflictError,
  ObservationCorrectionForbiddenError,
  ObservationNotFoundError,
  ObservationValidationError,
  ObservationVersionConflictError,
} from './patient-observations';

type TestBoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

const databases: DatabaseSync[] = [];
const clinicianScope: ObservationScope = {
  organizationId: 'org-a',
  facilityId: 'fac-a',
  userId: 'user-doctor',
  membershipId: 'membership-doctor',
  role: 'clinician',
};
const nurseScope: ObservationScope = {
  organizationId: 'org-a',
  facilityId: 'fac-a',
  userId: 'user-nurse',
  membershipId: 'membership-nurse',
  role: 'nurse',
};
const otherScope: ObservationScope = {
  organizationId: 'org-b',
  facilityId: 'fac-b',
  userId: 'user-other',
  membershipId: 'membership-other',
  role: 'clinician',
};
const uuid = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

function applyMigrations(target: DatabaseSync) {
  target.exec('pragma foreign_keys = on');
  for (const fileName of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    target.exec(
      readFileSync(join('drizzle', fileName), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
  }
}

function d1Result<T>(results: T[], changes = 0) {
  return { success: true, results, meta: { changes } } as unknown as D1Result<T>;
}

function createD1Adapter(target: DatabaseSync): D1Database {
  const prepareBound = (
    sql: string,
    bindings: SQLInputValue[] = [],
  ): TestBoundStatement => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return prepareBound(sql, values as SQLInputValue[]) as unknown as D1PreparedStatement;
    },
    async first<T = unknown>(columnName?: string) {
      const row = target.prepare(sql).get(...bindings) as Record<string, T> | undefined;
      if (!row) return null;
      return columnName ? row[columnName] ?? null : (row as T);
    },
    async all<T = unknown>() {
      return d1Result(target.prepare(sql).all(...bindings) as T[]);
    },
    async run<T = unknown>() {
      const result = target.prepare(sql).run(...bindings);
      return d1Result<T>([], Number(result.changes));
    },
    async raw<T = unknown>() {
      return target
        .prepare(sql)
        .all(...bindings)
        .map((row) => Object.values(row as Record<string, unknown>)) as T[];
    },
  });
  let batchTail: Promise<void> = Promise.resolve();
  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const previous = batchTail;
      let release!: () => void;
      batchTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      target.exec('begin immediate');
      try {
        const results = statements.map((statement) => {
          const bound = statement as unknown as TestBoundStatement;
          const result = target.prepare(bound.sql).run(...bound.bindings);
          return d1Result<T>([], Number(result.changes));
        });
        target.exec('commit');
        return results;
      } catch (error) {
        target.exec('rollback');
        throw error;
      } finally {
        release();
      }
    },
    async exec(query: string) {
      target.exec(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      throw new Error('Sessions are not used in this test');
    },
    dump() {
      throw new Error('Dump is not used in this test');
    },
  } as unknown as D1Database;
}

function createFixture() {
  const target = new DatabaseSync(':memory:');
  databases.push(target);
  applyMigrations(target);
  target.exec(`
    insert into organizations (id, name, status) values
      ('org-a', 'Synthetic Clinic', 'active'),
      ('org-b', 'Other Synthetic Clinic', 'active');
    insert into facilities (id, organization_id, name, timezone, status) values
      ('fac-a', 'org-a', 'Main', 'Asia/Almaty', 'active'),
      ('fac-b', 'org-b', 'Other', 'Asia/Almaty', 'active');
    insert into users (id, external_issuer, external_subject, display_name, status) values
      ('user-doctor', 'test', 'doctor', 'Врач Тестовый', 'active'),
      ('user-nurse', 'test', 'nurse', 'Медсестра Тестовая', 'active'),
      ('user-other', 'test', 'other', 'Другой врач', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values
      ('membership-doctor', 'org-a', 'fac-a', 'user-doctor', 'clinician', 'active'),
      ('membership-nurse', 'org-a', 'fac-a', 'user-nurse', 'nurse', 'active'),
      ('membership-other', 'org-b', 'fac-b', 'user-other', 'clinician', 'active');
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name, status
    ) values
      ('patient-a', 'org-a', 'fac-a', 'SYN-OBS-01', 'Пациент Тестовый', 'active'),
      ('patient-b', 'org-b', 'fac-b', 'SYN-OBS-02', 'Другой пациент', 'active');
    insert into audit_stream_heads (
      id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
    ) values
      ('audit-head-a', 'org-a', 'fac-a', 0, null, 1),
      ('audit-head-b', 'org-b', 'fac-b', 0, null, 1);
  `);
  return { target, database: createD1Adapter(target) };
}

function createCommand(idempotencyKey = uuid(1)) {
  return {
    patientId: 'patient-a',
    measuredAt: Date.UTC(2026, 8, 5, 8, 0),
    context: 'pre_visit' as const,
    values: {
      heightCm: 170,
      weightKg: 68.2,
      systolicMmhg: 122,
      diastolicMmhg: 78,
      temperatureC: 36.6,
    },
    note: 'Синтетическое измерение перед приёмом',
    reason: 'Первичная запись тестовых показателей',
    idempotencyKey,
    requestId: `request-${idempotencyKey}`,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 patient observations', () => {
  it('records an exact synthetic measurement, derived BMI, audit and read history', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientObservationRepository(database, clinicianScope);

    const created = await repository.create(createCommand());
    expect(created.current.version).toBe(1);
    expect(created.current.values).toEqual({
      heightCm: 170,
      weightKg: 68.2,
      bmi: 23.6,
      systolicMmhg: 122,
      diastolicMmhg: 78,
      temperatureC: 36.6,
    });
    expect(created.current.sourceType).toBe('manual_test');

    const workspace = await repository.list({ patientId: 'patient-a' });
    await repository.recordListRead({
      patientId: 'patient-a',
      resultCount: workspace.observations.length,
      requestId: 'request-read',
    });
    expect(workspace.observations).toHaveLength(1);
    expect(workspace.clinicalInterpretation).toBe('not_performed');
    expect(workspace.thresholdPolicy.decision).toBe('DEC-006');
    expect(
      target
        .prepare(`select action, purpose from audit_events order by sequence`)
        .all(),
    ).toEqual([
      {
        action: 'observation.recorded',
        purpose: 'synthetic_patient_observation',
      },
      {
        action: 'observation.workspace.read',
        purpose: 'synthetic_patient_observation',
      },
    ]);
  });

  it('replays an exact command and rejects a changed payload under the same key', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientObservationRepository(database, clinicianScope);
    const command = createCommand();

    const first = await repository.create(command);
    const replay = await repository.create(command);
    expect(replay).toEqual(first);
    expect(
      target.prepare('select count(*) as total from patient_observation_records').get(),
    ).toEqual({ total: 1 });

    await expect(
      repository.create({
        ...command,
        values: { ...command.values, temperatureC: 37.1 },
      }),
    ).rejects.toBeInstanceOf(ObservationConflictError);
  });

  it('corrects by appending a successor and rejects stale or unchanged edits', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientObservationRepository(database, clinicianScope);
    const created = await repository.create(createCommand());
    const correction = {
      ...createCommand(uuid(2)),
      observationId: created.id,
      expectedVersion: 1,
      values: { ...createCommand().values, systolicMmhg: 124 },
      reason: 'Исправлена опечатка в верхнем давлении',
    };

    const corrected = await repository.correct(correction);
    expect(corrected.current.version).toBe(2);
    expect(corrected.current.values.systolicMmhg).toBe(124);
    expect(corrected.history.map((version) => version.version)).toEqual([2, 1]);
    expect(
      target
        .prepare(`select version, systolic_mmhg as systolic from patient_observation_versions order by version`)
        .all(),
    ).toEqual([
      { version: 1, systolic: 122 },
      { version: 2, systolic: 124 },
    ]);

    await expect(
      repository.correct({ ...correction, idempotencyKey: uuid(3) }),
    ).rejects.toBeInstanceOf(ObservationVersionConflictError);
    await expect(
      repository.correct({
        ...createCommand(uuid(4)),
        observationId: created.id,
        expectedVersion: 2,
        values: correction.values,
        reason: 'Попытка сохранить те же значения повторно',
      }),
    ).rejects.toBeInstanceOf(ObservationValidationError);
  });

  it('lets a nurse correct their own measurement but not a doctor measurement', async () => {
    const { database } = createFixture();
    const doctorRepository = new D1PatientObservationRepository(database, clinicianScope);
    const nurseRepository = new D1PatientObservationRepository(database, nurseScope);
    const doctorRecord = await doctorRepository.create(createCommand(uuid(10)));

    await expect(
      nurseRepository.correct({
        ...createCommand(uuid(11)),
        observationId: doctorRecord.id,
        expectedVersion: 1,
        values: { ...createCommand().values, temperatureC: 36.7 },
        reason: 'Исправление чужой записи медсестрой',
      }),
    ).rejects.toBeInstanceOf(ObservationCorrectionForbiddenError);

    const nurseRecord = await nurseRepository.create({
      ...createCommand(uuid(12)),
      values: {
        heightCm: null,
        weightKg: null,
        systolicMmhg: null,
        diastolicMmhg: null,
        temperatureC: 36.5,
      },
    });
    await expect(
      nurseRepository.correct({
        ...createCommand(uuid(13)),
        observationId: nurseRecord.id,
        expectedVersion: 1,
        values: {
          heightCm: null,
          weightKg: null,
          systolicMmhg: null,
          diastolicMmhg: null,
          temperatureC: 36.6,
        },
        reason: 'Повторное тестовое измерение температуры',
      }),
    ).resolves.toMatchObject({ current: { version: 2 } });
  });

  it('keeps tenant and active-patient boundaries neutral', async () => {
    const { target, database } = createFixture();
    const otherRepository = new D1PatientObservationRepository(database, otherScope);
    await expect(
      otherRepository.create(createCommand(uuid(20))),
    ).rejects.toBeInstanceOf(ObservationNotFoundError);

    target.prepare(`update patients set status = 'inactive' where id = 'patient-a'`).run();
    await expect(
      new D1PatientObservationRepository(database, clinicianScope).create(
        createCommand(uuid(21)),
      ),
    ).rejects.toBeInstanceOf(ObservationNotFoundError);
  });

  it('enforces immutable versions, derived BMI and linear head advancement in SQLite', async () => {
    const { target, database } = createFixture();
    const repository = new D1PatientObservationRepository(database, clinicianScope);
    const created = await repository.create(createCommand(uuid(30)));
    const currentId = created.current.id;

    expect(() =>
      target
        .prepare(`update patient_observation_versions set systolic_mmhg = 140 where id = ?`)
        .run(currentId),
    ).toThrow(/immutable/);
    expect(() =>
      target
        .prepare(`update patient_observation_heads set lock_version = lock_version + 2 where observation_id = ?`)
        .run(created.id),
    ).toThrow(/head identity or lock/);
    expect(() =>
      target
        .prepare(`insert into patient_observation_versions (
          id, organization_id, facility_id, observation_id, patient_id,
          version, supersedes_version_id, measured_at, measurement_context,
          height_mm, height_unit, weight_grams, weight_unit, bmi_hundredths,
          bmi_unit, recorded_by_membership_id, recorded_at, change_reason,
          input_hash, created_at
        ) values (
          'tampered', 'org-a', 'fac-a', ?, 'patient-a', 2, ?, ?, 'pre_visit',
          1700, 'mm', 68200, 'g', 9999, 'kg_m2', 'membership-doctor', ?,
          'Несогласованное значение ИМТ', ?, ?
        )`)
        .run(
          created.id,
          currentId,
          Date.UTC(2026, 8, 5, 8, 0),
          Date.now(),
          'f'.repeat(64),
          Date.now(),
        ),
    ).toThrow();
  });
});
