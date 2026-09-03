import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { FacilityAccessScope } from '@/lib/auth/facility-access';
import {
  D1PatientRegistryRepository,
  PatientAlreadyArchivedError,
  PatientDuplicateCandidateError,
  PatientEncounterRoleRequiredError,
  PatientNotFoundError,
  PatientProfileStateError,
  PatientProfileUnchangedError,
  PatientProfileVersionConflictError,
  PatientRegistryConflictError,
} from './patient-registry';

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

  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      target.exec('begin immediate');
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          results.push(await (statement as unknown as TestBoundStatement).run<T>());
        }
        target.exec('commit');
        return results;
      } catch (error) {
        target.exec('rollback');
        throw error;
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

function fixture(role: 'clinician' | 'registrar' = 'clinician') {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  database.exec(`
    insert into organizations (id, name) values ('org-a', 'Clinic A');
    insert into facilities (id, organization_id, name)
      values ('fac-a', 'org-a', 'Facility A');
    insert into users (
      id, external_issuer, external_subject, display_name, status
    ) values ('user-a', 'openai:sites', 'local_seedy', 'Doctor A', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values ('membership-a', 'org-a', 'fac-a', 'user-a', '${role}', 'active');
    insert into audit_stream_heads (
      id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
    ) values ('audit-head-a', 'org-a', 'fac-a', 0, null, 1);
  `);
  const scope: FacilityAccessScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    userId: 'user-a',
    membershipId: 'membership-a',
    role,
  };
  return {
    database,
    repository: new D1PatientRegistryRepository(createD1Adapter(database), scope),
  };
}

const patientInput = {
  displayName: 'Айдана Тестова',
  birthDate: '1990-05-12',
  sexAtBirth: 'female' as const,
  testIin: '900512400001',
  phone: '+7 700 000 00 01',
  email: 'patient@example.test',
  address: 'г. Алматы',
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  actorId: 'user-a',
  requestId: 'request-create-patient',
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 patient registry', () => {
  it('persists, lists and reads a complete patient record', async () => {
    const { repository } = fixture();
    const created = await repository.create(patientInput);
    const listed = await repository.list({ query: '900512', status: 'active' });
    const loaded = await repository.get(created.id);

    expect(created).toMatchObject({
      displayName: 'Айдана Тестова',
      testIin: '900512400001',
      phone: '+7 700 000 00 01',
      email: 'patient@example.test',
      address: 'г. Алматы',
      encounterCount: 0,
    });
    expect(listed.map((patient) => patient.id)).toEqual([created.id]);
    expect(loaded?.encounters).toEqual([]);
  });

  it('replays the same create command without duplicating rows', async () => {
    const { database, repository } = fixture();
    const first = await repository.create(patientInput);
    const replay = await repository.create(patientInput);
    expect(replay.id).toBe(first.id);
    expect(
      database.prepare('select count(*) as count from patients').get(),
    ).toMatchObject({ count: 1 });
  });

  it('updates a patient by appending a linked immutable profile version', async () => {
    const { database, repository } = fixture();
    const created = await repository.create(patientInput);
    const updated = await repository.updateProfile({
      patientId: created.id,
      displayName: 'Айдана Тестова',
      birthDate: '1990-05-12',
      sexAtBirth: 'female',
      phone: '+7 701 111 22 33',
      email: 'updated@example.test',
      address: 'г. Алматы, тестовый адрес',
      changeReason: 'Контакты уточнены со слов пациента',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000010',
      actorId: 'user-a',
      requestId: 'request-update-patient',
    });

    expect(updated).toMatchObject({
      id: created.id,
      phone: '+7 701 111 22 33',
      email: 'updated@example.test',
      version: 2,
      status: 'active',
    });
    expect(updated.profileHistory).toMatchObject([
      {
        version: 2,
        status: 'active',
        changeReason: 'Контакты уточнены со слов пациента',
        actorDisplayName: 'Doctor A',
      },
      { version: 1, status: 'active', changeReason: 'initial_registration' },
    ]);
    expect(
      database
        .prepare(`
          select count(*) as count,
            max(version) as latestVersion
          from patient_profile_versions where patient_id = ?
        `)
        .get(created.id),
    ).toEqual({ count: 2, latestVersion: 2 });
    expect(
      database
        .prepare(`
          select action, json_extract(metadata_json, '$.resultingVersion') as version
          from audit_events order by sequence desc limit 1
        `)
        .get(),
    ).toEqual({ action: 'patient.update', version: 2 });
  });

  it('replays an exact update once and rejects changed payload under the same key', async () => {
    const { database, repository } = fixture();
    const created = await repository.create(patientInput);
    const command = {
      patientId: created.id,
      displayName: 'Айдана Тестова',
      birthDate: '1990-05-12',
      sexAtBirth: 'female' as const,
      phone: '+7 701 111 22 33',
      email: 'updated@example.test',
      address: 'г. Алматы',
      changeReason: 'Исправлен номер телефона',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000011',
      actorId: 'user-a',
      requestId: 'request-update-once',
    };
    const first = await repository.updateProfile(command);
    const replay = await repository.updateProfile({
      ...command,
      requestId: 'request-update-replay',
    });

    expect(replay).toEqual(first);
    expect(
      database
        .prepare('select count(*) as count from patient_profile_versions where patient_id = ?')
        .get(created.id),
    ).toEqual({ count: 2 });
    expect(
      database
        .prepare("select count(*) as count from audit_events where action = 'patient.update'")
        .get(),
    ).toEqual({ count: 1 });
    await expect(
      repository.updateProfile({ ...command, phone: '+7 702 000 00 00' }),
    ).rejects.toBeInstanceOf(PatientRegistryConflictError);
  });

  it('rejects stale and unchanged profile commands without creating a version', async () => {
    const { database, repository } = fixture();
    const created = await repository.create(patientInput);
    await expect(
      repository.updateProfile({
        patientId: created.id,
        displayName: patientInput.displayName,
        birthDate: patientInput.birthDate,
        sexAtBirth: patientInput.sexAtBirth,
        phone: patientInput.phone,
        email: patientInput.email,
        address: patientInput.address,
        changeReason: 'Проверка без изменений',
        expectedVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000012',
        actorId: 'user-a',
        requestId: 'request-unchanged',
      }),
    ).rejects.toBeInstanceOf(PatientProfileUnchangedError);

    await repository.updateProfile({
      patientId: created.id,
      displayName: patientInput.displayName,
      birthDate: patientInput.birthDate,
      sexAtBirth: patientInput.sexAtBirth,
      phone: '+7 701 111 22 33',
      email: patientInput.email,
      address: patientInput.address,
      changeReason: 'Обновлён телефон',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000013',
      actorId: 'user-a',
      requestId: 'request-current',
    });
    await expect(
      repository.updateProfile({
        patientId: created.id,
        displayName: patientInput.displayName,
        birthDate: patientInput.birthDate,
        sexAtBirth: patientInput.sexAtBirth,
        phone: '+7 702 222 33 44',
        email: patientInput.email,
        address: patientInput.address,
        changeReason: 'Устаревшая вкладка',
        expectedVersion: 1,
        idempotencyKey: '00000000-0000-4000-8000-000000000014',
        actorId: 'user-a',
        requestId: 'request-stale',
      }),
    ).rejects.toMatchObject({
      constructor: PatientProfileVersionConflictError,
      currentVersion: 2,
      currentStatus: 'active',
    });
    expect(
      database
        .prepare('select count(*) as count from patient_profile_versions where patient_id = ?')
        .get(created.id),
    ).toEqual({ count: 2 });
  });

  it('archives without deletion and prevents later profile, photo or encounter mutation', async () => {
    const { database, repository } = fixture();
    const created = await repository.create(patientInput);
    const archiveCommand = {
      patientId: created.id,
      changeReason: 'Тестовая карточка больше не используется',
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000015',
      actorId: 'user-a',
      requestId: 'request-archive',
    };
    const archived = await repository.archiveProfile(archiveCommand);
    const replay = await repository.archiveProfile({
      ...archiveCommand,
      requestId: 'request-archive-replay',
    });

    expect(archived).toMatchObject({ status: 'inactive', version: 2 });
    expect(replay).toEqual(archived);
    expect((await repository.list({ status: 'active' })).map(({ id }) => id)).not.toContain(created.id);
    expect((await repository.list({ status: 'inactive' })).map(({ id }) => id)).toContain(created.id);
    expect(await repository.get(created.id)).toMatchObject({
      status: 'inactive',
      profileHistory: [{ version: 2, status: 'inactive' }, { version: 1 }],
    });
    expect(
      database.prepare('select count(*) as count from patients where id = ?').get(created.id),
    ).toEqual({ count: 1 });
    expect(
      database.prepare('select count(*) as count from patient_profile_versions where patient_id = ?').get(created.id),
    ).toEqual({ count: 2 });
    expect(
      database.prepare("select count(*) as count from audit_events where action = 'patient.archive'").get(),
    ).toEqual({ count: 1 });
    await expect(
      repository.archiveProfile({
        ...archiveCommand,
        changeReason: 'Изменённая причина с тем же ключом',
      }),
    ).rejects.toBeInstanceOf(PatientRegistryConflictError);

    await expect(
      repository.archiveProfile({
        patientId: created.id,
        changeReason: 'Повторное архивирование',
        expectedVersion: 2,
        idempotencyKey: '00000000-0000-4000-8000-000000000016',
        actorId: 'user-a',
        requestId: 'request-archive-again',
      }),
    ).rejects.toBeInstanceOf(PatientAlreadyArchivedError);
    await expect(
      repository.updateProfile({
        patientId: created.id,
        displayName: patientInput.displayName,
        birthDate: patientInput.birthDate,
        sexAtBirth: patientInput.sexAtBirth,
        phone: '+7 702 000 00 00',
        email: patientInput.email,
        address: patientInput.address,
        changeReason: 'Попытка после архива',
        expectedVersion: 2,
        idempotencyKey: '00000000-0000-4000-8000-000000000017',
        actorId: 'user-a',
        requestId: 'request-update-archived',
      }),
    ).rejects.toBeInstanceOf(PatientProfileStateError);
    await expect(
      repository.createEncounter({
        patientId: created.id,
        reasonForVisit: 'Новый приём',
        idempotencyKey: '00000000-0000-4000-8000-000000000018',
        actorId: 'user-a',
        requestId: 'request-encounter-archived',
      }),
    ).rejects.toBeInstanceOf(PatientNotFoundError);
    await expect(
      repository.registerPhoto({
        patientId: created.id,
        objectKey: 'patient-media/org-a/fac-a/archived/hash.jpg',
        mimeType: 'image/jpeg',
        sha256: 'b'.repeat(64),
        byteSize: 128,
        actorId: 'user-a',
        requestId: 'request-photo-archived',
      }),
    ).rejects.toBeInstanceOf(PatientNotFoundError);
  });

  it('blocks an artificial IIN duplicate instead of merging silently', async () => {
    const { repository } = fixture();
    await repository.create(patientInput);
    await expect(
      repository.create({
        ...patientInput,
        displayName: 'Другой пациент',
        idempotencyKey: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toBeInstanceOf(PatientDuplicateCandidateError);
  });

  it('creates one encounter for an existing patient with eight empty sections', async () => {
    const { database, repository } = fixture();
    const patient = await repository.create(patientInput);
    const encounter = await repository.createEncounter({
      patientId: patient.id,
      reasonForVisit: 'Первичная консультация',
      idempotencyKey: '00000000-0000-4000-8000-000000000003',
      actorId: 'user-a',
      requestId: 'request-create-encounter',
    });
    const replay = await repository.createEncounter({
      patientId: patient.id,
      reasonForVisit: 'Первичная консультация',
      idempotencyKey: '00000000-0000-4000-8000-000000000003',
      actorId: 'user-a',
      requestId: 'different-request-id',
    });

    expect(encounter.status).toBe('draft');
    expect(replay.id).toBe(encounter.id);
    expect(
      database
        .prepare('select count(*) as count from encounters where patient_id = ?')
        .get(patient.id),
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare('select count(*) as count from clinical_section_heads where encounter_id = ?')
        .get(encounter.id),
    ).toMatchObject({ count: 8 });
  });

  it('keeps encounter creation clinician-only', async () => {
    const { repository } = fixture('registrar');
    const patient = await repository.create(patientInput);
    await expect(
      repository.createEncounter({
        patientId: patient.id,
        reasonForVisit: 'Осмотр',
        idempotencyKey: '00000000-0000-4000-8000-000000000004',
        actorId: 'user-a',
        requestId: 'request-create-encounter',
      }),
    ).rejects.toBeInstanceOf(PatientEncounterRoleRequiredError);
  });

  it('records patient reads in the fail-closed facility audit chain', async () => {
    const { database, repository } = fixture();
    const patient = await repository.create(patientInput);

    await repository.recordRead({
      action: 'patient.read',
      actorId: 'user-a',
      patientId: patient.id,
      requestId: 'request-read-patient',
    });

    expect(
      database
        .prepare(`
          select action, purpose, entity_type as entityType,
            entity_id as entityId, request_id as requestId
          from audit_events order by sequence desc limit 1
        `)
        .get(),
    ).toEqual({
      action: 'patient.read',
      purpose: 'patient_directory_access',
      entityType: 'patient',
      entityId: patient.id,
      requestId: 'request-read-patient',
    });
    expect(
      database
        .prepare('select last_sequence as lastSequence from audit_stream_heads')
        .get(),
    ).toEqual({ lastSequence: 2 });
  });

  it('stores photo metadata as a scoped R2 reference, not bytes in D1', async () => {
    const { database, repository } = fixture();
    const patient = await repository.create(patientInput);
    const photo = await repository.registerPhoto({
      patientId: patient.id,
      objectKey: `patient-media/org-a/fac-a/${patient.id}/hash.jpg`,
      mimeType: 'image/jpeg',
      sha256: 'a'.repeat(64),
      byteSize: 1024,
      actorId: 'user-a',
      requestId: 'request-photo',
    });

    expect(await repository.getPhoto(patient.id)).toEqual(photo);
    expect(
      database
        .prepare('select object_key as objectKey, byte_size as byteSize from patient_photo_assets')
        .get(),
    ).toEqual({ objectKey: photo.objectKey, byteSize: 1024 });
  });
});
