import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { STAFF_SESSION_COOKIE, STAFF_SESSION_IDLE_MS } from '../auth/staff-session';
import { resolveLocalMaterialContext } from '../local-materials/server-context';
import { D1LocalMaterialContextRepository } from './local-material-context';
import { D1StaffCredentialRepository } from './staff-credentials';
import { D1StaffSessionRepository } from './staff-sessions';

type Clock = { now: number };
type Bound = { sql: string; bindings: SQLInputValue[] };
type ConsentType = 'care' | 'transcript_storage' | 'audio_retention' | 'transient_audio_processing' | 'external_ai_processing';
type ConsentOptions = { decision?: 'granted' | 'denied' | 'withdrawn'; effectiveAt?: number; expiresAt?: number | null };
type AssignmentOptions = { roles?: string[]; deny?: string[]; status?: 'active' | 'revoked'; from?: number; until?: number | null };
const consentTypes: ConsentType[] = ['care', 'transcript_storage', 'audio_retention', 'transient_audio_processing', 'external_ai_processing'];
const issuer = 'orion:synthetic-local-material-test';
const syntheticTokens = { a: 'a1'.repeat(32), b: 'b2'.repeat(32) };
const tokenHash = (suffix: 'a' | 'b') => createHash('sha256').update(syntheticTokens[suffix]).digest('hex');
const syntheticPasswordHash = `orion$scrypt$v1$32768$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const opened = new Set<DatabaseSync>();
const temporary: { directory: string; path: string }[] = [];

function close(database: DatabaseSync) { database.close(); opened.delete(database); }
afterEach(() => {
  for (const database of opened) database.close();
  opened.clear();
  for (const item of temporary.splice(0)) {
    const directory = resolve(item.directory);
    if (dirname(resolve(item.path)) !== directory || dirname(directory) !== resolve(tmpdir())
      || !basename(directory).startsWith('orion-material-context-test-')) throw new Error('Unsafe material fixture cleanup');
    // Only exact files owned by this synthetic fixture, never main .wrangler/state.
    for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(item.path + suffix)) unlinkSync(item.path + suffix);
    rmdirSync(directory);
  }
});

function adapter(database: DatabaseSync, statements: string[]): D1Database {
  const execute = (bound: Bound): D1Result => {
    statements.push(bound.sql);
    const before = Number(database.prepare('select total_changes() as n').get()?.n);
    const statement = database.prepare(bound.sql);
    const results = statement.columns().length ? statement.all(...bound.bindings) : (statement.run(...bound.bindings), []);
    return { success: true, results, meta: { changes: Number(database.prepare('select total_changes() as n').get()?.n) - before } } as D1Result;
  };
  const prepare = (sql: string, bindings: SQLInputValue[] = []): D1PreparedStatement => ({
    sql, bindings,
    bind(...values: unknown[]) { return prepare(sql, values as SQLInputValue[]); },
    async first<T>() { statements.push(sql); return database.prepare(sql).get(...bindings) as T | undefined ?? null; },
    async all() { return execute({ sql, bindings }); },
    async run() { return execute({ sql, bindings }); },
  } as unknown as D1PreparedStatement);
  return {
    prepare,
    async batch(statements_: D1PreparedStatement[]) {
      database.exec('begin immediate');
      try {
        const results = (statements_ as unknown as Bound[]).map(execute);
        database.exec('commit'); return results;
      } catch (error) { database.exec('rollback'); throw error; }
    },
  } as unknown as D1Database;
}

function connect(path: string, clock: Clock) {
  const database = new DatabaseSync(path);
  opened.add(database);
  database.exec('pragma foreign_keys=on');
  // Shadow only this disposable DB connection, not the JS or request clock.
  database.function('unixepoch', { varargs: true }, (...args: SQLInputValue[]) => args[0] === 'subsec' ? clock.now / 1000 : Math.floor(clock.now / 1000));
  const statements: string[] = [];
  const d1 = adapter(database, statements);
  return { database, d1, statements, sessions: new D1StaffSessionRepository(d1), contexts: new D1LocalMaterialContextRepository(d1) };
}

function headers(suffix: 'a' | 'b' = 'a') {
  return new Headers({ Cookie: `${STAFF_SESSION_COOKIE}=${syntheticTokens[suffix]}` });
}
function selection(suffix: 'a' | 'b' = 'a') {
  return { facilityId: 'material-facility', accessAssignmentId: `assignment-${suffix}`, patientId: `patient-${suffix}`, encounterId: `encounter-${suffix}` };
}
function readInput(suffix: 'a' | 'b' = 'a') {
  return { ...selection(suffix), tokenHash: tokenHash(suffix), userId: `doctor-${suffix}`, issuer, subject: `external-individual-${suffix}` };
}

function appendConsent(database: DatabaseSync, clock: Clock, type: ConsentType, options: ConsentOptions = {}, suffix: 'a' | 'b' = 'a') {
  const head = database.prepare('select current_consent_event_id as id, lock_version as version from consent_heads where encounter_id=? and consent_type=?')
    .get(`encounter-${suffix}`, type) as { id: string; version: number } | undefined;
  const version = (head?.version ?? 0) + 1;
  const id = `consent-${suffix}-${type}-v${version}`;
  database.prepare(`insert into consent_events (id, organization_id, facility_id, patient_id, encounter_id, version,
    consent_type, decision, captured_by_membership_id, policy_version, policy_hash, notice_language, source,
    occurred_at, effective_at, expires_at, supersedes_consent_event_id, external_processor)
    values (?, 'material-org', 'material-facility', ?, ?, ?, ?, ?, ?, 'synthetic-policy-v1', ?, 'ru', 'verbal', ?, ?, ?, ?, ?)`)
    .run(id, `patient-${suffix}`, `encounter-${suffix}`, version, type, options.decision ?? 'granted', `member-${suffix}`,
      'a'.repeat(64), clock.now, options.effectiveAt ?? clock.now - 1000, options.expiresAt ?? null, head?.id ?? null,
      type === 'external_ai_processing' ? 'synthetic-processor' : null);
  if (head) {
    database.prepare('update consent_heads set current_consent_event_id=?,lock_version=?,updated_at=? where encounter_id=? and consent_type=?')
      .run(id, version, clock.now, `encounter-${suffix}`, type);
  } else {
    database.prepare(`insert into consent_heads (id,organization_id,facility_id,patient_id,encounter_id,consent_type,current_consent_event_id,lock_version)
      values (?,'material-org','material-facility',?,?,?,?,?)`)
      .run(`consent-head-${suffix}-${type}`, `patient-${suffix}`, `encounter-${suffix}`, type, id, version);
  }
}

function advanceAssignment(database: DatabaseSync, clock: Clock, options: AssignmentOptions = {}, suffix: 'a' | 'b' = 'a') {
  const current = database.prepare(`select version.* from department_access_assignment_heads head
    join department_access_assignment_versions version on version.id=head.current_version_id where head.assignment_id=?`)
    .get(`assignment-${suffix}`) as { id: string; version: number; effective_from: number; effective_until: number | null; roles_json: string; deny_permissions_json: string };
  const id = `assignment-${suffix}-v${current.version + 1}`;
  database.prepare(`insert into department_access_assignment_versions
    (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,supersedes_version_id,status,source_type,
     roles_json,allow_permissions_json,deny_permissions_json,effective_from,effective_until,change_reason,changed_by_membership_id,changed_at)
    values (?,'material-org','material-facility',?,'material-department',?,?,?,?,'bootstrap',?,'[]',?,?,?,'synthetic fixture transition','member-a',?)`)
    .run(id, `assignment-${suffix}`, `member-${suffix}`, current.version + 1, current.id, options.status ?? 'active',
      JSON.stringify(options.roles ?? JSON.parse(current.roles_json)), JSON.stringify(options.deny ?? JSON.parse(current.deny_permissions_json)),
      options.from ?? current.effective_from, options.until === undefined ? current.effective_until : options.until, clock.now);
  database.prepare('update department_access_assignment_heads set current_version_id=?,lock_version=lock_version+1,updated_at=? where assignment_id=?')
    .run(id, clock.now, `assignment-${suffix}`);
}

async function fixture(options: { disk?: boolean; missingConsents?: boolean; encounterStatus?: string; legacyPatients?: boolean } = {}) {
  let path = ':memory:';
  if (options.disk) {
    const directory = mkdtempSync(join(tmpdir(), 'orion-material-context-test-'));
    path = join(directory, 'context.sqlite'); temporary.push({ directory, path });
  }
  const clock = { now: Date.UTC(2026, 8, 24, 12) };
  const connection = connect(path, clock);
  const { database, sessions } = connection;
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join('drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  database.exec(`insert into organizations (id,name) values ('material-org','Synthetic material clinic');
    insert into facilities (id,organization_id,name) values ('material-facility','material-org','Synthetic material facility');
    insert into users (id,external_issuer,external_subject,display_name,status)
      values ('operator','${issuer}','synthetic-operator','Synthetic fixture operator','active');`);
  for (const suffix of ['a', 'b'] as const) {
    database.prepare("insert into users (id,external_issuer,external_subject,display_name,status) values (?,?,?,?,'active')")
      .run(`doctor-${suffix}`, issuer, `external-individual-${suffix}`, `Synthetic doctor ${suffix}`);
    database.prepare("insert into memberships (id,organization_id,facility_id,user_id,role) values (?,'material-org','material-facility',?,'clinician')")
      .run(`member-${suffix}`, `doctor-${suffix}`);
  }
  database.exec(`insert into departments (id,organization_id,facility_id,code,name,kind)
      values ('material-department','material-org','material-facility','synthetic','Synthetic department','clinical');
    insert into department_versions (id,organization_id,facility_id,department_id,version,name,kind,status,change_reason,changed_by_membership_id,changed_at)
      values ('department-v1','material-org','material-facility','material-department',1,'Synthetic department','clinical','active','synthetic fixture','member-a',${clock.now});
    insert into department_heads (id,organization_id,facility_id,department_id,current_version_id)
      values ('department-head','material-org','material-facility','material-department','department-v1');`);
  const credentials = new D1StaffCredentialRepository(connection.d1);
  for (const suffix of ['a', 'b'] as const) {
    database.prepare(`insert into department_access_assignments (id,organization_id,facility_id,department_id,membership_id,created_by_membership_id)
      values (?,'material-org','material-facility','material-department',?,'member-a')`).run(`assignment-${suffix}`, `member-${suffix}`);
    database.prepare(`insert into department_access_assignment_versions
      (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,status,source_type,roles_json,effective_from,change_reason,changed_by_membership_id,changed_at)
      values (?,'material-org','material-facility',?,'material-department',?,1,'active','bootstrap','["doctor"]',?,'synthetic fixture','member-a',?)`)
      .run(`assignment-${suffix}-v1`, `assignment-${suffix}`, `member-${suffix}`, clock.now - 10_000, clock.now);
    database.prepare(`insert into department_access_assignment_heads (id,organization_id,facility_id,assignment_id,department_id,membership_id,current_version_id)
      values (?,'material-org','material-facility',?,'material-department',?,?)`)
      .run(`assignment-head-${suffix}`, `assignment-${suffix}`, `member-${suffix}`, `assignment-${suffix}-v1`);
    database.prepare(`insert into patients (id,organization_id,facility_id,medical_record_number,display_name)
      values (?,'material-org','material-facility',?,?)`).run(`patient-${suffix}`, `SYN-MATERIAL-${suffix}`, `Synthetic patient ${suffix}`);
    if (!options.legacyPatients) {
      database.prepare(`insert into patient_profile_versions (id,organization_id,facility_id,patient_id,version,display_name,status,sex_at_birth,created_by_membership_id,change_reason)
        values (?,'material-org','material-facility',?,1,?,'active','not_recorded','member-a','synthetic fixture')`)
        .run(`profile-${suffix}-v1`, `patient-${suffix}`, `Synthetic patient ${suffix}`);
      database.prepare(`insert into patient_profile_heads (id,organization_id,facility_id,patient_id,current_version_id)
        values (?,'material-org','material-facility',?,?)`).run(`profile-head-${suffix}`, `patient-${suffix}`, `profile-${suffix}-v1`);
    }
    database.prepare(`insert into encounters (id,organization_id,facility_id,patient_id,clinician_membership_id,status,reason_for_visit)
      values (?,'material-org','material-facility',?,?,?,'Synthetic clinical content must not escape')`)
      .run(`encounter-${suffix}`, `patient-${suffix}`, `member-${suffix}`, options.encounterStatus ?? 'in_progress');
    if (!options.missingConsents) for (const type of consentTypes) appendConsent(database, clock, type, {}, suffix);
    const provisioned = await credentials.provision({
      credentialId: `credential-${suffix}`, eventId: randomUUID(), normalizedLogin: `synthetic.doctor.${suffix}`, passwordHash: syntheticPasswordHash,
      target: { userId: `doctor-${suffix}`, expectedIssuer: issuer, expectedSubject: `external-individual-${suffix}`, expectedUserVersion: 1 },
      actor: { userId: 'operator', expectedIssuer: issuer, expectedSubject: 'synthetic-operator', expectedUserVersion: 1 },
    });
    expect(provisioned?.userVersion).toBe(2);
    expect(await sessions.create({
      sessionId: `synthetic-session-${suffix}`, tokenHash: tokenHash(suffix), userId: `doctor-${suffix}`,
      expectedUserVersion: 2, expectedIssuer: issuer, expectedSubject: `external-individual-${suffix}`,
    })).not.toBeNull();
  }
  return { ...connection, credentials, path, clock };
}

async function resolved(connection: ReturnType<typeof connect>, suffix: 'a' | 'b' = 'a') {
  const result = await resolveLocalMaterialContext(headers(suffix), selection(suffix), connection);
  expect(result.status).toBe('resolved');
  if (result.status !== 'resolved') throw new Error('Synthetic fixture was not resolved');
  return result;
}

describe('server local-material metadata with full SQL migrations and durable staff sessions', () => {
  it('reads one SQL snapshot and returns frozen minimal per-individual context for two doctors of the same role', async () => {
    const connection = await fixture();
    connection.statements.length = 0;
    const writesBefore = connection.database.prepare('select total_changes() as n').get()?.n;
    const sessionBefore = connection.database.prepare('select version,last_seen_at,idle_expires_at from staff_sessions where token_hash=?').get(tokenHash('a'));
    expect(await connection.contexts.readSnapshot(readInput())).not.toBeNull();
    expect(connection.statements).toHaveLength(1);
    expect(connection.database.prepare('select total_changes() as n').get()?.n).toBe(writesBefore);
    expect(connection.database.prepare('select version,last_seen_at,idle_expires_at from staff_sessions where token_hash=?').get(tokenHash('a'))).toEqual(sessionBefore);
    const a = await resolved(connection);
    const b = await resolved(connection, 'b');
    expect(a.context).toMatchObject({ audience: 'staff', userId: 'doctor-a', issuer, subject: 'external-individual-a', ...selection() });
    expect(b.context.userId).toBe('doctor-b');
    expect(b.context.subject).toBe('external-individual-b');
    expect(a.context.authorizationGeneration).not.toBe(b.context.authorizationGeneration);
    expect(a.observedAt).toBe(connection.clock.now);
    expect(a.versions).toEqual({ user: 2, membership: 1, organization: 1, facility: 1, assignment: 1, department: 1, patient: 1, encounter: 1 });
    for (const value of [a, a.context, a.context.consentVersions, a.versions, a.consents, ...Object.values(a.consents)]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    for (const forbidden of ['Synthetic clinical content', 'Synthetic patient', 'Synthetic doctor', syntheticTokens.a, tokenHash('a'), syntheticPasswordHash]) {
      expect(JSON.stringify(a).includes(forbidden)).toBe(false);
    }
  });

  it('never gives another same-role doctor the owner assignment or encounter', async () => {
    const connection = await fixture();
    expect(await resolveLocalMaterialContext(headers('b'), selection('a'), connection)).toEqual({ status: 'forbidden' });
    expect(await resolveLocalMaterialContext(headers('a'), selection('b'), connection)).toEqual({ status: 'forbidden' });
    expect(await connection.contexts.readSnapshot({ ...readInput(), userId: 'doctor-b' })).toBeNull();
    expect(await connection.contexts.readSnapshot({ ...readInput(), subject: 'external-individual-b' })).toBeNull();
  });

  it('rejects malformed repository identifiers and hashes before sending SQL', async () => {
    const connection = await fixture();
    connection.statements.length = 0;
    for (const bad of [
      { tokenHash: syntheticTokens.a.toUpperCase() }, { tokenHash: 'not-a-hash' },
      { userId: 'doctor-a ' }, { issuer: `${issuer}\u0000` }, { subject: '\ud800' },
      { accessAssignmentId: 'x'.repeat(257) }, { patientId: '' },
    ]) expect(await connection.contexts.readSnapshot({ ...readInput(), ...bad })).toBeNull();
    expect(connection.statements).toHaveLength(0);
  });

  it.each(['facilityId', 'patientId', 'encounterId', 'accessAssignmentId'] as const)('rejects a wrong exact %s without falling back to another scope', async field => {
    const connection = await fixture();
    expect(await resolveLocalMaterialContext(headers(), { ...selection(), [field]: `${selection()[field]}-wrong` }, connection)).toEqual({ status: 'forbidden' });
  });

  it.each(['nurse', 'service'] as const)('does not turn the %s assignment into an interactive doctor context', async role => {
    const connection = await fixture();
    advanceAssignment(connection.database, connection.clock, { roles: [role] });
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
  });

  it('retains the service-role exclusion even for an invalid mixed doctor/service persisted row', async () => {
    const connection = await fixture();
    expect(() => advanceAssignment(connection.database, connection.clock, { roles: ['doctor', 'service'] })).toThrow(/service/);
    // Normal schema rejects the combination. Corruption-only setup verifies the
    // read boundary independently of that write guard in this disposable DB.
    connection.database.exec('drop trigger department_access_assignment_versions_insert_guard');
    advanceAssignment(connection.database, connection.clock, { roles: ['doctor', 'service'] });
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
  });

  it('rejects explicit read denial even while another doctor assignment remains readable', async () => {
    const connection = await fixture();
    advanceAssignment(connection.database, connection.clock, { deny: ['encounter.read'] });
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
    await resolved(connection, 'b');
  });

  it('allows read-only metadata without turning encounter.manage denial into a material grant', async () => {
    const connection = await fixture();
    advanceAssignment(connection.database, connection.clock, { deny: ['encounter.manage'] });
    const result = await resolved(connection);
    expect(result).not.toHaveProperty('canManage');
    expect(result).not.toHaveProperty('canRecord');
  });

  it.each([
    ["update organizations set status='suspended' where id='material-org'", 'organization'],
    ["update facilities set status='suspended' where id='material-facility'", 'facility'],
    ["update memberships set status='disabled' where id='member-a'", 'membership'],
    ["update patients set status='inactive' where id='patient-a'", 'patient'],
  ])('rejects inactive scope: %s (%s)', async sql => {
    const connection = await fixture();
    connection.database.exec(sql);
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
  });

  it('denies an archived current patient profile even when the legacy base patient remains active', async () => {
    const connection = await fixture();
    connection.database.exec(`insert into patient_profile_versions
      (id,organization_id,facility_id,patient_id,version,display_name,status,sex_at_birth,created_by_membership_id,change_reason,supersedes_profile_version_id)
      values ('profile-a-v2','material-org','material-facility','patient-a',2,'Synthetic archived patient','inactive','not_recorded','member-a','synthetic archive','profile-a-v1');
      update patient_profile_heads set current_version_id='profile-a-v2',lock_version=2 where id='profile-head-a';`);
    expect(connection.database.prepare("select status from patients where id='patient-a'").get()?.status).toBe('active');
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
    await resolved(connection, 'b');
  });

  it('never falls back to a base patient when an existing current profile head is malformed', async () => {
    const connection = await fixture();
    // Simulated persisted corruption in this disposable DB only. Normal writes
    // cannot bypass these immutable-head guards; production guards stay intact.
    connection.database.exec(`drop trigger patient_profile_heads_advance_only;
      update patient_profile_heads set lock_version=99 where id='profile-head-a';`);
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
  });

  it('permits an active legacy patient only when no profile head exists at all', async () => {
    const connection = await fixture({ legacyPatients: true });
    const row = await connection.contexts.readSnapshot(readInput());
    expect(row).toMatchObject({ patientVersion: 1, patientVersionId: null });
    expect((await resolved(connection)).versions.patient).toBe(1);
  });

  it('pins the current immutable profile version instead of the unchanged base patient version', async () => {
    const connection = await fixture();
    const before = await resolved(connection);
    connection.database.exec(`insert into patient_profile_versions
      (id,organization_id,facility_id,patient_id,version,display_name,status,sex_at_birth,created_by_membership_id,change_reason,supersedes_profile_version_id)
      values ('profile-a-v2','material-org','material-facility','patient-a',2,'Synthetic revised patient','active','not_recorded','member-a','synthetic revision','profile-a-v1');
      update patient_profile_heads set current_version_id='profile-a-v2',lock_version=2 where id='profile-head-a';`);
    const current = await resolved(connection);
    expect(connection.database.prepare("select version from patients where id='patient-a'").get()?.version).toBe(1);
    expect(current.versions.patient).toBe(2);
    expect(current.context.authorizationGeneration).not.toBe(before.context.authorizationGeneration);
  });

  it('denies a disabled current department version despite an active immutable department root', async () => {
    const connection = await fixture();
    connection.database.prepare(`insert into department_versions
      (id,organization_id,facility_id,department_id,version,supersedes_version_id,name,kind,status,change_reason,changed_by_membership_id,changed_at)
      values ('department-v2','material-org','material-facility','material-department',2,'department-v1','Synthetic department','clinical','disabled','synthetic disable','member-a',?)`)
      .run(connection.clock.now);
    connection.database.exec("update department_heads set current_version_id='department-v2',lock_version=2 where id='department-head'");
    expect(connection.database.prepare("select status from departments where id='material-department'").get()?.status).toBe('active');
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
  });

  it('uses the same SQL clock for future and exact-expiry access decisions', async () => {
    const connection = await fixture();
    advanceAssignment(connection.database, connection.clock, { from: connection.clock.now + 10, until: connection.clock.now + 20 });
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
    connection.clock.now += 10;
    expect((await resolved(connection)).observedAt).toBe(connection.clock.now);
    connection.clock.now += 10;
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'forbidden' });
  });

  it('returns five separate consent decisions and time pins, never consent-derived operation grants', async () => {
    const connection = await fixture();
    appendConsent(connection.database, connection.clock, 'care', { decision: 'denied' });
    appendConsent(connection.database, connection.clock, 'transcript_storage', { decision: 'withdrawn' });
    appendConsent(connection.database, connection.clock, 'audio_retention', { effectiveAt: connection.clock.now + 10 });
    appendConsent(connection.database, connection.clock, 'transient_audio_processing', { expiresAt: connection.clock.now });
    const result = await resolved(connection);
    expect(Object.keys(result.consents).sort()).toEqual([...consentTypes].sort());
    expect(result.consents.care).toMatchObject({ decision: 'denied', version: 2 });
    expect(result.consents.transcript_storage).toMatchObject({ decision: 'withdrawn', version: 2 });
    expect(result.consents.audio_retention).toMatchObject({ decision: 'granted', effectiveByTime: false });
    expect(result.consents.transient_audio_processing).toMatchObject({ decision: 'granted', effectiveByTime: false });
    expect(result.consents.external_ai_processing).toMatchObject({ externalProcessor: 'synthetic-processor', effectiveByTime: true });
    expect(result.context.consentVersions).toEqual({ care: 2, transcriptStorage: 2, audioRetention: 2, transientAudioProcessing: 2, externalAiProcessing: 1 });
    expect(result).not.toHaveProperty('capabilities');
    expect(result).not.toHaveProperty('key');
    expect(result).not.toHaveProperty('canRecord');
  });

  it('keeps missing consent heads explicitly null, including care, without inventing grants', async () => {
    const connection = await fixture({ missingConsents: true });
    const result = await resolved(connection);
    expect(Object.values(result.consents)).toEqual([null, null, null, null, null]);
    expect(Object.values(result.context.consentVersions)).toEqual([null, null, null, null, null]);
  });

  it('fails unavailable for a malformed existing consent head rather than treating it as missing/granted', async () => {
    const connection = await fixture();
    // Corruption-only fixture, never a production schema change.
    connection.database.exec(`drop trigger consent_heads_advance_only;
      update consent_heads set lock_version=99 where id='consent-head-a-care';`);
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'unavailable' });
  });

  it('rejects a schema-valid consent head for the wrong patient within the requested encounter', async () => {
    const connection = await fixture();
    // Separate patient/encounter foreign keys permit this relationship. No guard
    // is removed: the final read must check encounter.patient_id itself.
    connection.database.exec(`insert into consent_events
      (id,organization_id,facility_id,patient_id,encounter_id,version,consent_type,decision,captured_by_membership_id,
       policy_version,policy_hash,notice_language,source,occurred_at,effective_at)
      values ('wrong-patient-care','material-org','material-facility','patient-b','encounter-a',1,'care','granted',
       'member-a','synthetic-policy','synthetic-hash','ru','verbal',1,1);
      insert into consent_heads
      (id,organization_id,facility_id,patient_id,encounter_id,consent_type,current_consent_event_id)
      values ('wrong-patient-head','material-org','material-facility','patient-b','encounter-a','care','wrong-patient-care');`);
    expect(connection.database.prepare('pragma foreign_key_check').all()).toEqual([]);
    expect(await resolveLocalMaterialContext(headers(), selection(), connection)).toEqual({ status: 'unavailable' });
  });

  it('changes the consent fence at DB-clock activation and expiry without a new event version', async () => {
    const connection = await fixture();
    appendConsent(connection.database, connection.clock, 'audio_retention', { effectiveAt: connection.clock.now + 10, expiresAt: connection.clock.now + 20 });
    const future = await resolved(connection);
    expect(future.consents.audio_retention?.effectiveByTime).toBe(false);
    connection.clock.now += 10;
    const active = await resolved(connection);
    expect(active.consents.audio_retention?.effectiveByTime).toBe(true);
    expect(active.context.authorizationGeneration).not.toBe(future.context.authorizationGeneration);
    connection.clock.now += 10;
    const expired = await resolved(connection);
    expect(expired.consents.audio_retention?.effectiveByTime).toBe(false);
    expect(expired.context.authorizationGeneration).not.toBe(active.context.authorizationGeneration);
    expect(expired.context.consentVersions.audioRetention).toBe(active.context.consentVersions.audioRetention);
  });

  it('survives file reopen and independent connections without exposing/storing a raw session token', async () => {
    const initial = await fixture({ disk: true });
    const before = await resolved(initial);
    close(initial.database);
    const reopened = connect(initial.path, initial.clock);
    const independent = connect(initial.path, initial.clock);
    expect(await resolved(reopened)).toEqual(before);
    expect(await resolved(independent)).toEqual(before);
    expect(reopened.database.prepare('pragma foreign_key_check').all()).toEqual([]);
    expect(reopened.database.prepare('pragma quick_check').get()?.quick_check).toBe('ok');
    expect(readFileSync(initial.path).includes(Buffer.from(syntheticTokens.a))).toBe(false);
  });

  it('does not mint a new authorization generation for mere read/touch or observedAt changes', async () => {
    const connection = await fixture();
    const first = await resolved(connection);
    connection.clock.now += 100;
    const next = await resolved(connection);
    expect(next.observedAt).not.toBe(first.observedAt);
    expect(next.context.authorizationGeneration).toBe(first.context.authorizationGeneration);
  });

  it('rejects logout on a second connection between initial authentication and the final SQL snapshot', async () => {
    const initial = await fixture({ disk: true });
    const other = connect(initial.path, initial.clock);
    const result = await resolveLocalMaterialContext(headers(), selection(), {
      sessions: initial.sessions,
      contexts: { readSnapshot: async input => { await other.sessions.revoke(tokenHash('a')); return initial.contexts.readSnapshot(input); } },
    });
    expect(result).toEqual({ status: 'forbidden' });
    await resolved(other, 'b');
  });

  it('rejects credential reset on another connection after initial authentication', async () => {
    const initial = await fixture({ disk: true });
    const other = connect(initial.path, initial.clock);
    const credentials = new D1StaffCredentialRepository(other.d1);
    const result = await resolveLocalMaterialContext(headers(), selection(), {
      sessions: initial.sessions,
      contexts: { readSnapshot: async input => {
        expect(await credentials.reset({
          credentialId: 'credential-a', eventId: randomUUID(), expectedCredentialVersion: 1, passwordHash: syntheticPasswordHash,
          target: { userId: 'doctor-a', expectedIssuer: issuer, expectedSubject: 'external-individual-a', expectedUserVersion: 2 },
          actor: { userId: 'operator', expectedIssuer: issuer, expectedSubject: 'synthetic-operator', expectedUserVersion: 1 },
        })).not.toBeNull();
        return initial.contexts.readSnapshot(input);
      } },
    });
    expect(result).toEqual({ status: 'forbidden' });
    await resolved(other, 'b');
  });

  it('pins a regranted access version instead of resurrecting the old generation', async () => {
    const initial = await fixture({ disk: true });
    const other = connect(initial.path, initial.clock);
    const before = await resolved(initial);
    const result = await resolveLocalMaterialContext(headers(), selection(), {
      sessions: initial.sessions,
      contexts: { readSnapshot: async input => {
        advanceAssignment(other.database, initial.clock, { status: 'revoked' });
        advanceAssignment(other.database, initial.clock, { status: 'active' });
        return initial.contexts.readSnapshot(input);
      } },
    });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('Current regrant not resolved');
    expect(result.versions.assignment).toBe(3);
    expect(result.context.authorizationGeneration).not.toBe(before.context.authorizationGeneration);
  });

  it('changes the generation after versioned membership, organization and facility disable/reactivate cycles', async () => {
    const initial = await fixture({ disk: true });
    const other = connect(initial.path, initial.clock);
    let previous = await resolved(initial);
    const scopes = [
      { table: 'memberships', id: 'member-a', disabled: 'disabled', version: 'membership' },
      { table: 'organizations', id: 'material-org', disabled: 'suspended', version: 'organization' },
      { table: 'facilities', id: 'material-facility', disabled: 'suspended', version: 'facility' },
    ] as const;
    for (const scope of scopes) {
      const current = await resolveLocalMaterialContext(headers(), selection(), {
        sessions: initial.sessions,
        contexts: { readSnapshot: async input => {
          // Trusted fixed fixture table names. The second connection performs an
          // ABA transition with proper epoch advancement before the final read.
          other.database.prepare(`update ${scope.table} set status=?,version=version+1 where id=?`).run(scope.disabled, scope.id);
          other.database.prepare(`update ${scope.table} set status='active',version=version+1 where id=?`).run(scope.id);
          return initial.contexts.readSnapshot(input);
        } },
      });
      expect(current.status).toBe('resolved');
      if (current.status !== 'resolved') throw new Error('Current versioned scope was not resolved');
      expect(current.versions[scope.version]).toBe(3);
      expect(current.context.authorizationGeneration).not.toBe(previous.context.authorizationGeneration);
      previous = current;
    }
  });

  it('reads a replacement consent head from the final query rather than retaining an earlier grant', async () => {
    const initial = await fixture({ disk: true });
    const other = connect(initial.path, initial.clock);
    const before = await resolved(initial);
    const result = await resolveLocalMaterialContext(headers(), selection(), {
      sessions: initial.sessions,
      contexts: { readSnapshot: async input => {
        appendConsent(other.database, initial.clock, 'audio_retention', { decision: 'withdrawn' });
        return initial.contexts.readSnapshot(input);
      } },
    });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('Replacement consent metadata not resolved');
    expect(result.consents.audio_retention).toMatchObject({ decision: 'withdrawn', version: 2 });
    expect(result.context.consentVersions.audioRetention).toBe(2);
    expect(result.context.authorizationGeneration).not.toBe(before.context.authorizationGeneration);
  });

  it('rejects a session expiring after initial authentication and before the final query', async () => {
    const initial = await fixture();
    expect(await resolveLocalMaterialContext(headers(), selection(), {
      sessions: initial.sessions,
      contexts: { readSnapshot: async input => { initial.clock.now += STAFF_SESSION_IDLE_MS; return initial.contexts.readSnapshot(input); } },
    })).toEqual({ status: 'forbidden' });
  });
});
