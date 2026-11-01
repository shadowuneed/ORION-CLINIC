import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { regionalLocalMiddleware } from '../../scripts/regional-local-middleware';
import { createRegionalPostgresRepository } from '../../scripts/regional-postgres-repository';
import type { VerifiedLocalPrincipal } from '../../scripts/local-account-auth';
import type { RegionalDirectiveCommand } from './directives';

const command: RegionalDirectiveCommand = { type: 'progress', assignmentId: 'assignment-a', expectedVersion: 1,
  progress: 85, idempotencyKey: '10000000-0000-4000-8000-000000000001' };
const writeResult = { directiveId: 'directive-a', assignmentId: 'assignment-a', version: 2, replayed: false };
const snapshot = { schemaVersion: 1, dataMode: 'training', generatedAt: '2026-10-09T10:00:00Z', today: '2026-10-09',
  actorId: 'head-a', capabilities: { issue: false, review: false }, facilities: [], directives: [] };
const bytes = Buffer.from('Отчёт о выполненной работе');
const attachment = { schemaVersion: 1, contentBase64: bytes.toString('base64'), attachment: {
  id: 'file-a', fileName: 'Отчёт.txt', mimeType: 'text/plain', purpose: 'report', byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), uploadedAt: '2026-10-09T10:00:00Z' } };

function fixture(input: { path?: string; method?: string; body?: unknown; anonymous?: boolean; valid?: boolean;
  headers?: Record<string, string | undefined>; address?: string } = {}) {
  const principal: VerifiedLocalPrincipal = { issuer: 'orion:local:directives', subject: 'head-a', generation: 'a'.repeat(32), revalidate: vi.fn(async () => input.valid !== false) };
  const directives = vi.fn(async () => snapshot);
  const directiveCommand = vi.fn(async () => writeResult);
  const directiveAttachment = vi.fn(async () => attachment);
  const req = Readable.from([Buffer.from(JSON.stringify(input.body ?? command))]) as unknown as IncomingMessage;
  Object.assign(req, { url: input.path ?? '/api/regional/v1/directives/commands', method: input.method ?? 'POST', aborted: false,
    headers: { host: '127.0.0.1:3200', origin: 'http://127.0.0.1:3200', 'content-type': 'application/json', 'x-orion-directive-actor': 'head-a', ...input.headers },
    socket: { remoteAddress: input.address ?? '127.0.0.1' } });
  const response = { statusCode: 0, destroyed: false, writableEnded: false, body: '' as string | Buffer, headers: new Map<string, unknown>(),
    setHeader(name: string, value: unknown) { this.headers.set(name, value); }, end(value: string | Buffer) { this.body = value; this.writableEnded = true; } };
  const handler = regionalLocalMiddleware({ port: 3200, principal: () => input.anonymous ? undefined : principal,
    repository: { directives, directiveCommand, directiveAttachment } as unknown as NonNullable<Parameters<typeof regionalLocalMiddleware>[0]['repository']> });
  return { response, directives, directiveCommand, directiveAttachment, principal, run: () => handler(req, response as unknown as ServerResponse, vi.fn()) };
}
describe('directive authenticated HTTP API', () => {
  it('binds commands to the verified actor and returns a canonical snapshot after commit', async () => {
    const x = fixture(); await x.run(); expect(x.response.statusCode).toBe(200);
    expect(x.directiveCommand).toHaveBeenCalledWith({ issuer: 'orion:local:directives', subject: 'head-a' }, command, expect.any(Function));
    expect(JSON.parse(String(x.response.body))).toEqual({ result: writeResult, snapshot });
    expect(x.response.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each([
    [{ anonymous: true }, 401], [{ valid: false }, 409], [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { origin: undefined } }, 403], [{ headers: { host: 'evil.example:3200' } }, 403],
    [{ address: '10.0.0.3' }, 403], [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: { 'content-length': '9437185' } }, 413], [{ body: { ...command, actorId: 'directive-admin' } }, 400],
    [{ body: { ...command, dueDate: '2026-12-31' } }, 400],
    [{ method: 'GET' }, 405], [{ path: '/api/regional/v1/directives/commands?subject=admin' }, 400],
  ])('rejects unsafe write %#', async (options, status) => {
    const x = fixture(options); await x.run(); expect(x.response.statusCode).toBe(status); expect(x.directiveCommand).not.toHaveBeenCalled();
  });
  it('reads only explicit permitted query fields', async () => {
    const x = fixture({ path: '/api/regional/v1/directives?facilityId=turkestan-hospital', method: 'GET' }); await x.run();
    expect(x.directives).toHaveBeenCalledWith(expect.any(Object), { facilityId: 'turkestan-hospital' }, expect.any(Function));
  });
  it.each(['?actorId=admin', '?facilityId=a&facilityId=b', '?facilityId=../a'])('rejects query ambiguity %s', async query => {
    const x = fixture({ path: `/api/regional/v1/directives${query}`, method: 'GET' }); await x.run();
    expect(x.response.statusCode).toBe(400); expect(x.directives).not.toHaveBeenCalled();
  });
  it('validates uploaded bytes before a transactional command', async () => {
    const x = fixture({ body: { ...command, type: 'submit', progress: undefined, actualCompletedDate: '2026-10-09',
      attachments: [{ fileName: 'report.pdf', mimeType: 'application/pdf', purpose: 'report', contentBase64: bytes.toString('base64') }] } });
    await x.run(); expect(x.response.statusCode).toBe(400); expect(x.directiveCommand).not.toHaveBeenCalled();
  });
  it('does not read snapshot or disclose a receipt after post-commit session loss', async () => {
    const x = fixture(); x.directiveCommand.mockImplementationOnce(async () => { vi.mocked(x.principal.revalidate).mockResolvedValue(false); return writeResult; });
    await x.run(); expect(x.response.statusCode).toBe(409); expect(x.directives).toHaveBeenCalledOnce(); expect(String(x.response.body)).not.toContain('directive-a');
  });
  it('snapshot failure after committed command is unknown, not a false success', async () => {
    const x = fixture(); x.directives.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error('private query'));
    await x.run(); expect(x.response.statusCode).toBe(503); expect(String(x.response.body)).not.toContain('private');
  });
  it('fences stale-account uploads before any command executes', async () => {
    for (const actor of [undefined, 'someone-else']) {
      const x = fixture({ headers: { 'x-orion-directive-actor': actor } }); await x.run();
      expect(x.response.statusCode).toBe(409); expect(x.directiveCommand).not.toHaveBeenCalled();
    }
  });
  it.each(['DIRECTIVE_VERSION_CONFLICT', 'DIRECTIVE_COMPLETION_DATE_LOCKED', 'DIRECTIVE_REWORK_DATE_REQUIRED', 'DIRECTIVE_EXPLANATION_REQUIRED'])('maps explicit rollback rejection %s without SQL', async code => {
    const x = fixture(); x.directiveCommand.mockRejectedValue({ code, message: 'sensitive database detail' }); await x.run();
    expect(x.response.statusCode).toBe(409); expect(JSON.parse(String(x.response.body)).error.code).toBe(code); expect(String(x.response.body)).not.toContain('sensitive');
  });
  it('forces private attachment download and verifies digest before responding', async () => {
    const x = fixture({ path: '/api/regional/v1/directive-attachments/file-a', method: 'GET' }); await x.run();
    expect(x.response.statusCode).toBe(200); expect(x.response.body).toEqual(bytes);
    expect(x.response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(x.response.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(x.response.headers.get('Cache-Control')).toBe('no-store');
    expect(x.response.headers.get('Content-Security-Policy')).toContain('sandbox');
  });
  it('never returns corrupted stored bytes or data after revoked download authority', async () => {
    const corrupt = fixture({ path: '/api/regional/v1/directive-attachments/file-a', method: 'GET' });
    corrupt.directiveAttachment.mockResolvedValueOnce({ ...attachment, attachment: { ...attachment.attachment, sha256: '0'.repeat(64) } });
    await corrupt.run(); expect(corrupt.response.statusCode).toBe(503); expect(Buffer.isBuffer(corrupt.response.body)).toBe(false);
    const revoked = fixture({ path: '/api/regional/v1/directive-attachments/file-a', method: 'GET' });
    revoked.directiveAttachment.mockImplementationOnce(async () => { vi.mocked(revoked.principal.revalidate).mockResolvedValue(false); return attachment; });
    await revoked.run(); expect(revoked.response.statusCode).toBe(409); expect(Buffer.isBuffer(revoked.response.body)).toBe(false);
  });
});

describe('directive transactional repository', () => {
  const config = { host: '127.0.0.1' as const, port: 55432 as const, database: 'orion_crm_local' as const, user: 'orion_crm_app' as const, password: 'unit'.repeat(12) };
  function setup(value: unknown) {
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [{ result: value }] : [] }));
    const release = vi.fn(); const client = { query, release } as unknown as PoolClient;
    const repository = createRegionalPostgresRepository(config, { connect: async () => client, end: async () => undefined });
    return { query, release, repository };
  }
  it('uses dedicated RPC and validates the result before commit', async () => {
    const x = setup(writeResult); await expect(x.repository.directiveCommand({ issuer: 'i', subject: 's' }, command)).resolves.toEqual(writeResult);
    expect(x.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'SELECT public.orion_regional_directive_command_v1($1::text,$2::text,$3::jsonb) AS result', 'COMMIT']);
  });
  it('rolls back malformed snapshot, command or attachment responses', async () => {
    for (const method of ['directives', 'directiveCommand', 'directiveAttachment'] as const) {
      const x = setup({ source: 'painted' });
      const promise = method === 'directives' ? x.repository.directives({ issuer: 'i', subject: 's' }, {}) : method === 'directiveCommand'
        ? x.repository.directiveCommand({ issuer: 'i', subject: 's' }, command) : x.repository.directiveAttachment({ issuer: 'i', subject: 's' }, 'file-a');
      await expect(promise).rejects.toMatchObject({ code: 'REGIONAL_UNAVAILABLE' });
      expect(x.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(x.release).toHaveBeenCalledOnce();
    }
  });
  it('revalidates before commit and suppresses receipt if session changes', async () => {
    const x = setup(writeResult); let n = 0;
    await expect(x.repository.directiveCommand({ issuer: 'i', subject: 's' }, command, async () => { if (++n === 4) throw new Error('SESSION_CHANGED'); })).rejects.toThrow('SESSION_CHANGED');
    expect(x.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
