import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertReviewedSyntheticStaff, generateMemorableLocalPassword, MEMORABLE_PASSWORD_ALPHABET,
  MEMORABLE_PASSWORD_CODE_LENGTH, MEMORABLE_PASSWORD_ENTROPY_BITS, MEMORABLE_PASSWORD_WORDS,
  parseLocalAccountProvisionArgs,
} from '../scripts/memorable-local-password';

const isolatedPaths = vi.hoisted(() => ({ directory: '', staff: '', database: '', handoff: '', failStageWrite: false, failRename: false }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (isolatedPaths.failStageWrite && typeof args[0] === 'number') throw new Error('SYNTHETIC_STAGE_WRITE_FAILURE');
      return actual.writeFileSync(...args);
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (isolatedPaths.failRename && String(args[0]).includes('accounts-reset-')) throw new Error('SYNTHETIC_RENAME_FAILURE');
      return actual.renameSync(...args);
    },
  };
});
vi.mock('../scripts/local-account-store.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/local-account-store')>(),
  findLocalStaffDatabase: () => isolatedPaths.staff,
  localAccountPaths: () => ({ directory: isolatedPaths.directory, database: isolatedPaths.database, handoff: isolatedPaths.handoff }),
}));

describe('memorable synthetic local credentials', () => {
  it('uses a distinct common-word dictionary and unbiased 32-character code with at least 54 bits', () => {
    expect(MEMORABLE_PASSWORD_WORDS.length >= 128).toBe(true);
    expect(new Set(MEMORABLE_PASSWORD_WORDS).size).toBe(MEMORABLE_PASSWORD_WORDS.length);
    expect(MEMORABLE_PASSWORD_WORDS.every(word => /^[a-z]{3,8}$/.test(word))).toBe(true);
    expect(Object.isFrozen(MEMORABLE_PASSWORD_WORDS)).toBe(true);
    expect(MEMORABLE_PASSWORD_ALPHABET.length).toBe(32);
    expect(new Set(MEMORABLE_PASSWORD_ALPHABET).size).toBe(32);
    expect(/[IO01]/.test(MEMORABLE_PASSWORD_ALPHABET)).toBe(false);
    expect(MEMORABLE_PASSWORD_CODE_LENGTH).toBe(8);
    expect(MEMORABLE_PASSWORD_ENTROPY_BITS >= 54).toBe(true);
  });
  it('generates independent Latin word-word-code samples within the unchanged length policy', () => {
    const samples = Array.from({ length: 256 }, () => generateMemorableLocalPassword());
    // Assert booleans/counts only; a failure never prints a generated credential.
    expect(new Set(samples).size).toBe(samples.length);
    expect(samples.every(sample => {
      const pieces = sample.split('-');
      return sample.length >= 15 && sample.length <= 256 && pieces.length === 3 &&
        pieces.slice(0, 2).every(word => MEMORABLE_PASSWORD_WORDS.includes(word.toLowerCase()) && /^[A-Z]{3,8}$/.test(word)) &&
        pieces[2].length === 8 && Array.from(pieces[2]).every(char => MEMORABLE_PASSWORD_ALPHABET.includes(char));
    })).toBe(true);
  });
  it('keeps default provisioning and existing single-account reset explicit', () => {
    expect(parseLocalAccountProvisionArgs([])).toEqual({ mode: 'provision_missing' });
    expect(parseLocalAccountProvisionArgs(['--reset', 'user-a'])).toEqual({ mode: 'reset_one', userId: 'user-a' });
    expect(parseLocalAccountProvisionArgs(['--reset-test-all', '--memorable'])).toEqual({ mode: 'reset_test_all', memorable: true });
    expect(parseLocalAccountProvisionArgs(['--memorable', '--reset-test-all'])).toEqual({ mode: 'reset_test_all', memorable: true });
  });
  it.each([
    ['--memorable'], ['--reset-test-all'], ['--reset'], ['--reset', '--memorable'],
    ['--reset-test-all', '--reset-test-all'], ['--reset', 'user-a', '--memorable'],
    ['--reset-test-all', '--memorable', 'user-a'], ['--reset', '../user-a'], ['--all'],
  ].map(args => [args]))('rejects ambiguous or incomplete flags %j before storage is opened', args => {
    expect(() => parseLocalAccountProvisionArgs(args)).toThrow('Usage:');
  });
  it('permits exact synthetic fixture metadata and rejects unknown or real external identities', () => {
    expect(() => assertReviewedSyntheticStaff([
      { id: 'user-a', issuer: 'openai:sites', subject: 'local_seedy' },
      { id: 'user-care-nurse', issuer: 'orion:synthetic', subject: 'local-care-nurse' },
    ])).not.toThrow();
    for (const people of [[], [{ id: 'user-a', issuer: 'openai:sites', subject: 'real-account' }],
      [{ id: 'user-a', issuer: 'supabase', subject: 'local_seedy' }],
      [{ id: 'unreviewed-person', issuer: 'orion:synthetic', subject: 'unreviewed-person' }]]) {
      expect(() => assertReviewedSyntheticStaff(people)).toThrow('no passwords changed');
    }
  });
  it('explicit all-test CLI resets only already provisioned active synthetic accounts, keeps roles/login and appends private handoff', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orion-memorable-accounts-'));
    Object.assign(isolatedPaths, { directory, staff: join(directory, 'staff.sqlite'), database: join(directory, 'accounts.sqlite'), handoff: join(directory, 'accounts.html'), failStageWrite: false, failRename: false });
    const staffDb = new DatabaseSync(isolatedPaths.staff);
    const oldArgs = process.argv;
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { bytesToHex, derivePassword } = await import('../scripts/local-account-auth');
    const { openLocalAccountStore } = await vi.importActual<typeof import('../scripts/local-account-store')>('../scripts/local-account-store');
    let store: ReturnType<typeof openLocalAccountStore> | undefined;
    let authDb: DatabaseSync | undefined;
    try {
      staffDb.exec(`create table users(id text primary key,external_issuer text,external_subject text,display_name text,status text);
        create table memberships(user_id text,status text,role text);
        insert into users values('user-a','openai:sites','local_seedy','Synthetic A','active'),
          ('user-care-nurse','orion:synthetic','local-care-nurse','Synthetic Nurse','active'),
          ('user-b','openai:sites','local_other_clinician','Synthetic Disabled','disabled'),
          ('not-provisioned','orion:synthetic','not-provisioned','Synthetic Unprovisioned','active');
        insert into memberships values('user-a','active','doctor'),('user-care-nurse','active','nurse'),
          ('user-b','active','doctor'),('not-provisioned','active','doctor');`);
      const staffBefore = JSON.stringify(staffDb.prepare('select * from users order by id').all());
      const membershipsBefore = JSON.stringify(staffDb.prepare('select * from memberships order by user_id').all());
      store = openLocalAccountStore(isolatedPaths.database, isolatedPaths.staff);
      const people = staffDb.prepare('select id,external_issuer as issuer,external_subject as subject,display_name as name from users where id<>?').all('not-provisioned') as { id: string; issuer: string; subject: string; name: string }[];
      for (const person of people) {
        const initial = generateMemorableLocalPassword(); const salt = bytesToHex(randomBytes(16));
        const hash = await derivePassword(initial, salt);
        store.provision(person, person.id, salt, bytesToHex(hash)); hash.fill(0);
      }
      authDb = new DatabaseSync(isolatedPaths.database);
      const disabledBefore = authDb.prepare('select salt,digest from local_accounts where user_id=?').get('user-b');
      for (const account of store.loadAccounts()) store.putSession(bytesToHex(randomBytes(32)), {
        issuer: account.issuer, subject: account.subject, digest: account.digest, created: Date.now(), touched: Date.now(), generation: bytesToHex(randomBytes(16)),
      });
      store.close(); store = undefined;
      const previous = '<!doctype html><p>Older protected handoff retained</p>';
      writeFileSync(isolatedPaths.handoff, previous, { mode: 0o600 });
      process.argv = [oldArgs[0], 'configure-local-accounts.mjs', '--reset-test-all', '--memorable'];
      vi.resetModules();
      await import('../scripts/configure-local-accounts.mjs');
      const handoff = readFileSync(isolatedPaths.handoff, 'utf8');
      const rows = Array.from(handoff.matchAll(/<td><code>([^<]+)<\/code><\/td><td><code>([^<]+)<\/code><\/td>/g));
      expect(handoff.startsWith(previous)).toBe(true);
      expect(rows.length).toBe(2);
      expect(new Set(rows.map(row => row[2])).size).toBe(2);
      expect(rows.every(row => /^[A-Z]{3,8}-[A-Z]{3,8}-[A-HJ-NP-Z2-9]{8}$/.test(row[2]) && row[2].length >= 15)).toBe(true);
      expect((authDb.prepare('select count(*) as total from local_accounts').get() as { total: number }).total).toBe(3);
      expect((authDb.prepare('select count(*) as total from local_sessions').get() as { total: number }).total).toBe(0);
      expect(JSON.stringify(authDb.prepare('select salt,digest from local_accounts where user_id=?').get('user-b')) === JSON.stringify(disabledBefore)).toBe(true);
      expect(JSON.stringify(staffDb.prepare('select * from users order by id').all()) === staffBefore).toBe(true);
      expect(JSON.stringify(staffDb.prepare('select * from memberships order by user_id').all()) === membershipsBefore).toBe(true);
      for (const row of rows) {
        const credential = authDb.prepare('select salt,digest from local_accounts where login=?').get(row[1]) as { salt: string; digest: string };
        const derived = await derivePassword(row[2], credential.salt);
        expect(bytesToHex(derived) === credential.digest).toBe(true); derived.fill(0);
      }
      expect(output.mock.calls.length).toBe(1);
      expect(output.mock.calls.every(call => rows.every(row => !String(call[0]).includes(row[2])))).toBe(true);
    } finally {
      process.argv = oldArgs; output.mockRestore(); store?.close(); authDb?.close(); staffDb.close();
      if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('orion-memorable-accounts-')) throw new Error('Unsafe fixture cleanup');
      rmSync(directory, { recursive: true });
    }
  }, 20000);
  it.each(['stage_write', 'database', 'rename'] as const)('keeps credential handoff recoverable on %s failure', async failure => {
    const directory = mkdtempSync(join(tmpdir(), 'orion-memorable-accounts-'));
    Object.assign(isolatedPaths, { directory, staff: join(directory, 'staff.sqlite'), database: join(directory, 'accounts.sqlite'),
      handoff: join(directory, 'accounts.html'), failStageWrite: false, failRename: false });
    const oldArgs = process.argv; const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const staffDb = new DatabaseSync(isolatedPaths.staff);
    const { bytesToHex, derivePassword } = await import('../scripts/local-account-auth');
    const { openLocalAccountStore } = await vi.importActual<typeof import('../scripts/local-account-store')>('../scripts/local-account-store');
    let store: ReturnType<typeof openLocalAccountStore> | undefined; let authDb: DatabaseSync | undefined;
    try {
      staffDb.exec(`create table users(id text primary key,external_issuer text,external_subject text,display_name text,status text);
        create table memberships(user_id text,status text,role text);
        insert into users values('user-a','openai:sites','local_seedy','Synthetic A','active');
        insert into memberships values('user-a','active','doctor');`);
      store = openLocalAccountStore(isolatedPaths.database, isolatedPaths.staff);
      const initial = generateMemorableLocalPassword(); const salt = bytesToHex(randomBytes(16));
      const initialHash = await derivePassword(initial, salt);
      store.provision({ id: 'user-a', issuer: 'openai:sites', subject: 'local_seedy', name: 'Synthetic A' }, 'user-a', salt, bytesToHex(initialHash)); initialHash.fill(0);
      const account = store.loadAccounts()[0];
      store.putSession(bytesToHex(randomBytes(32)), { issuer: account.issuer, subject: account.subject, digest: account.digest,
        created: Date.now(), touched: Date.now(), generation: bytesToHex(randomBytes(16)) });
      store.close(); store = undefined; authDb = new DatabaseSync(isolatedPaths.database);
      const originalAccounts = JSON.stringify(authDb.prepare('select * from local_accounts').all());
      const originalSessions = JSON.stringify(authDb.prepare('select * from local_sessions').all());
      const previous = '<!doctype html><p>Older handoff retained on failure</p>';
      writeFileSync(isolatedPaths.handoff, previous, { mode: 0o600 });
      const unrelated = join(directory, 'accounts-reset-unrelated.html'); writeFileSync(unrelated, 'Unrelated fixture sentinel', { mode: 0o600 });
      if (failure === 'database') authDb.exec(`CREATE TRIGGER reject_reset BEFORE UPDATE ON local_accounts
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DB_FAILURE'); END;`);
      isolatedPaths.failStageWrite = failure === 'stage_write'; isolatedPaths.failRename = failure === 'rename';
      process.argv = [oldArgs[0], 'configure-local-accounts.mjs', '--reset-test-all', '--memorable']; vi.resetModules();
      if (failure !== 'rename') {
        await expect(import('../scripts/configure-local-accounts.mjs')).rejects.toThrow(failure === 'database' ? 'SYNTHETIC_DB_FAILURE' : 'SYNTHETIC_STAGE_WRITE_FAILURE');
        expect(JSON.stringify(authDb.prepare('select * from local_accounts').all()) === originalAccounts).toBe(true);
        expect(JSON.stringify(authDb.prepare('select * from local_sessions').all()) === originalSessions).toBe(true);
        expect(readFileSync(isolatedPaths.handoff, 'utf8') === previous).toBe(true);
        expect(readdirSync(directory).filter(name => /^accounts-reset-[a-f0-9]{32}\.html$/.test(name)).length).toBe(0);
        expect(output.mock.calls.length).toBe(0);
      } else {
        await import('../scripts/configure-local-accounts.mjs');
        const summary = JSON.parse(String(output.mock.calls[0][0]));
        expect(summary.handoffPublication).toBe('retained_private_stage');
        expect(dirname(summary.credentialFile) === directory).toBe(true);
        expect(basename(summary.credentialFile).startsWith('accounts-reset-')).toBe(true);
        expect(existsSync(summary.credentialFile)).toBe(true);
        expect(readFileSync(isolatedPaths.handoff, 'utf8') === previous).toBe(true);
        const staged = readFileSync(summary.credentialFile, 'utf8');
        expect(staged.startsWith(previous)).toBe(true);
        const issued = Array.from(staged.matchAll(/<td><code>([^<]+)<\/code><\/td><td><code>([^<]+)<\/code><\/td>/g));
        expect(issued.length).toBe(1);
        const current = authDb.prepare('select salt,digest from local_accounts where login=?').get(issued[0][1]) as { salt: string; digest: string };
        const hash = await derivePassword(issued[0][2], current.salt);
        expect(bytesToHex(hash) === current.digest).toBe(true); hash.fill(0);
        expect((authDb.prepare('select count(*) as total from local_sessions').get() as { total: number }).total).toBe(0);
        expect(output.mock.calls.every(call => !String(call[0]).includes(issued[0][2]))).toBe(true);
      }
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      process.argv = oldArgs; isolatedPaths.failStageWrite = false; isolatedPaths.failRename = false; output.mockRestore();
      store?.close(); authDb?.close(); staffDb.close();
      if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('orion-memorable-accounts-')) throw new Error('Unsafe fixture cleanup');
      rmSync(directory, { recursive: true });
    }
  }, 20000);
});
