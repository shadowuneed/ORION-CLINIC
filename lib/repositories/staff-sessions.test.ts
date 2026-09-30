import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  handleStaffLogout,
  issueStaffSession,
  resolveStaffSession,
  STAFF_SESSION_ABSOLUTE_MS,
  STAFF_SESSION_COOKIE,
  STAFF_SESSION_IDLE_MS,
} from '@/lib/auth/staff-session';
import { D1StaffSessionRepository } from './staff-sessions';

type Clock = { now: number };
type Operation = { kind: 'first' | 'all' | 'run' | 'batch'; sql: string };
type Hooks = {
  before?: (operation: Operation) => void | Promise<void>;
  after?: (operation: Operation) => void | Promise<void>;
};
type BoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

const opened = new Set<DatabaseSync>();
const temporaryDatabases: { directory: string; path: string }[] = [];
const issuer = 'orion:staff-test';
// Valid bearer-token shape, but deterministic synthetic test material only.
const rawTokenA = 'a1'.repeat(32);
const rawTokenB = 'b2'.repeat(32);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenHashA = hash(rawTokenA);
const tokenHashB = hash(rawTokenB);

function close(database: DatabaseSync) {
  database.close();
  opened.delete(database);
}

afterEach(() => {
  for (const database of opened) database.close();
  opened.clear();
  for (const item of temporaryDatabases.splice(0)) {
    // Remove only exact files created inside this test's unique temp directory.
    // No recursive deletion and no workspace/working-D1 paths are involved.
    const directory = resolve(item.directory);
    if (dirname(resolve(item.path)) !== directory || dirname(directory) !== resolve(tmpdir())) {
      throw new Error('Refusing cleanup outside the isolated staff-session fixture');
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const path = `${item.path}${suffix}`;
      if (existsSync(path)) unlinkSync(path);
    }
    rmdirSync(directory);
  }
});

function result<T>(results: T[], changes = 0): D1Result<T> {
  return { success: true, results, meta: { changes } } as unknown as D1Result<T>;
}

function createD1Adapter(database: DatabaseSync, hooks: Hooks = {}): D1Database {
  const execute = <T>(sql: string, bindings: SQLInputValue[]) => {
    const statement = database.prepare(sql);
    if (statement.columns().length) {
      const rows = statement.all(...bindings) as T[];
      return result(rows, Number(database.prepare('select changes() as n').get()?.n ?? 0));
    }
    return result<T>([], Number(statement.run(...bindings).changes));
  };
  const prepare = (sql: string, bindings: SQLInputValue[] = []): BoundStatement => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return prepare(sql, values as SQLInputValue[]) as unknown as D1PreparedStatement;
    },
    async first<T = unknown>(column?: string) {
      const operation = { kind: 'first', sql } as const;
      await hooks.before?.(operation);
      const row = database.prepare(sql).get(...bindings) as Record<string, T> | undefined;
      await hooks.after?.(operation);
      return row ? column ? row[column] ?? null : row as T : null;
    },
    async all<T = unknown>() {
      const operation = { kind: 'all', sql } as const;
      await hooks.before?.(operation);
      const response = execute<T>(sql, bindings);
      await hooks.after?.(operation);
      return response;
    },
    async run<T = unknown>() {
      const operation = { kind: 'run', sql } as const;
      await hooks.before?.(operation);
      const response = execute<T>(sql, bindings);
      await hooks.after?.(operation);
      return response;
    },
    async raw<T = unknown>() {
      return database.prepare(sql).all(...bindings).map(row => Object.values(row)) as T[];
    },
  });
  return {
    prepare: (sql: string) => prepare(sql) as unknown as D1PreparedStatement,
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const bound = statements as unknown as BoundStatement[];
      const operation = { kind: 'batch', sql: bound.map(statement => statement.sql).join('\n') } as const;
      await hooks.before?.(operation);
      database.exec('begin immediate');
      let responses: D1Result<T>[];
      try {
        // D1 batch is atomic: hooks cannot interleave another connection mid-batch.
        responses = bound.map(statement => execute<T>(statement.sql, statement.bindings));
        database.exec('commit');
      } catch (error) {
        database.exec('rollback');
        throw error;
      }
      await hooks.after?.(operation);
      return responses;
    },
    async exec(sql: string) {
      database.exec(sql);
      return { count: 0, duration: 0 };
    },
    withSession() { throw new Error('D1 read replication is outside this SQLite test adapter'); },
    dump() { throw new Error('Dump is not used by staff-session tests'); },
  } as unknown as D1Database;
}

function connect(path: string, clock: Clock, hooks?: Hooks) {
  const database = new DatabaseSync(path);
  opened.add(database);
  database.exec('pragma foreign_keys = on');
  // Shadow only this isolated SQLite connection's clock. The repository still
  // executes its actual SQL clock expression; no request/test now parameter exists.
  database.function('unixepoch', { varargs: true }, (...arguments_: SQLInputValue[]) =>
    arguments_[0] === 'subsec' ? clock.now / 1000 : Math.floor(clock.now / 1000));
  const d1 = createD1Adapter(database, hooks);
  return { database, d1, repository: new D1StaffSessionRepository(d1) };
}

function fixture(options: { disk?: boolean; hooks?: Hooks } = {}) {
  let path = ':memory:';
  if (options.disk) {
    const directory = mkdtempSync(join(tmpdir(), 'orion-staff-session-test-'));
    path = join(directory, 'staff-sessions.sqlite');
    temporaryDatabases.push({ directory, path });
  }
  const clock = { now: Date.UTC(2026, 8, 24, 12) };
  const connection = connect(path, clock, options.hooks);
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    connection.database.exec(readFileSync(join('drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  connection.database.exec(`
    insert into organizations (id, name) values ('org-session-test', 'Synthetic session clinic');
    insert into facilities (id, organization_id, name)
      values ('facility-session-test', 'org-session-test', 'Synthetic session facility');
  `);
  for (const suffix of ['a', 'b']) {
    connection.database.prepare(`insert into users
      (id, external_issuer, external_subject, email_normalized, display_name, status)
      values (?, ?, ?, ?, ?, 'active')`).run(
      `doctor-${suffix}`, issuer, `individual-doctor-${suffix}`, `doctor-${suffix}@example.test`, `Synthetic Doctor ${suffix.toUpperCase()}`,
    );
    connection.database.prepare(`insert into memberships
      (id, organization_id, facility_id, user_id, role, status)
      values (?, 'org-session-test', 'facility-session-test', ?, 'clinician', 'active')`)
      .run(`membership-doctor-${suffix}`, `doctor-${suffix}`);
  }
  return { ...connection, path, clock };
}

function grant(suffix: 'a' | 'b' = 'a', tokenHash = suffix === 'a' ? tokenHashA : tokenHashB) {
  return {
    sessionId: randomUUID(), tokenHash, userId: `doctor-${suffix}`, expectedUserVersion: 1,
    expectedIssuer: issuer, expectedSubject: `individual-doctor-${suffix}`,
  };
}

function sessionCount(database: DatabaseSync) {
  return Number(database.prepare('select count(*) as n from staff_sessions').get()?.n);
}

describe('D1 staff-session foundation with full SQLite migrations', () => {
  it('keeps two doctors with the same role as distinct individual principals', async () => {
    const { database, repository, clock } = fixture();
    const commandA = grant('a');
    const commandB = grant('b');
    const sessionA = await repository.create(commandA);
    const sessionB = await repository.create(commandB);
    expect(sessionA).toEqual({
      sessionId: commandA.sessionId, userId: 'doctor-a', displayName: 'Synthetic Doctor A',
      principal: { issuer, subject: 'individual-doctor-a', email: 'doctor-a@example.test' },
      createdAt: clock.now, lastSeenAt: clock.now,
      idleExpiresAt: clock.now + STAFF_SESSION_IDLE_MS,
      absoluteExpiresAt: clock.now + STAFF_SESSION_ABSOLUTE_MS,
    });
    expect(sessionB?.principal.subject).toBe('individual-doctor-b');
    expect(sessionB?.userId).toBe('doctor-b');
    expect(await repository.resolve(tokenHashA)).toEqual(sessionA);
    expect(await repository.resolve(tokenHashB)).toEqual(sessionB);
    expect(database.prepare('select distinct role from memberships').all()).toEqual([{ role: 'clinician' }]);
    expect(sessionA).not.toHaveProperty('role');
    expect(sessionB).not.toHaveProperty('roles');
  });

  it('survives file close/reopen and resolves consistently from two connections without storing raw tokens', async () => {
    const original = fixture({ disk: true });
    const created = await original.repository.create(grant());
    const stored = original.database.prepare('select * from staff_sessions').get();
    expect(stored?.token_hash).toBe(tokenHashA);
    expect(stored).not.toHaveProperty('token');
    expect(stored).not.toHaveProperty('raw_token');
    expect(JSON.stringify(stored)).not.toContain(rawTokenA);
    expect(JSON.stringify(created)).not.toContain(tokenHashA);
    expect(JSON.stringify(created)).not.toContain(rawTokenA);
    close(original.database);
    const reopened = connect(original.path, original.clock);
    const independent = connect(original.path, original.clock);
    expect(await reopened.repository.resolve(tokenHashA)).toEqual(created);
    expect(await independent.repository.resolve(tokenHashA)).toEqual(created);
    expect(reopened.database.prepare('pragma foreign_key_check').all()).toEqual([]);
    expect(reopened.database.prepare('pragma quick_check').get()?.quick_check).toBe('ok');
    expect(readFileSync(original.path).includes(Buffer.from(rawTokenA))).toBe(false);
  });

  it('shares terminal single-session revocation across connections without revoking another staff member', async () => {
    const first = fixture({ disk: true });
    const second = connect(first.path, first.clock);
    await first.repository.create(grant('a'));
    await second.repository.create(grant('b'));
    await second.repository.revoke(tokenHashA);
    await second.repository.revoke(tokenHashA);
    expect(await first.repository.resolve(tokenHashA)).toBeNull();
    expect(await first.repository.resolve(tokenHashB)).toMatchObject({ userId: 'doctor-b' });
    expect(first.database.prepare('select revoked_at from staff_sessions where token_hash = ?').get(tokenHashA)?.revoked_at).toBe(first.clock.now);
    expect(sessionCount(first.database)).toBe(2);
    close(second.database);
    close(first.database);
    const restarted = connect(first.path, first.clock);
    expect(await restarted.repository.resolve(tokenHashA)).toBeNull();
  });

  it('revokes all existing sessions for exactly one user and allows a subsequently verified new session', async () => {
    const { database, repository } = fixture();
    const secondHash = hash('synthetic-doctor-a-second-session');
    await repository.create(grant('a'));
    await repository.create(grant('a', secondHash));
    await repository.create(grant('b'));
    await repository.revokeAll('doctor-a');
    await repository.revokeAll('doctor-a');
    expect(await repository.resolve(tokenHashA)).toBeNull();
    expect(await repository.resolve(secondHash)).toBeNull();
    expect(await repository.resolve(tokenHashB)).toMatchObject({ userId: 'doctor-b' });
    expect(sessionCount(database)).toBe(3);
    // Global logout revokes present sessions; credential reset separately advances
    // users.version. It must not permanently prevent this employee logging in.
    expect(await repository.create(grant('a', hash('synthetic-newly-verified-session')))).toMatchObject({ userId: 'doctor-a' });
  });

  it('performs an unmounted helper issue/read/POST-logout roundtrip against durable D1 with no header fallback', async () => {
    const first = fixture({ disk: true });
    const issued = await issueStaffSession(first.repository, grant());
    expect(issued).not.toBeNull();
    if (!issued) throw new Error('Expected a synthetic staff session');
    expect(first.database.prepare('select token_hash from staff_sessions').get()?.token_hash).toBe(hash(issued.token));
    expect(readFileSync(first.path).includes(Buffer.from(issued.token))).toBe(false);
    const headers = new Headers({
      cookie: `${STAFF_SESSION_COOKIE}=${issued.token}`,
      origin: 'https://clinic.example.test',
      'sec-fetch-site': 'same-origin',
      'oai-authenticated-user-id': 'individual-doctor-b',
    });
    expect(await resolveStaffSession(headers, first.repository)).toMatchObject({ userId: 'doctor-a' });
    close(first.database);
    const second = connect(first.path, first.clock);
    const independent = connect(first.path, first.clock);
    expect(await resolveStaffSession(headers, second.repository)).toMatchObject({ userId: 'doctor-a' });
    const response = await handleStaffLogout(new Request('https://clinic.example.test/logout', {
      method: 'POST', headers,
    }), second.repository, { origin: 'https://clinic.example.test' });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    // Even an old tab retaining the original cookie cannot regain the principal.
    expect(await resolveStaffSession(headers, independent.repository)).toBeNull();
    expect(await resolveStaffSession(new Headers({ 'oai-authenticated-user-id': 'individual-doctor-b' }), independent.repository)).toBeNull();
    expect(sessionCount(independent.database)).toBe(1);
  });

  it('enforces immutable identity/token/deadline columns and server-clock transitions in SQL', async () => {
    const { database, repository, clock } = fixture();
    await repository.create(grant());
    const original = database.prepare('select * from staff_sessions').get();
    const invalidPatches: { clause: string; values: SQLInputValue[] }[] = [
      { clause: 'id = ?', values: [randomUUID()] },
      { clause: 'token_hash = ?', values: [hash('synthetic-rebound-token')] },
      { clause: 'user_id = ?', values: ['doctor-b'] },
      { clause: 'user_version = ?', values: [2] },
      { clause: 'identity_issuer = ?', values: ['orion:other-issuer'] },
      { clause: 'identity_subject = ?', values: ['individual-doctor-b'] },
      { clause: 'created_at = ?', values: [clock.now - 1] },
      { clause: 'absolute_expires_at = ?', values: [clock.now + STAFF_SESSION_ABSOLUTE_MS + 1] },
      { clause: 'last_seen_at = ?, idle_expires_at = ?', values: [clock.now + 1, clock.now + STAFF_SESSION_IDLE_MS + 1] },
      { clause: 'revoked_at = ?', values: [clock.now + 1] },
    ];
    for (const patch of invalidPatches) {
      expect(() => database.prepare(`update staff_sessions set ${patch.clause}, version = version + 1`).run(...patch.values)).toThrow();
      expect(database.prepare('select * from staff_sessions').get()).toEqual(original);
    }
    expect(() => database.prepare('update staff_sessions set version = version + 2').run()).toThrow();
    expect(database.prepare('select * from staff_sessions').get()).toEqual(original);
  });

  it('keeps terminal tombstones and treats repeated token/session ids as collisions, not fresh login', async () => {
    const { database, repository } = fixture();
    const command = grant();
    await repository.create(command);
    expect(await repository.create(command)).toBeNull();
    expect(await repository.create({ ...grant('b'), tokenHash: tokenHashA })).toBeNull();
    expect(await repository.create({ ...grant('b'), sessionId: command.sessionId })).toBeNull();
    await repository.revoke(tokenHashA);
    expect(() => database.prepare('update staff_sessions set revoked_at = null, version = version + 1').run()).toThrow();
    expect(() => database.prepare('delete from staff_sessions').run()).toThrow();
    expect(await repository.create({ ...command, sessionId: randomUUID() })).toBeNull();
    expect(sessionCount(database)).toBe(1);
    expect(await repository.resolve(tokenHashA)).toBeNull();
  });

  it('cannot resurrect a revoked session through SQLite REPLACE conflicts even with recursive triggers off', async () => {
    const { database, repository } = fixture();
    database.exec('pragma recursive_triggers = off');
    await repository.create(grant());
    await repository.revoke(tokenHashA);
    const tombstone = database.prepare('select * from staff_sessions').get()!;
    for (const patch of [
      {},
      { id: randomUUID() },
      { token_hash: hash('synthetic-replacement-token') },
    ]) {
      const replacement = { ...tombstone, ...patch, revoked_at: null, version: 1 };
      const keys = Object.keys(replacement);
      expect(() => database.prepare(`insert or replace into staff_sessions (${keys.join(',')})
        values (${keys.map(() => '?').join(',')})`)
        .run(...keys.map(key => replacement[key as keyof typeof replacement] as SQLInputValue))).toThrow();
      expect(database.prepare('select * from staff_sessions').all()).toEqual([tombstone]);
    }
    expect(await repository.resolve(tokenHashA)).toBeNull();
  });

  it('does not claim durable logout success when SQLite ignores the revocation write', async () => {
    const { database, repository } = fixture();
    await repository.create(grant());
    database.exec(`create trigger test_ignore_staff_session_revoke
      before update on staff_sessions when new.revoked_at is not null
      begin select raise(ignore); end`);
    await expect(repository.revoke(tokenHashA)).rejects.toThrow();
    await expect(repository.revokeAll('doctor-a')).rejects.toThrow();
    const response = await handleStaffLogout(new Request('https://clinic.example.test/logout', {
      method: 'POST', headers: {
        cookie: `${STAFF_SESSION_COOKIE}=${rawTokenA}`,
        origin: 'https://clinic.example.test',
      },
    }), repository, { origin: 'https://clinic.example.test' });
    expect(response.status).toBe(503);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(database.prepare('select revoked_at from staff_sessions').get()?.revoked_at).toBeNull();
  });

  it('rolls back every affected session if global revocation publication is partially ignored', async () => {
    const { database, repository } = fixture();
    const secondTokenHash = hash('synthetic-partially-ignored-session');
    await repository.create(grant('a'));
    await repository.create(grant('a', secondTokenHash));
    database.exec(`create trigger test_ignore_one_staff_session_revoke
      before update on staff_sessions when new.revoked_at is not null and old.token_hash = '${secondTokenHash}'
      begin select raise(ignore); end`);
    await expect(repository.revokeAll('doctor-a')).rejects.toThrow();
    expect(database.prepare('select token_hash, revoked_at from staff_sessions order by token_hash').all()).toEqual(
      [tokenHashA, secondTokenHash].sort().map(token_hash => ({ token_hash, revoked_at: null })),
    );
  });

  it('allows a new verified login committed after global revocation without reporting a false logout failure', async () => {
    const first = fixture({ disk: true });
    const second = connect(first.path, first.clock);
    await first.repository.create(grant());
    const freshTokenHash = hash('synthetic-login-after-revocation-commit');
    let interleaved = false;
    const racing = new D1StaffSessionRepository(createD1Adapter(first.database, {
      after: async operation => {
        if (!interleaved && ['run', 'batch'].includes(operation.kind) &&
          /update\s+staff_sessions/i.test(operation.sql) && /where user_id/i.test(operation.sql)) {
          interleaved = true;
          expect(await second.repository.create(grant('a', freshTokenHash))).not.toBeNull();
        }
      },
    }));
    await expect(racing.revokeAll('doctor-a')).resolves.toBeUndefined();
    expect(interleaved).toBe(true);
    expect(await second.repository.resolve(tokenHashA)).toBeNull();
    expect(await second.repository.resolve(freshTokenHash)).toMatchObject({ userId: 'doctor-a' });
  });

  it('rolls back disabling the account if mandatory session invalidation is ignored', async () => {
    const { database, repository } = fixture();
    await repository.create(grant());
    database.exec(`create trigger test_ignore_account_staff_session_revoke
      before update on staff_sessions when new.revoked_at is not null
      begin select raise(ignore); end`);
    const originalUser = database.prepare("select * from users where id = 'doctor-a'").get()!;
    expect(() => database.prepare("update users set status = 'disabled' where id = 'doctor-a'").run()).toThrow();
    expect(database.prepare("select * from users where id = 'doctor-a'").get()).toEqual(originalUser);
    const replacement = { ...originalUser, status: 'disabled' };
    const keys = Object.keys(replacement);
    expect(() => database.prepare(`insert or replace into users (${keys.join(',')})
      values (${keys.map(() => '?').join(',')})`)
      .run(...keys.map(key => replacement[key as keyof typeof replacement] as SQLInputValue))).toThrow();
    expect(database.prepare("select * from users where id = 'doctor-a'").get()).toEqual(originalUser);
    expect(database.prepare('select revoked_at from staff_sessions').get()?.revoked_at).toBeNull();
  });

  it('invalidates REPLACE-and-restore account transitions without relying on UPDATE triggers', async () => {
    const { database, repository } = fixture();
    database.exec('pragma recursive_triggers = off');
    const original = database.prepare("select * from users where id = 'doctor-a'").get()!;
    const replaceUser = (patch: Record<string, SQLInputValue>) => {
      const row = { ...original, ...patch };
      const keys = Object.keys(row);
      database.prepare(`insert or replace into users (${keys.join(',')})
        values (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
    };
    const patches: Record<string, SQLInputValue>[] = [
      { status: 'disabled' }, { version: 2 },
      { external_issuer: 'orion:replacement-issuer' },
      { external_subject: 'replacement-individual-subject' },
    ];
    for (const [index, patch] of patches.entries()) {
      const tokenHash = hash(`synthetic-replace-account-${index}`);
      expect(await repository.create(grant('a', tokenHash))).not.toBeNull();
      replaceUser(patch);
      replaceUser({});
      expect(await repository.resolve(tokenHash)).toBeNull();
      expect(database.prepare('select revoked_at from staff_sessions where token_hash = ?').get(tokenHash)?.revoked_at).not.toBeNull();
    }
  });

  it('does not revoke valid sessions for an ignored conflicting user insert', async () => {
    const { database, repository } = fixture();
    await repository.create(grant());
    const originalUser = database.prepare("select * from users where id = 'doctor-a'").get()!;
    const originalSession = database.prepare('select * from staff_sessions').get();
    const conflicting = {
      ...originalUser, status: 'disabled', version: 2,
      external_issuer: 'orion:ignored-issuer', external_subject: 'ignored-subject',
    };
    const keys = Object.keys(conflicting);
    database.prepare(`insert or ignore into users (${keys.join(',')})
      values (${keys.map(() => '?').join(',')})`)
      .run(...keys.map(key => conflicting[key as keyof typeof conflicting] as SQLInputValue));
    expect(database.prepare("select * from users where id = 'doctor-a'").get()).toEqual(originalUser);
    expect(database.prepare('select * from staff_sessions').get()).toEqual(originalSession);
    expect(await repository.resolve(tokenHashA)).toMatchObject({ userId: 'doctor-a' });
  });

  it('rejects unknown users without creating sessions or falling back to a same-role doctor', async () => {
    const { database, repository } = fixture();
    expect(await repository.create({ ...grant(), userId: 'unknown-staff' })).toBeNull();
    expect(sessionCount(database)).toBe(0);
  });

  it.each(['invited', 'disabled'])('does not issue a session for an %s account', async status => {
    const { database, repository } = fixture();
    database.prepare('update users set status = ? where id = ?').run(status, 'doctor-a');
    expect(await repository.create(grant())).toBeNull();
    expect(sessionCount(database)).toBe(0);
  });

  it.each(['invited', 'disabled'])('permanently invalidates old sessions when an account becomes %s, even if re-enabled between reads', async status => {
    const { database, repository } = fixture();
    await repository.create(grant());
    database.prepare('update users set status = ? where id = ?').run(status, 'doctor-a');
    // Deliberately do not resolve while disabled: the database trigger itself must
    // prevent a later status restoration from reviving the old browser token.
    database.prepare("update users set status = 'active' where id = ?").run('doctor-a');
    expect(await repository.resolve(tokenHashA)).toBeNull();
    expect(database.prepare('select revoked_at from staff_sessions').get()?.revoked_at).not.toBeNull();
  });

  it('rejects stale verified account versions and never revives prior-version sessions', async () => {
    const { database, repository } = fixture();
    await repository.create(grant());
    database.prepare('update users set version = version + 1 where id = ?').run('doctor-a');
    expect(await repository.resolve(tokenHashA)).toBeNull();
    expect(await repository.create(grant('a', hash('synthetic-stale-grant')))).toBeNull();
    expect(await repository.create({ ...grant('a', hash('synthetic-fresh-grant')), expectedUserVersion: 2 })).toMatchObject({ userId: 'doctor-a' });
    expect(sessionCount(database)).toBe(2);
  });

  it.each(['external_issuer', 'external_subject'] as const)('permanently invalidates changed %s identity even after it is restored', async column => {
    const { database, repository } = fixture();
    await repository.create(grant());
    const prior = column === 'external_issuer' ? issuer : 'individual-doctor-a';
    database.prepare(`update users set ${column} = ? where id = ?`).run('changed-individual-identity', 'doctor-a');
    expect(await repository.create(grant('a', hash('synthetic-stale-identity-grant')))).toBeNull();
    database.prepare(`update users set ${column} = ? where id = ?`).run(prior, 'doctor-a');
    expect(await repository.resolve(tokenHashA)).toBeNull();
    expect(sessionCount(database)).toBe(1);
  });

  it.each(['expectedIssuer', 'expectedSubject'] as const)('rejects a mismatched verified %s instead of finding a role-equivalent identity', async field => {
    const { database, repository } = fixture();
    expect(await repository.create({ ...grant(), [field]: 'wrong-verified-identity' })).toBeNull();
    expect(sessionCount(database)).toBe(0);
  });

  it('rejects forged and malformed hashes without modifying a legitimate session', async () => {
    const { database, repository } = fixture();
    await repository.create(grant());
    const before = database.prepare('select * from staff_sessions').get();
    for (const candidate of [hash('synthetic-forged-token'), '', rawTokenA, 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(await repository.resolve(candidate)).toBeNull();
      await repository.revoke(candidate);
    }
    expect(database.prepare('select * from staff_sessions').get()).toEqual(before);
    expect(await repository.resolve(tokenHashA)).toMatchObject({ userId: 'doctor-a' });
  });

  it('rejects trailing-line-ending token hashes before touching the database', async () => {
    const noDatabase = new D1StaffSessionRepository({
      prepare() { throw new Error('Malformed hash reached the database'); },
    } as unknown as D1Database);
    for (const ending of ['\n', '\r', '\r\n']) {
      const malformed = `${tokenHashA}${ending}`;
      expect(await noDatabase.resolve(malformed)).toBeNull();
      await expect(noDatabase.revoke(malformed)).resolves.toBeUndefined();
      expect(await noDatabase.create(grant('a', malformed))).toBeNull();
    }
  });

  it('extends idle expiry only up to the immutable absolute deadline', async () => {
    const { repository, clock } = fixture();
    const created = await repository.create(grant());
    expect(created).not.toBeNull();
    const origin = clock.now;
    clock.now += STAFF_SESSION_IDLE_MS - 1;
    expect(await repository.resolve(tokenHashA)).toMatchObject({
      lastSeenAt: clock.now, idleExpiresAt: clock.now + STAFF_SESSION_IDLE_MS,
      createdAt: origin, absoluteExpiresAt: origin + STAFF_SESSION_ABSOLUTE_MS,
    });
    // Keep the session active until the last part of its absolute lifetime.
    while (clock.now + STAFF_SESSION_IDLE_MS - 1 < origin + STAFF_SESSION_ABSOLUTE_MS) {
      clock.now += STAFF_SESSION_IDLE_MS - 1;
      expect(await repository.resolve(tokenHashA)).not.toBeNull();
    }
    clock.now = origin + STAFF_SESSION_ABSOLUTE_MS - 1;
    expect(await repository.resolve(tokenHashA)).toMatchObject({
      lastSeenAt: clock.now, idleExpiresAt: origin + STAFF_SESSION_ABSOLUTE_MS,
      absoluteExpiresAt: origin + STAFF_SESSION_ABSOLUTE_MS,
    });
    clock.now += 1;
    expect(await repository.resolve(tokenHashA)).toBeNull();
  });

  it.each([0, 1])('rejects idle expiry at its exact boundary plus %s ms', async offset => {
    const { database, repository, clock } = fixture();
    await repository.create(grant());
    clock.now += STAFF_SESSION_IDLE_MS + offset;
    expect(await repository.resolve(tokenHashA)).toBeNull();
    expect(() => database.prepare(`update staff_sessions set last_seen_at = ?,
      idle_expires_at = ?, version = version + 1`).run(clock.now, clock.now + STAFF_SESSION_IDLE_MS)).toThrow();
  });

  it('does not authorize if revocation commits on another connection after touch but before final read', async () => {
    const first = fixture({ disk: true });
    const second = connect(first.path, first.clock);
    await first.repository.create(grant());
    first.clock.now += 1000;
    let interleaved = false;
    const racing = new D1StaffSessionRepository(createD1Adapter(first.database, {
      after: async operation => {
        if (!interleaved && operation.kind === 'run' && /update\s+staff_sessions/i.test(operation.sql) && /last_seen_at/i.test(operation.sql)) {
          interleaved = true;
          await second.repository.revoke(tokenHashA);
        }
      },
    }));
    expect(await racing.resolve(tokenHashA)).toBeNull();
    expect(interleaved).toBe(true);
    expect(await second.repository.resolve(tokenHashA)).toBeNull();
    expect(first.database.prepare('select revoked_at from staff_sessions').get()?.revoked_at).toBe(first.clock.now);
  });

  it('does not issue from a verified grant invalidated on another connection immediately before insert', async () => {
    const first = fixture({ disk: true });
    const second = connect(first.path, first.clock);
    const previouslyVerified = grant();
    let interleaved = false;
    const racing = new D1StaffSessionRepository(createD1Adapter(first.database, {
      before: operation => {
        if (!interleaved && operation.kind === 'run' && /insert\s+into\s+staff_sessions/i.test(operation.sql)) {
          interleaved = true;
          second.database.prepare('update users set version = version + 1 where id = ?').run('doctor-a');
        }
      },
    }));
    expect(await racing.create(previouslyVerified)).toBeNull();
    expect(interleaved).toBe(true);
    expect(sessionCount(first.database)).toBe(0);
  });

  it('suppresses a new session response if it is revoked after insert before final read', async () => {
    const first = fixture({ disk: true });
    const second = connect(first.path, first.clock);
    let interleaved = false;
    const racing = new D1StaffSessionRepository(createD1Adapter(first.database, {
      after: async operation => {
        if (!interleaved && operation.kind === 'run' && /insert\s+into\s+staff_sessions/i.test(operation.sql)) {
          interleaved = true;
          await second.repository.revoke(tokenHashA);
        }
      },
    }));
    expect(await racing.create(grant())).toBeNull();
    expect(interleaved).toBe(true);
    expect(sessionCount(first.database)).toBe(1);
    expect(await second.repository.resolve(tokenHashA)).toBeNull();
  });

  it('propagates storage failures instead of claiming unauthenticated state or successful revocation', async () => {
    const { d1 } = fixture();
    const unavailable = new D1StaffSessionRepository({
      ...d1,
      prepare() { throw new Error('SESSION_STORE_UNAVAILABLE'); },
    } as unknown as D1Database);
    await expect(unavailable.create(grant())).rejects.toThrow('SESSION_STORE_UNAVAILABLE');
    await expect(unavailable.resolve(tokenHashA)).rejects.toThrow('SESSION_STORE_UNAVAILABLE');
    await expect(unavailable.revoke(tokenHashA)).rejects.toThrow('SESSION_STORE_UNAVAILABLE');
    await expect(unavailable.revokeAll('doctor-a')).rejects.toThrow('SESSION_STORE_UNAVAILABLE');
  });
});
