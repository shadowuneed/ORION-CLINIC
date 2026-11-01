import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePostgresAccountArgs, provisionPostgresAccount } from '../scripts/configure-postgres-account.mjs';
import { bytesToHex, derivePassword } from '../scripts/local-account-auth';
import { openLocalAccountStore, setPostgresAccountAuthority, type StaffRow } from '../scripts/local-account-store';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
function fixture(cutover = true) {
  const directory = mkdtempSync(join(tmpdir(), 'orion-pg-new-account-'));
  cleanup.push(() => { if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('orion-pg-new-account-')) throw new Error('Unsafe fixture cleanup'); rmSync(directory, { recursive: true }); });
  const database = join(directory, 'accounts.sqlite'); const legacy = join(directory, 'legacy.sqlite');
  const d1 = new DatabaseSync(legacy);
  d1.exec(`create table users(id text,external_issuer text,external_subject text,display_name text,status text); create table memberships(user_id text,status text,role text);
    insert into users values('old-user','old-issuer','old-subject','Old employee','active'); insert into memberships values('old-user','active','doctor');`); d1.close();
  const old: StaffRow = { id: 'old-user', issuer: 'old-issuer', subject: 'old-subject', name: 'Old employee' };
  const fresh: StaffRow = { id: 'user-new', issuer: 'orion:local:postgres', subject: 'new-subject', name: '<script>Not markup</script> & name' };
  const store = openLocalAccountStore(database, legacy);
  store.provision(old, 'old-user', 'a'.repeat(32), 'b'.repeat(128));
  store.putSession('c'.repeat(64), { issuer: old.issuer, subject: old.subject, digest: 'b'.repeat(128), created: 1000, touched: 1000, generation: 'd'.repeat(32) }); store.close();
  if (cutover) setPostgresAccountAuthority(database);
  const mode = vi.fn(async () => ({ source: 'postgres', revision: 2, importComplete: true }));
  const loadStaff = vi.fn(async () => [old, fresh]);
  const provider = { source: 'postgresql' as const, mode, loadStaff };
  const paths = { directory, database };
  const rows = () => {
    const db = new DatabaseSync(database, { readOnly: true });
    try { return { accounts: db.prepare('select * from local_accounts order by user_id').all(), sessions: db.prepare('select * from local_sessions').all() }; } finally { db.close(); }
  };
  return { old, fresh, paths, provider, rows, issue: (userId = fresh.id) => provisionPostgresAccount({ userId, paths, directory: provider }) };
}
describe('first PostgreSQL credential PC-only issuance', () => {
  it('issues a private handoff and only a salted password hash, preserving every old credential and session', async () => {
    const f = fixture(); const before = f.rows(); const result = await f.issue();
    expect(Object.keys(result).sort()).toEqual(['credentialFile', 'userId']); expect(result.userId).toBe(f.fresh.id);
    expect(dirname(result.credentialFile)).toBe(f.paths.directory);
    const html = readFileSync(result.credentialFile, 'utf8');
    expect(html).toContain('&lt;script&gt;Not markup&lt;/script&gt; &amp; name'); expect(html).not.toContain('<script>');
    expect(html).toContain("default-src 'none'"); expect(html).not.toContain('<img'); expect(html).not.toContain('https://');
    const password = /id="initial-password">([^<]+)</.exec(html)?.[1]; expect(password).toBeTruthy();
    const after = f.rows(); const row = after.accounts.find(account => account.user_id === f.fresh.id)!;
    const derived = await derivePassword(password!, row.salt as string);
    expect(bytesToHex(derived)).toBe(row.digest); derived.fill(0);
    expect(JSON.stringify(after)).not.toContain(password!);
    expect(after.accounts.filter(account => account.user_id !== f.fresh.id)).toEqual(before.accounts); expect(after.sessions).toEqual(before.sessions);
    expect(f.provider.loadStaff).toHaveBeenCalledTimes(2);
  });
  it('refuses resetting an existing ID, a reused identity, or a second issuance without changing anything', async () => {
    const f = fixture(); const before = f.rows();
    await expect(f.issue(f.old.id)).rejects.toThrow('ALREADY_EXISTS'); expect(f.rows()).toEqual(before);
    f.provider.loadStaff.mockResolvedValue([{ ...f.old, id: f.fresh.id }]);
    await expect(f.issue()).rejects.toThrow('ALREADY_EXISTS'); expect(f.rows()).toEqual(before);
    f.provider.loadStaff.mockResolvedValue([f.old, f.fresh]); const issued = await f.issue();
    const complete = f.rows(); const document = readFileSync(issued.credentialFile);
    await expect(f.issue()).rejects.toThrow('ALREADY_EXISTS'); expect(f.rows()).toEqual(complete); expect(readFileSync(issued.credentialFile)).toEqual(document);
  });
  it.each(['unknown-user', 'service-only-user', 'disabled-user'])('refuses a principal excluded by the authoritative active-interactive directory: %s', async userId => {
    const f = fixture(); const before = f.rows(); await expect(f.issue(userId)).rejects.toThrow('IDENTITY_UNAVAILABLE');
    expect(f.rows()).toEqual(before); expect(readdirSync(f.paths.directory).filter(name => name.endsWith('.html'))).toEqual([]);
  });
  it('fails closed on missing cutover, wrong PG mode, or directory outage', async () => {
    const legacy = fixture(false); const before = legacy.rows(); await expect(legacy.issue()).rejects.toThrow('REQUIRES_CUTOVER'); expect(legacy.provider.mode).not.toHaveBeenCalled(); expect(legacy.rows()).toEqual(before);
    const f = fixture(); f.provider.mode.mockResolvedValue({ source: 'legacy_d1', revision: 1, importComplete: false }); await expect(f.issue()).rejects.toThrow('REQUIRES_CUTOVER');
    f.provider.mode.mockRejectedValue(new Error('synthetic offline')); await expect(f.issue()).rejects.toThrow('synthetic offline'); expect(f.provider.loadStaff).not.toHaveBeenCalled();
  });
  it('rechecks identity after password derivation and refuses a concurrent disable', async () => {
    const f = fixture(); const before = f.rows(); f.provider.loadStaff.mockResolvedValueOnce([f.old, f.fresh]).mockResolvedValueOnce([f.old]);
    await expect(f.issue()).rejects.toThrow('IDENTITY_UNAVAILABLE'); expect(f.rows()).toEqual(before); expect(readdirSync(f.paths.directory).filter(name => name.endsWith('.html'))).toEqual([]);
  });
  it('never overwrites a preexisting private handoff or commits a credential without publishing it', async () => {
    const f = fixture(); const before = f.rows(); const name = `accounts-pg-${createHash('sha256').update(f.fresh.id).digest('hex').slice(0, 24)}.html`;
    const file = join(f.paths.directory, name); writeFileSync(file, 'synthetic-existing-handoff', { flag: 'wx' });
    await expect(f.issue()).rejects.toThrow(); expect(readFileSync(file, 'utf8')).toBe('synthetic-existing-handoff'); expect(f.rows()).toEqual(before);
  });
  it('rejects reset flags, selectors and extra arguments', () => {
    for (const args of [[], ['--reset', 'user-new'], ['../user'], ['user-new', 'extra'], ['user@example.test']]) expect(() => parsePostgresAccountArgs(args)).toThrow();
    expect(parsePostgresAccountArgs(['user-new'])).toBe('user-new');
  });
});
