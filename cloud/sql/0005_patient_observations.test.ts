import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createObservationSchema, toStoredObservationValues } from '@/lib/domain/observations';
import { parseCloudLatestVitals } from '@/lib/cloud/observation-latest-contract.server';
import type { LatestPatientVitals, ObservationVersionRecord, PatientObservationRecord } from '@/lib/repositories/patient-observations';

// Disposable PostgreSQL WASM; all fixtures are artificial. Never apply0003,
// connect a provider, import local records, or bootstrap the operator account.
const issuer = 'https://bctyswbqjgpmtsanrfhp.supabase.co/auth/v1';
const subject = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const otherSubject = '33333333-3333-4333-8333-333333333333';
const otherSession = '44444444-4444-4444-8444-444444444444';
let db: PGlite;
let patientSequence = 0;
type Cursor = Record<string, unknown>;
type Page = { hasMore: boolean; nextCursor: Cursor | null };
type RecordWithPage = PatientObservationRecord & { historyCount: number; currentVersion: number; historyPage: Page };
type Envelope = { organizationId: string; facilityId: string; patientId: string; accessAssignmentId: string;
  assignmentVersionId: string; role: 'clinician' | 'nurse'; timeZone: string; sourceLabel: string;
  observedAt: number; clinicalInterpretation: 'not_performed' };
type Mutation = Envelope & { observation: RecordWithPage; replayed: boolean };
type List = Envelope & { observations: RecordWithPage[]; page: Page };
type History = Envelope & { observationId: string; observationVersion: number; items: ObservationVersionRecord[]; page: Page };
type Counts = { records: number; versions: number; heads: number; receipts: number; audits: number };

async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  const result = await db.query<{ result: T }>(`select public.${name}(${placeholders}) result`,
    args.map(arg => arg !== null && typeof arg === 'object' ? JSON.stringify(arg) : arg));
  return result.rows[0].result;
}
async function claims(extra: Record<string, unknown> = {}) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({
    iss: issuer, sub: subject, role: 'authenticated', session_id: session,
    exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false, ...extra,
  })]);
}
async function patient() {
  const result = await rpc<{ patient: { id: string } }>('orion_patient_create', ['assignment-a', {
    displayName: `Искусственный пациент ${++patientSequence}`, birthDate: '1990-01-02', sexAtBirth: 'unknown',
    testIin: null, phone: null, email: null, address: null, idempotencyKey: randomUUID(), testDataAcknowledged: true,
  }, 'fac-a']);
  return result.patient.id;
}
function payload(patientId: string, changes: Record<string, unknown> = {}) {
  return { patientId, measuredAt: Date.now() - 1000, context: 'consultation',
    values: { heightCm: 165, weightKg: 64, systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 36.5 },
    note: null, reason: 'Искусственная проверка записи', syntheticDataAcknowledged: true, idempotencyKey: randomUUID(), ...changes };
}
function create(patientId: string, changes: Record<string, unknown> = {}, assignment = 'assignment-a') {
  return rpc<Mutation>('orion_observation_create', [assignment, payload(patientId, changes), 'fac-a']);
}
function correct(made: Mutation, changes: Record<string, unknown> = {}, assignment = 'assignment-a') {
  const current = made.observation.current;
  const values = { heightCm: current.values.heightCm, weightKg: current.values.weightKg,
    systolicMmhg: current.values.systolicMmhg, diastolicMmhg: current.values.diastolicMmhg, temperatureC: current.values.temperatureC };
  return rpc<Mutation>('orion_observation_correct', [assignment, made.observation.id, payload(made.patientId, {
    measuredAt: current.measuredAt, context: current.context, values, note: current.note,
    expectedVersion: current.version, ...changes,
  }), 'fac-a']);
}
function list(patientId: string, cursor: Cursor | null = null, size = 25, assignment = 'assignment-a') {
  return rpc<List>('orion_observations_page', [assignment, patientId, 'fac-a', size, cursor]);
}
function history(made: Mutation, cursor: Cursor | null = null, size = 25) {
  return rpc<History>('orion_observation_history_page', ['assignment-a', made.patientId, made.observation.id, 'fac-a', size, cursor]);
}
function latest(patientId: string, assignment = 'assignment-a') {
  return rpc<Envelope & { vitals: LatestPatientVitals }>('orion_patient_latest_vitals', [assignment, patientId, 'fac-a']);
}
async function counts() {
  return (await db.query<Counts>(`select
    (select count(*)::int from orion_private.patient_observation_records) records,
    (select count(*)::int from orion_private.patient_observation_versions) versions,
    (select count(*)::int from orion_private.patient_observation_heads) heads,
    (select count(*)::int from orion_private.observation_command_receipts) receipts,
    (select count(*)::int from orion_private.audit_events) audits`)).rows[0];
}
async function changeAssignment(options: { roles?: string[]; allows?: string[]; denies?: string[]; status?: string; until?: number } = {}) {
  await db.query(`insert into orion_private.department_access_assignment_versions
    select 'assignment-a-v'||(v.version+1),v.organization_id,v.facility_id,v.assignment_id,v.department_id,v.membership_id,v.version+1,v.id,
      $1,'bootstrap',$2::jsonb,$3::jsonb,$4::jsonb,1,$5,'Искусственная смена доступа','member-a',orion_private.now_ms(),1
    from orion_private.department_access_assignment_heads h join orion_private.department_access_assignment_versions v on v.id=h.current_version_id
    where h.assignment_id='assignment-a'`, [options.status ?? 'active', JSON.stringify(options.roles ?? ['doctor']),
    JSON.stringify(options.allows ?? []), JSON.stringify(options.denies ?? []), options.until ?? null]);
  await db.exec(`update orion_private.department_access_assignment_heads set current_version_id='assignment-a-v'||(lock_version+1),
    lock_version=lock_version+1,updated_at=orion_private.now_ms() where assignment_id='assignment-a'`);
}
async function addNurse() {
  await db.query('insert into auth.users(id) values($1)', [otherSubject]);
  await db.query('insert into auth.sessions values($1,$2,null)', [otherSession, otherSubject]);
  await db.query(`insert into orion_private.users values('staff-n',$1,$2,null,'Медсестра проверки','active',1,1,1)`, [issuer, otherSubject]);
  await db.exec(`insert into orion_private.memberships values('member-n','org-a','fac-a','staff-n','nurse','active',1,1,1);
    insert into orion_private.department_access_assignments values('assignment-n','org-a','fac-a','dept-a','member-n','member-a',1);
    insert into orion_private.department_access_assignment_versions values('assignment-n-v1','org-a','fac-a','assignment-n','dept-a','member-n',1,null,
      'active','bootstrap','["nurse"]','[]','[]',1,null,'Искусственная медсестра','member-a',1,1);
    insert into orion_private.department_access_assignment_heads values('assignment-n-head','org-a','fac-a','assignment-n','dept-a','member-n','assignment-n-v1',1,1,1);`);
}
async function fault(table: string, operation: string, behavior = 'return null') {
  await db.exec(`create function orion_private.test_observation_fault() returns trigger language plpgsql set search_path='' as $$begin ${behavior}; end$$;
    create trigger aaa_test_observation_fault before ${operation} on orion_private.${table} for each row execute function orion_private.test_observation_fault();`);
}

beforeEach(async () => {
  patientSequence = 0;
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for (const name of ['0001_private_schema_boundary.sql', '0002_access_patient_registry.sql', '0004_bounded_patient_pagination.sql', '0005_patient_observations.sql']) {
    try {
      await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
    } catch (error) {
      const diagnostic = error as { message: string; position?: string; internalPosition?: string; internalQuery?: string; where?: string };
      throw new Error(`${name}: ${JSON.stringify({ message: diagnostic.message, position: diagnostic.position,
        internalPosition: diagnostic.internalPosition, internalQuery: diagnostic.internalQuery, where: diagnostic.where })}`);
    }
  }
  await db.query('insert into auth.users(id) values($1)', [subject]);
  await db.query('insert into auth.sessions values($1,$2,null)', [session, subject]);
  await db.query(`insert into orion_private.users values('staff-a',$1,$2,null,'Сотрудник проверки','active',1,1,1)`, [issuer, subject]);
  await db.exec(`insert into orion_private.organizations values('org-a','Организация A','active',1,1,1),('org-b','Организация B','active',1,1,1);
    insert into orion_private.facilities values('fac-a','org-a','Клиника A','Asia/Almaty','active',1,1,1),('fac-b','org-b','Клиника B','UTC','active',1,1,1);
    insert into orion_private.memberships values('member-a','org-a','fac-a','staff-a','clinician','active',1,1,1);
    insert into orion_private.departments values('dept-a','org-a','fac-a','medicine','Медицина','clinical','active',1,1,1);
    insert into orion_private.department_versions values('dept-a-v1','org-a','fac-a','dept-a',1,null,'Медицина','clinical','active','Искусственное подразделение','member-a',1,1);
    insert into orion_private.department_heads values('dept-a-head','org-a','fac-a','dept-a','dept-a-v1',1,1,1);
    insert into orion_private.department_access_assignments values('assignment-a','org-a','fac-a','dept-a','member-a','member-a',1);
    insert into orion_private.department_access_assignment_versions values('assignment-a-v1','org-a','fac-a','assignment-a','dept-a','member-a',1,null,
      'active','bootstrap','["doctor"]','[]','[]',1,null,'Искусственный доступ','member-a',1,1);
    insert into orion_private.department_access_assignment_heads values('assignment-a-head','org-a','fac-a','assignment-a','dept-a','member-a','assignment-a-v1',1,1,1);`);
  await claims();
}, 20000);
afterEach(async () => { await db.close(); });

describe('0005 prepared, closed PostgreSQL observation slice', () => {
  it('has22closedRLS tables and precisely12 authenticated RPCs, with no direct/helper/service access', async () => {
    expect((await db.query(`select count(*)::int total,count(*) filter(where relrowsecurity)::int protected from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='orion_private' and c.relkind='r'`)).rows[0]).toEqual({ total: 22, protected: 22 });
    const functions = (await db.query<{ name: string; authenticated: boolean; anon: boolean; service: boolean; definer: boolean; config: string[] }>(`
      select p.proname name,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service,
      p.prosecdef definer,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'orion_%'`)).rows;
    expect(functions).toHaveLength(12);
    for (const f of functions) expect(f).toMatchObject({ authenticated: true, anon: false, service: false, definer: true, config: ['search_path=""'] });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await db.query('select has_schema_privilege($1,$2,$3) allowed', [role, 'orion_private', 'USAGE'])).rows[0]).toEqual({ allowed: false });
      expect((await db.query(`select count(*)::int n from information_schema.table_privileges where table_schema='orion_private' and grantee=$1`, [role])).rows[0]).toEqual({ n: 0 });
      expect((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='orion_private' and has_function_privilege($1,p.oid,'EXECUTE')`, [role])).rows[0]).toEqual({ n: 0 });
    }
    const pat = await patient();
    await db.exec('set role anon'); await expect(latest(pat)).rejects.toMatchObject({ code: '42501' });
    await db.exec('reset role; set role authenticated'); expect((await latest(pat)).vitals).toEqual({ anthropometry: null, bloodPressure: null, temperature: null });
    await expect(db.query('select * from orion_private.patient_observation_versions')).rejects.toMatchObject({ code: '42501' });
  });

  it('persists scaled values with honest immutable provenance, exact scope and bounded current history', async () => {
    const pat = await patient(); const command = payload(pat);
    const made = await rpc<Mutation>('orion_observation_create', ['assignment-a', command, 'fac-a']);
    expect(made).toMatchObject({ organizationId: 'org-a', facilityId: 'fac-a', patientId: pat, accessAssignmentId: 'assignment-a',
      assignmentVersionId: 'assignment-a-v1', role: 'clinician', timeZone: 'Asia/Almaty', sourceLabel: 'Облачный ручной ввод · тестовые данные',
      clinicalInterpretation: 'not_performed', replayed: false });
    expect(made.observation.current).toMatchObject({ version: 1, supersedesVersionId: null, measuredAt: command.measuredAt,
      values: { ...command.values, bmi: 23.51 }, sourceType: 'manual_test', accessAssignmentId: 'assignment-a', recordedByMembershipId: 'member-a',
      recordedBy: 'Сотрудник проверки', note: null });
    expect(made.observation.history).toEqual([made.observation.current]);
    expect(made.observation).toMatchObject({ historyCount: 1, currentVersion: 1, historyPage: { hasMore: false, nextCursor: null } });
    expect(made.observation.current.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await db.query(`select height_mm,weight_grams,bmi_hundredths,temperature_milli_c from orion_private.patient_observation_versions`)).rows[0])
      .toEqual({ height_mm: 1650, weight_grams: 64000, bmi_hundredths: 2351, temperature_milli_c: 36500 });
    expect((await list(pat)).observations).toEqual([made.observation]);
    const latestDto = parseCloudLatestVitals(await latest(pat), {
      organizationId: 'org-a', facilityId: 'fac-a', patientId: pat, accessAssignmentId: 'assignment-a',
    });
    expect(latestDto.vitals.anthropometry).toMatchObject({ observationId: made.observation.id, version: 1, heightCm: 165, weightKg: 64, bmi: 23.51 });
  });

  it('selects latest complete measurement groups independently without inventing absent values', async () => {
    const pat = await patient(); const at = Date.now() - 10000;
    const a = await create(pat, { measuredAt: at, values: { heightCm: 165, weightKg: 64, systolicMmhg: null, diastolicMmhg: null, temperatureC: null } });
    const b = await create(pat, { measuredAt: at + 1000, values: { heightCm: null, weightKg: null, systolicMmhg: 120, diastolicMmhg: 80, temperatureC: null } });
    const t = await create(pat, { measuredAt: at + 2000, values: { heightCm: null, weightKg: null, systolicMmhg: null, diastolicMmhg: null, temperatureC: 36.7 } });
    const result = (await latest(pat)).vitals;
    expect(result.anthropometry).toMatchObject({ observationId: a.observation.id, measuredAt: at, bmi: 23.51 });
    expect(result.bloodPressure).toMatchObject({ observationId: b.observation.id, measuredAt: at + 1000, systolicMmhg: 120, diastolicMmhg: 80 });
    expect(result.temperature).toMatchObject({ observationId: t.observation.id, measuredAt: at + 2000, temperatureC: 36.7 });
    const another = await patient(); expect((await latest(another)).vitals).toEqual({ anthropometry: null, bloodPressure: null, temperature: null });
  });

  it('preserves command-time snapshots on replay after correction and registry rename', async () => {
    const pat = await patient(); const command = payload(pat); const made = await rpc<Mutation>('orion_observation_create', ['assignment-a', command, 'fac-a']);
    const fixed = await correct(made, { values: { ...command.values, weightKg: 65 } });
    await rpc('orion_patient_update', ['assignment-a', { patientId: pat, expectedVersion: 1, displayName: 'Переименованный пациент', birthDate: '1990-01-02',
      sexAtBirth: 'unknown', phone: null, email: null, address: null, changeReason: 'Искусственная смена имени', idempotencyKey: randomUUID(), testDataAcknowledged: true }, 'fac-a']);
    const before = await counts(); const replay = await rpc<Mutation>('orion_observation_create', ['assignment-a', command, 'fac-a']);
    expect(replay.observation).toEqual(made.observation); expect(replay.replayed).toBe(true);
    expect(await counts()).toEqual({ ...before, audits: Number(before.audits) + 1 });
    expect((await list(pat)).observations[0]).toMatchObject({ current: fixed.observation.current, patient: { displayName: 'Переименованный пациент' } });
    await expect(rpc('orion_observation_create', ['assignment-a', { ...command, reason: 'Другой смысл команды' }, 'fac-a'])).rejects.toMatchObject({ code: 'PT409' });
  });

  it('appends direct successor, preserves old version and rejects stale version/no-op without side effects', async () => {
    const made = await create(await patient()); const before = await counts();
    await expect(correct(made)).rejects.toMatchObject({ code: 'PT409', message: 'OBSERVATION_NO_CHANGE' }); expect(await counts()).toEqual(before);
    const fixed = await correct(made, { values: { heightCm: 165, weightKg: 65, systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 36.5 } });
    expect(fixed.observation.current).toMatchObject({ version: 2, supersedesVersionId: made.observation.current.id });
    expect(fixed.observation.history).toEqual([fixed.observation.current]); expect(fixed.observation.historyCount).toBe(2);
    expect((await history(fixed)).items).toEqual([fixed.observation.current, made.observation.current]);
    const after = await counts(); await expect(correct(made, { note: 'Искусственное исправление' })).rejects.toMatchObject({ code: 'PT409', message: 'OBSERVATION_VERSION_CONFLICT' });
    expect(await counts()).toEqual(after);
  });

  it('replays correction at its original version after a newer correction without republishing its old head', async () => {
    const made = await create(await patient());
    const { current } = made.observation;
    const command = payload(made.patientId, { measuredAt: current.measuredAt, context: current.context,
      values: { heightCm: 165, weightKg: 64, systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 36.5 },
      note: 'Вторая искусственная версия', expectedVersion: 1 });
    const second = await rpc<Mutation>('orion_observation_correct', ['assignment-a', made.observation.id, command, 'fac-a']);
    const third = await correct(second, { note: 'Третья искусственная версия' }); const before = await counts();
    const replay = await rpc<Mutation>('orion_observation_correct', ['assignment-a', made.observation.id, command, 'fac-a']);
    expect(replay.replayed).toBe(true); expect(replay.observation).toEqual(second.observation);
    expect((await list(made.patientId)).observations[0].current).toEqual(third.observation.current);
    expect(await counts()).toEqual({ ...before, audits: before.audits + 2 });
    await expect(history(replay, replay.observation.historyPage.nextCursor)).rejects.toMatchObject({ code: 'PT409' });
  });

  it('checks current recorder for nurses, not immutable root creator, including receipt replay', async () => {
    const pat = await patient(); await addNurse(); await claims({ sub: otherSubject, session_id: otherSession });
    const command = payload(pat); const made = await rpc<Mutation>('orion_observation_create', ['assignment-n', command, 'fac-a']);
    expect(made.role).toBe('nurse');
    const nurseCorrection = { ...command, expectedVersion: 1, note: 'Исправлено медсестрой', idempotencyKey: randomUUID() };
    const nurseFixed = await rpc<Mutation>('orion_observation_correct', ['assignment-n', made.observation.id, nurseCorrection, 'fac-a']);
    await claims(); const doctorFixed = await correct(nurseFixed, { note: 'Исправлено врачом' });
    await claims({ sub: otherSubject, session_id: otherSession }); const before = await counts();
    await expect(correct(doctorFixed, { note: 'Вновь медсестра' }, 'assignment-n')).rejects.toMatchObject({ code: 'PT403' });
    await expect(rpc('orion_observation_create', ['assignment-n', command, 'fac-a'])).rejects.toMatchObject({ code: 'PT403' });
    await expect(rpc('orion_observation_correct', ['assignment-n', made.observation.id, nurseCorrection, 'fac-a'])).rejects.toMatchObject({ code: 'PT403' });
    expect(await counts()).toEqual(before);
    // Nurse may still read all permitted measurements in the exact scope.
    expect((await list(pat, null, 25, 'assignment-n')).observations[0].current).toEqual(doctorFixed.observation.current);
  });

  it('rejects unacknowledged, partial, empty, extra, unsafe-time, control and UTF16-oversized inputs with422', async () => {
    const pat = await patient(); const before = await counts(); const valid = payload(pat);
    const invalid = [
      { syntheticDataAcknowledged: false }, { syntheticDataAcknowledged: 'true' }, { note: 'x' }, { note: 'Текст\nстроки' }, { reason: '😀'.repeat(251) },
      { note: '😀'.repeat(501) }, { extra: 'not allowed' }, { measuredAt: 946684799999 }, { measuredAt: Date.now() + 301000 },
      { measuredAt: 9007199254740992 }, { measuredAt: 1.5 }, { context: 'diagnosis' }, { idempotencyKey: 'not-a-uuid' },
      { values: { ...valid.values, heightCm: null } }, { values: { ...valid.values, diastolicMmhg: null } },
      { values: { ...valid.values, systolicMmhg: 76 } }, { values: { ...valid.values, systolicMmhg: 118.5 } },
      { values: { ...valid.values, temperatureC: 45.01 } }, { values: { ...valid.values, weightKg: '64' } },
      { values: { ...valid.values, diagnosis: 'not allowed' } }, { values: { heightCm: null, weightKg: null, systolicMmhg: null, diastolicMmhg: null, temperatureC: null } },
    ];
    for (const change of invalid) await expect(create(pat, change)).rejects.toMatchObject({ code: 'PT422' });
    expect(await counts()).toEqual(before);
  });

  it('explicitly rejects domain-admitted out-of-range BMI and agrees on valid fixed-point rounding', async () => {
    const pat = await patient(); const command = payload(pat, { values: { heightCm: 40, weightKg: 500, systolicMmhg: null, diastolicMmhg: null, temperatureC: null } });
    expect(createObservationSchema.safeParse(command).success).toBe(true);
    await expect(rpc('orion_observation_create', ['assignment-a', command, 'fac-a'])).rejects.toMatchObject({ code: 'PT422', message: 'OBSERVATION_BMI_OUT_OF_RANGE' });
    const values = { heightCm: 165.26, weightKg: 64.1236, systolicMmhg: 120, diastolicMmhg: 80, temperatureC: 36.5556 };
    const made = await create(pat, { values }); const stored = toStoredObservationValues(values);
    expect(made.observation.current.values).toMatchObject({ heightCm: stored.heightMm! / 10, weightKg: stored.weightGrams! / 1000,
      bmi: stored.bmiHundredths! / 100, temperatureC: stored.temperatureMilliC! / 1000 });
  });

  it('accepts integral decimal JSONB pressure and refuses altered raw values even when storage rounds identically', async () => {
    const pat = await patient();
    const decimal = JSON.stringify(payload(pat)).replace('"systolicMmhg":118', '"systolicMmhg":118.0').replace('"diastolicMmhg":76', '"diastolicMmhg":76.0');
    const made = await rpc<Mutation>('orion_observation_create', ['assignment-a', decimal, 'fac-a']);
    expect(made.observation.current.values).toMatchObject({ systolicMmhg: 118, diastolicMmhg: 76 });
    const command = payload(pat, { values: { heightCm: 165, weightKg: 64.12341, systolicMmhg: null, diastolicMmhg: null, temperatureC: null } });
    await rpc('orion_observation_create', ['assignment-a', command, 'fac-a']); const before = await counts();
    await expect(rpc('orion_observation_create', ['assignment-a', { ...command, values: { ...command.values, weightKg: 64.12342 } }, 'fac-a']))
      .rejects.toMatchObject({ code: 'PT409', message: 'OBSERVATION_IDEMPOTENCY_CONFLICT' });
    expect(await counts()).toEqual(before);
  });

  it('does not borrow clinical role from an administrator allow-list or choose an assignment automatically', async () => {
    const pat = await patient(); await changeAssignment({ roles: ['administrator'], allows: ['observations.manage'] }); const before = await counts();
    await expect(create(pat)).rejects.toMatchObject({ code: 'PT403', message: 'OBSERVATION_ROLE_FORBIDDEN' });
    await expect(latest(pat)).rejects.toMatchObject({ code: 'PT403' }); expect(await counts()).toEqual(before);
    await expect(rpc('orion_patient_latest_vitals', ['', pat])).rejects.toMatchObject({ code: 'PT400' });
    await expect(rpc('orion_patient_latest_vitals', ['missing-assignment', pat])).rejects.toMatchObject({ code: 'PT403' });
  });

  it('requires active session, exactissuer, active assignment, deny precedence and database-clock expiry on every action', async () => {
    const pat = await patient(); const command = payload(pat); await rpc('orion_observation_create', ['assignment-a', command, 'fac-a']);
    for (const extra of [{ iss: 'https://other.invalid/auth/v1' }, { exp: 1 }, { is_anonymous: true }, { session_id: randomUUID() }, { role: 'anon' }]) {
      await claims(extra); await expect(latest(pat)).rejects.toMatchObject({ code: 'PT401' });
    }
    await claims(); await changeAssignment({ denies: ['observations.manage'] });
    await expect(rpc('orion_observation_create', ['assignment-a', command, 'fac-a'])).rejects.toMatchObject({ code: 'PT403' });
    await changeAssignment({ until: Date.now() - 1 }); await expect(latest(pat)).rejects.toMatchObject({ code: 'PT403' });
    await changeAssignment({ status: 'revoked' }); await expect(list(pat)).rejects.toMatchObject({ code: 'PT403' });
  });

  it('checks active patient under current head and denies wrong patient/facility without existence leaks', async () => {
    const pat = await patient(); const made = await create(pat); const another = await patient();
    await expect(rpc('orion_patient_latest_vitals', ['assignment-a', pat, 'fac-b'])).rejects.toMatchObject({ code: 'PT403' });
    await expect(latest('inaccessible-patient')).rejects.toMatchObject({ code: 'PT404' });
    await expect(rpc('orion_observation_history_page', ['assignment-a', another, made.observation.id, 'fac-a'])).rejects.toMatchObject({ code: 'PT404' });
    await expect(create(pat, { accessAssignmentId: 'assignment-n' })).rejects.toMatchObject({ code: 'PT403' });
    await rpc('orion_patient_archive', ['assignment-a', { patientId: pat, expectedVersion: 1, changeReason: 'Искусственный архив', idempotencyKey: randomUUID(), testDataAcknowledged: true }, 'fac-a']);
    const before = await counts(); await expect(latest(pat)).rejects.toMatchObject({ code: 'PT404' });
    await expect(correct(made, { note: 'Нет доступа к архиву' })).rejects.toMatchObject({ code: 'PT404' }); expect(await counts()).toEqual(before);
  });

  it('pages equal measured timestamps, bounds size and pins cursors to exact scope/patient/assignment/head', async () => {
    const pat = await patient(); const at = Date.now() - 1000;
    // A fixture-only frozen database clock forces complete measured/recorded
    // timestamp ties, so the observation-ID keyset ordering is actually tested.
    await db.exec(`create or replace function orion_private.now_ms() returns bigint language sql volatile set search_path='' as $$select ${Date.now()}::bigint$$`);
    for (let i = 0; i < 28; i++) await create(pat, { measuredAt: at });
    const first = await list(pat); expect(first.observations).toHaveLength(25); expect(first.page.hasMore).toBe(true);
    const second = await list(pat, first.page.nextCursor); expect(second.observations).toHaveLength(3); expect(second.page).toEqual({ hasMore: false, nextCursor: null });
    expect(new Set([...first.observations, ...second.observations].map(r => r.id)).size).toBe(28);
    const ids = [...first.observations, ...second.observations].map(r => r.id); expect(ids).toEqual([...ids].sort());
    await expect(list(pat, null, 51)).rejects.toMatchObject({ code: 'PT400' });
    for (const change of [{ kind: 'observation_history' }, { organizationId: 'org-b' }, { facilityId: 'fac-b' }, { patientId: 'other' }, { assignmentId: 'other' },
      { extra: 1 }, { measuredAt: -1 }, { recordedAt: 9007199254740992 }, { observationVersion: 0 }]) {
      await expect(list(pat, { ...first.page.nextCursor, ...change })).rejects.toMatchObject({ code: 'PT400' });
    }
    await expect(list(pat, { ...first.page.nextCursor, assignmentVersionId: 'old' })).rejects.toMatchObject({ code: 'PT409' });
    await expect(list(pat, { ...first.page.nextCursor, recordedAt: 1 })).rejects.toMatchObject({ code: 'PT409' });
    await changeAssignment(); await expect(list(pat, first.page.nextCursor)).rejects.toMatchObject({ code: 'PT409' });
  }, 20000);

  it('starts record history at[current], continues bounded immutable pages and refuses a changed head', async () => {
    let made = await create(await patient());
    for (let i = 0; i < 5; i++) made = await correct(made, { note: `Искусственное исправление ${i}` });
    expect(made.observation.history).toHaveLength(1); expect(made.observation.historyPage.hasMore).toBe(true);
    const prior = await history(made, made.observation.historyPage.nextCursor, 2); expect(prior.items.map(v => v.version)).toEqual([5, 4]);
    const rest = await history(made, prior.page.nextCursor, 2); expect(rest.items.map(v => v.version)).toEqual([3, 2]);
    const last = await history(made, rest.page.nextCursor, 2); expect(last.items.map(v => v.version)).toEqual([1]); expect(last.page).toEqual({ hasMore: false, nextCursor: null });
    await correct(made, { note: 'Седьмая версия проверки' });
    await expect(history(made, prior.page.nextCursor)).rejects.toMatchObject({ code: 'PT409' });
    await expect(history(made, { ...prior.page.nextCursor, beforeVersion: 0 })).rejects.toMatchObject({ code: 'PT400' });
  }, 20000);

  it.each(['patient_observation_records', 'patient_observation_versions', 'patient_observation_heads', 'observation_command_receipts'])(
    'rolls back all parts when%s publication is ignored', async table => {
      const pat = await patient(); const before = await counts(); await fault(table, 'insert');
      await expect(create(pat)).rejects.toMatchObject({ code: 'PT503', message: 'OBSERVATION_PUBLICATION_FAILED' }); expect(await counts()).toEqual(before);
    });

  it('rolls back correction when head CAS publication is ignored', async () => {
    const made = await create(await patient()); const before = await counts(); await fault('patient_observation_heads', 'update');
    await expect(correct(made, { note: 'Искусственное исправление' })).rejects.toMatchObject({ code: 'PT503' }); expect(await counts()).toEqual(before);
    expect((await db.query('select lock_version from orion_private.patient_observation_heads')).rows[0]).toEqual({ lock_version: 1 });
  });

  it.each(['audit_events', 'audit_stream_heads'])('requires%s publication before command/read response commit', async table => {
    const pat = await patient(); const made = await create(pat); const before = await counts();
    await fault(table, table === 'audit_stream_heads' ? 'update' : 'insert');
    await expect(correct(made, { note: 'Искусственное исправление' })).rejects.toMatchObject({ code: 'PT503', message: 'AUDIT_UNAVAILABLE' });
    await expect(list(pat)).rejects.toMatchObject({ code: 'PT503' }); await expect(latest(pat)).rejects.toMatchObject({ code: 'PT503' });
    await expect(history(made)).rejects.toMatchObject({ code: 'PT503' }); expect(await counts()).toEqual(before);
  });

  it('rechecks live authority after audit and rolls back a command/read when its session expires before publication', async () => {
    const pat = await patient(); const made = await create(pat); const before = await counts();
    await fault('audit_events', 'insert', `perform set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{exp}','1'::jsonb)::text,false); return new`);
    await expect(correct(made, { note: 'Команда с истёкшим сеансом' })).rejects.toMatchObject({ code: 'PT401' });
    await expect(list(pat)).rejects.toMatchObject({ code: 'PT401' }); await expect(latest(pat)).rejects.toMatchObject({ code: 'PT401' });
    expect(await counts()).toEqual(before);
    expect(Number((await db.query<{ exp: string }>(`select auth.jwt()->>'exp' exp`)).rows[0].exp)).toBeGreaterThan(Date.now() / 1000);
  });

  it('bounds final wrapper and generated history cursor inside the mutation transaction', async () => {
    const made = await create(await patient()); const before = await counts();
    await expect(db.query('select orion_private.observation_bounded_response($1)', [{ big: 'Ж'.repeat(400000) }])).rejects.toMatchObject({ code: 'PT503' });
    await db.exec(`create or replace function orion_private.observation_cursor_scope(scope jsonb,pat_id text) returns jsonb language sql immutable set search_path='' as $$
      select jsonb_build_object('domainVersion',1,'organizationId',repeat('界',160),'facilityId',repeat('界',160),'assignmentId',repeat('界',160),
        'assignmentVersionId',repeat('界',160),'patientId',pat_id)$$`);
    await expect(correct(made, { note: 'Искусственный размер курсора' })).rejects.toMatchObject({ code: 'PT400' }); expect(await counts()).toEqual(before);
  });

  it('rejects direct root/version actor forgery, immutable ledger mutation and skipping/cross-resource heads', async () => {
    const pat = await patient(); const made = await create(pat); const second = await create(pat);
    await expect(db.query(`insert into orion_private.patient_observation_records values('forged','org-b','fac-b',$1,'manual_test',
      'Облачный ручной ввод · тестовые данные','member-a','assignment-a',orion_private.now_ms())`, [pat])).rejects.toMatchObject({ code: 'PT403' });
    for (const table of ['patient_observation_records', 'patient_observation_versions', 'observation_command_receipts']) {
      await expect(db.exec(`delete from orion_private.${table}`)).rejects.toMatchObject({ code: '23514' });
    }
    await expect(db.query(`update orion_private.patient_observation_heads set current_version_id=$1,lock_version=2 where observation_id=$2`,
      [second.observation.current.id, made.observation.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.exec('delete from orion_private.patient_observation_heads')).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`insert into orion_private.patient_observation_versions
      select 'forged-recorder',organization_id,facility_id,patient_id,observation_id,2,id,measured_at,measurement_context,
        height_mm,weight_grams,bmi_hundredths,systolic_mmhg,diastolic_mmhg,temperature_milli_c,'Прямая подделка',
        'member-forged',access_assignment_id,recorded_by_display_name,orion_private.now_ms(),change_reason,input_hash
      from orion_private.patient_observation_versions where id=$1`, [made.observation.current.id])).rejects.toMatchObject({ code: 'PT403' });
    await expect(db.query(`insert into orion_private.patient_observation_versions
      select 'skipped-version',organization_id,facility_id,patient_id,observation_id,3,id,measured_at,measurement_context,
        height_mm,weight_grams,bmi_hundredths,systolic_mmhg,diastolic_mmhg,temperature_milli_c,'Пропуск версии',
        recorded_by_membership_id,access_assignment_id,recorded_by_display_name,orion_private.now_ms(),change_reason,input_hash
      from orion_private.patient_observation_versions where id=$1`, [made.observation.current.id])).rejects.toMatchObject({ code: 'PT409' });
  });

  it('uses dedicated audit purpose, omits values/names/note and preserves contiguous schema1 hashes', async () => {
    const pat = await patient(); const made = await create(pat, { note: 'Приватный текст проверки' }); await latest(pat); await list(pat); await history(made);
    const events = (await db.query<{ action: string; purpose: string; entity_type: string; metadata_json: string; correct: boolean; sequence: number; previous_hash: string | null; event_hash: string }>(`
      select action,purpose,entity_type,metadata_json,(event_hash=orion_private.audit_hash(e)) correct,sequence::int,previous_hash,event_hash
      from orion_private.audit_events e order by sequence`)).rows;
    for (let i = 0; i < events.length; i++) {
      expect(events[i].correct).toBe(true); expect(events[i].sequence).toBe(i + 1); expect(events[i].previous_hash).toBe(i === 0 ? null : events[i - 1].event_hash);
      if (events[i].action.startsWith('observation.')) {
        expect(events[i].purpose).toBe('synthetic_patient_observation'); expect(events[i].metadata_json).not.toContain('Приватный');
        expect(events[i].metadata_json).not.toContain('118'); expect(events[i].metadata_json).not.toContain('Искусственный пациент');
        expect(JSON.parse(events[i].metadata_json)).toMatchObject({ accessAssignmentId: 'assignment-a', assignmentVersionId: 'assignment-a-v1' });
      }
    }
    // Existing registry command shape/ledger remains unchanged.
    expect((await db.query<{ definition: string }>(`select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='orion_private.command_idempotency'::regclass and contype='c'`)).rows
      .map(row => row.definition).join(' ')).not.toContain('observation');
  });
});
