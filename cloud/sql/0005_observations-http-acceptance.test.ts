import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createPatient } from '@/app/api/patients/route';
import { GET as listObservations, POST as createObservation } from '@/app/api/observations/route';
import { PATCH as correctObservation } from '@/app/api/observations/[observationId]/route';
import { GET as observationHistory } from '@/app/api/observations/[observationId]/history/route';
import { GET as latestVitals } from '@/app/api/observations/latest-vitals/route';
import { cloudAuthCookies } from '@/lib/cloud/auth-session.server';
import { cloudGenerationHeader } from '@/lib/cloud/account-fence';
import { cloudDatabaseForRequest } from '@/lib/cloud/database-context.server';
import { decodeCloudObservationCursor, encodeCloudObservationCursor } from '@/lib/cloud/observation-cursor.server';
import type { CloudRpcName } from '@/lib/cloud/supabase-rpc.server';
import type { LatestPatientVitals, ObservationVersionRecord, PatientObservationRecord } from '@/lib/repositories/patient-observations';

// Engineering integration proof ONLY: real route exports, verified database
// context, same-assignment access resolver, RPC transport, DTOs and reviewed SQL
// on a disposable PostgreSQL WASM database. Fixed Auth/PostgREST doubles are NOT
// live Supabase proof, real staff/passwords, browser acceptance, provider session
// revocation timing or clinical approval. No0003, env files or network are used.
const projectRef = 'bctyswbqjgpmtsanrfhp'; // Reviewed issuer contract, not a credential.
const providerOrigin = `https://${projectRef}.supabase.co`;
const issuer = `${providerOrigin}/auth/v1`;
const origin = 'https://orion-fixture.example.invalid';
const source = { ORION_SUPABASE_PROJECT_REF: projectRef, ORION_SUPABASE_URL: providerOrigin,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'z'.repeat(24)}`,
  ORION_CLOUD_PUBLIC_ORIGIN: origin, ORION_SYNTHETIC_DATA_ONLY: 'true' };

type Actor = { subject: string; session: string; staff: string; member: string; organization: string;
  facility: string; assignment: string; clinicalRole: 'doctor' | 'nurse'; token: string; claims: Record<string, unknown> };
function actor(suffix: string, subject: string, session: string, clinic = suffix, clinicalRole: Actor['clinicalRole'] = 'doctor'): Actor {
  const claims = { iss: issuer, sub: subject, session_id: session, role: 'authenticated',
    is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 };
  // Deliberately invalid header/signature, accepted ONLY by the fixed double.
  const token = `example.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.example`;
  return { subject, session, staff: `staff-${suffix}`, member: `member-${suffix}`, organization: `org-${clinic}`,
    facility: `fac-${clinic}`, assignment: `assignment-${suffix}`, clinicalRole, token, claims };
}
const a = actor('a', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
const n = actor('n', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'a', 'nurse');
const b = actor('b', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666');
const actors = [a, n, b];
const observationRpcNames = ['orion_observations_page', 'orion_observation_history_page', 'orion_patient_latest_vitals',
  'orion_observation_create', 'orion_observation_correct'] as const satisfies readonly CloudRpcName[];
const fixtureRpcNames = ['orion_access_overview', 'orion_patient_create', ...observationRpcNames] as const satisfies readonly CloudRpcName[];
type FixtureRpcName = typeof fixtureRpcNames[number];
let db: PGlite;
let patientSequence = 0;
let unexpectedRequests = 0;
let seenRpcs: FixtureRpcName[];
let seenUsers: string[];

type Page = { hasMore: boolean; nextCursor: string | null };
type Observation = PatientObservationRecord & { currentVersion: number; historyCount: number; historyPage: Page };
type Envelope = { patient?: { id: string }; observation?: Observation; observations?: Observation[];
  items?: ObservationVersionRecord[]; vitals?: LatestPatientVitals; page?: Page; replayed?: boolean;
  observationVersion?: number; assignmentVersionId?: string; role?: string; error?: { code: string; message: string } };
type Reply = { status: number; body: Envelope };
type Counts = { records: number; versions: number; heads: number; receipts: number; observationAudits: number; accessAudits: number };

// URL and SQL/argument order are pinned independently of incoming request JSON.
// No arbitrary destination, function, helper or SQL can be requested here.
const rpcContracts: Record<FixtureRpcName, { sql: string; fields: string[]; json?: string[] }> = {
  orion_access_overview: { sql: 'select public.orion_access_overview() result', fields: [] },
  orion_patient_create: { sql: 'select public.orion_patient_create($1,$2,$3) result',
    fields: ['assignment_id', 'payload', 'facility_id'], json: ['payload'] },
  orion_observations_page: { sql: 'select public.orion_observations_page($1,$2,$3,$4,$5) result',
    fields: ['assignment_id', 'patient_id', 'facility_id', 'max_results', 'cursor'], json: ['cursor'] },
  orion_observation_history_page: { sql: 'select public.orion_observation_history_page($1,$2,$3,$4,$5,$6) result',
    fields: ['assignment_id', 'patient_id', 'observation_id', 'facility_id', 'max_results', 'cursor'], json: ['cursor'] },
  orion_patient_latest_vitals: { sql: 'select public.orion_patient_latest_vitals($1,$2,$3) result',
    fields: ['assignment_id', 'patient_id', 'facility_id'] },
  orion_observation_create: { sql: 'select public.orion_observation_create($1,$2,$3) result',
    fields: ['assignment_id', 'payload', 'facility_id'], json: ['payload'] },
  orion_observation_correct: { sql: 'select public.orion_observation_correct($1,$2,$3,$4) result',
    fields: ['assignment_id', 'observation_id', 'payload', 'facility_id'], json: ['payload'] },
};

async function providerDouble(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init?.headers);
  const selected = actors.find(candidate => headers.get('authorization') === `Bearer ${candidate.token}`);
  if (!selected || headers.get('apikey') !== source.ORION_SUPABASE_PUBLISHABLE_KEY || init?.cache !== 'no-store' ||
      init?.redirect !== 'error' || init?.signal?.aborted) {
    unexpectedRequests += 1; throw new Error('Fixture provider transport rejected.');
  }
  if (url === `${providerOrigin}/auth/v1/user` && init?.method === 'GET') {
    seenUsers.push(selected.staff);
    // Remains200 after deleting auth.sessions: verified identity metadata alone
    // cannot grant access, including receipt replay or an audit-only RPC.
    return Response.json({ id: selected.subject, role: 'authenticated', is_anonymous: false,
      email: `${selected.staff}@example.invalid` });
  }
  const name = fixtureRpcNames.find(candidate => url === `${providerOrigin}/rest/v1/rpc/${candidate}`);
  if (!name || init?.method !== 'POST' || typeof init.body !== 'string' || headers.get('content-type') !== 'application/json') {
    unexpectedRequests += 1; throw new Error('Fixture provider destination rejected.');
  }
  const args = JSON.parse(init.body) as Record<string, unknown>;
  const contract = rpcContracts[name];
  if (!args || Array.isArray(args) || Object.keys(args).some(field => !contract.fields.includes(field)) ||
      contract.fields.some(field => !(field in args))) {
    unexpectedRequests += 1; throw new Error('Fixture RPC shape rejected.');
  }
  seenRpcs.push(name);
  try {
    const result = await db.transaction(async transaction => {
      await transaction.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify(selected.claims)]);
      await transaction.exec('set local role authenticated');
      const values = contract.fields.map(field => contract.json?.includes(field) && args[field] !== null
        ? JSON.stringify(args[field]) : args[field]);
      return (await transaction.query<{ result: unknown }>(contract.sql, values)).rows[0].result;
    });
    return Response.json(result);
  } catch (error) {
    const rejected = error as { code?: string; message?: string; detail?: string; hint?: string };
    const status = /^PT[1-5][0-9]{2}$/.test(rejected.code ?? '') ? Number(rejected.code!.slice(2)) : 500;
    return Response.json({ code: rejected.code, message: rejected.message, details: rejected.detail ?? 'fixture-private-detail',
      hint: rejected.hint ?? 'fixture-private-hint' }, { status });
  }
}

beforeEach(async () => {
  patientSequence = 0; seenRpcs = []; seenUsers = []; unexpectedRequests = 0;
  Object.entries(source).forEach(([name, value]) => vi.stubEnv(name, value));
  vi.stubGlobal('fetch', providerDouble);
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for (const name of ['0001_private_schema_boundary.sql', '0002_access_patient_registry.sql',
    '0004_bounded_patient_pagination.sql', '0005_patient_observations.sql']) {
    await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into orion_private.organizations values('org-a','Искусственная организация A','active',1,1,1),('org-b','Искусственная организация B','active',1,1,1);
    insert into orion_private.facilities values('fac-a','org-a','Искусственная клиника A','UTC','active',1,1,1),('fac-b','org-b','Искусственная клиника B','UTC','active',1,1,1);
    insert into orion_private.departments values('dept-fac-a','org-a','fac-a','medicine','Искусственная медицина','clinical','active',1,1,1),('dept-fac-b','org-b','fac-b','medicine','Искусственная медицина','clinical','active',1,1,1);`);
  for (const selected of actors) {
    await db.query('insert into auth.users(id) values($1)', [selected.subject]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [selected.session, selected.subject]);
    await db.query('insert into orion_private.users values($1,$2,$3,null,$4,\'active\',1,1,1)',
      [selected.staff, issuer, selected.subject, `Искусственный сотрудник ${selected.staff}`]);
    await db.query('insert into orion_private.memberships values($1,$2,$3,$4,$5,\'active\',1,1,1)',
      [selected.member, selected.organization, selected.facility, selected.staff, selected.clinicalRole === 'nurse' ? 'nurse' : 'clinician']);
  }
  await db.exec(`insert into orion_private.department_versions values('dept-fac-a-v1','org-a','fac-a','dept-fac-a',1,null,'Искусственная медицина','clinical','active','Искусственный тест','member-a',1,1),('dept-fac-b-v1','org-b','fac-b','dept-fac-b',1,null,'Искусственная медицина','clinical','active','Искусственный тест','member-b',1,1);
    insert into orion_private.department_heads values('dept-fac-a-head','org-a','fac-a','dept-fac-a','dept-fac-a-v1',1,1,1),('dept-fac-b-head','org-b','fac-b','dept-fac-b','dept-fac-b-v1',1,1,1);`);
  for (const selected of actors) {
    await db.query('insert into orion_private.department_access_assignments values($1,$2,$3,$4,$5,$5,1)',
      [selected.assignment, selected.organization, selected.facility, `dept-${selected.facility}`, selected.member]);
    await db.query(`insert into orion_private.department_access_assignment_versions
      values($1,$2,$3,$4,$5,$6,1,null,'active','bootstrap',$7::jsonb,'[]','[]',1,null,'Искусственный тестовый доступ',$6,1,1)`,
      [`${selected.assignment}-v1`, selected.organization, selected.facility, selected.assignment, `dept-${selected.facility}`,
        selected.member, JSON.stringify([selected.clinicalRole])]);
    await db.query('insert into orion_private.department_access_assignment_heads values($1,$2,$3,$4,$5,$6,$7,1,1,1)',
      [`${selected.assignment}-head`, selected.organization, selected.facility, selected.assignment, `dept-${selected.facility}`,
        selected.member, `${selected.assignment}-v1`]);
  }
}, 20000);

afterEach(async () => {
  try { expect(unexpectedRequests).toBe(0); }
  finally { await db?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

function scope(selected: Actor) { return { accessAssignmentId: selected.assignment, facilityId: selected.facility }; }
function query(selected: Actor, patientId: string) { return new URLSearchParams({ ...scope(selected), patientId }).toString(); }
function request(selected: Actor, path: string, method = 'GET', body?: unknown, generation = selected.session.replaceAll('-', '')) {
  return new Request(`${origin}${path}`, { method,
    headers: { Cookie: `${cloudAuthCookies.access}=${selected.token}`, [cloudGenerationHeader]: generation,
      Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
async function api(selected: Actor, path: string, method = 'GET', body?: unknown, generation?: string): Promise<Reply> {
  const supplied = request(selected, path, method, body, generation);
  const url = new URL(supplied.url);
  let response: Response;
  if (url.pathname === '/api/patients' && method === 'POST') response = await createPatient(supplied);
  else if (url.pathname === '/api/observations') response = await (method === 'GET' ? listObservations : createObservation)(supplied);
  else if (url.pathname === '/api/observations/latest-vitals' && method === 'GET') response = await latestVitals(supplied);
  else {
    const match = /^\/api\/observations\/([^/]+)(\/history)?$/.exec(url.pathname);
    if (!match || (!match[2] && method !== 'PATCH')) throw new Error('Unknown fixture API route.');
    const params = { params: Promise.resolve({ observationId: match[1] }) };
    response = await (match[2] ? observationHistory : correctObservation)(supplied, params);
  }
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const text = await response.text();
  for (const forbidden of ['fixture-private-detail', 'fixture-private-hint', source.ORION_SUPABASE_PUBLISHABLE_KEY,
    ...actors.map(value => value.token)]) expect(text).not.toContain(forbidden);
  return { status: response.status, body: JSON.parse(text) as Envelope };
}
async function patient(selected = a) {
  const reply = await api(selected, '/api/patients', 'POST', { ...scope(selected),
    displayName: `Искусственный HTTP пациент ${++patientSequence}`, birthDate: '1990-01-02', sexAtBirth: 'unknown',
    phone: null, email: null, address: null, testIin: null, testDataAcknowledged: true, idempotencyKey: randomUUID() });
  expect(reply.status).toBe(201); expect(reply.body.patient).toBeDefined(); return reply.body.patient!.id;
}
function payload(patientId: string, selected = a, changes: Record<string, unknown> = {}) {
  return { ...scope(selected), patientId, measuredAt: Date.now() - 1000, context: 'consultation',
    values: { heightCm: 165, weightKg: 64, systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 36.5 },
    note: null, reason: 'Искусственная HTTP проверка', syntheticDataAcknowledged: true, idempotencyKey: randomUUID(), ...changes };
}
function correction(made: Observation, selected = a, changes: Record<string, unknown> = {}) {
  const current = made.current;
  return payload(made.patient.id, selected, { measuredAt: current.measuredAt, context: current.context,
    values: { heightCm: current.values.heightCm, weightKg: current.values.weightKg,
      systolicMmhg: current.values.systolicMmhg, diastolicMmhg: current.values.diastolicMmhg, temperatureC: current.values.temperatureC },
    note: 'Искусственное исправление', expectedVersion: current.version, ...changes });
}
function saved(reply: Reply, status = 200): Observation {
  expect(reply.status).toBe(status); expect(reply.body.observation).toBeDefined(); return reply.body.observation!;
}
async function counts(): Promise<Counts> {
  return (await db.query<Counts>(`select
    (select count(*)::int from orion_private.patient_observation_records) records,
    (select count(*)::int from orion_private.patient_observation_versions) versions,
    (select count(*)::int from orion_private.patient_observation_heads) heads,
    (select count(*)::int from orion_private.observation_command_receipts) receipts,
    (select count(*)::int from orion_private.audit_events where action like 'observation.%') "observationAudits",
    (select count(*)::int from orion_private.audit_events where action='access.self.read') "accessAudits"`)).rows[0];
}
function observationCounts(value: Counts) {
  return { records: value.records, versions: value.versions, heads: value.heads, receipts: value.receipts,
    observationAudits: value.observationAudits };
}
async function denied(selected: Actor, path: string, status: number, code: string, method = 'GET', body?: unknown) {
  const before = await counts();
  expect(await api(selected, path, method, body)).toMatchObject({ status, body: { error: { code } } });
  const after = await counts();
  expect(observationCounts(after)).toEqual(observationCounts(before));
  // A genuine preceding access-overview RPC may legitimately audit a read;
  // this is not an observation mutation or failed clinical action committing.
  expect(after.accessAudits).toBeGreaterThanOrEqual(before.accessAudits);
}
async function changeAssignment(selected: Actor, roles: string[] = [selected.clinicalRole], denies: string[] = []) {
  await db.query(`insert into orion_private.department_access_assignment_versions
    select v.assignment_id||'-v'||(v.version+1),v.organization_id,v.facility_id,v.assignment_id,v.department_id,v.membership_id,
      v.version+1,v.id,'active','bootstrap',$2::jsonb,'[]',$3::jsonb,1,null,'Искусственная смена прав',v.membership_id,
      orion_private.now_ms(),1 from orion_private.department_access_assignment_heads h
      join orion_private.department_access_assignment_versions v on v.id=h.current_version_id where h.assignment_id=$1`,
  [selected.assignment, JSON.stringify(roles), JSON.stringify(denies)]);
  await db.query(`update orion_private.department_access_assignment_heads set current_version_id=assignment_id||'-v'||(lock_version+1),
    lock_version=lock_version+1,updated_at=orion_private.now_ms() where assignment_id=$1`, [selected.assignment]);
}

describe('0005 observation HTTP/PostgreSQL engineering bridge (NOT live provider proof)', () => {
  it('persists create/correct once per exact key/body and rejects changed retries without observation side effects', async () => {
    const pat = await patient(); const creation = payload(pat);
    const made = saved(await api(a, '/api/observations', 'POST', creation), 201);
    const beforeReplay = await counts();
    const replay = await api(a, '/api/observations', 'POST', creation);
    expect(saved(replay, 201)).toEqual(made); expect(replay.body.replayed).toBe(true);
    expect(observationCounts(await counts())).toEqual({ ...observationCounts(beforeReplay), observationAudits: beforeReplay.observationAudits + 1 });
    await denied(a, '/api/observations', 409, 'OBSERVATION_IDEMPOTENCY_CONFLICT', 'POST', { ...creation, reason: 'Искусственная другая причина' });
    const command = correction(made); const path = `/api/observations/${made.id}`;
    const fixed = saved(await api(a, path, 'PATCH', command));
    expect(fixed.current).toMatchObject({ version: 2, supersedesVersionId: made.current.id });
    const afterCorrection = await counts();
    const fixedReplay = await api(a, path, 'PATCH', command);
    expect(saved(fixedReplay)).toEqual(fixed); expect(fixedReplay.body.replayed).toBe(true);
    expect(observationCounts(await counts())).toEqual({ ...observationCounts(afterCorrection), observationAudits: afterCorrection.observationAudits + 1 });
    await denied(a, path, 409, 'OBSERVATION_IDEMPOTENCY_CONFLICT', 'PATCH', { ...command, note: 'Искусственная подмена' });
    const reopened = await api(a, `/api/observations?${query(a, pat)}`);
    expect(reopened.status).toBe(200); expect(reopened.body.observations).toEqual([fixed]);
    const history = await api(a, `${path}/history?${query(a, pat)}`);
    expect(history.status).toBe(200); expect(history.body.items).toEqual([fixed.current, made.current]);
    expect((await api(a, `/api/observations/latest-vitals?${query(a, pat)}`)).body.vitals?.anthropometry)
      .toMatchObject({ observationId: made.id, version: 2, heightCm: 165, weightKg: 64, bmi: 23.51 });
  }, 20000);

  it('returns immutable command-time replay after a newer correction and rejects the old pinned history cursor', async () => {
    const pat = await patient(); const creation = payload(pat);
    const v1 = saved(await api(a, '/api/observations', 'POST', creation), 201);
    const path = `/api/observations/${v1.id}`; const secondCommand = correction(v1);
    const v2 = saved(await api(a, path, 'PATCH', secondCommand));
    const v3 = saved(await api(a, path, 'PATCH', correction(v2, a, { note: 'Искусственная третья версия' })));
    const before = await counts();
    expect(saved(await api(a, '/api/observations', 'POST', creation), 201)).toEqual(v1);
    expect(saved(await api(a, path, 'PATCH', secondCommand))).toEqual(v2);
    expect(observationCounts(await counts())).toEqual({ ...observationCounts(before), observationAudits: before.observationAudits + 2 });
    expect((await api(a, `/api/observations?${query(a, pat)}`)).body.observations?.[0]).toEqual(v3);
    expect(v2.historyPage.nextCursor).toBeTruthy();
    await denied(a, `${path}/history?${query(a, pat)}&cursor=${v2.historyPage.nextCursor}`, 409, 'PAGINATION_STALE');
    const current = await api(a, `${path}/history?${query(a, pat)}&limit=2`);
    expect(current.status).toBe(200); expect(current.body.items?.map(item => item.version)).toEqual([3, 2]);
    const older = await api(a, `${path}/history?${query(a, pat)}&limit=2&cursor=${current.body.page!.nextCursor}`);
    expect(older.status).toBe(200); expect(older.body.items).toEqual([v1.current]);
  }, 20000);

  it('uses the current nurse recorder for corrections and old receipts, not the original creator', async () => {
    const pat = await patient(); const creation = payload(pat, n);
    const v1 = saved(await api(n, '/api/observations', 'POST', creation), 201);
    expect(v1.current.recordedByMembershipId).toBe(n.member);
    const path = `/api/observations/${v1.id}`; const nurseCommand = correction(v1, n);
    const v2 = saved(await api(n, path, 'PATCH', nurseCommand));
    const v3 = saved(await api(a, path, 'PATCH', correction(v2, a, { note: 'Искусственное исправление врача' })));
    expect(v3.current.recordedByMembershipId).toBe(a.member);
    await denied(n, path, 403, 'OBSERVATION_FORBIDDEN', 'PATCH', correction(v3, n));
    await denied(n, path, 403, 'OBSERVATION_FORBIDDEN', 'PATCH', nurseCommand);
    await denied(n, '/api/observations', 403, 'OBSERVATION_FORBIDDEN', 'POST', creation);
    const read = await api(n, `/api/observations?${query(n, pat)}`);
    expect(read.status).toBe(200);
    expect(read.body.observations?.[0]).toMatchObject({ id: v3.id, patient: v3.patient, current: v3.current,
      history: v3.history, currentVersion: 3, historyCount: 3 });
    // Immutable recorded provenance belongs to the doctor; fresh pagination
    // authority belongs to the nurse's own current read assignment.
    expect(decodeCloudObservationCursor(read.body.observations![0].historyPage.nextCursor!))
      .toMatchObject({ assignmentId: n.assignment, assignmentVersionId: `${n.assignment}-v1`, observationVersion: 3 });
  }, 20000);

  it('rechecks current assignment grants before replay and never borrows clinical role from a revoked assignment', async () => {
    const pat = await patient(); const creation = payload(pat);
    const made = saved(await api(a, '/api/observations', 'POST', creation), 201);
    await changeAssignment(a, ['doctor'], ['observations.manage']);
    await denied(a, '/api/observations', 403, 'OBSERVATION_FORBIDDEN', 'POST', creation);
    await denied(a, `/api/observations/${made.id}`, 403, 'OBSERVATION_FORBIDDEN', 'PATCH', correction(made));
    await denied(a, `/api/observations?${query(a, pat)}`, 403, 'OBSERVATION_FORBIDDEN');
    await changeAssignment(a, ['administrator']);
    await denied(a, `/api/observations/latest-vitals?${query(a, pat)}`, 403, 'OBSERVATION_FORBIDDEN');
    expect((await api(n, `/api/observations?${query(n, pat)}`)).status).toBe(200);
  }, 20000);

  it('keeps another clinic isolated, returns safe404 for foreign/missing resources and rejects wrong assignments', async () => {
    const patA = await patient(); const patB = await patient(b);
    const madeA = saved(await api(a, '/api/observations', 'POST', payload(patA)), 201);
    const madeB = saved(await api(b, '/api/observations', 'POST', payload(patB, b)), 201);
    expect((await api(b, `/api/observations?${query(b, patB)}`)).body.observations?.map(item => item.id)).toEqual([madeB.id]);
    await denied(b, `/api/observations?${query(a, patA)}`, 403, 'OBSERVATION_FORBIDDEN');
    for (const path of [`/api/observations?${query(b, patA)}`,
      `/api/observations/latest-vitals?${query(b, patA)}`,
      `/api/observations/${madeA.id}/history?${query(b, patB)}`,
      `/api/observations/missing-observation/history?${query(b, patB)}`]) {
      await denied(b, path, 404, 'OBSERVATION_NOT_FOUND');
    }
    await denied(b, `/api/observations/${madeA.id}`, 404, 'OBSERVATION_NOT_FOUND', 'PATCH',
      { ...correction(madeA, b), patientId: patB });
    await denied(b, '/api/observations', 404, 'OBSERVATION_NOT_FOUND', 'POST', payload(patA, b));
    await denied(b, '/api/observations', 403, 'OBSERVATION_FORBIDDEN', 'POST', payload(patA, a));
    expect((await api(a, `/api/observations?${query(a, patA)}`)).body.observations?.map(item => item.id)).toEqual([madeA.id]);
  }, 20000);

  it('accepts integral pressure JSON decimals through the actual HTTP schema and returns only persisted measurement groups', async () => {
    const pat = await patient(); const command = payload(pat);
    const raw = JSON.stringify(command).replace('"systolicMmhg":118', '"systolicMmhg":118.0')
      .replace('"diastolicMmhg":76', '"diastolicMmhg":76.0');
    expect(raw).toContain('118.0'); expect(raw).toContain('76.0');
    const made = saved(await api(a, '/api/observations', 'POST', raw), 201);
    expect(made.current.values).toEqual({ ...command.values, bmi: 23.51 });
    expect((await db.query(`select systolic_mmhg,diastolic_mmhg,height_mm,weight_grams,temperature_milli_c
      from orion_private.patient_observation_versions`)).rows[0])
      .toEqual({ systolic_mmhg: 118, diastolic_mmhg: 76, height_mm: 1650, weight_grams: 64000, temperature_milli_c: 36500 });
    const latest = await api(a, `/api/observations/latest-vitals?${query(a, pat)}`);
    expect(latest.status).toBe(200);
    expect(latest.body.vitals?.bloodPressure).toMatchObject({ observationId: made.id, version: 1, systolicMmhg: 118, diastolicMmhg: 76 });
    expect(latest.body.vitals?.temperature).toMatchObject({ observationId: made.id, temperatureC: 36.5 });
    const noMeasurements = await patient();
    expect((await api(a, `/api/observations/latest-vitals?${query(a, noMeasurements)}`)).body.vitals)
      .toEqual({ anthropometry: null, bloodPressure: null, temperature: null });
  }, 20000);

  it('rejects an old account generation before RPC and every observation RPC after fixture session deletion despite Auth/user200', async () => {
    const pat = await patient(); const creation = payload(pat);
    const made = saved(await api(a, '/api/observations', 'POST', creation), 201);
    const command = correction(made); const fixed = saved(await api(a, `/api/observations/${made.id}`, 'PATCH', command));
    const before = await counts(); const offset = seenRpcs.length;
    const staleGeneration = a.session.replaceAll('-', '');
    expect(await api(n, `/api/observations?${query(n, pat)}`, 'GET', undefined, staleGeneration))
      .toMatchObject({ status: 409, body: { error: { code: 'SESSION_CHANGED' } } });
    expect(await api(n, '/api/observations', 'POST', payload(pat, n), staleGeneration))
      .toMatchObject({ status: 409, body: { error: { code: 'SESSION_CHANGED' } } });
    expect(seenRpcs.length).toBe(offset); expect(await counts()).toEqual(before); expect(seenUsers).toContain(n.staff);
    await db.query('delete from auth.sessions where id=$1 and user_id=$2', [a.session, a.subject]);
    const database = await cloudDatabaseForRequest(request(a, '/api/observations'));
    expect(database.principal.subject).toBe(a.subject);
    const calls: Record<typeof observationRpcNames[number], Record<string, unknown>> = {
      orion_observations_page: { assignment_id: a.assignment, patient_id: pat, facility_id: a.facility, max_results: 25, cursor: null },
      orion_observation_history_page: { assignment_id: a.assignment, patient_id: pat, observation_id: made.id,
        facility_id: a.facility, max_results: 25, cursor: null },
      orion_patient_latest_vitals: { assignment_id: a.assignment, patient_id: pat, facility_id: a.facility },
      orion_observation_create: { assignment_id: a.assignment, payload: creation, facility_id: a.facility },
      orion_observation_correct: { assignment_id: a.assignment, observation_id: made.id, payload: command, facility_id: a.facility },
    };
    for (const name of observationRpcNames) await expect(database.call(name, calls[name])).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(await api(a, '/api/observations', 'POST', creation)).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    expect(await api(a, `/api/observations/${fixed.id}/history?${query(a, pat)}`))
      .toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    expect(await counts()).toEqual(before);
    expect((await api(n, `/api/observations?${query(n, pat)}`)).status).toBe(200);
  }, 20000);

  it('enforces bounded ordered continuation, scope, current assignment and immutable anchor/history pins', async () => {
    const pat = await patient(); const at = Date.now() - 10000; const made: Observation[] = [];
    for (let index = 0; index < 3; index += 1) {
      made.push(saved(await api(a, '/api/observations', 'POST', payload(pat, a, { measuredAt: at + index * 1000 })), 201));
    }
    const first = await api(a, `/api/observations?${query(a, pat)}&limit=2`);
    expect(first.status).toBe(200); expect(first.body.observations?.map(item => item.id)).toEqual([made[2].id, made[1].id]);
    expect(first.body.page).toMatchObject({ hasMore: true });
    const encoded = first.body.page!.nextCursor!; const cursor = decodeCloudObservationCursor(encoded)!;
    const second = await api(a, `/api/observations?${query(a, pat)}&limit=2&cursor=${encoded}`);
    expect(second.status).toBe(200); expect(second.body.observations?.map(item => item.id)).toEqual([made[0].id]);
    expect(second.body.page).toEqual({ hasMore: false, nextCursor: null });
    for (const changes of [{ organizationId: b.organization }, { assignmentId: n.assignment }, { patientId: 'other-patient' }]) {
      const foreign = encodeCloudObservationCursor({ ...cursor, ...changes });
      await denied(a, `/api/observations?${query(a, pat)}&limit=2&cursor=${foreign}`, 400, 'INVALID_CONTINUATION');
    }
    await denied(a, `/api/observations?${query(a, pat)}&patientId=${pat}`, 400, 'INVALID_OBSERVATION_QUERY');
    saved(await api(a, `/api/observations/${made[1].id}`, 'PATCH', correction(made[1])));
    await denied(a, `/api/observations?${query(a, pat)}&limit=2&cursor=${encoded}`, 409, 'PAGINATION_STALE');
    const fresh = await api(a, `/api/observations?${query(a, pat)}&limit=2`);
    expect(fresh.status).toBe(200); const beforeAssignment = fresh.body.page!.nextCursor!;
    await changeAssignment(a);
    await denied(a, `/api/observations?${query(a, pat)}&limit=2&cursor=${beforeAssignment}`, 409, 'PAGINATION_STALE');
    expect((await api(a, `/api/observations?${query(a, pat)}&limit=2`)).status).toBe(200);
  }, 20000);
});
