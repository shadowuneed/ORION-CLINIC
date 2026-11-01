import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { regionalCommandSchema, regionalOverviewSchema, type RegionalCommand } from './contracts';
import { regionalLocalMiddleware } from '../../scripts/regional-local-middleware';
import { createRegionalPostgresRepository } from '../../scripts/regional-postgres-repository';
import type { VerifiedLocalPrincipal } from '../../scripts/local-account-auth';

const command: RegionalCommand = { facilityId: 'turkestan-hospital', type: 'task.transition', taskId: 'task-1',
  expectedVersion: 1, status: 'in_progress', idempotencyKey: '10000000-0000-4000-8000-000000000001' };
function fixture(input: { path?: string; method?: string; anonymous?: boolean; valid?: boolean; body?: unknown;
  host?: string; origin?: string; address?: string; contentType?: string; length?: string } = {}) {
  const principal: VerifiedLocalPrincipal = { issuer: 'orion:test', subject: 'unit-only', generation: 'a'.repeat(32), revalidate: vi.fn(async () => input.valid !== false) };
  const overview = vi.fn(async () => ({ source: 'canonical' }));
  const scope = vi.fn(async () => ({ canViewRegion: false, facilities: [] }));
  const facility = vi.fn(async () => ({ facility: 'canonical' }));
  const kpi = vi.fn(async () => ({ source: 'postgres-kpi' }));
  const kpiEvidence = vi.fn(async () => ({ source: 'postgres-evidence' }));
  const write = vi.fn(async () => ({ resourceId: 'task-1', version: 2, replayed: false }));
  const req = Readable.from([Buffer.from(JSON.stringify(input.body ?? command))]) as unknown as IncomingMessage;
  Object.assign(req, { url: input.path ?? '/api/regional/v1/commands', method: input.method ?? 'POST', aborted: false,
    headers: { host: input.host ?? '127.0.0.1:3200', origin: input.origin ?? 'http://127.0.0.1:3200', 'content-type': input.contentType ?? 'application/json',
      ...(input.length ? { 'content-length': input.length } : {}) }, socket: { remoteAddress: input.address ?? '127.0.0.1' } });
  const result = { statusCode: 0, destroyed: false, writableEnded: false, body: '', headers: new Map<string, unknown>(),
    setHeader(key: string, value: unknown) { this.headers.set(key, value); }, end(value: string) { this.body = value; this.writableEnded = true; } };
  const next = vi.fn();
  const middleware = regionalLocalMiddleware({ port: 3200, principal: () => input.anonymous ? undefined : principal,
    repository: { scope, overview, facility, kpi, kpiEvidence, command: write } as unknown as NonNullable<Parameters<typeof regionalLocalMiddleware>[0]['repository']> });
  return { result, scope, overview, facility, kpi, kpiEvidence, write, next, principal, run: () => middleware(req, result as unknown as ServerResponse, next) };
}
describe('regional HTTP boundary', () => {
  it('uses only verified actor and returns committed result with refreshed canonical facility', async () => {
    const x = fixture(); await x.run(); expect(x.result.statusCode).toBe(200);
    expect(x.write).toHaveBeenCalledWith({ issuer: 'orion:test', subject: 'unit-only' }, command, expect.any(Function));
    expect(x.facility).toHaveBeenCalledWith({ issuer: 'orion:test', subject: 'unit-only' }, command.facilityId, expect.any(Function));
    expect(JSON.parse(x.result.body)).toEqual({ result: { resourceId: 'task-1', version: 2, replayed: false }, snapshot: { facility: 'canonical' } });
    expect(x.result.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each([
    [{ anonymous: true }, 401], [{ valid: false }, 409], [{ host: 'evil.example:3200' }, 403],
    [{ origin: 'https://evil.example' }, 403], [{ address: '10.0.0.1' }, 403], [{ contentType: 'text/plain' }, 415],
    [{ length: '8193' }, 413], [{ body: { ...command, actor: 'user-a' } }, 400], [{ method: 'GET' }, 405],
  ])('rejects unauthorized, cross-origin and malformed command %#', async (options, status) => {
    const x = fixture(options); await x.run(); expect(x.result.statusCode).toBe(status); expect(x.write).not.toHaveBeenCalled(); expect(x.facility).not.toHaveBeenCalled();
  });
  it('overview and facility IDs go to separate scoped repository methods', async () => {
    const s = fixture({ path: '/api/regional/v1/scope', method: 'GET' }); await s.run(); expect(s.scope).toHaveBeenCalledOnce(); expect(s.overview).not.toHaveBeenCalled();
    const a = fixture({ path: '/api/regional/v1/overview', method: 'GET' }); await a.run(); expect(a.overview).toHaveBeenCalledOnce();
    const b = fixture({ path: '/api/regional/v1/facilities/sayram-hospital', method: 'GET' }); await b.run(); expect(b.facility).toHaveBeenCalledWith(expect.any(Object), 'sayram-hospital', expect.any(Function));
  });
  it('a lost session after commit suppresses response and does not perform subsequent snapshot', async () => {
    const x = fixture(); x.write.mockImplementationOnce(async () => { vi.mocked(x.principal.revalidate).mockResolvedValue(false); return { resourceId: 'task-1', version: 2, replayed: false }; });
    await x.run(); expect(x.result.statusCode).toBe(409); expect(x.facility).not.toHaveBeenCalled();
  });
  it('driver errors never reveal SQL, host passwords or internal messages', async () => {
    const x = fixture(); x.write.mockRejectedValueOnce(new Error('postgres://sensitive-connection SELECT clinical_text')); await x.run();
    expect(x.result.statusCode).toBe(503); expect(x.result.body).not.toMatch(/postgres|SELECT|sensitive/);
  });
  it('does not consume other namespaces', async () => { const x = fixture({ path: '/api/clinical/v1/snapshot' }); await x.run(); expect(x.next).toHaveBeenCalledOnce(); expect(x.write).not.toHaveBeenCalled(); });
  it('loads period-filtered KPI with server-verified identity and no-store', async () => {
    const x = fixture({ path: '/api/regional/v1/kpi?start=2026-09-01&end=2026-09-30&facilityId=turkestan-hospital', method: 'GET' });
    await x.run(); expect(x.result.statusCode).toBe(200);
    expect(x.kpi).toHaveBeenCalledWith({ issuer: 'orion:test', subject: 'unit-only' },
      { start: '2026-09-01', end: '2026-09-30', facilityId: 'turkestan-hospital' }, expect.any(Function));
    expect(x.result.headers.get('Cache-Control')).toBe('no-store'); expect(x.facility).not.toHaveBeenCalled();
  });
  it.each([
    '', '?start=2026-09-01', '?start=2026-02-30&end=2026-03-01', '?start=2026-10-01&end=2026-09-01',
    '?start=2024-01-01&end=2026-09-01', '?start=2026-09-01&end=2026-09-30&issuer=admin',
    '?start=2026-09-01&start=2026-08-01&end=2026-09-30', '?start=2026-09-01&end=2026-09-30&facilityId=../other',
  ])('rejects malformed or ambiguous KPI selectors %s', async query => {
    const x = fixture({ path: `/api/regional/v1/kpi${query}`, method: 'GET' }); await x.run();
    expect(x.result.statusCode).toBe(400); expect(x.kpi).not.toHaveBeenCalled();
  });
  it('does not expose KPI data if the principal is revoked during the read', async () => {
    const x = fixture({ path: '/api/regional/v1/kpi?start=2026-09-01&end=2026-09-30', method: 'GET' });
    x.kpi.mockImplementationOnce(async () => { vi.mocked(x.principal.revalidate).mockResolvedValue(false); return { source: 'postgres-kpi' }; });
    await x.run(); expect(x.result.statusCode).toBe(409); expect(x.result.body).not.toContain('postgres-kpi');
  });
  it('reads a bounded evidence page with verified identity and parsed offset', async () => {
    const x = fixture({ path: '/api/regional/v1/kpi/evidence?start=2026-09-01&end=2026-09-30&facilityId=turkestan-hospital&indicatorId=complaints-hospital&offset=20', method: 'GET' });
    await x.run(); expect(x.result.statusCode).toBe(200);
    expect(x.kpiEvidence).toHaveBeenCalledWith({ issuer: 'orion:test', subject: 'unit-only' },
      { start: '2026-09-01', end: '2026-09-30', facilityId: 'turkestan-hospital', indicatorId: 'complaints-hospital', offset: 20 }, expect.any(Function));
    expect(x.result.headers.get('Cache-Control')).toBe('no-store'); expect(x.kpi).not.toHaveBeenCalled();
  });
  it.each(['&offset=-1', '&offset=1e2', '&offset=01', '&offset=10001', '&offset=1.1', '&offset=0&offset=20', '&subject=admin'])('rejects unsafe evidence pagination/identity %s', async extra => {
    const x = fixture({ path: `/api/regional/v1/kpi/evidence?start=2026-09-01&end=2026-09-30&facilityId=turkestan-hospital&indicatorId=complaints-hospital${extra}`, method: 'GET' });
    await x.run(); expect(x.result.statusCode).toBe(400); expect(x.kpiEvidence).not.toHaveBeenCalled();
  });
  it('requires an explicit facility for underlying evidence', async () => {
    const x = fixture({ path: '/api/regional/v1/kpi/evidence?start=2026-09-01&end=2026-09-30&indicatorId=lab-turnaround', method: 'GET' });
    await x.run(); expect(x.result.statusCode).toBe(400); expect(x.kpiEvidence).not.toHaveBeenCalled();
  });
  it('discards evidence if the session changes during reading', async () => {
    const x = fixture({ path: '/api/regional/v1/kpi/evidence?start=2026-09-01&end=2026-09-30&facilityId=turkestan-hospital&indicatorId=lab-turnaround', method: 'GET' });
    x.kpiEvidence.mockImplementationOnce(async () => { vi.mocked(x.principal.revalidate).mockResolvedValue(false); return { source: 'postgres-evidence' }; });
    await x.run(); expect(x.result.statusCode).toBe(409); expect(x.result.body).not.toContain('postgres-evidence');
  });
  it('returns a safe 400 for a database-rejected indicator profile', async () => {
    const x = fixture({ path: '/api/regional/v1/kpi/evidence?start=2026-09-01&end=2026-09-30&facilityId=turkestan-polyclinic&indicatorId=doctor-staffing', method: 'GET' });
    x.kpiEvidence.mockRejectedValueOnce({ code: 'REGIONAL_KPI_INVALID_QUERY', message: 'sensitive SQL detail' });
    await x.run(); expect(x.result.statusCode).toBe(400); expect(x.result.body).not.toMatch(/sensitive|SQL/);
  });
});

describe('regional repository durability', () => {
  const config = { host: '127.0.0.1' as const, port: 55432 as const, database: 'orion_crm_local' as const,
    user: 'orion_crm_app' as const, password: 'unit'.repeat(12) };
  function poolFixture(response: unknown = { resourceId: 'task-1', version: 2, replayed: false }) {
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [{ result: response }] : [] }));
    const release = vi.fn(); const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => undefined) };
    return { query, release, pool, repository: createRegionalPostgresRepository(config, pool) };
  }
  it('commits only after returned DTO and current session are validated', async () => {
    const x = poolFixture(); const current = vi.fn(async () => undefined);
    expect(await x.repository.command({ issuer: 'unit', subject: 'actor' }, command, current)).toEqual({ resourceId: 'task-1', version: 2, replayed: false });
    expect(x.query.mock.calls.map(row => row[0])).toEqual(['BEGIN', 'SELECT public.orion_regional_command_v1($1::text,$2::text,$3::jsonb) AS result', 'COMMIT']);
    expect(current).toHaveBeenCalledTimes(5); expect(x.release).toHaveBeenCalledOnce();
  });
  it('invalid DB response rolls back command/audit/receipt instead of returning painted success', async () => {
    const x = poolFixture({ resourceId: 'task-1', version: -1, replayed: false });
    await expect(x.repository.command({ issuer: 'unit', subject: 'actor' }, command)).rejects.toMatchObject({ code: 'REGIONAL_UNAVAILABLE' });
    expect(x.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(x.query.mock.calls.some(row => row[0] === 'COMMIT')).toBe(false);
  });
  it('session failure before commit rolls back and preserves explicit authentication error', async () => {
    const x = poolFixture(); let n = 0; const current = async () => { n++; if (n === 4) throw new Error('SESSION_CHANGED'); };
    await expect(x.repository.command({ issuer: 'unit', subject: 'actor' }, command, current)).rejects.toThrow('SESSION_CHANGED');
    expect(x.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rejects wrong database targets and rejects new requests after close', async () => {
    expect(() => createRegionalPostgresRepository({ ...config, database: 'other' } as never)).toThrow();
    const x = poolFixture(); await x.repository.close(); await expect(x.repository.overview({ issuer: 'unit', subject: 'actor' })).rejects.toMatchObject({ code: 'REGIONAL_UNAVAILABLE' }); expect(x.pool.connect).not.toHaveBeenCalled();
  });
  it('contracts reject extra privilege fields, invalid training IDs and unbounded counters', () => {
    expect(regionalCommandSchema.safeParse({ ...command, actorUserId: 'user-a' }).success).toBe(false);
    expect(regionalOverviewSchema.safeParse({ schemaVersion: 1, totals: { patientCount: Infinity } }).success).toBe(false);
  });
  it('rejects invalid KPI output before committing its audit and returning data', async () => {
    const x = poolFixture({ schemaVersion: 1, dataMode: 'production', source: 'painted' });
    await expect(x.repository.kpi({ issuer: 'unit', subject: 'actor' }, { start: '2026-09-01', end: '2026-09-30' })).rejects.toMatchObject({ code: 'REGIONAL_UNAVAILABLE' });
    expect(x.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(x.query.mock.calls.some(row => row[0] === 'COMMIT')).toBe(false);
  });
  it('preserves a safe database profile/query error instead of reporting outage', async () => {
    const x = poolFixture();
    x.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) throw Object.assign(new Error('REGIONAL_KPI_INVALID_QUERY'), { code: 'PT400' });
      return { rows: [] };
    });
    await expect(x.repository.kpiEvidence({ issuer: 'unit', subject: 'actor' }, { start: '2026-09-01', end: '2026-09-30', facilityId: 'turkestan-polyclinic', indicatorId: 'doctor-staffing' })).rejects.toMatchObject({ code: 'REGIONAL_KPI_INVALID_QUERY', status: 400 });
    expect(x.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
