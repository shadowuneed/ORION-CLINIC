import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// PostgreSQL WASM, not SQLite, mocks, regex assertions, or external Supabase.
// Auth tables below contain isolated test principals only; no local DB is read.
const issuer = 'https://bctyswbqjgpmtsanrfhp.supabase.co/auth/v1';
const subject = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
let db: PGlite;

type Patient = {
  id: string;
  displayName: string;
  medicalRecordNumber: string;
  sexAtBirth: string;
  status: string;
  version: number;
  birthDate: string | null;
  photoUrl: null;
  encounters: unknown[];
  profileHistory: { version: number; status: string }[];
};
type Mutation = { patient: Patient; accessAssignmentId: string; observedAt: number; replayed: boolean };

async function claims(extra: Record<string, unknown> = {}) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({
    iss: issuer, sub: subject, role: 'authenticated', session_id: session,
    exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false, ...extra,
  })]);
}
async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
  const { rows } = await db.query<{ result: T }>(`select public.${name}(${placeholders}) result`, args);
  return rows[0].result;
}
const payload = (changes: Record<string, unknown> = {}) => ({
  displayName: 'Пациент проверки', birthDate: '1990-01-02', sexAtBirth: 'female',
  testIin: null, phone: null, email: null, address: null,
  testDataAcknowledged: true, idempotencyKey: randomUUID(), ...changes,
});
async function create(changes: Record<string, unknown> = {}) {
  return rpc<Mutation>('orion_patient_create', ['assignment-a', payload(changes), 'fac-a']);
}
async function counts() {
  const { rows } = await db.query<{ patients: number; versions: number; commands: number; audits: number }>(`
    select (select count(*)::int from orion_private.patients) patients,
      (select count(*)::int from orion_private.patient_profile_versions) versions,
      (select count(*)::int from orion_private.command_idempotency) commands,
      (select count(*)::int from orion_private.audit_events) audits`);
  return rows[0];
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz, email text, email_confirmed_at timestamptz, is_anonymous boolean not null default false);
    create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
  `);
  await db.exec(readFileSync(new URL('./0001_private_schema_boundary.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('./0002_access_patient_registry.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users(id) values($1)', [subject]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, subject]);
  await db.query(`insert into orion_private.users values('staff-a',$1,$2,null,'Сотрудник проверки','active',1,1,1)`, [issuer, subject]);
  await db.exec(`
    insert into orion_private.organizations values('org-a','Организация A','active',1,1,1),('org-b','Организация B','active',1,1,1);
    insert into orion_private.facilities values('fac-a','org-a','Клиника A','UTC','active',1,1,1),('fac-b','org-b','Клиника B','UTC','active',1,1,1);
    insert into orion_private.memberships values('member-a','org-a','fac-a','staff-a','clinician','active',1,1,1);
    insert into orion_private.departments values('dept-a','org-a','fac-a','medicine','Медицина','clinical','active',1,1,1);
    insert into orion_private.department_versions values('dept-a-v1','org-a','fac-a','dept-a',1,null,'Медицина','clinical','active','Создание подразделения','member-a',1,1);
    insert into orion_private.department_heads values('dept-a-head','org-a','fac-a','dept-a','dept-a-v1',1,1,1);
    insert into orion_private.department_access_assignments values('assignment-a','org-a','fac-a','dept-a','member-a','member-a',1);
    insert into orion_private.department_access_assignment_versions values('assignment-a-v1','org-a','fac-a','assignment-a','dept-a','member-a',1,null,'active','bootstrap','["doctor"]','[]','[]',1,null,'Создание доступа','member-a',1,1);
    insert into orion_private.department_access_assignment_heads values('assignment-a-head','org-a','fac-a','assignment-a','dept-a','member-a','assignment-a-v1',1,1,1);
  `);
  await claims();
}, 20000);
afterEach(async () => { await db.close(); });

describe('0002 PostgreSQL access/patient vertical', () => {
  it('has 18 RLS tables, zero API schema/table grants and six authenticated-only RPCs', async () => {
    const { rows } = await db.query<{ count: number; protected: number }>(`select count(*)::int count,count(*) filter(where c.relrowsecurity)::int protected from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='orion_private' and c.relkind='r'`);
    expect(rows[0]).toEqual({ count: 18, protected: 18 });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const result = await db.query<{ allowed: boolean }>('select has_schema_privilege($1,$2,$3) allowed', [role, 'orion_private', 'USAGE']);
      expect(result.rows[0].allowed).toBe(false);
      const tables = await db.query<{ granted: number }>(`select count(*)::int granted from information_schema.table_privileges where table_schema='orion_private' and grantee=$1`, [role]);
      expect(tables.rows[0].granted).toBe(0);
    }
    const functions = await db.query<{ name: string; authenticated: boolean; anonymous: boolean; service: boolean; definer: boolean; config: string[] }>(`
      select p.proname name,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('anon',p.oid,'EXECUTE') anonymous,has_function_privilege('service_role',p.oid,'EXECUTE') service,
        p.prosecdef definer,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'orion_%' order by p.proname`);
    expect(functions.rows).toHaveLength(6);
    for (const f of functions.rows) expect(f).toMatchObject({ authenticated: true, anonymous: false, service: false, definer: true, config: ['search_path=""'] });
    await db.exec('set role anon');
    await expect(rpc('orion_access_overview')).rejects.toMatchObject({ code: '42501' });
    await db.exec('reset role; set role authenticated');
    await expect(db.query('select * from orion_private.patients')).rejects.toMatchObject({ code: '42501' });
    const overview = await rpc<{ assignments: { roles: string[] }[] }>('orion_access_overview');
    expect(overview.assignments[0].roles).toEqual(['doctor']);
  });

  it('creates durable versioned profile and serves literal-search/detail with complete DTO', async () => {
    const made = await create({ displayName: 'Пациент  с пробелами', phone: '+7 700 000 00 00' });
    expect(made.patient).toMatchObject({ displayName: 'Пациент с пробелами', sexAtBirth: 'female', version: 1, status: 'active', photoUrl: null, encounters: [] });
    expect(made.patient.medicalRecordNumber).toMatch(/^OR-[A-F0-9]{8}$/);
    expect(made.patient.profileHistory).toHaveLength(1);
    const list = await rpc<{ patients: Patient[] }>('orion_patients_list', ['assignment-a', 'fac-a', 'пробелами', 'active', 50]);
    expect(list.patients.map(p => p.id)).toEqual([made.patient.id]);
    const wildcard = await rpc<{ patients: Patient[] }>('orion_patients_list', ['assignment-a', 'fac-a', '%', 'active', 50]);
    expect(wildcard.patients).toEqual([]);
    const detail = await rpc<{ patient: Patient }>('orion_patient_detail', ['assignment-a', made.patient.id, 'fac-a']);
    expect(detail.patient).toEqual(made.patient);
    expect(await counts()).toEqual({ patients: 1, versions: 1, commands: 1, audits: 4 });
  });

  it('updates once, detects stale writers, and replays only matching actor/assignment/hash', async () => {
    const made = await create();
    const update = { ...payload({ displayName: 'Пациент обновлён' }), patientId: made.patient.id, expectedVersion: 1, changeReason: 'Исправление карточки' };
    delete (update as Partial<typeof update>).testIin;
    const changed = await rpc<Mutation>('orion_patient_update', ['assignment-a', update, 'fac-a']);
    expect(changed.patient.version).toBe(2);
    expect(changed.patient.profileHistory.map(v => v.version)).toEqual([2, 1]);
    const replay = await rpc<Mutation>('orion_patient_update', ['assignment-a', update, 'fac-a']);
    expect(replay.replayed).toBe(true);
    expect(replay.patient).toEqual(changed.patient);
    await expect(rpc('orion_patient_update', ['assignment-a', { ...update, displayName: 'Другие данные' }, 'fac-a'])).rejects.toMatchObject({ code: 'PT409', message: 'PATIENT_COMMAND_CONFLICT' });
    await expect(rpc('orion_patient_update', ['assignment-a', { ...update, idempotencyKey: randomUUID() }, 'fac-a'])).rejects.toMatchObject({ code: 'PT409', message: 'PATIENT_VERSION_CONFLICT' });
    expect(await counts()).toEqual({ patients: 1, versions: 2, commands: 2, audits: 3 });
  });

  it('archives by immutable successor; active listing excludes it, historical profile remains', async () => {
    const made = await create();
    const command = { patientId: made.patient.id, expectedVersion: 1, changeReason: 'Архивирование карточки', idempotencyKey: randomUUID(), testDataAcknowledged: true };
    const archived = await rpc<Mutation>('orion_patient_archive', ['assignment-a', command, 'fac-a']);
    expect(archived.patient).toMatchObject({ status: 'inactive', version: 2 });
    expect(archived.patient.profileHistory.map(p => p.status)).toEqual(['inactive', 'active']);
    const active = await rpc<{ patients: Patient[] }>('orion_patients_list', ['assignment-a']);
    expect(active.patients).toEqual([]);
    const all = await rpc<{ patients: Patient[] }>('orion_patients_list', ['assignment-a', 'fac-a', null, 'all', 50]);
    expect(all.patients[0].status).toBe('inactive');
    await expect(rpc('orion_patient_archive', ['assignment-a', { ...command, expectedVersion: 2, idempotencyKey: randomUUID() }, 'fac-a'])).rejects.toMatchObject({ code: 'PT422', message: 'PATIENT_ALREADY_ARCHIVED' });
  });

  it('deduplicates same-key creates; refuses another payload and active same-name/date candidate', async () => {
    const command = payload();
    const a = await rpc<Mutation>('orion_patient_create', ['assignment-a', command]);
    const b = await rpc<Mutation>('orion_patient_create', ['assignment-a', command]);
    expect(a.patient.id).toBe(b.patient.id);
    expect(b.replayed).toBe(true);
    await expect(rpc('orion_patient_create', ['assignment-a', { ...command, displayName: 'Подмена команды' }])).rejects.toMatchObject({ message: 'PATIENT_COMMAND_CONFLICT', code: 'PT409' });
    await expect(create()).rejects.toMatchObject({ message: 'PATIENT_DUPLICATE_CANDIDATE', code: 'PT409' });
    expect(await counts()).toEqual({ patients: 1, versions: 1, commands: 1, audits: 2 });
    await create({ displayName: 'Пациент без даты', birthDate: null });
    await expect(create({ displayName: 'Пациент без даты', birthDate: null })).rejects.toMatchObject({ message: 'PATIENT_DUPLICATE_CANDIDATE', code: 'PT409' });
  });

  it('rejects logged-out, expired, anonymous, wrong-issuer, disabled and banned principals', async () => {
    for (const change of [{ exp: 1 }, { is_anonymous: true }, { iss: 'https://other.supabase.co/auth/v1' }, { session_id: randomUUID() }]) {
      await claims(change);
      await expect(rpc('orion_access_overview')).rejects.toMatchObject({ code: 'PT401' });
    }
    await claims();
    await db.exec(`update auth.users set banned_until=clock_timestamp()+interval '1 day'`);
    await expect(rpc('orion_access_overview')).rejects.toMatchObject({ code: 'PT401' });
    await db.exec('update auth.users set banned_until=null; update orion_private.users set status=\'disabled\',version=version+1,updated_at=2');
    await expect(rpc('orion_access_overview')).rejects.toMatchObject({ code: 'PT403' });
    await db.exec('update orion_private.users set status=\'active\',version=version+1,updated_at=3; delete from auth.sessions');
    await expect(create()).rejects.toMatchObject({ code: 'PT401' });
    expect((await counts()).patients).toBe(0);
  });

  it('denies forged role metadata, explicit write deny and current assignment revocation', async () => {
    await claims({ app_metadata: { role: 'administrator', roles: ['doctor'] }, user_metadata: { role: 'doctor' } });
    await db.exec(`
      insert into orion_private.department_access_assignment_versions values('assignment-a-v2','org-a','fac-a','assignment-a','dept-a','member-a',2,'assignment-a-v1','active','bootstrap','["doctor"]','[]','["patient.profile.write"]',1,null,'Ограничение записи','member-a',2,2);
      update orion_private.department_access_assignment_heads set current_version_id='assignment-a-v2',lock_version=2,updated_at=2 where id='assignment-a-head';
    `);
    await expect(create()).rejects.toMatchObject({ code: 'PT403' });
    const list = await rpc<{ patients: Patient[] }>('orion_patients_list', ['assignment-a']);
    expect(list.patients).toEqual([]);
    await db.exec(`
      insert into orion_private.department_access_assignment_versions values('assignment-a-v3','org-a','fac-a','assignment-a','dept-a','member-a',3,'assignment-a-v2','revoked','bootstrap','["doctor"]','[]','[]',1,null,'Отзыв доступа','member-a',3,3);
      update orion_private.department_access_assignment_heads set current_version_id='assignment-a-v3',lock_version=3,updated_at=3 where id='assignment-a-head';
    `);
    await expect(rpc('orion_patients_list', ['assignment-a'])).rejects.toMatchObject({ code: 'PT403' });
  });

  it('requires exact facility/assignment, does not leak another tenant or absent patient', async () => {
    const made = await create();
    await expect(rpc('orion_patient_detail', ['assignment-a', made.patient.id, 'fac-b'])).rejects.toMatchObject({ code: 'PT403' });
    await expect(rpc('orion_patients_list', ['assignment-b'])).rejects.toMatchObject({ code: 'PT403' });
    const absent = await rpc<{ patient: null }>('orion_patient_detail', ['assignment-a', 'nonexistent', 'fac-a']);
    expect(absent.patient).toBeNull();
    expect((await counts()).audits).toBe(1);
  });

  it('rolls back patient/profile/command when mandatory audit fails; reads fail closed too', async () => {
    await db.exec(`create function orion_private.test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$; create trigger test_audit_failure before insert on orion_private.audit_events for each row execute function orion_private.test_audit_failure()`);
    await expect(create()).rejects.toThrow('forced audit failure');
    expect(await counts()).toEqual({ patients: 0, versions: 0, commands: 0, audits: 0 });
    await expect(rpc('orion_patients_list', ['assignment-a'])).rejects.toThrow('forced audit failure');
  });

  it('protects immutable roots/versions and rejects head skips, rewinds and cross-scope versions', async () => {
    const made = await create();
    await expect(db.query('update orion_private.patient_profile_versions set display_name=$1 where patient_id=$2', ['Подмена', made.patient.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('delete from orion_private.patients where id=$1', [made.patient.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('update orion_private.patient_profile_heads set lock_version=3 where patient_id=$1', [made.patient.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('delete from orion_private.patient_profile_heads where patient_id=$1', [made.patient.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`insert into orion_private.patient_profile_versions select 'bad-profile',organization_id,'fac-b',patient_id,2,display_name,birth_date,sex_at_birth,phone,email,address,status,created_by_membership_id,'Проверка границы',id,created_at+1 from orion_private.patient_profile_versions where patient_id=$1`, [made.patient.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('retains ordered hash-schema-1 byte contract, serialized audit chain and append-only history', async () => {
    await create({ displayName: 'Пациент "А"' });
    await rpc('orion_patients_list', ['assignment-a']);
    const { rows } = await db.query<Record<string, unknown>>('select * from orion_private.audit_events order by sequence');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const canonical = JSON.stringify({
        hashSchemaVersion: 1, previousHash: row.previous_hash, organizationId: row.organization_id,
        facilityId: row.facility_id, sequence: Number(row.sequence), actorType: row.actor_type,
        actorId: row.actor_id, actorMembershipId: row.actor_membership_id, action: row.action,
        outcome: row.outcome, purpose: row.purpose, schemaVersion: row.schema_version,
        entityType: row.entity_type, entityId: row.entity_id, requestId: row.request_id,
        metadataJson: row.metadata_json, occurredAt: Number(row.occurred_at),
      });
      expect(row.event_hash).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
      expect(JSON.parse(row.metadata_json as string)).not.toHaveProperty('displayName');
    }
    expect(rows[1].previous_hash).toBe(rows[0].event_hash);
    await expect(db.query('update orion_private.audit_events set action=$1', ['rewritten'])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('delete from orion_private.audit_stream_heads')).rejects.toMatchObject({ code: '23514' });
  });

  it('validates structured payload, real calendar dates and idempotency rather than trusting API preflight', async () => {
    for (const invalid of [payload({ birthDate: '2024-02-30' }), payload({ displayName: 12 }), payload({ sexAtBirth: 'invented' }), payload({ actorId: 'staff-other' }), payload({ email: 'invalid-email' }), payload({ idempotencyKey: 'not-a-uuid' }), payload({ testDataAcknowledged: false }), payload({ patientId: 'ignored-field-must-fail' })]) {
      await expect(rpc('orion_patient_create', ['assignment-a', invalid])).rejects.toMatchObject({ code: 'PT400' });
    }
    expect(await counts()).toEqual({ patients: 0, versions: 0, commands: 0, audits: 0 });
  });

  it('never uses legacy administrator role alone to issue an administrator-sourced grant', async () => {
    await db.exec(`update orion_private.memberships set role='administrator',version=version+1,updated_at=2`);
    await expect(db.exec(`insert into orion_private.department_access_assignment_versions values('assignment-a-v2','org-a','fac-a','assignment-a','dept-a','member-a',2,'assignment-a-v1','active','administrator','["administrator"]','[]','[]',1,null,'Попытка повышения','member-a',2,2)`)).rejects.toMatchObject({ code: '23514', message: 'current access.manage required' });
  });

  it('owner bootstrap template requires an exact confirmed nonanonymous identity and is one-time atomic', async () => {
    const bootstrapSubject = '33333333-3333-4333-8333-333333333333';
    const bootstrapEmail = 'owner-fixture@example.invalid';
    const template = readFileSync(new URL('./0003_owner_access_bootstrap.sql', import.meta.url), 'utf8');
    await expect(db.exec(template)).rejects.toMatchObject({ code: '22P02' });
    await db.exec('rollback');
    const explicit = template.replace('__CONFIRMED_OWNER_AUTH_UUID__', bootstrapSubject).replace('__CONFIRMED_OWNER_AUTH_EMAIL__', bootstrapEmail);
    await db.query('insert into auth.users(id,email) values($1,$2)', [bootstrapSubject, bootstrapEmail]);
    await expect(db.exec(explicit)).rejects.toThrow('confirmed, nonanonymous exact owner identity required');
    await db.exec('rollback');
    await db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1', [bootstrapSubject]);
    await db.exec(explicit);
    const { rows } = await db.query<{ roles: string[]; sequence: number }>(`select v.roles_json roles,a.sequence::int sequence from orion_private.department_access_assignment_versions v join orion_private.audit_events a on a.organization_id=v.organization_id and a.facility_id=v.facility_id where v.assignment_id='access-assignment-owner-general-medicine'`);
    expect(rows).toEqual([{ roles: ['doctor', 'administrator'], sequence: 1 }]);
    await expect(db.exec(explicit)).rejects.toThrow('bootstrap already initialized');
    await db.exec('rollback');
    const total = await db.query<{ count: number }>(`select count(*)::int count from orion_private.audit_events where organization_id='org-orion-cloud'`);
    expect(total.rows[0].count).toBe(1);
  });
});
