import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listPatients, POST as createPatient } from '@/app/api/patients/route';
import { GET as patientDetail, PATCH as updatePatient } from '@/app/api/patients/[patientId]/route';
import { POST as archivePatient } from '@/app/api/patients/[patientId]/archive/route';
import { GET as patientHistory } from '@/app/api/patients/[patientId]/history/route';
import { cloudDatabaseForRequest } from '@/lib/cloud/database-context.server';
import { cloudAuthCookies } from '@/lib/cloud/auth-session.server';
import { cloudGenerationHeader } from '@/lib/cloud/account-fence';
import { encodeCloudPatientCursor } from '@/lib/cloud/patient-cursor.server';
import { cloudRpcNames, type CloudRpcName } from '@/lib/cloud/supabase-rpc.server';

// Engineering integration proof ONLY: real HTTP-shaped route handlers, transport,
// assignment resolver, DTOs and PostgreSQL WASM. Auth and PostgREST are explicit
// fixed-URL provider doubles, NOT live Supabase, real passwords, browser cookies,
// two-account browser acceptance, provider revocation timing or clinical approval.
// No env file, original DB, owner bootstrap, provider resource or network is used.
const projectRef = 'bctyswbqjgpmtsanrfhp'; // Existing SQL issuer contract, not a credential.
const providerOrigin = `https://${projectRef}.supabase.co`;
const issuer = `${providerOrigin}/auth/v1`;
const origin = 'https://orion-fixture.example.invalid';
const source = { ORION_SUPABASE_PROJECT_REF: projectRef, ORION_SUPABASE_URL: providerOrigin,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'z'.repeat(24)}`,
  ORION_CLOUD_PUBLIC_ORIGIN: origin, ORION_SYNTHETIC_DATA_ONLY: 'true' };

type Actor = { subject: string; session: string; staff: string; member: string;
  organization: string; facility: string; assignment: string; token: string;
  claims: Record<string, unknown> };
function actor(suffix: string, subject: string, session: string, clinic = suffix): Actor {
  const claims = { iss: issuer, sub: subject, session_id: session, role: 'authenticated',
    is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 };
  // The same deliberately invalid header/signature factory used by auth tests;
  // only the fixed provider double can ever accept this artificial bearer.
  const token = `example.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.example`;
  return { subject, session, staff: `staff-${suffix}`, member: `member-${suffix}`,
    organization: `org-${clinic}`, facility: `fac-${clinic}`, assignment: `assignment-${suffix}`, token, claims };
}
const a = actor('a', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
const b = actor('b', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
// A distinct employee in the SAME clinic may legitimately read that clinic's
// patients. The registry is facility-scoped, not private-by-patient-creator.
const c = actor('c', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', 'a');
const actors = [a, b, c];
let db: PGlite;
let seenRpcs: CloudRpcName[];
let seenUsers: string[];
let unexpectedRequests = 0;

type Patient = { id: string; displayName: string; status: string; version: number;
  profileHistory: { version: number; status: string }[] };
type Envelope = { patient?: Patient; patients?: Patient[]; items?: { version: number }[];
  page?: { hasMore: boolean; nextCursor: string | null }; error?: { code: string; message: string } };
type Reply = { status: number; body: Envelope; headers: Headers };
type Counts = { patients: number; versions: number; commands: number; patientAudits: number; accessAudits: number };

// SQL names AND argument order are fixed locally. Incoming URLs/JSON can never
// supply raw SQL, choose another database or invoke private helper functions.
const rpcContracts: Record<CloudRpcName, { sql: string; fields: string[]; json?: string[] }> = {
  orion_access_overview: { sql: 'select public.orion_access_overview() result', fields: [] },
  orion_patients_list: { sql: 'select public.orion_patients_list($1,$2,$3,$4,$5,$6) result',
    fields: ['assignment_id', 'facility_id', 'query', 'status', 'max_results', 'cursor'], json: ['cursor'] },
  orion_patient_detail: { sql: 'select public.orion_patient_detail($1,$2,$3) result',
    fields: ['assignment_id', 'patient_id', 'facility_id'] },
  orion_patient_create: { sql: 'select public.orion_patient_create($1,$2,$3) result',
    fields: ['assignment_id', 'payload', 'facility_id'], json: ['payload'] },
  orion_patient_update: { sql: 'select public.orion_patient_update($1,$2,$3) result',
    fields: ['assignment_id', 'payload', 'facility_id'], json: ['payload'] },
  orion_patient_archive: { sql: 'select public.orion_patient_archive($1,$2,$3) result',
    fields: ['assignment_id', 'payload', 'facility_id'], json: ['payload'] },
  orion_patient_history_page: { sql: 'select public.orion_patient_history_page($1,$2,$3,$4,$5,$6) result',
    fields: ['assignment_id', 'patient_id', 'history_kind', 'facility_id', 'max_results', 'cursor'], json: ['cursor'] },
};

async function providerDouble(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init?.headers);
  const selected = actors.find(candidate => headers.get('authorization') === `Bearer ${candidate.token}`);
  if (!selected || headers.get('apikey') !== source.ORION_SUPABASE_PUBLISHABLE_KEY ||
      init?.cache !== 'no-store' || init?.redirect !== 'error' || init?.signal?.aborted) {
    unexpectedRequests += 1;
    throw new Error('Fixture provider transport rejected.');
  }
  if (url === `${providerOrigin}/auth/v1/user` && init?.method === 'GET') {
    seenUsers.push(selected.staff);
    // Intentionally remains200 after deleting the fixture auth.sessions row.
    // Identity metadata alone must not authorize a PostgreSQL read/write/replay.
    return Response.json({ id: selected.subject, role: 'authenticated', is_anonymous: false,
      email: `${selected.staff}@example.invalid` });
  }
  const name = cloudRpcNames.find(candidate => url === `${providerOrigin}/rest/v1/rpc/${candidate}`);
  if (!name || init?.method !== 'POST' || typeof init.body !== 'string' ||
      headers.get('content-type') !== 'application/json') {
    unexpectedRequests += 1;
    throw new Error('Fixture provider destination rejected.');
  }
  const args = JSON.parse(init.body) as Record<string, unknown>;
  const contract = rpcContracts[name];
  if (!args || Array.isArray(args) || Object.keys(args).some(field => !contract.fields.includes(field)) ||
      contract.fields.some(field => !(field in args))) {
    unexpectedRequests += 1;
    throw new Error('Fixture RPC shape rejected.');
  }
  seenRpcs.push(name);
  try {
    const result = await db.transaction(async transaction => {
      // Local transaction claims cannot survive into the next employee request.
      // Execute as the real API role, with unchanged migration grant boundaries.
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
    // This is a PostgREST-shaped SQL error, not an invented successful result.
    return Response.json({ code: rejected.code, message: rejected.message,
      details: rejected.detail ?? 'fixture-private-detail', hint: rejected.hint ?? 'fixture-private-hint' }, { status });
  }
}

beforeEach(async () => {
  seenRpcs = []; seenUsers = []; unexpectedRequests = 0;
  Object.entries(source).forEach(([name, value]) => vi.stubEnv(name, value));
  vi.stubGlobal('fetch', providerDouble);
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for (const name of ['0001_private_schema_boundary.sql', '0002_access_patient_registry.sql', '0004_bounded_patient_pagination.sql']) {
    await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into orion_private.organizations values('org-a','Искусственная организация A','active',1,1,1),('org-b','Искусственная организация B','active',1,1,1);
    insert into orion_private.facilities values('fac-a','org-a','Искусственная клиника A','UTC','active',1,1,1),('fac-b','org-b','Искусственная клиника B','UTC','active',1,1,1);
    insert into orion_private.departments values('dept-fac-a','org-a','fac-a','medicine','Искусственная медицина','clinical','active',1,1,1),('dept-fac-b','org-b','fac-b','medicine','Искусственная медицина','clinical','active',1,1,1);`);
  // Department versions reference their creating membership, so insert the
  // minimal staff rows before the version/head and assignment fixture rows.
  for (const selected of actors) {
    await db.query('insert into auth.users(id) values($1)', [selected.subject]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [selected.session, selected.subject]);
    await db.query('insert into orion_private.users values($1,$2,$3,null,$4,\'active\',1,1,1)',
      [selected.staff, issuer, selected.subject, `Искусственный сотрудник ${selected.staff}`]);
    await db.query('insert into orion_private.memberships values($1,$2,$3,$4,\'clinician\',\'active\',1,1,1)',
      [selected.member, selected.organization, selected.facility, selected.staff]);
  }
  await db.exec(`insert into orion_private.department_versions values('dept-fac-a-v1','org-a','fac-a','dept-fac-a',1,null,'Искусственная медицина','clinical','active','Искусственный тест','member-a',1,1),('dept-fac-b-v1','org-b','fac-b','dept-fac-b',1,null,'Искусственная медицина','clinical','active','Искусственный тест','member-b',1,1);
    insert into orion_private.department_heads values('dept-fac-a-head','org-a','fac-a','dept-fac-a','dept-fac-a-v1',1,1,1),('dept-fac-b-head','org-b','fac-b','dept-fac-b','dept-fac-b-v1',1,1,1);`);
  for (const selected of actors) {
    await db.query('insert into orion_private.department_access_assignments values($1,$2,$3,$4,$5,$5,1)',
      [selected.assignment, selected.organization, selected.facility, `dept-${selected.facility}`, selected.member]);
    await db.query(`insert into orion_private.department_access_assignment_versions
      values($1,$2,$3,$4,$5,$6,1,null,'active','bootstrap','["doctor"]','[]','[]',1,null,'Искусственный тестовый доступ',$6,1,1)`,
      [`${selected.assignment}-v1`, selected.organization, selected.facility, selected.assignment, `dept-${selected.facility}`, selected.member]);
    await db.query('insert into orion_private.department_access_assignment_heads values($1,$2,$3,$4,$5,$6,$7,1,1,1)',
      [`${selected.assignment}-head`, selected.organization, selected.facility, selected.assignment, `dept-${selected.facility}`,
        selected.member, `${selected.assignment}-v1`]);
  }
}, 20000);

afterEach(async () => {
  try { expect(unexpectedRequests).toBe(0); }
  finally { await db?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

function request(selected: Actor, path: string, method = 'GET', body?: unknown, generation = selected.session.replaceAll('-', '')) {
  return new Request(`${origin}${path}`, { method,
    headers: { Cookie: `${cloudAuthCookies.access}=${selected.token}`, [cloudGenerationHeader]: generation,
      Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function api(selected: Actor, path: string, method = 'GET', body?: unknown, generation?: string): Promise<Reply> {
  const supplied = request(selected, path, method, body, generation);
  const url = new URL(supplied.url);
  let response: Response;
  if (url.pathname === '/api/patients') response = await (method === 'GET' ? listPatients : createPatient)(supplied);
  else {
    const match = /^\/api\/patients\/([^/]+)(\/archive|\/history)?$/.exec(url.pathname);
    if (!match) throw new Error('Unknown fixture API route.');
    const params = { params: Promise.resolve({ patientId: match[1] }) };
    response = await (match[2] === '/archive' ? archivePatient : match[2] === '/history' ? patientHistory
      : method === 'PATCH' ? updatePatient : patientDetail)(supplied, params);
  }
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const text = await response.text();
  for (const forbidden of ['fixture-private-detail', 'fixture-private-hint', source.ORION_SUPABASE_PUBLISHABLE_KEY, ...actors.map(value => value.token)]) {
    expect(text).not.toContain(forbidden);
  }
  return { status: response.status, body: JSON.parse(text) as Envelope, headers: response.headers };
}
function scope(selected: Actor) { return { accessAssignmentId: selected.assignment, facilityId: selected.facility }; }
function query(selected: Actor) { return new URLSearchParams(scope(selected)).toString(); }
function createBody(selected = a, changes: Record<string, unknown> = {}) {
  return { ...scope(selected), displayName: 'Искусственный HTTP пациент', birthDate: '1990-01-02', sexAtBirth: 'female',
    phone: null, email: null, address: null, testIin: null, testDataAcknowledged: true, idempotencyKey: randomUUID(), ...changes };
}
function updateBody(patient: Patient, changes: Record<string, unknown> = {}, selected = a) {
  return { ...scope(selected), displayName: 'Искусственный исправленный пациент', birthDate: '1990-01-02', sexAtBirth: 'female',
    phone: null, email: null, address: null, testDataAcknowledged: true, expectedVersion: patient.version,
    changeReason: 'Искусственная HTTP проверка', idempotencyKey: randomUUID(), ...changes };
}
function archiveBody(patient: Patient, selected = a) {
  return { ...scope(selected), expectedVersion: patient.version, changeReason: 'Искусственное HTTP архивирование',
    testDataAcknowledged: true, idempotencyKey: randomUUID() };
}
function saved(reply: Reply, status = 200): Patient {
  expect(reply.status).toBe(status); expect(reply.body.patient).toBeDefined(); return reply.body.patient!;
}
async function counts(): Promise<Counts> {
  return (await db.query<Counts>(`select (select count(*)::int from orion_private.patients) patients,
    (select count(*)::int from orion_private.patient_profile_versions) versions,
    (select count(*)::int from orion_private.command_idempotency) commands,
    (select count(*)::int from orion_private.audit_events where action like 'patient.%') "patientAudits",
    (select count(*)::int from orion_private.audit_events where action='access.self.read') "accessAudits"`)).rows[0];
}
function patientCounts(value: Counts) {
  return { patients: value.patients, versions: value.versions, commands: value.commands, patientAudits: value.patientAudits };
}
async function rejectedWithoutPatientMutation(selected: Actor, path: string, method: string, body: unknown, code: string, status = 409) {
  const before = await counts();
  const reply = await api(selected, path, method, body);
  expect(reply.status).toBe(status); expect(reply.body.error?.code).toBe(code);
  const after = await counts();
  expect(patientCounts(after)).toEqual(patientCounts(before));
  // The separate genuine access-overview RPC may audit this employee's read;
  // it must not be misrepresented as a failed patient mutation having committed.
  expect(after.accessAudits).toBeGreaterThanOrEqual(before.accessAudits);
}

describe('0004 registry HTTP/PostgreSQL engineering bridge (NOT live provider proof)', () => {
  it('creates, updates and archives once per exact key/body; changed-body retries cannot commit', async () => {
    const creation = createBody();
    const made = saved(await api(a, '/api/patients', 'POST', creation), 201);
    const madeAgain = saved(await api(a, '/api/patients', 'POST', creation), 201);
    expect(madeAgain).toEqual(made);
    expect(patientCounts(await counts())).toEqual({ patients: 1, versions: 1, commands: 1, patientAudits: 2 });
    await rejectedWithoutPatientMutation(a, '/api/patients', 'POST', { ...creation, displayName: 'Искусственная подмена' }, 'PATIENT_COMMAND_CONFLICT');

    const update = updateBody(made);
    const changed = saved(await api(a, `/api/patients/${made.id}`, 'PATCH', update));
    expect(changed.version).toBe(2);
    const beforeReplay = await counts();
    expect(saved(await api(a, `/api/patients/${made.id}`, 'PATCH', update))).toEqual(changed);
    expect(patientCounts(await counts())).toEqual({ ...patientCounts(beforeReplay), patientAudits: beforeReplay.patientAudits + 1 });
    await rejectedWithoutPatientMutation(a, `/api/patients/${made.id}`, 'PATCH', { ...update, phone: '+7 000 111 22 33' }, 'PATIENT_COMMAND_CONFLICT');

    const archive = archiveBody(changed);
    const archived = saved(await api(a, `/api/patients/${made.id}/archive`, 'POST', archive));
    expect(archived).toMatchObject({ status: 'inactive', version: 3 });
    const beforeArchiveReplay = await counts();
    expect(saved(await api(a, `/api/patients/${made.id}/archive`, 'POST', archive))).toEqual(archived);
    expect(patientCounts(await counts())).toEqual({ ...patientCounts(beforeArchiveReplay), patientAudits: beforeArchiveReplay.patientAudits + 1 });
    await rejectedWithoutPatientMutation(a, `/api/patients/${made.id}/archive`, 'POST', { ...archive, changeReason: 'Искусственная другая причина' }, 'PATIENT_COMMAND_CONFLICT');
    const reopened = saved(await api(a, `/api/patients/${made.id}?${query(a)}`));
    expect(reopened).toEqual(archived);
    expect(reopened.profileHistory.map(item => item.version)).toEqual([3, 2, 1]);
    const cursor = encodeCloudPatientCursor({ domainVersion: 1, kind: 'profile', organizationId: a.organization,
      facilityId: a.facility, assignmentId: a.assignment, assignmentVersionId: `${a.assignment}-v1`,
      patientId: made.id, profileVersion: 3, beforeVersion: 3 });
    const history = await api(a, `/api/patients/${made.id}/history?${query(a)}&kind=profile&cursor=${cursor}`);
    expect(history.status).toBe(200);
    expect(history.body.items?.map(item => item.version)).toEqual([2, 1]);
    expect((await api(a, `/api/patients?${query(a)}`)).body.patients).toEqual([]);
  }, 20000);

  it('replays an old receipt as the current head without resurrecting or duplicating old profile data', async () => {
    const creation = createBody();
    const made = saved(await api(a, '/api/patients', 'POST', creation), 201);
    const update = updateBody(made);
    const v2 = saved(await api(a, `/api/patients/${made.id}`, 'PATCH', update));
    const v3 = saved(await api(a, `/api/patients/${made.id}`, 'PATCH', updateBody(v2, { displayName: 'Искусственный текущий пациент' })));
    const before = await counts();
    expect(saved(await api(a, '/api/patients', 'POST', creation), 201)).toEqual(v3);
    expect(saved(await api(a, `/api/patients/${made.id}`, 'PATCH', update))).toEqual(v3);
    expect(patientCounts(await counts())).toEqual({ ...patientCounts(before), patientAudits: before.patientAudits + 2 });
    expect(saved(await api(a, `/api/patients/${made.id}?${query(a)}`))).toEqual(v3);
  }, 20000);

  it('keeps another clinic isolated through real assignments, patient detail/history and cursor checks', async () => {
    const madeA = saved(await api(a, '/api/patients', 'POST', createBody()), 201);
    const madeB = saved(await api(b, '/api/patients', 'POST', createBody(b)), 201);
    expect((await api(b, `/api/patients?${query(b)}`)).body.patients?.map(patient => patient.id)).toEqual([madeB.id]);
    expect((await api(a, `/api/patients?${query(a)}`)).body.patients?.map(patient => patient.id)).toEqual([madeA.id]);
    const before = await counts();
    const ownScopeForeignPatient = await api(b, `/api/patients/${madeA.id}?${query(b)}`);
    expect(ownScopeForeignPatient).toMatchObject({ status: 404, body: { error: { code: 'PATIENT_NOT_FOUND' } } });
    for (const path of [`/api/patients?${query(a)}`, `/api/patients/${madeA.id}?${query(a)}`]) {
      expect(await api(b, path)).toMatchObject({ status: 403, body: { error: { code: 'PATIENT_DIRECTORY_FORBIDDEN' } } });
    }
    const cursor = encodeCloudPatientCursor({ domainVersion: 1, kind: 'profile', organizationId: a.organization,
      facilityId: a.facility, assignmentId: a.assignment, assignmentVersionId: `${a.assignment}-v1`,
      patientId: madeA.id, profileVersion: 1, beforeVersion: 1 });
    expect(await api(b, `/api/patients/${madeA.id}/history?${query(a)}&kind=profile&cursor=${cursor}`))
      .toMatchObject({ status: 403, body: { error: { code: 'PATIENT_DIRECTORY_FORBIDDEN' } } });
    expect(await api(b, `/api/patients/${madeA.id}/history?${query(b)}&kind=profile&cursor=${cursor}`))
      .toMatchObject({ status: 404, body: { error: { code: 'PATIENT_NOT_FOUND' } } });
    await rejectedWithoutPatientMutation(b, `/api/patients/${madeA.id}`, 'PATCH', updateBody(madeA, {}, b), 'PATIENT_NOT_FOUND', 404);
    await rejectedWithoutPatientMutation(b, '/api/patients', 'POST', createBody(a), 'PATIENT_DIRECTORY_FORBIDDEN', 403);
    expect(patientCounts(await counts())).toEqual(patientCounts(before));
    const receipts = (await db.query<{ member: string; patient: string }>(`select actor_membership_id member,result_resource_id patient
      from orion_private.command_idempotency order by actor_membership_id`)).rows;
    expect(receipts).toEqual([{ member: a.member, patient: madeA.id }, { member: b.member, patient: madeB.id }]);
  }, 20000);

  it('permits a separately assigned same-clinic employee, but never adopts another actor receipt or assignment', async () => {
    const sharedKey = randomUUID();
    const madeA = saved(await api(a, '/api/patients', 'POST', createBody(a, { idempotencyKey: sharedKey })), 201);
    expect(saved(await api(c, `/api/patients/${madeA.id}?${query(c)}`))).toEqual(madeA);
    const madeC = saved(await api(c, '/api/patients', 'POST', createBody(c,
      { idempotencyKey: sharedKey, displayName: 'Искусственный пациент сотрудника C' })), 201);
    expect(madeC.id).not.toBe(madeA.id);
    const receipts = (await db.query<{ member: string; assignment: string; patient: string }>(`select
      actor_membership_id member,access_assignment_id assignment,result_resource_id patient from orion_private.command_idempotency
      where idempotency_key=$1 order by actor_membership_id`, [sharedKey])).rows;
    expect(receipts).toEqual([{ member: a.member, assignment: a.assignment, patient: madeA.id },
      { member: c.member, assignment: c.assignment, patient: madeC.id }]);
    await rejectedWithoutPatientMutation(c, `/api/patients/${madeA.id}`, 'PATCH', updateBody(madeA), 'PATIENT_DIRECTORY_FORBIDDEN', 403);
  }, 20000);

  it('denies all seven real RPCs and recorded-command replay after deleting only the fixture session, even with Auth/user200', async () => {
    const creation = createBody();
    const made = saved(await api(a, '/api/patients', 'POST', creation), 201);
    const update = updateBody(made);
    const changed = saved(await api(a, `/api/patients/${made.id}`, 'PATCH', update));
    const archive = archiveBody(changed);
    saved(await api(a, `/api/patients/${made.id}/archive`, 'POST', archive));
    const before = await counts();
    await db.query('delete from auth.sessions where id=$1 and user_id=$2', [a.session, a.subject]);
    const database = await cloudDatabaseForRequest(request(a, '/api/patients'));
    expect(database.principal.subject).toBe(a.subject); // Provider double STILL verifies metadata.
    const { accessAssignmentId: _a, facilityId: _f, ...createPayload } = creation; void _a; void _f;
    const { accessAssignmentId: _ua, facilityId: _uf, ...updatePayload } = update; void _ua; void _uf;
    const { accessAssignmentId: _aa, facilityId: _af, ...archivePayload } = archive; void _aa; void _af;
    const requests: Record<CloudRpcName, Record<string, unknown>> = {
      orion_access_overview: {},
      orion_patients_list: { assignment_id: a.assignment, facility_id: a.facility, query: null, status: 'all', max_results: 25, cursor: null },
      orion_patient_detail: { assignment_id: a.assignment, facility_id: a.facility, patient_id: made.id },
      orion_patient_create: { assignment_id: a.assignment, facility_id: a.facility, payload: createPayload },
      orion_patient_update: { assignment_id: a.assignment, facility_id: a.facility, payload: { ...updatePayload, patientId: made.id } },
      orion_patient_archive: { assignment_id: a.assignment, facility_id: a.facility, payload: { ...archivePayload, patientId: made.id } },
      orion_patient_history_page: { assignment_id: a.assignment, facility_id: a.facility, patient_id: made.id, history_kind: 'profile', max_results: 25, cursor: null },
    };
    const rpcOffset = seenRpcs.length;
    for (const name of cloudRpcNames) await expect(database.call(name, requests[name])).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(seenRpcs.slice(rpcOffset)).toEqual([...cloudRpcNames]);
    expect(await api(a, `/api/patients/${made.id}?${query(a)}`)).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    expect(await api(a, '/api/patients', 'POST', creation)).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    expect(await counts()).toEqual(before); // Revoked RPCs cannot even commit access audit.
    expect(seenUsers.filter(staff => staff === a.staff).length).toBeGreaterThan(3);
    expect((await api(b, `/api/patients?${query(b)}`)).status).toBe(200);
  }, 20000);

  it('rejects an old generation paired with another employee cookie before any database RPC', async () => {
    const made = saved(await api(a, '/api/patients', 'POST', createBody()), 201);
    const before = await counts(); const rpcOffset = seenRpcs.length;
    const stale = a.session.replaceAll('-', '');
    expect(await api(b, `/api/patients?${query(b)}`, 'GET', undefined, stale))
      .toMatchObject({ status: 409, body: { error: { code: 'SESSION_CHANGED' } } });
    expect(await api(b, `/api/patients/${made.id}`, 'PATCH', updateBody(made, {}, b), stale))
      .toMatchObject({ status: 409, body: { error: { code: 'SESSION_CHANGED' } } });
    expect(seenRpcs.length).toBe(rpcOffset); expect(await counts()).toEqual(before);
    expect(seenUsers).toContain(b.staff);
  }, 20000);
});
