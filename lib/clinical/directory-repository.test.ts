import type { PoolClient } from 'pg';
import { describe, it, expect, vi } from 'vitest';
import { createDirectoryPostgresRepository } from '../../scripts/directory-postgres-repository';
const config = { host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app', password: 'synthetic-directory-unit-only' } as const;
const actor = { issuer: 'unit', subject: 'doctor' };
const snapshot = { schemaVersion: 1, clinic: { id: 'clinic', name: 'Synthetic clinic' }, accounts: [], memberships: [], assignments: [], staff: [], generatedAt: '2026-10-07T00:00:00.000Z' };
const command = { type: 'account.create', clinicId: 'clinic', name: 'Synthetic employee', idempotencyKey: '10000000-0000-4000-8000-000000000001' } as const;
function fixture(result: unknown = snapshot) {
  const query = vi.fn(async (text: string, values?: unknown[]) => { void values; return text.startsWith('SELECT') ? { rows: [{ result }] } : { rows: [] }; });
  const release = vi.fn(); const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => undefined) };
  return { query, release, pool, repository: createDirectoryPostgresRepository(config, pool) };
}
describe('directory repository trusted RPC boundary', () => {
  it('parameterizes exact verified actor and clinic in an audited transaction', async () => {
    const f = fixture(); await expect(f.repository.snapshot(actor, 'clinic')).resolves.toEqual(snapshot);
    expect(f.query.mock.calls).toEqual([['BEGIN'], ['SELECT public.orion_directory_snapshot_v1($1::text,$2::text,$3::text) AS result', ['unit', 'doctor', 'clinic']], ['COMMIT']]);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('uses only the directory command RPC and returns its exact resource', async () => {
    const result = { resourceId: 'membership', userId: 'user', version: 1, replayed: false };
    const f = fixture(result); expect(await f.repository.command(actor, command)).toEqual(result);
    expect(f.query.mock.calls[1][0]).toBe('SELECT public.orion_directory_command_v1($1::text,$2::text,$3::jsonb) AS result');
    expect(f.query.mock.calls[1][1]?.slice(0, 2)).toEqual(['unit', 'doctor']);
    expect(JSON.parse(f.query.mock.calls[1][1]?.[2] as string)).toEqual(command);
  });
  it('rejects alternate config, injected clinic and identity payload fields before connections', () => {
    expect(() => createDirectoryPostgresRepository({ ...config, host: 'remote' } as never)).toThrow('DIRECTORY_UNAVAILABLE');
    const f = fixture(); expect(() => f.repository.snapshot(actor, "clinic' OR true")).toThrow();
    expect(() => f.repository.command(actor, { ...command, issuer: 'admin' } as never)).toThrow(); expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('rolls back on revocation before execution and emits no driver details', async () => {
    const f = fixture(); let count = 0; const changed = Object.assign(new Error('changed'), { code: 'SESSION_CHANGED' });
    await expect(f.repository.snapshot(actor, 'clinic', async () => { if (++count === 3) throw changed; })).rejects.toBe(changed);
    expect(f.query.mock.calls.map(c => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
  });
  it('does not commit malformed or overbroad database output', async () => {
    const f = fixture({ ...snapshot, credentials: 'must-not-leave' });
    await expect(f.repository.snapshot(actor, 'clinic')).rejects.toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' });
    expect(f.query.mock.calls.map(c => c[0])).toEqual(['BEGIN', 'SELECT public.orion_directory_snapshot_v1($1::text,$2::text,$3::text) AS result', 'ROLLBACK']);
  });
  it.each([
    [{ code: 'PT403', message: 'DIRECTORY_ACCESS_DENIED' }, 'DIRECTORY_ACCESS_DENIED'],
    [{ code: '28P01', message: 'private driver detail' }, 'DIRECTORY_UNAVAILABLE'],
    [{ code: 'PT409', message: 'private driver detail' }, 'DIRECTORY_UNAVAILABLE'],
  ])('redacts driver errors outside exact SQLSTATE and public code pairs', async (error, code) => {
    const f = fixture(); f.query.mockRejectedValueOnce(error);
    await expect(f.repository.snapshot(actor, 'clinic')).rejects.toMatchObject({ code }); expect(f.release).toHaveBeenCalledOnce();
  });
  it('withholds result on late revocation without claiming a committed write was rolled back', async () => {
    const f = fixture(); let count = 0; const changed = Object.assign(new Error('changed'), { code: 'SESSION_CHANGED' });
    await expect(f.repository.snapshot(actor, 'clinic', async () => { if (++count === 5) throw changed; })).rejects.toBe(changed);
    expect(f.query.mock.calls.map(c => c[0])).toContain('COMMIT'); expect(f.query.mock.calls.map(c => c[0])).not.toContain('ROLLBACK');
  });
});
