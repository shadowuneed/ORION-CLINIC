import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { directoryLocalMiddleware } from '../../scripts/directory-local-middleware';
import type { VerifiedLocalPrincipal } from '../../scripts/local-account-auth';
const command = { type: 'account.create', clinicId: 'clinic', name: 'Synthetic employee', idempotencyKey: '10000000-0000-4000-8000-000000000001' };
const result = { resourceId: 'membership', userId: 'user', version: 1, replayed: false };
const snapshot = { schemaVersion: 1 as const, clinic: { id: 'clinic', name: 'Synthetic clinic' }, accounts: [], memberships: [], assignments: [], staff: [], generatedAt: '2026-10-07T00:00:00.000Z' };
function fixture(options: { url?: string; method?: string; headers?: Record<string, string>; anonymous?: boolean; unconfigured?: boolean; remoteAddress?: string; chunks?: Buffer[] | AsyncIterable<Buffer> } = {}) {
  const state = { valid: true }; const revalidate = vi.fn(async () => state.valid);
  const principal: VerifiedLocalPrincipal = { issuer: 'unit', subject: 'verified-doctor', generation: 'a'.repeat(32), revalidate };
  const read = vi.fn(async () => snapshot); const write = vi.fn(async () => result);
  const request = Readable.from(options.chunks ?? [Buffer.from(JSON.stringify(command))]) as unknown as IncomingMessage;
  Object.assign(request, { url: options.url ?? '/api/directory/v1/commands', method: options.method ?? 'POST', aborted: false,
    headers: { host: '127.0.0.1:3200', origin: 'http://127.0.0.1:3200', 'content-type': 'application/json', ...options.headers }, socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' } });
  const data = { body: '', headers: new Map<string, unknown>() };
  const response = { statusCode: 200, destroyed: false, writableEnded: false,
    setHeader(name: string, value: unknown) { data.headers.set(name.toLowerCase(), value); }, end(value = '') { data.body = String(value); response.writableEnded = true; } };
  const next = vi.fn();
  const middleware = directoryLocalMiddleware({ port: 3200, principal: () => options.anonymous ? undefined : principal, repository: options.unconfigured ? null : { snapshot: read, command: write } });
  return { state, request, response, read, write, next, data, revalidate, run: () => middleware(request, response as unknown as ServerResponse, next), json: () => JSON.parse(data.body) };
}
describe('directory HTTP private identity, origin and schema gates', () => {
  it('passes other namespaces without touching identity or storage', async () => {
    const f = fixture({ url: '/api/clinical/v1/snapshot' }); await f.run(); expect(f.next).toHaveBeenCalledOnce(); expect(f.revalidate).not.toHaveBeenCalled();
  });
  it('rejects anonymous forged headers and hides directory availability', async () => {
    const f = fixture({ anonymous: true, unconfigured: true, headers: { 'oai-authenticated-user-id': 'admin', 'x-orion-role': 'administrator' } });
    await f.run(); expect(f.response.statusCode).toBe(401); expect(f.write).not.toHaveBeenCalled(); expect(f.data.body).not.toContain('DIRECTORY_UNAVAILABLE');
  });
  it('uses verified principal only and returns no opportunistic snapshot after mutation', async () => {
    const f = fixture({ headers: { 'oai-authenticated-user-id': 'forged-admin' } }); await f.run(); expect(f.response.statusCode).toBe(200);
    expect(f.write).toHaveBeenCalledWith({ issuer: 'unit', subject: 'verified-doctor' }, command, expect.any(Function)); expect(f.read).not.toHaveBeenCalled();
    expect(f.json()).toEqual(result); expect(f.data.headers.get('cache-control')).toBe('no-store');
  });
  it('passes clinic only as a resource selector', async () => {
    const f = fixture({ method: 'GET', url: '/api/directory/v1/snapshot?clinicId=clinic' }); await f.run(); expect(f.response.statusCode).toBe(200);
    expect(f.read).toHaveBeenCalledWith({ issuer: 'unit', subject: 'verified-doctor' }, 'clinic', expect.any(Function));
  });
  it.each(['', '?clinicId=x&clinicId=y', '?clinicId=x&role=administrator', '?clinicId=%27'])('rejects ambiguous or unsupported snapshot selectors %s', async query => {
    const f = fixture({ method: 'GET', url: `/api/directory/v1/snapshot${query}` }); await f.run(); expect(f.response.statusCode).toBe(400); expect(f.read).not.toHaveBeenCalled();
  });
  it.each([{ host: 'evil.test:3200' }, { 'x-forwarded-host': 'localhost:3200' }, { origin: 'null' }, { origin: 'http://localhost:3200' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[])('rejects host/origin forgery %j', async headers => {
    const f = fixture({ headers }); await f.run(); expect(f.response.statusCode).toBe(403); expect(f.write).not.toHaveBeenCalled();
  });
  it('rejects non-loopback sockets even with a private principal', async () => {
    const f = fixture({ remoteAddress: '192.0.2.1' }); await f.run(); expect(f.response.statusCode).toBe(403); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', JSON.stringify({ ...command, issuer: 'admin' }), JSON.stringify({ ...command, roles: ['administrator'] })])('rejects malformed JSON or untrusted authority in command %s', async body => {
    const f = fixture({ chunks: [Buffer.from(body)] }); await f.run(); expect(f.response.statusCode).toBe(400); expect(f.write).not.toHaveBeenCalled();
  });
  it('bounds declared bytes before consuming a stream', async () => {
    const consumed = vi.fn(); async function* chunks() { consumed(); yield Buffer.from('{}'); }
    const f = fixture({ headers: { 'content-length': '16385' }, chunks: chunks() }); await f.run(); expect(f.response.statusCode).toBe(413); expect(consumed).not.toHaveBeenCalled();
  });
  it('bounds actual bytes and rejects invalid UTF8', async () => {
    const oversized = fixture({ chunks: [Buffer.from('Ж'.repeat(9000))] }); await oversized.run(); expect(oversized.response.statusCode).toBe(413);
    const invalid = fixture({ chunks: [Buffer.from([0xff])] }); await invalid.run(); expect(invalid.response.statusCode).toBe(400);
  });
  it('revalidates after a delayed body and after repository work', async () => {
    const f = fixture(); f.write.mockImplementation(async () => { f.state.valid = false; return result; }); await f.run(); expect(f.response.statusCode).toBe(409); expect(f.json().error.code).toBe('SESSION_CHANGED');
    let revoke = () => {}; async function* chunks() { revoke(); yield Buffer.from(JSON.stringify(command)); }
    const delayed = fixture({ chunks: chunks() }); revoke = () => { delayed.state.valid = false; }; await delayed.run(); expect(delayed.response.statusCode).toBe(409); expect(delayed.write).not.toHaveBeenCalled();
  });
  it.each([['DIRECTORY_ACCESS_DENIED', 403], ['DIRECTORY_LAST_ADMIN_REQUIRED', 409], ['synthetic-private-driver-code', 503], ['__proto__', 503], ['constructor', 503]])('exposes only bounded public repository error %s', async (code, status) => {
    const f = fixture(); f.write.mockRejectedValue(Object.assign(new Error('private driver detail'), { code })); await f.run(); expect(f.response.statusCode).toBe(status);
    expect(f.data.body).not.toContain('private driver detail'); expect(f.json().error.code).toBe(status === 503 ? 'DIRECTORY_UNAVAILABLE' : code);
  });
  it.each([['GET', '/api/directory/v1/commands', 405], ['POST', '/api/directory/v1/unknown', 404]])('rejects method/route %s %s', async (method, url, status) => {
    const f = fixture({ method, url }); await f.run(); expect(f.response.statusCode).toBe(status); expect(f.write).not.toHaveBeenCalled();
  });
});
