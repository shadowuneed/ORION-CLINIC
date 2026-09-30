import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCloudPatientDetail, parseCloudPatientHistoryPage, parseCloudPatientListPage,
  parseCloudPatientMutation } from '@/lib/cloud/response-contracts';

// Actual PostgreSQL WASM with disposable artificial rows only. The operator
// bootstrap is deliberately NOT instantiated or applied by these tests.
const issuer = 'https://bctyswbqjgpmtsanrfhp.supabase.co/auth/v1';
const subject = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
type Cursor = Record<string, unknown>;
type Page = { hasMore: boolean; nextCursor: Cursor | null };
type HistoryItem = { id: string; version: number; status: string; updatedAt?: number };
type Patient = {
  id: string; displayName: string; version: number; status: string; encounterCount: number;
  encounters: HistoryItem[]; profileHistory: HistoryItem[]; profileHistoryCount: number;
  encountersPage: Page; profileHistoryPage: Page;
};
type Mutation = { patient: Patient; replayed: boolean };
type Directory = { patients: Patient[]; page: Page; accessAssignmentId: string };
type History = { items: HistoryItem[]; page: Page; patientId: string; profileVersion: number; historyKind: string };

async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  const bound = args.map((arg, i) => i === 5 && arg !== null ? JSON.stringify(arg) : arg);
  const result = await db.query<{ result: T }>(`select public.${name}(${placeholders}) result`, bound);
  return result.rows[0].result;
}
async function claims(extra: Record<string, unknown> = {}) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({
    iss: issuer, sub: subject, role: 'authenticated', session_id: session,
    exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false, ...extra,
  })]);
}
function payload(changes: Record<string, unknown> = {}) {
  return { displayName: 'Пациент проверки', birthDate: '1990-01-02', sexAtBirth: 'unknown',
    testIin: null, phone: null, email: null, address: null, idempotencyKey: randomUUID(),
    testDataAcknowledged: true, ...changes };
}
async function create(changes: Record<string, unknown> = {}) {
  return rpc<Mutation>('orion_patient_create', ['assignment-a', payload(changes), 'fac-a']);
}
function directory(cursor: Cursor | null = null, size = 25, query: string | null = null, status = 'active') {
  return rpc<Directory>('orion_patients_list', ['assignment-a', 'fac-a', query, status, size, cursor]);
}
function history(patientId: string, kind: string, cursor: Cursor | null = null, size = 25) {
  return rpc<History>('orion_patient_history_page', ['assignment-a', patientId, kind, 'fac-a', size, cursor]);
}
async function counts() {
  return (await db.query<{ versions: number; commands: number; audits: number }>(`select
    (select count(*)::int from orion_private.patient_profile_versions) versions,
    (select count(*)::int from orion_private.command_idempotency) commands,
    (select count(*)::int from orion_private.audit_events) audits`)).rows[0];
}
async function seedDirectory(total: number) {
  await db.query(`select set_config('test.patient_total',$1,false)`, [String(total)]);
  await db.exec(`do $$ declare n integer; pat text; prof text; begin
    for n in 1..current_setting('test.patient_total')::integer loop
      pat:='directory-'||lpad(n::text,3,'0'); prof:=pat||'-profile-1';
      insert into orion_private.patients values(pat,'org-a','fac-a','SYN-'||n,'Пациент '||n,'1990-01-02','unknown','active',1000,1000,1);
      insert into orion_private.patient_profile_versions values(prof,'org-a','fac-a',pat,1,'Пациент '||n,'1990-01-02','unknown',null,null,null,'active','member-a','Искусственная проверка',null,1000);
      insert into orion_private.patient_profile_heads values(pat||'-head','org-a','fac-a',pat,prof,1,1000);
    end loop; end $$`);
}
async function seedHistories(patientId: string, profiles: number, encounters: number) {
  await db.query(`select set_config('test.patient_id',$1,false),set_config('test.profile_total',$2,false),set_config('test.encounter_total',$3,false)`,
    [patientId, String(profiles), String(encounters)]);
  await db.exec(`do $$ declare n integer; pat text:=current_setting('test.patient_id'); previous text; observed bigint; begin
    select h.current_version_id,h.updated_at into previous,observed from orion_private.patient_profile_heads h where h.patient_id=pat;
    for n in 2..current_setting('test.profile_total')::integer loop
      insert into orion_private.patient_profile_versions
        select pat||'-history-'||n,organization_id,facility_id,patient_id,n,display_name,birth_date,sex_at_birth,
          phone,email,address,status,'member-a','Искусственная версия '||n,previous,observed+n
        from orion_private.patient_profile_versions where id=previous;
      update orion_private.patient_profile_heads set current_version_id=pat||'-history-'||n,lock_version=n,updated_at=observed+n where patient_id=pat;
      previous:=pat||'-history-'||n;
    end loop;
    insert into orion_private.encounters
      select 'encounter-'||lpad(g.num::text,5,'0'),'org-a','fac-a',pat,'member-a','draft','Искусственная проверка',
        null,null,null,1000,1000+(g.num/3),1 from generate_series(1,current_setting('test.encounter_total')::integer) g(num);
  end $$`);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for (const name of ['0001_private_schema_boundary.sql', '0002_access_patient_registry.sql', '0004_bounded_patient_pagination.sql']) {
    await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users(id) values($1)', [subject]);
  await db.query('insert into auth.sessions values($1,$2,null)', [session, subject]);
  await db.query(`insert into orion_private.users values('staff-a',$1,$2,null,'Сотрудник проверки','active',1,1,1)`, [issuer, subject]);
  await db.exec(`insert into orion_private.organizations values('org-a','Организация A','active',1,1,1),('org-b','Организация B','active',1,1,1);
    insert into orion_private.facilities values('fac-a','org-a','Клиника A','UTC','active',1,1,1),('fac-b','org-b','Клиника B','UTC','active',1,1,1);
    insert into orion_private.memberships values('member-a','org-a','fac-a','staff-a','clinician','active',1,1,1);
    insert into orion_private.departments values('dept-a','org-a','fac-a','medicine','Медицина','clinical','active',1,1,1);
    insert into orion_private.department_versions values('dept-a-v1','org-a','fac-a','dept-a',1,null,'Медицина','clinical','active','Искусственное подразделение','member-a',1,1);
    insert into orion_private.department_heads values('dept-a-head','org-a','fac-a','dept-a','dept-a-v1',1,1,1);
    insert into orion_private.department_access_assignments values('assignment-a','org-a','fac-a','dept-a','member-a','member-a',1);
    insert into orion_private.department_access_assignment_versions values('assignment-a-v1','org-a','fac-a','assignment-a','dept-a','member-a',1,null,'active','bootstrap','["doctor"]','[]','[]',1,null,'Искусственный доступ','member-a',1,1);
    insert into orion_private.department_access_assignment_heads values('assignment-a-head','org-a','fac-a','assignment-a','dept-a','member-a','assignment-a-v1',1,1,1);`);
  await claims();
}, 20000);
afterEach(async () => { await db.close(); });

describe('0004 forward PostgreSQL pagination', () => {
  it('retains all18 RLS tables, zero direct grants and exactly seven authenticated-only RPCs', async () => {
    expect((await db.query(`select count(*)::int total,count(*) filter(where c.relrowsecurity)::int protected from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='orion_private' and c.relkind='r'`)).rows[0]).toEqual({ total: 18, protected: 18 });
    const functions = (await db.query<{ name: string; authenticated: boolean; anon: boolean; service: boolean; definer: boolean; config: string[] }>(`
      select p.proname name,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service,
        p.prosecdef definer,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'orion_%'`)).rows;
    expect(functions).toHaveLength(7);
    expect(functions.filter(f => f.name === 'orion_patients_list')).toHaveLength(1);
    for (const f of functions) expect(f).toMatchObject({ authenticated: true, anon: false, service: false, definer: true, config: ['search_path=""'] });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await db.query('select has_schema_privilege($1,$2,$3) allowed', [role, 'orion_private', 'USAGE'])).rows[0]).toEqual({ allowed: false });
      expect((await db.query(`select count(*)::int n from information_schema.table_privileges where table_schema='orion_private' and grantee=$1`, [role])).rows[0]).toEqual({ n: 0 });
      expect((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='orion_private' and has_function_privilege($1,p.oid,'EXECUTE')`, [role])).rows[0]).toEqual({ n: 0 });
    }
    await db.exec('set role anon');
    await expect(directory()).rejects.toMatchObject({ code: '42501' });
    await db.exec('reset role; set role authenticated');
    expect((await directory()).patients).toEqual([]);
    await expect(db.query('select * from orion_private.patients')).rejects.toMatchObject({ code: '42501' });
  });

  it('returns default25, continues equal-timestamp keysets without gaps and exposes explicit terminal page', async () => {
    await seedDirectory(55);
    const first = await rpc<Directory>('orion_patients_list', ['assignment-a']);
    expect(parseCloudPatientListPage(first, 'assignment-a', { organizationId: 'org-a', facilityId: 'fac-a' }).patients).toHaveLength(25);
    expect(first.patients).toHaveLength(25);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toMatchObject({ domainVersion: 1, kind: 'directory', assignmentId: 'assignment-a', assignmentVersionId: 'assignment-a-v1', query: '', status: 'active', updatedAt: 1000, patientId: 'directory-031' });
    const second = await directory(first.page.nextCursor);
    const third = await directory(second.page.nextCursor);
    expect(second.patients).toHaveLength(25);
    expect(third.patients).toHaveLength(5);
    expect(third.page).toEqual({ hasMore: false, nextCursor: null });
    const ids = [...first.patients, ...second.patients, ...third.patients].map(p => p.id);
    expect(ids).toEqual(Array.from({ length: 55 }, (_, i) => `directory-${String(55 - i).padStart(3, '0')}`));
    expect(new Set(ids).size).toBe(55);
    expect((await directory(null, 50)).patients).toHaveLength(50);
    expect((await directory(null, 50, '%')).patients).toEqual([]);
    await expect(directory(null, 100)).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_QUERY' });
  });

  it('reads and mutates >1000 history rows through bounded replies with every older row reachable', async () => {
    const made = await create();
    await seedHistories(made.patient.id, 1005, 1101);
    const detail = await rpc<{ patient: Patient }>('orion_patient_detail', ['assignment-a', made.patient.id, 'fac-a']);
    const parsedDetail = parseCloudPatientDetail(detail, 'assignment-a', made.patient.id, { organizationId: 'org-a', facilityId: 'fac-a' });
    expect(parsedDetail?.profileHistoryPage?.nextCursor?.length).toBeLessThanOrEqual(2048);
    expect(detail.patient).toMatchObject({ version: 1005, profileHistoryCount: 1005, encounterCount: 1101 });
    expect(detail.patient.profileHistory).toHaveLength(25);
    expect(detail.patient.encounters).toHaveLength(25);
    expect(Buffer.byteLength(JSON.stringify(detail), 'utf8')).toBeLessThan(786432);
    for (const kind of ['profile', 'encounters'] as const) {
      const initial = kind === 'profile' ? detail.patient.profileHistory : detail.patient.encounters;
      let page = kind === 'profile' ? detail.patient.profileHistoryPage : detail.patient.encountersPage;
      const all = [...initial];
      while (page.hasMore) {
        expect(page.nextCursor).not.toBeNull();
        const next = await history(made.patient.id, kind, page.nextCursor, 50);
        expect(parseCloudPatientHistoryPage(next, 'assignment-a', made.patient.id, kind,
          { organizationId: 'org-a', facilityId: 'fac-a' }, 1005).items).toHaveLength(next.items.length);
        expect(next.profileVersion).toBe(1005);
        expect(next.items.length).toBeLessThanOrEqual(50);
        all.push(...next.items); page = next.page;
      }
      expect(page.nextCursor).toBeNull();
      expect(all).toHaveLength(kind === 'profile' ? 1005 : 1101);
      expect(new Set(all.map(item => item.id)).size).toBe(all.length);
      if (kind === 'profile') expect(all.map(item => item.version)).toEqual(Array.from({ length: 1005 }, (_, i) => 1005 - i));
    }
    const command = { patientId: made.patient.id, expectedVersion: 1005, changeReason: 'Искусственное исправление',
      ...payload({ displayName: 'Пациент исправлен' }) };
    delete (command as Partial<typeof command>).testIin;
    const updated = await rpc<Mutation>('orion_patient_update', ['assignment-a', command, 'fac-a']);
    expect(parseCloudPatientMutation(updated, 'assignment-a', made.patient.id,
      { organizationId: 'org-a', facilityId: 'fac-a' }).version).toBe(1006);
    expect(updated.patient).toMatchObject({ version: 1006, profileHistoryCount: 1006, encounterCount: 1101 });
    expect(updated.patient.profileHistory).toHaveLength(25);
    expect(updated.patient.profileHistoryPage.nextCursor).toMatchObject({ profileVersion: 1006, assignmentVersionId: 'assignment-a-v1' });
    const replay = await rpc<Mutation>('orion_patient_update', ['assignment-a', command, 'fac-a']);
    expect(replay.replayed).toBe(true);
    expect(replay.patient).toEqual(updated.patient);
    expect((await counts()).versions).toBe(1006);
    await expect(history(made.patient.id, 'profile', detail.patient.profileHistoryPage.nextCursor)).rejects.toMatchObject({ code: 'PT409', message: 'PAGINATION_STALE' });
  }, 30000);

  it('rejects malformed, wrong-kind, cross-patient, tenant/filter and unsafe-integer cursors without auditing', async () => {
    await seedDirectory(30);
    const first = await directory(); const cursor = first.page.nextCursor!;
    const before = await counts();
    for (const bad of [[], 'cursor', { ...cursor, ignored: true }, { ...cursor, domainVersion: 2 },
      { ...cursor, updatedAt: '1000' }, { ...cursor, updatedAt: -1 }, { ...cursor, updatedAt: 1.5 },
      { ...cursor, updatedAt: 9007199254740992 }, { ...cursor, assignmentId: 'wrong' },
      { ...cursor, organizationId: 'org-b' }, { ...cursor, query: 'changed' }, { ...cursor, kind: 'profile' },
      { ...cursor, patientId: 'x'.repeat(161) }, { ...cursor, query: 'x'.repeat(1537) }]) {
      await expect(rpc('orion_patients_list', ['assignment-a', 'fac-a', null, 'active', 25, bad])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_CURSOR' });
    }
    expect(await counts()).toEqual(before);
    const one = first.patients[0]; const two = first.patients[1];
    const profile = { domainVersion: 1, kind: 'profile', organizationId: 'org-a', facilityId: 'fac-a',
      assignmentId: 'assignment-a', assignmentVersionId: 'assignment-a-v1', patientId: one.id, profileVersion: 1, beforeVersion: 1 };
    await expect(history(two.id, 'profile', profile)).rejects.toMatchObject({ code: 'PT400' });
    await expect(history(one.id, 'profile', { ...profile, beforeVersion: 0 })).rejects.toMatchObject({ code: 'PT400' });
    await expect(history(one.id, 'profile', { ...profile, profileVersion: '1' })).rejects.toMatchObject({ code: 'PT400' });
    await expect(history(one.id, 'profile', { ...profile, beforeVersion: 2147483648 })).rejects.toMatchObject({ code: 'PT400' });
    await expect(history(one.id, 'unknown')).rejects.toMatchObject({ code: 'PT400' });
  });

  it('returns409 after the exact assignment version changes and403 after revoke, with no fallback', async () => {
    await seedDirectory(30); const first = await directory();
    await db.exec(`insert into orion_private.department_access_assignment_versions values('assignment-a-v2','org-a','fac-a','assignment-a','dept-a','member-a',2,'assignment-a-v1','active','bootstrap','["doctor"]','[]','[]',1,null,'Новая версия доступа','member-a',2,2);
      update orion_private.department_access_assignment_heads set current_version_id='assignment-a-v2',lock_version=2,updated_at=2 where id='assignment-a-head';`);
    await expect(directory(first.page.nextCursor)).rejects.toMatchObject({ code: 'PT409', message: 'PAGINATION_STALE' });
    expect((await directory()).page.nextCursor).toMatchObject({ assignmentVersionId: 'assignment-a-v2' });
    await db.exec(`insert into orion_private.department_access_assignment_versions values('assignment-a-v3','org-a','fac-a','assignment-a','dept-a','member-a',3,'assignment-a-v2','revoked','bootstrap','["doctor"]','[]','[]',1,null,'Отзыв доступа','member-a',3,3);
      update orion_private.department_access_assignment_heads set current_version_id='assignment-a-v3',lock_version=3,updated_at=3 where id='assignment-a-head';`);
    await expect(directory()).rejects.toMatchObject({ code: 'PT403' });
    await expect(history(first.patients[0].id, 'profile')).rejects.toMatchObject({ code: 'PT403' });
  });

  it('retains live-session and neutral exact-patient/facility denial on the seventh RPC', async () => {
    const made = await create();
    await expect(rpc('orion_patient_history_page', ['assignment-a', made.patient.id, 'profile', 'fac-b'])).rejects.toMatchObject({ code: 'PT403' });
    await expect(history('foreign-or-absent', 'profile')).rejects.toMatchObject({ code: 'PT404', message: 'PATIENT_NOT_FOUND' });
    await claims({ iss: 'https://other.supabase.co/auth/v1' });
    await expect(history(made.patient.id, 'profile')).rejects.toMatchObject({ code: 'PT401' });
    await claims(); await db.exec('delete from auth.sessions');
    await expect(history(made.patient.id, 'profile')).rejects.toMatchObject({ code: 'PT401' });
  });

  it('fails closed for stale directory/encounter anchors and reaches empty terminal histories', async () => {
    await seedDirectory(30); const first = await directory();
    await expect(directory({ ...first.page.nextCursor, updatedAt: 999 })).rejects.toMatchObject({ code: 'PT409' });
    const made = await create({ displayName: 'Другой пациент' });
    const empty = await history(made.patient.id, 'encounters');
    expect(empty).toMatchObject({ items: [], page: { hasMore: false, nextCursor: null }, profileVersion: 1 });
    await seedHistories(made.patient.id, 1, 30);
    const encounters = await history(made.patient.id, 'encounters');
    await expect(history(made.patient.id, 'encounters', { ...encounters.page.nextCursor, updatedAt: 999 })).rejects.toMatchObject({ code: 'PT409' });
  });

  it('bounds individual encounter reasons and prevents oversized wrapper failures from committing a mutation', async () => {
    const made = await create();
    await expect(db.query(`insert into orion_private.encounters values('bad-reason','org-a','fac-a',$1,'member-a','draft',$2,null,null,null,1,1,1)`,
      [made.patient.id, 'Ж'.repeat(501)])).rejects.toMatchObject({ code: '23514', constraint: 'encounters_reason_dto_bound' });
    await expect(db.query('select orion_private.bounded_patient_response($1)', [{ oversized: 'Ж'.repeat(400000) }])).rejects.toMatchObject({ code: 'PT503', message: 'PATIENT_RESPONSE_TOO_LARGE' });
    const before = await counts();
    // Fault at response publication after unchanged patient_command has performed
    // its mutation/audit. SQL transaction must roll all parts back together.
    await db.exec(`create or replace function orion_private.scoped_patient_response(value jsonb,scope jsonb) returns jsonb language plpgsql immutable set search_path='' as $$ begin
      return orion_private.bounded_patient_response(value||jsonb_build_object('forced',repeat('Ж',400000))); end $$`);
    const command = { patientId: made.patient.id, expectedVersion: 1, changeReason: 'Проверка атомарности', ...payload({ displayName: 'Новые данные' }) };
    delete (command as Partial<typeof command>).testIin;
    await expect(rpc('orion_patient_update', ['assignment-a', command, 'fac-a'])).rejects.toMatchObject({ code: 'PT503', message: 'PATIENT_RESPONSE_TOO_LARGE' });
    expect(await counts()).toEqual(before);
    expect((await db.query(`select lock_version from orion_private.patient_profile_heads where patient_id=$1`, [made.patient.id])).rows[0]).toEqual({ lock_version: 1 });
  });

  it('rejects UTF16-oversized direct RPC values before commit and validates date/time scalar limits', async () => {
    expect((await db.query('select orion_private.patient_utf16_length($1) units', ['A😀Б'])).rows[0]).toEqual({ units: 4 });
    const before = await counts();
    await expect(create({ address: '😀'.repeat(200) })).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_PATIENT_RESPONSE' });
    await expect(create({ displayName: '😀'.repeat(160) })).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_PATIENT_RESPONSE' });
    expect(await counts()).toEqual(before);
    const made = await create(); const afterCreate = await counts();
    const command = { patientId: made.patient.id, expectedVersion: 1, changeReason: '😀'.repeat(200), ...payload({ displayName: 'Исправленный пациент' }) };
    delete (command as Partial<typeof command>).testIin;
    await expect(rpc('orion_patient_update', ['assignment-a', command, 'fac-a'])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_PATIENT_RESPONSE' });
    expect(await counts()).toEqual(afterCreate);
    for (const invalid of [{ birthDate: '2024-02-30' }, { birthDate: 'not-date' }, { updatedAt: -1 }, { createdAt: 9007199254740992 }, { version: 0 }, { id: 'x'.repeat(161) }, { testIin: 'invalid' }, { photoUrl: 'https://example.invalid/private' }]) {
      await expect(db.query('select orion_private.bounded_patient_response($1)', [invalid])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_PATIENT_RESPONSE' });
    }
    await db.query(`insert into orion_private.encounters values('astral-reason','org-a','fac-a',$1,'member-a','draft',$2,null,null,null,1,1,1)`, [made.patient.id, '😀'.repeat(500)]);
    await expect(rpc('orion_patient_detail', ['assignment-a', made.patient.id, 'fac-a'])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_PATIENT_RESPONSE' });
    await expect(rpc('orion_patient_archive', ['assignment-a', { patientId: made.patient.id, expectedVersion: 1, changeReason: 'Искусственный архив', idempotencyKey: randomUUID(), testDataAcknowledged: true }, 'fac-a'])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_PATIENT_RESPONSE' });
    expect(await counts()).toEqual(afterCreate);
  });

  it('rolls back publication when individually valid generated cursor IDs exceed its total byte cap', async () => {
    const made = await create();
    await seedHistories(made.patient.id, 30, 0);
    const largeId = '界'.repeat(160);
    const scope = { organizationId: largeId, facilityId: largeId, assignmentId: largeId, assignmentVersionId: largeId };
    const cursor = { domainVersion: 1, kind: 'profile', ...scope, patientId: made.patient.id, profileVersion: 30, beforeVersion: 6 };
    expect(largeId.length).toBe(160);
    expect(Buffer.byteLength(JSON.stringify(cursor), 'utf8')).toBeGreaterThan(1536);
    await expect(db.query(`select orion_private.validate_patient_cursor($1,$2,'profile',$3,30)`,
      [cursor, scope, made.patient.id])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_CURSOR' });
    const before = await counts();
    // Inject valid-length but oversized scope metadata at the final generated
    // cursor boundary, after patient_command has inserted version/audit/replay.
    await db.exec(`create or replace function orion_private.patient_cursor_scope(scope jsonb) returns jsonb
      language sql immutable set search_path='' as $$select jsonb_build_object('domainVersion',1,
        'organizationId',repeat('界',160),'facilityId',repeat('界',160),
        'assignmentId',repeat('界',160),'assignmentVersionId',repeat('界',160))$$`);
    const command = { patientId: made.patient.id, expectedVersion: 30, changeReason: 'Проверка размера курсора', ...payload({ displayName: 'Новые данные' }) };
    delete (command as Partial<typeof command>).testIin;
    await expect(rpc('orion_patient_update', ['assignment-a', command, 'fac-a'])).rejects.toMatchObject({ code: 'PT400', message: 'INVALID_CURSOR' });
    expect(await counts()).toEqual(before);
    expect((await db.query(`select lock_version from orion_private.patient_profile_heads where patient_id=$1`, [made.patient.id])).rows[0]).toEqual({ lock_version: 30 });
  });

  it('requires audit before publishing history/list, and keeps the original atomic command body untouched', async () => {
    const made = await create(); const before = await counts();
    await db.exec(`create function orion_private.force_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$;
      create trigger forced_audit_failure before insert on orion_private.audit_events for each row execute function orion_private.force_audit_failure();`);
    await expect(history(made.patient.id, 'profile')).rejects.toThrow('forced audit failure');
    await expect(directory()).rejects.toThrow('forced audit failure');
    expect(await counts()).toEqual(before);
    const original = readFileSync(new URL('./0002_access_patient_registry.sql', import.meta.url), 'utf8')
      .split('CREATE FUNCTION orion_private.patient_command')[1].split('AS $$')[1].split('END $$;')[0] + 'END ';
    const body = (await db.query<{ source: string }>(`select prosrc source from pg_proc where oid='orion_private.patient_command(text,jsonb,text,text)'::regprocedure`)).rows[0].source;
    expect(body.trim()).toBe(original.trim());
  });
});
