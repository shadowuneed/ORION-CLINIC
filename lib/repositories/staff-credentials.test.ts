import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { handleStaffLogout, resolveStaffSession, type StaffSessionGrant } from '@/lib/auth/staff-session';
import { handleStaffLogin } from '@/lib/auth/staff-login';
import { hashStaffPassword, verifyStaffPassword } from '@/lib/auth/staff-password';
import { D1StaffCredentialRepository, type StaffCredentialState } from './staff-credentials';
import { D1StaffSessionRepository } from './staff-sessions';

type Operation = { kind: 'first' | 'run' | 'batch'; sql: string };
type Hooks = { before?: (operation: Operation) => void | Promise<void>; after?: (operation: Operation) => void | Promise<void> };
type Clock = { now: number };
type Bound = { sql: string; bindings: SQLInputValue[] };
const opened = new Set<DatabaseSync>();
const temporary: { directory: string; path: string }[] = [];
const issuer = 'orion:individual-staff-test';
const passwordHash = `orion$scrypt$v1$32768$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const replacementHash = `orion$scrypt$v1$32768$8$3$${'c'.repeat(32)}$${'d'.repeat(64)}`;
const tokenHash = 'a1'.repeat(32);

function close(database: DatabaseSync) { database.close(); opened.delete(database); }
afterEach(() => {
  for (const database of opened) database.close();
  opened.clear();
  for (const item of temporary.splice(0)) {
    const directory = resolve(item.directory);
    if (dirname(resolve(item.path)) !== directory || dirname(directory) !== resolve(tmpdir())) throw new Error('Unsafe credential test cleanup');
    for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(item.path + suffix)) unlinkSync(item.path + suffix);
    rmdirSync(directory);
  }
});

function adapter(database: DatabaseSync, hooks: Hooks = {}): D1Database {
  const execute = (bound: Bound): D1Result => {
    // D1's meta.changes is a total_changes() delta, including trigger effects,
    // NOT sqlite statement.run().changes. Lifecycle triggers exercise that difference.
    const before = Number(database.prepare('select total_changes() as n').get()?.n);
    const statement = database.prepare(bound.sql);
    const results = statement.columns().length ? statement.all(...bound.bindings) : (statement.run(...bound.bindings), []);
    const changes = Number(database.prepare('select total_changes() as n').get()?.n) - before;
    return { success: true, results, meta: { changes } } as D1Result;
  };
  const prepare = (sql: string, bindings: SQLInputValue[] = []): D1PreparedStatement => ({
    sql, bindings,
    bind(...values: unknown[]) { return prepare(sql, values as SQLInputValue[]); },
    async first<T>() {
      const operation = { kind: 'first', sql } as const;
      await hooks.before?.(operation);
      const value = database.prepare(sql).get(...bindings) as T | undefined;
      await hooks.after?.(operation);
      return value ?? null;
    },
    async run() {
      const operation = { kind: 'run', sql } as const;
      await hooks.before?.(operation);
      const value = execute({ sql, bindings });
      await hooks.after?.(operation);
      return value;
    },
    async all() { return execute({ sql, bindings }); },
  } as unknown as D1PreparedStatement);
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const bound = statements as unknown as Bound[];
      const operation = { kind: 'batch', sql: bound.map(value => value.sql).join('\n') } as const;
      await hooks.before?.(operation);
      database.exec('begin immediate');
      let result: D1Result[];
      try { result = bound.map(execute); database.exec('commit'); }
      catch (error) { database.exec('rollback'); throw error; }
      await hooks.after?.(operation);
      return result;
    },
  } as unknown as D1Database;
}

function connect(path: string, clock: Clock, hooks?: Hooks) {
  const database = new DatabaseSync(path);
  opened.add(database);
  database.exec('pragma foreign_keys = on');
  database.function('unixepoch', { varargs: true }, (...args: SQLInputValue[]) => args[0] === 'subsec' ? clock.now / 1000 : Math.floor(clock.now / 1000));
  const d1 = adapter(database, hooks);
  return { database, d1, repository: new D1StaffCredentialRepository(d1), sessions: new D1StaffSessionRepository(d1) };
}

function fixture(disk = false, hooks?: Hooks) {
  let path = ':memory:';
  if (disk) {
    const directory = mkdtempSync(join(tmpdir(), 'orion-staff-credential-test-'));
    path = join(directory, 'credentials.sqlite'); temporary.push({ directory, path });
  }
  const clock = { now: Date.UTC(2026, 8, 24, 12) };
  const connection = connect(path, clock, hooks);
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    connection.database.exec(readFileSync(join('drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  for (const id of ['operator', 'doctor-a', 'doctor-b']) {
    connection.database.prepare("insert into users (id,external_issuer,external_subject,display_name,status) values (?,?,?,?,'active')")
      .run(id, issuer, id, `Synthetic ${id}`);
  }
  return { ...connection, path, clock };
}

function grant(userId = 'doctor-a', expectedUserVersion = 1): StaffSessionGrant {
  return { userId, expectedUserVersion, expectedIssuer: issuer, expectedSubject: userId };
}
function provision(userId = 'doctor-a') {
  return { credentialId: `credential-${userId}`, eventId: randomUUID(), target: grant(userId), actor: grant('operator'), normalizedLogin: `${userId}@example.test`, passwordHash };
}
function change(state: StaffCredentialState) {
  return { credentialId: state.credentialId, eventId: randomUUID(), target: grant(state.userId, state.userVersion), actor: grant('operator'), expectedCredentialVersion: state.credentialVersion };
}
async function enroll(repository: D1StaffCredentialRepository, userId = 'doctor-a') {
  const state = await repository.provision(provision(userId)); expect(state).not.toBeNull(); return state!;
}
async function reserve(repository: D1StaffCredentialRepository, login = 'doctor-a@example.test') {
  const result = await repository.reserveAttempt(login, randomUUID());
  expect(result.status).toBe('reserved'); if (result.status !== 'reserved') throw new Error('Fixture admission failed'); return result;
}
function count(database: DatabaseSync, table: 'staff_credentials' | 'staff_credential_events' | 'staff_login_attempts') {
  return Number(database.prepare(`select count(*) as n from ${table}`).get()?.n);
}

describe('durable individual staff credentials, full migrations and real SQL', () => {
  it('provisions two individual users, returns no password hash in lifecycle state and audits only bounded metadata', async () => {
    const { repository, database } = fixture();
    const a = await enroll(repository); const b = await enroll(repository, 'doctor-b');
    expect(a).toEqual({ credentialId: 'credential-doctor-a', userId: 'doctor-a', normalizedLogin: 'doctor-a@example.test', status: 'active', credentialVersion: 1, userVersion: 2 });
    expect(b.userId).not.toBe(a.userId);
    expect(count(database, 'staff_credential_events')).toBe(2);
    const audit = database.prepare('select * from staff_credential_events').all();
    expect(audit[0]).toMatchObject({ actor_id: 'operator', action: 'provision', previous_version: 0, version: 1, user_version: 2 });
    expect(JSON.stringify(audit)).not.toContain(passwordHash);
    expect(JSON.stringify(a)).not.toContain(passwordHash);
    const attempt = await reserve(repository);
    expect(attempt.credential).toEqual({ passwordHash, credentialVersion: 1 });
    const verified = await repository.finishAttempt(attempt.attemptId, 'success', 1);
    expect(verified).toEqual(grant('doctor-a', 2));
    expect(await repository.finishAttempt(attempt.attemptId, 'success', 1)).toBeNull();
  });

  it('survives file close/reopen and preserves admissions and identity on a second connection', async () => {
    const first = fixture(true); await enroll(first.repository);
    const pending = await reserve(first.repository);
    close(first.database);
    const reopened = connect(first.path, first.clock); const second = connect(first.path, first.clock);
    expect(await second.repository.finishAttempt(pending.attemptId, 'success', 1)).toEqual(grant('doctor-a', 2));
    for (let n = 0; n < 4; n++) await reserve(reopened.repository);
    expect(await second.repository.reserveAttempt('doctor-a@example.test', randomUUID())).toEqual({ status: 'throttled', retryAfterSeconds: 300 });
    expect(reopened.database.prepare('pragma foreign_key_check').all()).toEqual([]);
    expect(reopened.database.prepare('pragma quick_check').get()?.quick_check).toBe('ok');
  });

  it('admits only five concurrent reservations across two connections before any verifier result exists', async () => {
    const first = fixture(true); await enroll(first.repository);
    const second = connect(first.path, first.clock);
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).repository.reserveAttempt('doctor-a@example.test', randomUUID())));
    expect(results.filter(value => value.status === 'reserved')).toHaveLength(5);
    expect(results.filter(value => value.status === 'throttled')).toHaveLength(7);
    expect(first.database.prepare("select count(*) as n from staff_login_attempts where status = 'pending'").get()?.n).toBe(5);
  });

  it('counts success, failure and abandonment equally and releases capacity exactly at the rolling window boundary', async () => {
    const { repository, clock } = fixture(); await enroll(repository);
    const first = await reserve(repository); await repository.finishAttempt(first.attemptId, 'success', 1);
    const second = await reserve(repository); await repository.finishAttempt(second.attemptId, 'failure');
    for (let n = 0; n < 3; n++) await reserve(repository);
    clock.now += 299999;
    expect(await repository.reserveAttempt('doctor-a@example.test', randomUUID())).toEqual({ status: 'throttled', retryAfterSeconds: 1 });
    clock.now += 1;
    expect((await reserve(repository)).credential?.credentialVersion).toBe(1);
  });

  it.each(['unknown', 'disabled', 'invited', 'stale-user'])('reserves and throttles %s identities without exposing credentials or a grant', async mode => {
    const { repository, database } = fixture(); const state = await enroll(repository);
    let login = state.normalizedLogin;
    if (mode === 'unknown') login = 'unknown@example.test';
    if (mode === 'disabled') await repository.disable(change(state));
    if (mode === 'invited') database.exec("update users set status='invited', version=version+1 where id='doctor-a'");
    if (mode === 'stale-user') database.exec("update users set version=version+1 where id='doctor-a'");
    for (let n = 0; n < 5; n++) {
      const attempt = await reserve(repository, login); expect(attempt.credential).toBeNull();
      expect(await repository.finishAttempt(attempt.attemptId, 'success', 1)).toBeNull();
    }
    expect((await repository.reserveAttempt(login, randomUUID())).status).toBe('throttled');
  });

  it.each([119999, 120000, 120001])('uses the database reservation deadline at %i milliseconds', async offset => {
    const { repository, clock } = fixture(); await enroll(repository);
    const attempt = await reserve(repository); clock.now += offset;
    const result = await repository.finishAttempt(attempt.attemptId, 'success', 1);
    expect(result).toEqual(offset < 120000 ? grant('doctor-a', 2) : null);
  });

  it('binds completion to the reserved credential version and consumes unsuccessful completions', async () => {
    const { repository } = fixture(); await enroll(repository);
    const attempt = await reserve(repository);
    expect(await repository.finishAttempt(attempt.attemptId, 'success', 99)).toBeNull();
    expect(await repository.finishAttempt(attempt.attemptId, 'success', 1)).toBeNull();
    const noVersion = await reserve(repository);
    expect(await repository.finishAttempt(noVersion.attemptId, 'success')).toBeNull();
    expect(await repository.finishAttempt('missing-attempt', 'success', 1)).toBeNull();
  });

  it.each(['reset', 'disable'] as const)('%s atomically advances user epoch, revokes sessions and rejects pre-change verification/grants', async action => {
    const { repository, sessions, database } = fixture(); const state = await enroll(repository);
    const verifiedAttempt = await reserve(repository);
    const oldGrant = await repository.finishAttempt(verifiedAttempt.attemptId, 'success', 1);
    await sessions.create({ ...oldGrant!, sessionId: randomUUID(), tokenHash });
    const pending = await reserve(repository);
    const updated = action === 'reset' ? await repository.reset({ ...change(state), passwordHash: replacementHash }) : await repository.disable(change(state));
    expect(updated).toMatchObject({ credentialVersion: 2, userVersion: 3, status: action === 'reset' ? 'active' : 'disabled' });
    expect(await sessions.resolve(tokenHash)).toBeNull();
    expect(await sessions.create({ ...oldGrant!, sessionId: randomUUID(), tokenHash: 'b2'.repeat(32) })).toBeNull();
    expect(await repository.finishAttempt(pending.attemptId, 'success', 1)).toBeNull();
    expect(database.prepare("select status,version from users where id='doctor-a'").get()).toEqual({ status: 'active', version: 3 });
    expect(count(database, 'staff_credential_events')).toBe(2);
  });

  it('reactivates only by explicit versioned reset; old hashes, reservations and grants never revive', async () => {
    const { repository, sessions } = fixture(); const state = await enroll(repository);
    const pending = await reserve(repository);
    const disabled = await repository.disable(change(state));
    const reset = await repository.reset({ ...change(disabled!), passwordHash: replacementHash });
    expect(reset).toMatchObject({ credentialVersion: 3, userVersion: 4, status: 'active' });
    expect(await repository.finishAttempt(pending.attemptId, 'success', 1)).toBeNull();
    expect(await sessions.create({ ...grant('doctor-a', 2), sessionId: randomUUID(), tokenHash })).toBeNull();
    const fresh = await reserve(repository);
    expect(fresh.credential).toEqual({ passwordHash: replacementHash, credentialVersion: 3 });
    expect(await repository.finishAttempt(fresh.attemptId, 'success', 3)).toEqual(grant('doctor-a', 4));
  });

  it('returns a successful reset with D1 total_changes metadata including audit, user epoch and multiple revocations', async () => {
    const { repository, database, sessions } = fixture(); const state = await enroll(repository);
    for (const suffix of ['a1', 'b2', 'c3']) {
      expect(await sessions.create({ ...grant('doctor-a', 2), sessionId: randomUUID(), tokenHash: suffix.repeat(32) })).not.toBeNull();
    }
    const before = Number(database.prepare('select total_changes() as n').get()?.n);
    expect(await repository.reset({ ...change(state), passwordHash: replacementHash })).toMatchObject({ credentialVersion: 2, userVersion: 3 });
    expect(Number(database.prepare('select total_changes() as n').get()?.n) - before).toBe(6);
    expect(database.prepare('select count(*) as n from staff_sessions where revoked_at is not null').get()?.n).toBe(3);
  });

  it('rejects stale target/actor, forged subject, duplicate user/login and noncanonical hash/login without changes', async () => {
    const { repository, database } = fixture(); const input = provision();
    for (const bad of [
      { ...input, target: grant('doctor-a', 2) }, { ...input, actor: grant('operator', 2) },
      { ...input, target: { ...input.target, expectedSubject: 'doctor-b' } },
      { ...input, normalizedLogin: 'Doctor-A@example.test' }, { ...input, normalizedLogin: ' abc' },
      { ...input, passwordHash: `${passwordHash}\n` }, { ...input, passwordHash: 'plaintext' },
    ]) expect(await repository.provision(bad)).toBeNull();
    expect(count(database, 'staff_credentials')).toBe(0);
    const state = await enroll(repository);
    expect(await repository.provision({ ...provision('doctor-b'), normalizedLogin: state.normalizedLogin })).toBeNull();
    expect(await repository.provision({ ...provision(), target: grant('doctor-a', 2), credentialId: 'different-id' })).toBeNull();
    expect(await repository.reset({ ...change(state), expectedCredentialVersion: 7, passwordHash: replacementHash })).toBeNull();
    database.exec("update users set status='disabled' where id='operator'");
    expect(await repository.disable(change(state))).toBeNull();
    expect(count(database, 'staff_credential_events')).toBe(1);
  });

  it('rejects reservation id replay and noncanonical normalized login rather than resetting capacity', async () => {
    const { repository, database } = fixture(); await enroll(repository);
    const attempt = await reserve(repository);
    await expect(repository.reserveAttempt('doctor-a@example.test', attempt.attemptId)).rejects.toThrow();
    await expect(repository.reserveAttempt('Doctor-A@example.test', randomUUID())).rejects.toThrow();
    await expect(repository.reserveAttempt('doctor-a@example.test\n', randomUUID())).rejects.toThrow();
    expect(count(database, 'staff_login_attempts')).toBe(1);
  });

  it('fences credential and audit REPLACE/delete, epoch regression and real user REPLACE while preserving ignored bootstrap', async () => {
    const { repository, database } = fixture(); await enroll(repository);
    expect(() => database.exec('insert or replace into staff_credentials select * from staff_credentials')).toThrow();
    expect(() => database.exec('insert or replace into staff_credential_events select * from staff_credential_events')).toThrow();
    expect(() => database.exec('delete from staff_credentials')).toThrow();
    expect(() => database.exec('delete from staff_credential_events')).toThrow();
    expect(() => database.exec("update users set version=1 where id='doctor-a'")).toThrow();
    expect(() => database.exec("update users set status='disabled' where id='doctor-a'")).toThrow();
    expect(() => database.exec("insert or replace into users select * from users where id='doctor-a'")).toThrow();
    database.exec("insert or ignore into users (id,external_issuer,external_subject,display_name,status,version) values ('doctor-a','other','other','Ignored','disabled',1)");
    expect((await reserve(repository)).credential?.credentialVersion).toBe(1);
    expect(database.prepare("select version from users where id='doctor-a'").get()?.version).toBe(2);
  });

  it('fences direct SQL reservation tampering, terminal replay, replacement, deletion and capacity bypass', async () => {
    const { repository, database, clock } = fixture(); await enroll(repository);
    const pending = await reserve(repository);
    expect(() => database.exec('update staff_login_attempts set credential_version=999')).toThrow();
    expect(() => database.exec('insert or replace into staff_login_attempts select * from staff_login_attempts')).toThrow();
    expect(() => database.exec('delete from staff_login_attempts')).toThrow();
    await repository.finishAttempt(pending.attemptId, 'failure');
    expect(() => database.exec("update staff_login_attempts set status='pending',completed_at=null")).toThrow();
    for (let n = 0; n < 4; n++) await reserve(repository);
    expect(() => database.prepare("insert into staff_login_attempts (id,login_normalized,created_at,expires_at,status) values (?,'doctor-a@example.test',?,?,'pending')")
      .run(randomUUID(), clock.now, clock.now + 120000)).toThrow();
  });

  it.each([0, 1])('blocks UPDATE OR REPLACE user-id/unique-identity collisions and stale grant resurrection with recursive_triggers=%i', async recursive => {
    const { repository, database, sessions } = fixture(); const state = await enroll(repository);
    database.exec(`pragma recursive_triggers = ${recursive}`);
    for (const id of ['spare-b', 'spare-c']) {
      database.prepare("insert into users (id,external_issuer,external_subject,display_name,status) values (?,?,?,?,'active')")
        .run(id, issuer, id, 'Synthetic spare');
    }
    const ready = await reserve(repository);
    const verified = await repository.finishAttempt(ready.attemptId, 'success', 1);
    expect(verified).toEqual(grant('doctor-a', 2));
    expect(await sessions.create({ ...verified!, sessionId: randomUUID(), tokenHash })).not.toBeNull();
    const pending = await reserve(repository);
    // Original reported bypass: source has no credential; displaced target does.
    expect(() => database.prepare("update or replace users set id='doctor-a',external_issuer=?,external_subject='doctor-a',status='disabled',version=2 where id='spare-b'")
      .run(issuer)).toThrow();
    expect(database.prepare("select status,version from users where id='doctor-a'").get()).toEqual({ status: 'active', version: 2 });
    expect(await sessions.resolve(tokenHash)).not.toBeNull(); // Denied SQL did not silently disable anything.
    // A real credential disable revokes the old token and advances its epoch.
    expect(await repository.disable(change(state))).toMatchObject({ credentialVersion: 2, userVersion: 3 });
    expect(() => database.prepare("update or replace users set id='doctor-a',external_issuer=?,external_subject='doctor-a',status='active',version=2 where id='spare-c'")
      .run(issuer)).toThrow();
    // A collision through the unique issuer/subject also cannot remove the
    // referenced target user (FK enabled), even without changing the source id.
    expect(() => database.prepare("update or replace users set external_issuer=?,external_subject='doctor-a' where id='spare-b'")
      .run(issuer)).toThrow();
    expect(await sessions.resolve(tokenHash)).toBeNull();
    expect(await sessions.create({ ...verified!, sessionId: randomUUID(), tokenHash: 'd4'.repeat(32) })).toBeNull();
    expect(await repository.finishAttempt(pending.attemptId, 'success', 1)).toBeNull();
    expect(database.prepare("select version from users where id='doctor-a'").get()?.version).toBe(3);
    expect(database.prepare("select count(*) as n from users where id in ('spare-b','spare-c')").get()?.n).toBe(2);
    expect(count(database, 'staff_credential_events')).toBe(2);
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it.each(['audit', 'epoch', 'session'] as const)('rolls back the entire reset when %s publication is silently ignored', async stage => {
    const { repository, database, sessions } = fixture(); const state = await enroll(repository);
    await sessions.create({ ...grant('doctor-a', 2), sessionId: randomUUID(), tokenHash });
    const target = stage === 'audit' ? 'before insert on staff_credential_events' : stage === 'epoch' ? 'before update on users' : 'before update on staff_sessions';
    database.exec(`create trigger injected_ignore ${target} begin select raise(ignore); end;`);
    await expect(repository.reset({ ...change(state), passwordHash: replacementHash })).rejects.toThrow();
    expect(database.prepare('select version,password_hash from staff_credentials').get()).toEqual({ version: 1, password_hash: passwordHash });
    expect(database.prepare("select version from users where id='doctor-a'").get()?.version).toBe(2);
    expect(count(database, 'staff_credential_events')).toBe(1);
    expect(database.prepare('select revoked_at from staff_sessions').get()?.revoked_at).toBeNull();
  });

  it('denies completion when reset wins immediately before its SQL update on another connection', async () => {
    const first = fixture(true); const state = await enroll(first.repository); const pending = await reserve(first.repository);
    const second = connect(first.path, first.clock);
    let raced = false;
    const racing = new D1StaffCredentialRepository(adapter(first.database, { before: async operation => {
      if (!raced && operation.kind === 'run' && operation.sql.includes('update staff_login_attempts')) {
        raced = true; await second.repository.reset({ ...change(state), passwordHash: replacementHash });
      }
    } }));
    expect(await racing.finishAttempt(pending.attemptId, 'success', 1)).toBeNull(); expect(raced).toBe(true);
  });

  it('does not release a grant when disable wins after completion commit but before its final read', async () => {
    const first = fixture(true); const state = await enroll(first.repository); const pending = await reserve(first.repository);
    const second = connect(first.path, first.clock);
    let raced = false;
    const racing = new D1StaffCredentialRepository(adapter(first.database, { after: async operation => {
      if (!raced && operation.kind === 'run' && operation.sql.includes('update staff_login_attempts')) {
        raced = true; await second.repository.disable(change(state));
      }
    } }));
    expect(await racing.finishAttempt(pending.attemptId, 'success', 1)).toBeNull(); expect(raced).toBe(true);
  });

  it('linearizes competing resets from two connections with only one new hash/epoch/audit winner', async () => {
    const first = fixture(true); const state = await enroll(first.repository); const second = connect(first.path, first.clock);
    const outcomes = await Promise.all([
      first.repository.reset({ ...change(state), passwordHash: replacementHash }),
      second.repository.reset({ ...change(state), passwordHash }),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(count(first.database, 'staff_credential_events')).toBe(2);
    expect(first.database.prepare("select version from users where id='doctor-a'").get()?.version).toBe(3);
  });

  it('propagates database I/O and rolls back an aborted audit, never returning a credential grant', async () => {
    const { repository, database } = fixture(); const state = await enroll(repository);
    database.exec("create trigger injected_failure before insert on staff_credential_events begin select raise(abort,'synthetic storage failure'); end;");
    await expect(repository.disable(change(state))).rejects.toThrow();
    expect(count(database, 'staff_credential_events')).toBe(1);
    const failed = new D1StaffCredentialRepository(adapter(database, { before: () => { throw new Error('Synthetic DB unavailable'); } }));
    await expect(failed.reserveAttempt('doctor-a@example.test', randomUUID())).rejects.toThrow('Synthetic DB unavailable');
    await expect(failed.finishAttempt(randomUUID(), 'success', 1)).rejects.toThrow('Synthetic DB unavailable');
  });

  it('performs real password login, cookie resolution, file reopen and logout across two independent staff identities', async () => {
    const first = fixture(true);
    const syntheticPassword = 'Synthetic-only passphrase 2026!';
    const encoded = await hashStaffPassword(syntheticPassword);
    for (const userId of ['doctor-a', 'doctor-b']) {
      expect(await first.repository.provision({ ...provision(userId), passwordHash: encoded })).not.toBeNull();
    }
    const origin = 'https://staff.example.test';
    const cookies: string[] = [];
    for (const userId of ['doctor-a', 'doctor-b']) {
      const response = await handleStaffLogin(new Request(`${origin}/staff/login`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ login: `${userId}@example.test`, password: syntheticPassword }),
      }), { credentials: first.repository, sessions: first.sessions }, { origin });
      expect(response.status).toBe(204);
      const setCookie = response.headers.get('set-cookie')!;
      expect(setCookie).toContain('; HttpOnly; Secure; SameSite=Strict;');
      const cookie = setCookie.split(';')[0]; cookies.push(cookie);
      expect((await resolveStaffSession(new Headers({ Cookie: cookie }), first.sessions))?.userId).toBe(userId);
    }
    expect(cookies[0]).not.toBe(cookies[1]);
    close(first.database);
    const reopened = connect(first.path, first.clock); const second = connect(first.path, first.clock);
    for (const connection of [reopened, second]) {
      expect((await resolveStaffSession(new Headers({ Cookie: cookies[0] }), connection.sessions))?.userId).toBe('doctor-a');
      expect((await resolveStaffSession(new Headers({ Cookie: cookies[1] }), connection.sessions))?.userId).toBe('doctor-b');
    }
    const logout = await handleStaffLogout(new Request(`${origin}/staff/logout`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookies[0], 'Sec-Fetch-Site': 'same-origin' },
    }), reopened.sessions, { origin });
    expect(logout.status).toBe(204);
    for (const connection of [reopened, second]) {
      expect(await resolveStaffSession(new Headers({ Cookie: cookies[0] }), connection.sessions)).toBeNull();
      expect((await resolveStaffSession(new Headers({ Cookie: cookies[1] }), connection.sessions))?.userId).toBe('doctor-b');
    }
    const bytes = readFileSync(first.path);
    expect(bytes.includes(Buffer.from(syntheticPassword))).toBe(false);
    for (const cookie of cookies) expect(bytes.includes(Buffer.from(cookie.split('=')[1]))).toBe(false);
    expect(reopened.database.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it('withholds the cookie when a real-password verification overlaps reset on a second connection', async () => {
    const first = fixture(true); const second = connect(first.path, first.clock);
    const syntheticPassword = 'Synthetic reset-race passphrase!';
    const state = await first.repository.provision({ ...provision(), passwordHash: await hashStaffPassword(syntheticPassword) });
    let reachedVerifier: () => void = () => {};
    let releaseVerifier: () => void = () => {};
    const reached = new Promise<void>(resolve => { reachedVerifier = resolve; });
    const release = new Promise<void>(resolve => { releaseVerifier = resolve; });
    const origin = 'https://staff.example.test';
    const pending = handleStaffLogin(new Request(`${origin}/staff/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'doctor-a@example.test', password: syntheticPassword }),
    }), {
      credentials: first.repository, sessions: first.sessions,
      verifyPassword: async (password, encoded) => {
        const matched = await verifyStaffPassword(password, encoded);
        reachedVerifier(); await release; return matched;
      },
    }, { origin });
    await reached;
    expect(count(first.database, 'staff_login_attempts')).toBe(1);
    await second.repository.reset({ ...change(state!), passwordHash: replacementHash });
    releaseVerifier();
    const response = await pending;
    expect(response.status).toBe(401); expect(response.headers.has('set-cookie')).toBe(false);
    expect(first.database.prepare('select status from staff_login_attempts').get()?.status).toBe('failed');
    expect(first.database.prepare('select count(*) as n from staff_sessions').get()?.n).toBe(0);
  });
});
