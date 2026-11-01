import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalAccountStore, readLocalAccountAuthority, setPostgresAccountAuthority, type StaffRow } from '../scripts/local-account-store';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orion-authority-test-'));
  cleanup.push(() => { if (dirname(root) !== tmpdir() || !basename(root).startsWith('orion-authority-test-')) throw new Error('Unsafe fixture cleanup'); rmSync(root, { recursive: true }); });
  const legacy = join(root, 'legacy.sqlite'); const auth = join(root, 'accounts.sqlite');
  const db = new DatabaseSync(legacy);
  db.exec(`create table users(id text,external_issuer text,external_subject text,display_name text,status text);
    create table memberships(user_id text,status text,role text);
    insert into users values('u-a','issuer-a','subject-a','Legacy name','active');
    insert into memberships values('u-a','active','doctor');`);
  db.close();
  const person: StaffRow = { id: 'u-a', issuer: 'issuer-a', subject: 'subject-a', name: 'Postgres name' };
  const initial = openLocalAccountStore(auth, legacy);
  initial.provision(person, 'doctor-a', 'a'.repeat(32), 'b'.repeat(128));
  initial.putSession('c'.repeat(64), { issuer: person.issuer, subject: person.subject, digest: 'b'.repeat(128), created: 1000, touched: 1000, generation: 'd'.repeat(32) });
  initial.close();
  return { root, legacy, auth, person };
}

describe('explicit local PostgreSQL identity authority cutover', () => {
  it('preserves existing credentials and sessions while refusing a D1 downgrade', async () => {
    const f = fixture();
    expect(readLocalAccountAuthority(f.auth)).toBe('legacy_d1');
    const before = new DatabaseSync(f.auth, { readOnly: true });
    const credentials = before.prepare('select * from local_accounts').all(); const sessions = before.prepare('select * from local_sessions').all(); before.close();
    const old = openLocalAccountStore(f.auth, f.legacy); cleanup.push(() => old.close());
    setPostgresAccountAuthority(f.auth); setPostgresAccountAuthority(f.auth);
    expect(readLocalAccountAuthority(f.auth)).toBe('postgresql');
    expect(() => old.loadAccounts()).toThrow('authority changed');
    await expect(old.loadActiveAccounts()).rejects.toThrow('authority changed');
    expect(() => openLocalAccountStore(f.auth, f.legacy)).toThrow('fallback is forbidden');
    const after = new DatabaseSync(f.auth, { readOnly: true });
    expect(after.prepare('select * from local_accounts').all()).toEqual(credentials);
    expect(after.prepare('select * from local_sessions').all()).toEqual(sessions); after.close();
  });

  it('queries PG fresh each time and immediately reflects names and revocations', async () => {
    const f = fixture(); setPostgresAccountAuthority(f.auth);
    let staff = [f.person];
    const loadStaff = vi.fn(async () => staff);
    const store = openLocalAccountStore(f.auth, { source: 'postgresql', loadStaff }); cleanup.push(() => store.close());
    expect((await store.loadActiveAccounts())[0]).toMatchObject({ login: 'doctor-a', name: 'Postgres name' });
    staff = [{ ...f.person, name: 'Updated verified name' }];
    expect((await store.loadActiveAccounts())[0].name).toBe('Updated verified name');
    staff = [];
    expect(await store.loadActiveAccounts()).toEqual([]);
    expect(loadStaff).toHaveBeenCalledTimes(3);
    expect(() => store.loadAccounts()).toThrow('async validation');
    expect(() => store.provision(f.person, 'doctor-a', 'a'.repeat(32), 'b'.repeat(128))).toThrow('provisioning is unavailable');
  });

  it('fails closed on PG outages, malformed identities, and same-name impersonation', async () => {
    const f = fixture(); setPostgresAccountAuthority(f.auth);
    const loadStaff = vi.fn(async (): Promise<StaffRow[]> => { throw new Error('artificial offline'); });
    const store = openLocalAccountStore(f.auth, { source: 'postgresql', loadStaff }); cleanup.push(() => store.close());
    await expect(store.loadActiveAccounts()).rejects.toThrow('artificial offline');
    loadStaff.mockResolvedValue([{ ...f.person, subject: 'different-subject' }]);
    expect(await store.loadActiveAccounts()).toEqual([]);
    loadStaff.mockResolvedValue([{ ...f.person, id: 'different-source-id' }]);
    expect(await store.loadActiveAccounts()).toEqual([]);
    loadStaff.mockResolvedValue([f.person, { ...f.person }]);
    await expect(store.loadActiveAccounts()).rejects.toThrow('Ambiguous');
    loadStaff.mockResolvedValue([{ ...f.person, issuer: '' }]);
    await expect(store.loadActiveAccounts()).rejects.toThrow('Invalid');
  });

  it('does not silently enable a PG provider or create a fresh store on cutover', () => {
    const f = fixture();
    expect(() => openLocalAccountStore(f.auth, { source: 'postgresql', loadStaff: async () => [f.person] })).toThrow('source mismatch');
    expect(() => setPostgresAccountAuthority(join(f.root, 'missing.sqlite'))).toThrow('Existing private credential');
  });
});
