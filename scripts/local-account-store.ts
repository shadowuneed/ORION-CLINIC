import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { LocalAccount } from './local-account-auth.ts';

export type StaffRow = { id: string; issuer: string; subject: string; name: string };
export type LocalStaffDirectoryProvider = { readonly source: 'postgresql'; loadStaff(): Promise<StaffRow[]> };
export type LocalAccountAuthority = 'legacy_d1' | 'postgresql';
const activeStaffSql = `select distinct u.id, u.external_issuer as issuer, u.external_subject as subject, u.display_name as name
  from users u join memberships m on m.user_id=u.id
  where u.status='active' and m.status='active' and m.role<>'service' order by u.id`;
export type LocalSession = { subject: string; issuer: string; digest: string; created: number; touched: number; generation: string };
export interface LocalSessionStore {
  getSession(key: string, now: number): LocalSession | undefined;
  putSession(key: string, session: LocalSession): void;
  deleteSession(key: string): void;
  reserveAttempt(now: number): boolean;
  finishAttempt(success: boolean): void;
  updatePassword?(account: LocalAccount, salt: string, digest: string): boolean;
}

export function localAccountPaths(root: string) {
  const repo = realpathSync(root);
  const base = process.env.LOCALAPPDATA;
  if (!base) throw new Error('LOCALAPPDATA is required for local account storage');
  const namespace = createHash('sha256').update(repo.toLowerCase()).digest('hex').slice(0, 16);
  const directory = join(base, 'ORION-Clinic', namespace);
  return { directory, database: join(directory, 'accounts.sqlite'), handoff: join(directory, 'accounts.html') };
}

export function findLocalStaffDatabase(root: string): string {
  const directory = realpathSync(resolve(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'));
  const candidates = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.sqlite$/.test(name));
  const matches: string[] = [];
  for (const name of candidates) {
    const path = realpathSync(join(directory, name));
    const child = relative(directory, path);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid local database path');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (db.prepare("select 1 from sqlite_master where type='table' and name='department_access_assignments'").get()) matches.push(path);
    } finally { db.close(); }
  }
  if (matches.length !== 1) throw new Error('Exactly one ORION local staff database is required');
  return matches[0];
}

export function readLocalStaff(path: string): StaffRow[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(activeStaffSql).all() as StaffRow[];
  } finally { db.close(); }
}

/** Local sticky downgrade fence, not a second copy of the staff directory. */
export function readLocalAccountAuthority(authPath: string): LocalAccountAuthority {
  if (!existsSync(authPath)) return 'legacy_d1';
  const db = new DatabaseSync(authPath, { readOnly: true });
  try { return authorityFromDatabase(db); } finally { db.close(); }
}

function authorityFromDatabase(db: DatabaseSync): LocalAccountAuthority {
  if (!db.prepare("select 1 from sqlite_master where type='table' and name='local_authority_mode'").get()) return 'legacy_d1';
  const rows = db.prepare('select id,source from local_authority_mode').all();
  if (rows.length !== 1 || rows[0].id !== 1 || rows[0].source !== 'postgresql') throw new Error('Invalid local authority cutover state');
  return 'postgresql';
}

/** Explicit operator cutover only, after verified PG migration and backup.
 * Does not replace credentials, revoke sessions, modify names, or touch D1.
 * Deliberately no downgrade/reset counterpart: PG failure must fail closed.
 */
export function setPostgresAccountAuthority(authPath: string): void {
  if (!existsSync(authPath)) throw new Error('Existing private credential store is required for cutover');
  const db = new DatabaseSync(authPath);
  try {
    db.exec('pragma busy_timeout=3000; begin immediate');
    try {
      if (!db.prepare("select 1 from sqlite_master where type='table' and name='local_accounts'").get()) throw new Error('Existing private credential store is required for cutover');
      db.exec("create table if not exists local_authority_mode(id integer primary key check(id=1),source text not null check(source='postgresql'))");
      db.prepare("insert into local_authority_mode(id,source) values(1,'postgresql') on conflict(id) do nothing").run();
      const rows = db.prepare('select id,source from local_authority_mode').all();
      if (rows.length !== 1 || rows[0].id !== 1 || rows[0].source !== 'postgresql') throw new Error('Invalid local authority cutover state');
      db.exec('commit');
    } catch (error) { db.exec('rollback'); throw error; }
  } finally { db.close(); }
}

function validateDirectoryStaff(staff: StaffRow[]): StaffRow[] {
  if (!Array.isArray(staff) || staff.length > 10_000) throw new Error('Invalid authoritative staff directory');
  const ids = new Set<string>(); const identities = new Set<string>();
  for (const person of staff) {
    if (!person || typeof person !== 'object' ||
      [person.id, person.issuer, person.subject].some(value => typeof value !== 'string' || !/^[^\s\p{Cc}]{1,256}$/u.test(value)) ||
      typeof person.name !== 'string' || person.name.length < 1 || person.name.length > 160) throw new Error('Invalid authoritative staff directory');
    const identity = JSON.stringify([person.issuer, person.subject]);
    if (ids.has(person.id) || identities.has(identity)) throw new Error('Ambiguous authoritative staff directory');
    ids.add(person.id); identities.add(identity);
  }
  return staff;
}

/** Separate local-computer credential store. It NEVER writes the clinical D1. */
export function openLocalAccountStore(authPath: string, source: string | LocalStaffDirectoryProvider) {
  const authority = readLocalAccountAuthority(authPath);
  const postgres = typeof source !== 'string';
  if ((authority === 'postgresql') !== postgres || (postgres && source.source !== 'postgresql')) throw new Error('Local authority source mismatch; legacy fallback is forbidden after cutover');
  mkdirSync(resolve(authPath, '..'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(authPath);
  db.exec(`pragma journal_mode=WAL; pragma busy_timeout=3000;
    create table if not exists local_accounts (user_id text primary key, issuer text not null, subject text not null,
      login text not null unique, salt text not null, digest text not null, unique(issuer,subject));
    create table if not exists local_sessions (token_hash text primary key, issuer text not null, subject text not null,
      digest text not null, created integer not null, touched integer not null, generation text not null);
    create table if not exists local_login_attempts (id integer primary key check(id=1), count integer not null, until_ms integer not null);`);
  // Reuse a read-only connection and compiled statements, NOT authority results.
  // Every validation still executes a fresh SELECT and sees committed revocations.
  let staffDb: DatabaseSync | undefined;
  try { if (typeof source === 'string') staffDb = new DatabaseSync(source, { readOnly: true }); }
  catch (error) { db.close(); throw error; }
  let staffQuery; let accountQuery;
  try {
    staffQuery = staffDb?.prepare(activeStaffSql);
    accountQuery = db.prepare('select user_id as userId, issuer, subject, login, salt, digest from local_accounts');
  } catch (error) { staffDb?.close(); db.close(); throw error; }
  const assertSource = () => {
    if ((authorityFromDatabase(db) === 'postgresql') !== postgres) throw new Error('Local authority changed; restart with the PostgreSQL provider');
  };
  const matchAccounts = (staff: StaffRow[]): LocalAccount[] => {
    assertSource();
    const current = validateDirectoryStaff(staff);
    const rows = accountQuery.all() as (Omit<LocalAccount, 'name'> & { userId: string })[];
    return rows.flatMap(row => {
      const person = current.find(item => item.id === row.userId && item.issuer === row.issuer && item.subject === row.subject);
      return person ? [{ ...row, name: person.name }] : [];
    });
  };
  return {
    close() { staffDb?.close(); db.close(); },
    loadAccounts(): LocalAccount[] {
      assertSource();
      if (!staffQuery) throw new Error('PostgreSQL identity authority requires async validation');
      return matchAccounts(staffQuery.all() as StaffRow[]);
    },
    async loadActiveAccounts(): Promise<LocalAccount[]> {
      assertSource();
      // Never cache authority or catch a PG error and fall back to D1. Current
      // credentials are matched only after the fresh provider request resolves.
      const staff = typeof source === 'string' ? staffQuery!.all() as StaffRow[] : await source.loadStaff();
      return matchAccounts(staff);
    },
    provision(person: StaffRow, login: string, salt: string, digest: string) {
      assertSource();
      if (postgres) throw new Error('Legacy credential provisioning is unavailable after PostgreSQL cutover');
      db.exec('begin immediate');
      try {
        db.prepare(`insert into local_accounts(user_id,issuer,subject,login,salt,digest) values(?,?,?,?,?,?)
          on conflict(user_id) do update set login=excluded.login,salt=excluded.salt,digest=excluded.digest
          where local_accounts.issuer=excluded.issuer and local_accounts.subject=excluded.subject`).run(person.id,person.issuer,person.subject,login,salt,digest);
        db.prepare('delete from local_sessions where issuer=? and subject=?').run(person.issuer,person.subject);
        db.exec('commit');
      } catch (error) { db.exec('rollback'); throw error; }
    },
    /** PC-operator-only first issuance. Never replaces credentials or sessions.
     * The publication callback must synchronously persist the private handoff
     * before COMMIT; failure rolls back the new credential, not existing rows.
     */
    async provisionPostgresNew(userId: string, login: string, salt: string, digest: string, publish: (person: StaffRow) => void) {
      assertSource();
      if (typeof source === 'string' || !postgres) throw new Error('PG_NEW_CREDENTIAL_REQUIRES_CUTOVER');
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(userId) || !/^[a-z0-9._-]{3,64}$/.test(login) ||
        !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(digest)) throw new Error('PG_NEW_CREDENTIAL_INVALID_INPUT');
      // Fresh after expensive password derivation. Missing/disabled/service-only
      // identities are absent from this authoritative PG RPC result.
      const people = validateDirectoryStaff(await source.loadStaff());
      const person = people.find(entry => entry.id === userId);
      if (!person) throw new Error('PG_NEW_CREDENTIAL_IDENTITY_UNAVAILABLE');
      assertSource();
      db.exec('begin immediate');
      try {
        if (db.prepare('select 1 from local_accounts where user_id=? or (issuer=? and subject=?) or login=?').get(person.id, person.issuer, person.subject, login)) throw new Error('PG_NEW_CREDENTIAL_ALREADY_EXISTS');
        if (Number(db.prepare('select count(*) as count from local_accounts').get()?.count) >= 100) throw new Error('PG_NEW_CREDENTIAL_REGISTRY_LIMIT');
        publish(person);
        db.prepare('insert into local_accounts(user_id,issuer,subject,login,salt,digest) values(?,?,?,?,?,?)').run(person.id, person.issuer, person.subject, login, salt, digest);
        db.exec('commit');
      } catch (error) { db.exec('rollback'); throw error; }
    },
    getSession(key: string, now: number) {
      db.prepare('delete from local_sessions where touched<? or created<?').run(now - 1_800_000, now - 28_800_000);
      return db.prepare('select issuer,subject,digest,created,touched,generation from local_sessions where token_hash=?').get(key) as LocalSession | undefined;
    },
    putSession(key: string, session: LocalSession) {
      db.prepare(`insert into local_sessions(token_hash,issuer,subject,digest,created,touched,generation) values(?,?,?,?,?,?,?)
        on conflict(token_hash) do update set touched=excluded.touched`).run(key,session.issuer,session.subject,session.digest,session.created,session.touched,session.generation);
    },
    deleteSession(key: string) { db.prepare('delete from local_sessions where token_hash=?').run(key); },
    reserveAttempt(now: number) {
      db.exec('begin immediate');
      try {
        db.prepare('delete from local_login_attempts where until_ms<=?').run(now);
        const row = db.prepare('select count from local_login_attempts where id=1').get() as { count: number } | undefined;
        if ((row?.count ?? 0) >= 10) { db.exec('commit'); return false; }
        db.prepare(`insert into local_login_attempts(id,count,until_ms) values(1,1,?)
          on conflict(id) do update set count=count+1`).run(now + 300_000);
        db.exec('commit'); return true;
      } catch (error) { db.exec('rollback'); throw error; }
    },
    finishAttempt(success: boolean) { void success; /* Successful logins keep the rolling budget. */ },
    updatePassword(account: LocalAccount, salt: string, digest: string) {
      db.exec('begin immediate');
      try {
        const changed=db.prepare('update local_accounts set salt=?,digest=? where issuer=? and subject=? and digest=?')
          .run(salt,digest,account.issuer,account.subject,account.digest).changes;
        if(Number(changed)!==1){db.exec('rollback');return false;}
        db.prepare('delete from local_sessions where issuer=? and subject=?').run(account.issuer,account.subject);
        db.exec('commit');return true;
      }catch(error){db.exec('rollback');throw error;}
    },
  };
}
