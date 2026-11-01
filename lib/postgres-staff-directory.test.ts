import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { assertDirectoryAuthority, createPostgresStaffDirectory } from '../scripts/postgres-staff-directory';

const config = { host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app', password: 'synthetic-directory-credential' } as const;
function fixture(source: 'postgres' | 'legacy_d1' = 'postgres', importComplete = true) {
  const people = [{ id: 'u-a', issuer: 'issuer-a', subject: 'subject-a', name: 'Doctor A' }];
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes('mode_v1') ? [{ result: { source, revision: 1, importComplete } }] : sql.includes('principals_v1') ? [{ result: people }] : [] }));
  const release = vi.fn(); const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => undefined) };
  return { directory: createPostgresStaffDirectory(config, pool), pool, query, release, people };
}
describe('trusted PostgreSQL staff-directory provider', () => {
  it('accepts only matching canonical and private authorities', () => {
    expect(() => assertDirectoryAuthority({ source: 'legacy_d1', revision: 1, importComplete: false }, 'legacy_d1')).not.toThrow();
    expect(() => assertDirectoryAuthority({ source: 'legacy_d1', revision: 2, importComplete: true }, 'legacy_d1')).not.toThrow();
    expect(() => assertDirectoryAuthority({ source: 'postgres', revision: 3, importComplete: true }, 'postgresql')).not.toThrow();
    expect(() => assertDirectoryAuthority({ source: 'legacy_d1', revision: 1, importComplete: true }, 'postgresql')).toThrow(/^STAFF_DIRECTORY_UNAVAILABLE$/);
    expect(() => assertDirectoryAuthority({ source: 'postgres', revision: 3, importComplete: true }, 'legacy_d1')).toThrow(/^STAFF_DIRECTORY_UNAVAILABLE$/);
    expect(() => assertDirectoryAuthority({ source: 'postgres', revision: 3, importComplete: true }, 'unknown' as never)).toThrow(/^STAFF_DIRECTORY_UNAVAILABLE$/);
  });
  it.each([
    undefined, null, [], new Error('must not expose driver details'),
    { source: 'postgres', revision: 1, importComplete: false },
    { source: { toString: () => 'postgres' }, revision: 1, importComplete: true },
    { source: 'postgres', revision: 0, importComplete: true },
    { source: 'postgres', revision: 1.5, importComplete: true },
    { source: 'postgres', revision: Number.MAX_SAFE_INTEGER + 1, importComplete: true },
    { source: 'postgres', revision: '1', importComplete: true },
    { source: 'postgres', revision: 1, importComplete: 'true' },
    { source: 'unknown', revision: 1, importComplete: true },
  ])('fails closed for missing or malformed canonical authority %#', value => {
    expect(() => assertDirectoryAuthority(value, 'postgresql')).toThrow(/^STAFF_DIRECTORY_UNAVAILABLE$/);
    expect(() => assertDirectoryAuthority(value, 'legacy_d1')).toThrow(/^STAFF_DIRECTORY_UNAVAILABLE$/);
  });
  it('checks canonical mode and fetches fresh principals on every validation', async () => {
    const f = fixture();
    expect(await f.directory.loadStaff()).toEqual(f.people);
    expect(await f.directory.loadStaff()).toEqual(f.people);
    expect(f.query.mock.calls.map(call => call[0])).toEqual(Array(2).fill([
      'BEGIN READ ONLY', 'SELECT public.orion_directory_mode_v1() AS result',
      'SELECT public.orion_directory_principals_v1() AS result', 'COMMIT',
    ]).flat());
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('can inspect legacy mode but cannot use it as a D1 fallback', async () => {
    const f = fixture('legacy_d1', false);
    expect(await f.directory.mode()).toEqual({ source: 'legacy_d1', revision: 1, importComplete: false });
    await expect(f.directory.loadStaff()).rejects.toThrow('STAFF_DIRECTORY_UNAVAILABLE');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('principals_v1'))).toBe(false);
    expect(f.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('rejects incomplete migrations and sanitizes driver failures', async () => {
    await expect(fixture('postgres', false).directory.loadStaff()).rejects.toThrow('STAFF_DIRECTORY_UNAVAILABLE');
    const f = fixture(); f.pool.connect.mockRejectedValueOnce(new Error('artificial connection details must not leak'));
    await expect(f.directory.loadStaff()).rejects.toThrow(/^STAFF_DIRECTORY_UNAVAILABLE$/);
    expect(f.release).not.toHaveBeenCalled();
  });
  it('rejects alternate endpoints before connecting and never accepts URL overrides', () => {
    const f = fixture();
    expect(() => createPostgresStaffDirectory({ ...config, host: 'external.invalid' } as never, f.pool)).toThrow('STAFF_DIRECTORY_UNAVAILABLE');
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
});
