import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { FacilityAccessScope } from '@/lib/auth/facility-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
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
  database.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const scope: FacilityAccessScope = {
    accessAssignmentId: 'access-assignment-a-general-medicine',
    organizationId: 'org-a',
    facilityId: 'fac-a',
    userId: 'user-a',
    membershipId: 'membership-a',
    role,
  };
  return {
    database,
    scope,
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

function profileCommand(patientId: string) {
  return {
    ...patientInput, patientId, phone: '+7 701 111 22 33',
    expectedVersion: 1, changeReason: 'Synthetic profile correction',
    idempotencyKey: crypto.randomUUID(), requestId: 'profile-security-test',
  };
}

function changeProfileAssignment(database: DatabaseSync, patch: Record<string, SQLInputValue>) {
  const current = database.prepare(`select version.* from department_access_assignment_versions version
    join department_access_assignment_heads head on head.current_version_id = version.id
    where head.assignment_id = 'access-assignment-a-general-medicine'`).get()!;
  const successor: Record<string, SQLInputValue> = {
    ...current, id: crypto.randomUUID(), version: Number(current.version) + 1,
    supersedes_version_id: current.id, changed_at: Date.now(), created_at: Date.now(), ...patch,
  };
  const columns = Object.keys(successor);
  database.prepare(`insert into department_access_assignment_versions (${columns.join(',')})
    values (${columns.map(() => '?').join(',')})`).run(...columns.map(column => successor[column]));
  database.prepare(`update department_access_assignment_heads set current_version_id = ?,
    lock_version = lock_version + 1, updated_at = ? where assignment_id = 'access-assignment-a-general-medicine'`)
    .run(successor.id, Date.now());
}

function addAlternativeProfileAssignment(database: DatabaseSync) {
  // A second valid department must not rescue a revoked selected assignment or
  // take ownership of a command issued under the first assignment.
  const clone = (table: string, where: string, patch: Record<string, SQLInputValue>) => {
    const row = { ...database.prepare(`select * from ${table} where ${where}`).get()!, ...patch };
    const columns = Object.keys(row);
    database.prepare(`insert into ${table} (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`)
      .run(...columns.map(column => row[column]));
  };
  clone('departments', "id = 'department-a-general-medicine'", { id: 'department-alternative', code: 'alternative' });
  clone('department_versions', "id = 'department-a-general-medicine-v1'", {
    id: 'department-alternative-v1', department_id: 'department-alternative',
  });
  clone('department_heads', "department_id = 'department-a-general-medicine'", {
    id: 'department-alternative-head', department_id: 'department-alternative', current_version_id: 'department-alternative-v1',
  });
  clone('department_access_assignments', "id = 'access-assignment-a-general-medicine'", {
    id: 'assignment-alternative', department_id: 'department-alternative',
  });
  clone('department_access_assignment_versions', "id = 'access-assignment-a-general-medicine-v1'", {
    id: 'assignment-alternative-v1', assignment_id: 'assignment-alternative', department_id: 'department-alternative',
  });
  clone('department_access_assignment_heads', "assignment_id = 'access-assignment-a-general-medicine'", {
    id: 'assignment-alternative-head', assignment_id: 'assignment-alternative', department_id: 'department-alternative',
    current_version_id: 'assignment-alternative-v1', lock_version: 1,
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 patient registry', () => {
  describe.each(['updateProfile', 'archiveProfile'] as const)('%s exact writer authority', operation => {
    it('attributes successful writes and exact replay to the selected registrar assignment', async () => {
      const { database, repository, scope } = fixture('registrar');
      const patient = await repository.create(patientInput);
      changeProfileAssignment(database, { roles_json: '["registrar"]' });
      const command = profileCommand(patient.id);
      const first = await repository[operation](command);
      expect(await repository[operation]({ ...command, requestId: 'replay' })).toEqual(first);
      expect(database.prepare(`select access_assignment_id as assignmentId, actor_membership_id as member,
        json_extract(response_json, '$.actorId') as actor from command_idempotency
        where operation in ('patient.update', 'patient.archive')`).get()).toEqual({
        assignmentId: scope.accessAssignmentId, member: scope.membershipId, actor: scope.userId,
      });
      expect(database.prepare(`select actor_id as actor, json_extract(metadata_json, '$.accessAssignmentId') as assignmentId
        from audit_events where action in ('patient.update', 'patient.archive')`).get())
        .toEqual({ actor: scope.userId, assignmentId: scope.accessAssignmentId });
    });

    it('denies wrong actors, missing scope, revoked, expired, future, explicit-deny and service assignments without fallback', async () => {
      const { database, repository, scope } = fixture();
      const patient = await repository.create(patientInput);
      const command = profileCommand(patient.id);
      addAlternativeProfileAssignment(database);
      await expect(repository[operation]({ ...command, actorId: 'wrong-user' }))
        .rejects.toBeInstanceOf(AccessPermissionRequiredError);
      const missing = new D1PatientRegistryRepository(createD1Adapter(database), { ...scope, accessAssignmentId: undefined });
      await expect(missing[operation](command)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      for (const patch of [
        { status: 'revoked' }, { effective_until: Date.now() - 1000 }, { effective_from: Date.now() + 60_000 },
        { deny_permissions_json: '["patient.profile.write"]' },
        { roles_json: '["service"]', allow_permissions_json: '["patient.profile.write"]' },
        { roles_json: '["nurse"]' },
      ]) {
        changeProfileAssignment(database, {
          status: 'active', effective_from: 1704067200000, effective_until: null,
          roles_json: '["doctor","administrator"]', allow_permissions_json: '[]', deny_permissions_json: '[]', ...patch,
        });
        await expect(repository[operation](command)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      }
      expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(1);
      expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
    });

    it('permits an explicit interactive grant without requiring the legacy clinician role', async () => {
      const { database, repository } = fixture('registrar');
      const patient = await repository.create(patientInput);
      changeProfileAssignment(database, { roles_json: '["nurse"]', allow_permissions_json: '["patient.profile.write"]' });
      expect((await repository[operation](profileCommand(patient.id))).version).toBe(2);
    });

    it('rejects replay after revocation and replay under another current assignment', async () => {
      const { database, repository, scope } = fixture();
      const patient = await repository.create(patientInput);
      const command = profileCommand(patient.id);
      await repository[operation](command);
      addAlternativeProfileAssignment(database);
      const alternative = new D1PatientRegistryRepository(createD1Adapter(database), {
        ...scope, accessAssignmentId: 'assignment-alternative',
      });
      await expect(alternative[operation](command)).rejects.toBeInstanceOf(PatientRegistryConflictError);
      changeProfileAssignment(database, { status: 'revoked' });
      await expect(repository[operation](command)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(2);
      expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(2);
    });

    it('rolls back when the selected assignment is revoked immediately before batch', async () => {
      const { database, repository, scope } = fixture();
      const patient = await repository.create(patientInput);
      addAlternativeProfileAssignment(database);
      const d1 = createD1Adapter(database);
      const batch = d1.batch.bind(d1);
      let attempts = 0;
      d1.batch = async statements => {
        attempts += 1;
        changeProfileAssignment(database, { status: 'revoked' });
        return batch(statements);
      };
      const raced = new D1PatientRegistryRepository(d1, scope);
      await expect(raced[operation](profileCommand(patient.id))).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      expect(attempts).toBe(1);
      expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(1);
      expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
      expect(database.prepare('select count(*) as n from command_idempotency').get()?.n).toBe(1);
      expect((await repository.get(patient.id))?.version).toBe(1);
    });

    it('rolls back if authority disappears within the transaction after its initial guard', async () => {
      const { database, repository } = fixture();
      const patient = await repository.create(patientInput);
      database.exec(`create trigger revoke_profile_writer after update on patient_profile_heads
        begin update memberships set status = 'disabled' where id = 'membership-a'; end`);
      await expect(repository[operation](profileCommand(patient.id))).rejects.toBeInstanceOf(PatientRegistryConflictError);
      expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(1);
      expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
      expect(database.prepare('select count(*) as n from command_idempotency').get()?.n).toBe(1);
      expect(database.prepare("select status from memberships where id = 'membership-a'").get()?.status).toBe('active');
      expect((await repository.get(patient.id))?.version).toBe(1);
    });

    it('fails closed on a legacy command with no recorded assignment', async () => {
      const { database, repository } = fixture();
      const patient = await repository.create(patientInput);
      const command = profileCommand(patient.id);
      await repository[operation](command);
      const legacyKey = crypto.randomUUID();
      const original = database.prepare('select * from command_idempotency where idempotency_key = ?').get(command.idempotencyKey)!;
      const legacy: Record<string, SQLInputValue> = {
        ...original,
        id: crypto.randomUUID(), idempotency_key: legacyKey, access_assignment_id: null,
        status: 'processing', result_resource_type: null, result_resource_id: null, response_json: null, completed_at: null,
      };
      const columns = Object.keys(legacy);
      database.prepare(`insert into command_idempotency (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(column => legacy[column]));
      database.prepare(`update command_idempotency set status = 'succeeded', result_resource_type = ?,
        result_resource_id = ?, response_json = ?, completed_at = ? where id = ?`)
        .run(original.result_resource_type, original.result_resource_id, original.response_json, original.completed_at, legacy.id);
      await expect(repository[operation]({ ...command, idempotencyKey: legacyKey })).rejects.toBeInstanceOf(PatientRegistryConflictError);
      expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(2);
      expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(2);
    });

    it.each(['patient_profile_heads', 'audit_stream_heads', 'command_idempotency'])(
      'rolls back an ignored %s publication inside the transaction', async table => {
        const { database, repository } = fixture();
        const patient = await repository.create(patientInput);
        database.exec(`create trigger skip_profile_publication before update on ${table} begin select raise(ignore); end`);
        await expect(repository[operation](profileCommand(patient.id))).rejects.toBeInstanceOf(PatientRegistryConflictError);
        expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(1);
        expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
        expect(database.prepare('select count(*) as n from command_idempotency').get()?.n).toBe(1);
        expect((await repository.get(patient.id))?.version).toBe(1);
      },
    );

    it.each(['committed', 'replayed'] as const)('does not disclose a %s result after authority disappears during response loading', async mode => {
      const { database, repository, scope } = fixture();
      const patient = await repository.create(patientInput);
      const command = profileCommand(patient.id);
      if (mode === 'replayed') await repository[operation](command);
      const raced = new D1PatientRegistryRepository(createD1Adapter(database), scope);
      const get = raced.get.bind(raced);
      let reads = 0;
      raced.get = async id => {
        const result = await get(id);
        reads += 1;
        if (mode === 'replayed' || reads === 2) changeProfileAssignment(database, { status: 'revoked' });
        return result;
      };
      await expect(raced[operation](command)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      // A commit preceding revocation remains durable; it is never undone or repeated.
      expect(database.prepare('select count(*) as n from patient_profile_versions').get()?.n).toBe(2);
      expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(2);
    });
  });

  it.each(['clinical_section_heads', 'audit_stream_heads'])('rolls back skipped publication of %s', async table => {
    const { repository, database } = fixture();
    const patient = await repository.create(patientInput);
    database.exec(`create trigger skip_publication before ${table === 'audit_stream_heads' ? 'update' : 'insert'} on ${table} begin select raise(ignore); end`);
    await expect(repository.createEncounter({ patientId: patient.id, reasonForVisit: 'Проверка',
      actorId: 'user-a', requestId: 'skip', idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    expect(database.prepare('select count(*) as n from encounters').get()?.n).toBe(0);
    expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
    expect(database.prepare("select count(*) as n from command_idempotency where operation='encounter.create_for_patient'").get()?.n).toBe(0);
  });
  it('denies a revoked creator and rejects wrong actor without creating an encounter', async () => {
    const { repository, database } = fixture();
    const patient = await repository.create(patientInput);
    const command = { patientId: patient.id, reasonForVisit: 'Проверка', actorId: 'wrong-user',
      requestId: 'request', idempotencyKey: crypto.randomUUID() };
    await expect(repository.createEncounter(command)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    database.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(repository.createEncounter({ ...command, actorId: 'user-a' })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as n from encounters').get()?.n).toBe(0);
  });
  it('rolls back when creator access disappears immediately before the transaction', async () => {
    const { repository, database, scope } = fixture();
    const patient = await repository.create(patientInput);
    const d1 = createD1Adapter(database);
    const batch = d1.batch.bind(d1);
    d1.batch = async statements => {
      database.exec("update memberships set status='disabled' where id='membership-a'");
      return batch(statements);
    };
    const raced = new D1PatientRegistryRepository(d1, scope);
    await expect(raced.createEncounter({ patientId: patient.id, reasonForVisit: 'Проверка',
      actorId: 'user-a', requestId: 'race', idempotencyKey: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as n from encounters').get()?.n).toBe(0);
    expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
  });
  it('searches long Cyrillic names literally without LIKE wildcard expansion', async () => {
    const { repository } = fixture();
    const displayName = 'Тест интерфейса 15 сентября — вымышленный пациент';
    const created = await repository.create({ ...patientInput, displayName });
    expect((await repository.list({ query: displayName })).map(row => row.id)).toEqual([created.id]);
    expect(await repository.list({ query: '%' })).toEqual([]);
    expect(await repository.list({ query: '_' })).toEqual([]);
    expect((await repository.list({ query: created.medicalRecordNumber.toLowerCase() })).map(row => row.id)).toEqual([created.id]);
  });

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
