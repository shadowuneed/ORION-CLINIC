import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crmLocalMiddleware } from '../scripts/crm-local-middleware';
import { bytesToHex, derivePassword, localAccountAuth, type VerifiedLocalPrincipal } from '../scripts/local-account-auth';
import type { LocalSession, LocalSessionStore } from '../scripts/local-account-store';
import { parseCrmCommand, parseCrmSnapshot, type CrmCommand } from './crm/contracts';

const snapshot = parseCrmSnapshot({
  schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'crm-test', name: 'Synthetic clinic' },
  rooms: [], staff: [], services: [], patients: [], visits: [], tasks: [], events: [],
  capabilities: { read: true, manage: false }, generatedAt: '2026-10-06T12:00:00.000Z',
});
const command: CrmCommand = {
  type: 'visit.transition', visitId: 'synthetic-visit', action: 'arrive', expectedVersion: 1,
  testDataAcknowledged: true, idempotencyKey: '10000000-0000-4000-8000-000000000001',
};
type Repository = NonNullable<Parameters<typeof crmLocalMiddleware>[0]['repository']>;
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

// Disposable streams and synthetic repository callbacks only: no configuration,
// PG connection, clinical D1, credential file, provider or running app is opened.
function fixture(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
  anonymous?: boolean;
  repository?: Repository | null;
  chunks?: AsyncIterable<Buffer> | Buffer[];
} = {}) {
  const state = { valid: true };
  const revalidate = vi.fn(async () => state.valid);
  const principal: VerifiedLocalPrincipal = Object.freeze({
    issuer: 'orion:synthetic', subject: 'test-staff', generation: 'a'.repeat(32), revalidate,
  });
  const read = vi.fn(async () => snapshot);
  const write = vi.fn(async () => ({ resourceId: 'synthetic-visit', version: 2, replayed: false }));
  const repository: Repository = { snapshot: read, command: write };
  const request = Readable.from(options.chunks ?? [Buffer.from(JSON.stringify(command))]) as unknown as IncomingMessage;
  Object.assign(request, {
    url: options.url ?? '/api/crm/v1/commands', method: options.method ?? 'POST', aborted: false,
    headers: { host: '127.0.0.1:3200', origin: 'http://127.0.0.1:3200', 'content-type': 'application/json', ...options.headers },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' }, rawHeaders: [],
  });
  const result = { body: '', headers: new Map<string, unknown>() };
  const responseState = {
    statusCode: 200, destroyed: false, writableEnded: false,
    setHeader(name: string, value: unknown) { result.headers.set(name.toLowerCase(), value); },
    end(value = '') { result.body = String(value); responseState.writableEnded = true; },
  };
  const response = responseState as unknown as ServerResponse;
  const next = vi.fn();
  const middleware = crmLocalMiddleware({
    port: 3200, principal: () => options.anonymous ? undefined : principal,
    repository: options.repository === undefined ? repository : options.repository, parseCommand: parseCrmCommand,
  });
  return {
    request, response, result, state, principal, revalidate, read, write, next,
    run: () => middleware(request, response, next),
    json: () => JSON.parse(result.body) as { error?: { code: string; message: string } },
  };
}

describe('local CRM middleware private actor and request boundary', () => {
  it('passes non-CRM routes through without principal or repository access', async () => {
    const data = fixture({ url: '/api/workspace', anonymous: true, repository: null });
    await data.run();
    expect(data.next).toHaveBeenCalledOnce();
    expect(data.revalidate).not.toHaveBeenCalled();
    expect(data.result.body).toBe('');
  });

  it('rejects a malformed absolute request target without an unhandled rejection', async () => {
    const data = fixture({ url: 'http://[', anonymous: true });
    await expect(data.run()).resolves.toBeUndefined();
    expect(data.response.statusCode).toBe(400);
    expect(data.next).not.toHaveBeenCalled();
    expect(data.read).not.toHaveBeenCalled();
  });

  it('denies anonymous requests despite forged identity, role, facility and generation headers', async () => {
    const data = fixture({ anonymous: true, headers: {
      'oai-authenticated-user-id': 'administrator', 'x-orion-local-issuer': 'openai:sites',
      'x-orion-local-generation': 'a'.repeat(32), 'x-orion-crm-role': 'admin', 'x-orion-facility': 'crm-test',
    } });
    await data.run();
    expect(data.response.statusCode).toBe(401);
    expect(data.json().error?.code).toBe('AUTHENTICATION_REQUIRED');
    expect(data.write).not.toHaveBeenCalled();
    expect(data.read).not.toHaveBeenCalled();
  });

  it('uses only the private verified issuer/subject and delegates grants to the repository', async () => {
    const data = fixture({ headers: { 'oai-authenticated-user-id': 'forged-admin', 'x-orion-local-issuer': 'forged' } });
    await data.run();
    expect(data.response.statusCode).toBe(200);
    expect(data.write).toHaveBeenCalledWith({ issuer: 'orion:synthetic', subject: 'test-staff' }, command, expect.any(Function));
    expect(data.read).toHaveBeenCalledWith({ issuer: 'orion:synthetic', subject: 'test-staff' }, expect.any(Function));
    expect(data.json()).toEqual(snapshot);
    expect(data.result.headers.get('cache-control')).toBe('no-store');
    expect(data.result.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not infer CRM access from a valid login or a claimed administrator role', async () => {
    const repository: Repository = {
      snapshot: vi.fn(async () => { throw Object.assign(new Error('Private grant detail'), { code: 'ACCESS_DENIED' }); }),
      command: vi.fn(async () => { throw Object.assign(new Error('Private grant detail'), { code: 'ACCESS_DENIED' }); }),
    };
    const data = fixture({ repository, headers: { 'x-orion-crm-role': 'administrator' } });
    await data.run();
    expect(data.response.statusCode).toBe(403);
    expect(data.json().error?.code).toBe('ACCESS_DENIED');
    expect(data.result.body).not.toContain('Private grant detail');
    expect(repository.snapshot).not.toHaveBeenCalled();
  });

  it.each([
    { host: 'evil.test:3200' }, { host: '127.0.0.1:9999' }, { 'x-forwarded-host': 'localhost:3200' },
  ] as Record<string, string>[])('rejects invalid local host or forwarding headers %j', async headers => {
    const data = fixture({ headers });
    await data.run();
    expect(data.response.statusCode).toBe(403);
    expect(data.json().error?.code).toBe('LOCAL_ONLY');
    expect(data.write).not.toHaveBeenCalled();
  });

  it('rejects a non-loopback socket even with a valid Host and private principal', async () => {
    const data = fixture({ remoteAddress: '192.0.2.10' });
    await data.run();
    expect(data.response.statusCode).toBe(403);
    expect(data.write).not.toHaveBeenCalled();
  });

  it.each(['https://external.test', 'null', 'http://localhost:3200', ''])('rejects mutation Origin %s', async origin => {
    const data = fixture({ headers: { origin } });
    await data.run();
    expect(data.response.statusCode).toBe(403);
    expect(data.json().error?.code).toBe('ORIGIN_REJECTED');
    expect(data.write).not.toHaveBeenCalled();
  });

  it('rejects explicit cross-site metadata despite a matching Origin', async () => {
    const data = fixture({ headers: { 'sec-fetch-site': 'cross-site' } });
    await data.run();
    expect(data.response.statusCode).toBe(403);
    expect(data.write).not.toHaveBeenCalled();
  });

  it('reports missing PG configuration honestly for authenticated staff', async () => {
    const data = fixture({ repository: null, method: 'GET', url: '/api/crm/v1/snapshot' });
    await data.run();
    expect(data.response.statusCode).toBe(503);
    expect(data.json().error?.code).toBe('CRM_NOT_CONFIGURED');
    expect(data.result.body).not.toContain('"patients"');
  });

  it('does not expose configuration availability to anonymous requests', async () => {
    const data = fixture({ repository: null, anonymous: true });
    await data.run();
    expect(data.response.statusCode).toBe(401);
    expect(data.json().error?.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it.each([
    ['/api/crm/v1/commands', 'GET', 405], ['/api/crm/v1/unknown', 'POST', 404],
  ])('rejects unsupported route/method %s %s', async (url, method, status) => {
    const data = fixture({ url, method });
    await data.run();
    expect(data.response.statusCode).toBe(status);
    expect(data.write).not.toHaveBeenCalled();
    expect(data.read).not.toHaveBeenCalled();
  });
});

describe('local CRM bounded command parsing and error secrecy', () => {
  it.each(['text/plain', 'application/jsonp', ''])('requires JSON rather than content type %s', async contentType => {
    const data = fixture({ headers: { 'content-type': contentType } });
    await data.run();
    expect(data.response.statusCode).toBe(415);
    expect(data.json().error?.code).toBe('JSON_REQUIRED');
    expect(data.write).not.toHaveBeenCalled();
  });

  it.each(['{', '', 'null', '[]', JSON.stringify({ ...command, role: 'administrator' }), JSON.stringify({ ...command, testDataAcknowledged: false })])
    ('rejects malformed or schema-invalid JSON without a repository command', async body => {
      const data = fixture({ chunks: [Buffer.from(body)] });
      await data.run();
      expect(data.response.statusCode).toBe(400);
      expect(data.json().error?.code).toBe('INVALID_COMMAND');
      expect(data.write).not.toHaveBeenCalled();
      expect(data.read).not.toHaveBeenCalled();
    });

  it('rejects a declared oversized body before consuming it', async () => {
    const consumed = vi.fn();
    async function* body() { consumed(); yield Buffer.from('{}'); }
    const data = fixture({ headers: { 'content-length': '8193' }, chunks: body() });
    await data.run();
    expect(data.response.statusCode).toBe(413);
    expect(consumed).not.toHaveBeenCalled();
    expect(data.write).not.toHaveBeenCalled();
  });

  it('bounds actual UTF-8 bytes without relying on Content-Length', async () => {
    const data = fixture({ chunks: [Buffer.from('Ж'.repeat(4500))] });
    await data.run();
    expect(data.response.statusCode).toBe(413);
    expect(data.json().error?.code).toBe('BODY_TOO_LARGE');
    expect(data.write).not.toHaveBeenCalled();
  });

  it.each(['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_TRANSITION', 'ROOM_BUSY', 'STAFF_BUSY',
    'CRM_SCHEDULE_CONFLICT', 'CRM_OUTSIDE_HOURS', 'CRM_PAST_SLOT', 'CRM_QUEUE_ORDER_CONFLICT', 'CRM_NO_SHOW_TOO_EARLY'])
    ('retains known operational conflict %s but not private driver text', async code => {
      const repository: Repository = {
        snapshot: vi.fn(async () => snapshot),
        command: vi.fn(async () => { throw Object.assign(new Error('Private SQL and connection detail'), { code }); }),
      };
      const data = fixture({ repository });
      await data.run();
      expect(data.response.statusCode).toBe(409);
      expect(data.json().error?.code).toBe(code);
      expect(data.result.body).not.toContain('Private SQL');
    });

  it.each([
    new Error('postgresql://synthetic-example@127.0.0.1:55432 SELECT private_value'),
    Object.assign(new Error('private SQL parameters'), { code: 'SYNTHETIC_DRIVER_DETAIL' }),
  ])('redacts unknown driver messages and codes', async error => {
    const repository: Repository = {
      snapshot: vi.fn(async () => { throw error; }), command: vi.fn(async () => undefined),
    };
    const data = fixture({ repository, method: 'GET', url: '/api/crm/v1/snapshot' });
    await data.run();
    expect(data.response.statusCode).toBe(503);
    expect(data.json().error?.code).toBe('CRM_UNAVAILABLE');
    expect(data.result.body).not.toContain('postgresql');
    expect(data.result.body).not.toContain('SELECT');
    expect(data.result.body).not.toContain('SYNTHETIC_DRIVER_DETAIL');
    expect(data.result.body).not.toContain('private SQL');
  });

  it('sanitizes a throwing error-code accessor without leaking or throwing from the catch block', async () => {
    const error = Object.defineProperty(new Error('Private synthetic driver detail'), 'code', {
      get() { throw new Error('Private accessor detail'); },
    });
    const repository: Repository = {
      snapshot: vi.fn(async () => { throw error; }), command: vi.fn(async () => undefined),
    };
    const data = fixture({ repository, method: 'GET', url: '/api/crm/v1/snapshot' });
    await expect(data.run()).resolves.toBeUndefined();
    expect(data.response.statusCode).toBe(503);
    expect(data.json().error?.code).toBe('CRM_UNAVAILABLE');
    expect(data.result.body).not.toContain('Private');
  });
});

describe('local CRM revalidation across asynchronous boundaries', () => {
  it('rejects an already stale capability before any repository work', async () => {
    const data = fixture(); data.state.valid = false;
    await data.run();
    expect(data.response.statusCode).toBe(409);
    expect(data.json().error?.code).toBe('SESSION_CHANGED');
    expect(data.write).not.toHaveBeenCalled();
    expect(data.read).not.toHaveBeenCalled();
  });

  it('revalidates after reading a delayed body and never commands a revoked session', async () => {
    let retire = () => {};
    async function* body() { yield Buffer.from(JSON.stringify(command)); await Promise.resolve(); retire(); }
    const data = fixture({ chunks: body() });
    retire = () => { data.state.valid = false; };
    await data.run();
    expect(data.revalidate).toHaveBeenCalledTimes(2);
    expect(data.response.statusCode).toBe(409);
    expect(data.write).not.toHaveBeenCalled();
  });

  it('gives the command repository a current-session fence for its own transaction', async () => {
    const repository: Repository = {
      snapshot: vi.fn(async () => snapshot),
      command: vi.fn(async (_actor, _command, revalidate) => {
        data.state.valid = false;
        await revalidate!();
        throw new Error('Unreachable synthetic commit');
      }),
    };
    const data = fixture({ repository });
    await data.run();
    expect(data.response.statusCode).toBe(409);
    expect(data.json().error?.code).toBe('SESSION_CHANGED');
    expect(repository.snapshot).not.toHaveBeenCalled();
    expect(data.result.body).not.toContain('Unreachable');
  });

  it('suppresses a stale snapshot after database completion', async () => {
    const repository: Repository = {
      snapshot: vi.fn(async () => { data.state.valid = false; return snapshot; }),
      command: vi.fn(async () => undefined),
    };
    const data = fixture({ repository, method: 'GET', url: '/api/crm/v1/snapshot' });
    await data.run();
    expect(data.response.statusCode).toBe(409);
    expect(data.json().error?.code).toBe('SESSION_CHANGED');
    expect(data.result.body).not.toContain('Synthetic clinic');
  });

  it('does not read or expose a snapshot after revocation during command completion', async () => {
    const repository: Repository = {
      snapshot: vi.fn(async () => snapshot),
      command: vi.fn(async () => { data.state.valid = false; return undefined; }),
    };
    const data = fixture({ repository });
    await data.run();
    expect(data.response.statusCode).toBe(409);
    expect(repository.snapshot).not.toHaveBeenCalled();
  });

  it('suppresses a post-command snapshot if revocation occurs during its database read', async () => {
    const repository: Repository = {
      snapshot: vi.fn(async () => { data.state.valid = false; return snapshot; }),
      command: vi.fn(async () => undefined),
    };
    const data = fixture({ repository });
    await data.run();
    expect(repository.command).toHaveBeenCalledOnce();
    expect(repository.snapshot).toHaveBeenCalledOnce();
    expect(data.response.statusCode).toBe(409);
    expect(data.json().error?.code).toBe('SESSION_CHANGED');
    expect(data.result.body).not.toContain('Synthetic clinic');
  });

  it('rechecks abortion after asynchronous principal revalidation', async () => {
    const data = fixture({ method: 'GET', url: '/api/crm/v1/snapshot' });
    data.revalidate.mockImplementation(async () => { await Promise.resolve(); data.request.aborted = true; return true; });
    await data.run();
    expect(data.response.statusCode).toBe(409);
    expect(data.read).not.toHaveBeenCalled();
  });

  it('does not publish into a response destroyed during revalidation', async () => {
    const data = fixture({ method: 'GET', url: '/api/crm/v1/snapshot' });
    data.revalidate.mockImplementation(async () => { await Promise.resolve(); data.response.destroyed = true; return true; });
    await data.run();
    expect(data.read).not.toHaveBeenCalled();
    expect(data.result.body).toBe('');
  });
});

it('receives a private local-login capability, strips forgery, and never resurrects it after logout', async () => {
  const generatedPassword = bytesToHex(randomBytes(24));
  const salt = bytesToHex(randomBytes(16));
  const account = { login: 'synthetic-doctor', subject: 'synthetic-subject', issuer: 'orion:synthetic',
    name: 'Synthetic administrator label grants nothing', salt, digest: bytesToHex(await derivePassword(generatedPassword, salt)) };
  const sessions = new Map<string, LocalSession>();
  const put = vi.fn((key: string, session: LocalSession) => { sessions.set(key, { ...session }); });
  const store: LocalSessionStore = {
    getSession: key => sessions.get(key), putSession: put, deleteSession: key => { sessions.delete(key); },
    reserveAttempt: () => true, finishAttempt: () => {},
  };
  const trusted = new WeakMap<IncomingMessage, VerifiedLocalPrincipal>();
  let latest: VerifiedLocalPrincipal | undefined;
  const read = vi.fn(async () => snapshot);
  const write = vi.fn(async () => undefined);
  const server = createServer((req, res) => {
    void handle(req, res, () => {
      void crm(req, res, () => { res.statusCode = 404; res.end(); });
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No disposable test port');
  const origin = `http://127.0.0.1:${address.port}`;
  const handle = localAccountAuth(address.port, async () => [account], Date.now, store, (req, principal) => {
    trusted.set(req, principal); latest = principal;
  });
  const crm = crmLocalMiddleware({ port: address.port, principal: req => trusted.get(req),
    repository: { snapshot: read, command: write }, parseCommand: parseCrmCommand });
  const anonymous = await fetch(`${origin}/api/crm/v1/snapshot`, { headers: {
    'oai-authenticated-user-id': account.subject, 'x-orion-local-issuer': account.issuer, 'x-orion-local-generation': 'a'.repeat(32),
  } });
  expect(anonymous.status).toBe(401);
  expect(latest).toBeUndefined(); expect(read).not.toHaveBeenCalled();
  const loginBody = new URLSearchParams({ login: account.login });
  loginBody.set('password', generatedPassword);
  const login = await fetch(`${origin}/login`, { method: 'POST', redirect: 'manual',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: loginBody,
  });
  expect(login.status).toBe(303);
  const cookies = login.headers.getSetCookie();
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const generation = cookies.find(value => value.startsWith('orion_local_generation='))!.split(';')[0].split('=')[1];
  expect((await fetch(`${origin}/api/crm/v1/snapshot`, { headers: { cookie } })).status).toBe(409);
  expect(latest).toBeUndefined();
  expect((await fetch(`${origin}/api/crm/v1/snapshot`, { headers: { cookie, 'x-orion-local-generation': generation,
    'oai-authenticated-user-id': 'forged-owner', 'x-orion-local-issuer': 'forged-issuer' } })).status).toBe(200);
  expect(read).toHaveBeenCalledWith({ issuer: account.issuer, subject: account.subject }, expect.any(Function));
  const capability = latest!;
  expect(Object.isFrozen(capability)).toBe(true);
  expect(Object.keys(capability).sort()).toEqual(['generation', 'issuer', 'revalidate', 'subject']);
  expect(await capability.revalidate()).toBe(true);
  expect((await fetch(`${origin}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie, origin } })).status).toBe(303);
  const writesAfterLogout = put.mock.calls.length;
  expect(await capability.revalidate()).toBe(false);
  expect(await capability.revalidate()).toBe(false);
  expect(put.mock.calls).toHaveLength(writesAfterLogout);
  expect(sessions.size).toBe(0);
  expect((await fetch(`${origin}/api/crm/v1/snapshot`, { headers: { cookie, 'x-orion-local-generation': generation } })).status).toBe(401);
});
