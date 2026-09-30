import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { LocalAccount } from './local-account-auth.ts';

type StaffRow = { id: string; issuer: string; subject: string; name: string };
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
    return db.prepare(`select distinct u.id, u.external_issuer as issuer, u.external_subject as subject, u.display_name as name
      from users u join memberships m on m.user_id=u.id
      where u.status='active' and m.status='active' and m.role<>'service' order by u.id`).all() as StaffRow[];
  } finally { db.close(); }
}

/** Separate local-computer credential store. It NEVER writes the clinical D1. */
export function openLocalAccountStore(authPath: string, staffPath: string) {
  mkdirSync(resolve(authPath, '..'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(authPath);
  db.exec(`pragma journal_mode=WAL; pragma busy_timeout=3000;
    create table if not exists local_accounts (user_id text primary key, issuer text not null, subject text not null,
      login text not null unique, salt text not null, digest text not null, unique(issuer,subject));
    create table if not exists local_sessions (token_hash text primary key, issuer text not null, subject text not null,
      digest text not null, created integer not null, touched integer not null, generation text not null);
    create table if not exists local_login_attempts (id integer primary key check(id=1), count integer not null, until_ms integer not null);`);
  return {
    close() { db.close(); },
    loadAccounts(): LocalAccount[] {
      const staff = readLocalStaff(staffPath);
      const rows = db.prepare('select user_id as userId, issuer, subject, login, salt, digest from local_accounts').all() as (Omit<LocalAccount, 'name'> & { userId: string })[];
      return rows.flatMap(row => {
        const person = staff.find(item => item.id === row.userId && item.issuer === row.issuer && item.subject === row.subject);
        return person ? [{ ...row, name: person.name }] : [];
      });
    },
    provision(person: StaffRow, login: string, salt: string, digest: string) {
      db.exec('begin immediate');
      try {
        db.prepare(`insert into local_accounts(user_id,issuer,subject,login,salt,digest) values(?,?,?,?,?,?)
          on conflict(user_id) do update set login=excluded.login,salt=excluded.salt,digest=excluded.digest
          where local_accounts.issuer=excluded.issuer and local_accounts.subject=excluded.subject`).run(person.id,person.issuer,person.subject,login,salt,digest);
        db.prepare('delete from local_sessions where issuer=? and subject=?').run(person.issuer,person.subject);
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
