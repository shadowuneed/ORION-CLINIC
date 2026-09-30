import { describe, expect, it, vi } from 'vitest';
import type { StaffCredentialRepository } from '../repositories/staff-credentials';
import { createStaffVerificationRuntime } from './staff-runtime';
import { STAFF_SESSION_COOKIE, type StaffSession, type StaffSessionRepository } from './staff-session';

const origin = 'https://staff.example.test';
const token = 'a'.repeat(64);
const valid: StaffSession = {
  sessionId: 'private-session-id', userId: 'internal-staff-a', displayName: 'Synthetic Doctor A',
  principal: { issuer: 'orion:staff', subject: 'external-subject-a', email: null },
  createdAt: 1, lastSeenAt: 1, idleExpiresAt: 2, absoluteExpiresAt: 3,
};
function fixture(value: StaffSession | null = valid) {
  const sessions = {
    create: vi.fn<StaffSessionRepository['create']>().mockResolvedValue(null),
    resolve: vi.fn<StaffSessionRepository['resolve']>().mockResolvedValue(value),
    revoke: vi.fn<StaffSessionRepository['revoke']>().mockResolvedValue(undefined),
    revokeAll: vi.fn<StaffSessionRepository['revokeAll']>().mockResolvedValue(undefined),
  };
  const credentials = {
    reserveAttempt: vi.fn<StaffCredentialRepository['reserveAttempt']>().mockResolvedValue({ status: 'throttled', retryAfterSeconds: 13 }),
    finishAttempt: vi.fn<StaffCredentialRepository['finishAttempt']>().mockResolvedValue(null),
  };
  return { sessions, credentials, fetch: createStaffVerificationRuntime({ sessions, credentials }, { origin }) };
}
function request(path: string, init: RequestInit = {}) {
  return new Request(`${origin}${path}`, { ...init, headers: { Cookie: `${STAFF_SESSION_COOKIE}=${token}`, ...init.headers } });
}
function privateResponse(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

describe('isolated staff verification transport (not mounted in clinical app)', () => {
  it.each(['http://staff.example.test', `${origin}/`, `${origin}/staff`, `${origin}?role=admin`, 'https://user:password@staff.example.test', 'not-a-url'])('rejects invalid configured origin %s', value => {
    const { sessions, credentials } = fixture();
    expect(() => createStaffVerificationRuntime({ sessions, credentials }, { origin: value })).toThrow();
  });
  it('does not follow later mutation of the supplied origin', async () => {
    const deps = fixture();
    const options = { origin };
    const fetch = createStaffVerificationRuntime(deps, options);
    options.origin = 'https://attacker.example.test';
    expect((await fetch(request('/staff'))).status).toBe(200);
    expect((await fetch(new Request(`${options.origin}/staff`))).status).toBe(403);
  });
  it.each(['/patients', '/api/patients', '/__proto__', '/constructor', '/toString', '/staff/', '/%73taff'])('has no clinical or wildcard route at %s', async path => {
    const test = fixture();
    const response = await test.fetch(request(path));
    expect(response.status).toBe(404);
    privateResponse(response);
    expect(test.sessions.resolve).not.toHaveBeenCalled();
  });
  it.each([
    ['/staff', 'POST', 'GET'], ['/api/staff/session', 'HEAD', 'GET'],
    ['/api/staff/login', 'GET', 'POST'], ['/api/staff/logout', 'GET', 'POST'],
    ['/sign-in', 'OPTIONS', 'GET'],
  ])('rejects non-contract method %s %s', async (path, method, allow) => {
    const test = fixture();
    const response = await test.fetch(request(path, { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe(allow);
    privateResponse(response);
    expect(test.sessions.resolve).not.toHaveBeenCalled();
    expect(test.sessions.revoke).not.toHaveBeenCalled();
  });
  it.each(['?next=https://attacker.example.test', '?userId=admin', '?token=secret', '#fragment'])('rejects URL input %s rather than use it as identity/redirect', async suffix => {
    const test = fixture();
    const response = await test.fetch(request(`/staff${suffix}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(test.sessions.resolve).not.toHaveBeenCalled();
  });
  it.each([
    ['Origin', 'https://attacker.example.test'], ['Origin', 'null'],
    ['Sec-Fetch-Site', 'cross-site'], ['Sec-Fetch-Site', 'same-site'],
    ['Sec-Fetch-Site', 'unexpected'],
  ])('rejects cross-origin reads before identity resolution (%s=%s)', async (name, value) => {
    const test = fixture();
    const response = await test.fetch(request('/api/staff/session', { headers: { [name]: value } }));
    expect(response.status).toBe(403);
    expect(test.sessions.resolve).not.toHaveBeenCalled();
  });
  it('does not use forged forwarded host to approve a different target origin', async () => {
    const test = fixture();
    const response = await test.fetch(new Request('https://attacker.example.test/staff', { headers: {
      Cookie: `${STAFF_SESSION_COOKIE}=${token}`, 'X-Forwarded-Host': 'staff.example.test', Origin: origin,
    } }));
    expect(response.status).toBe(403);
    expect(test.sessions.resolve).not.toHaveBeenCalled();
  });
  it('shares exact identity between SSR and API without leaking a session row', async () => {
    const test = fixture();
    const api = await test.fetch(request('/api/staff/session'));
    expect(await api.json()).toEqual({
      user: { id: valid.userId, displayName: valid.displayName, email: null }, principal: valid.principal,
    });
    const ssr = await test.fetch(request('/staff', { headers: { 'Sec-Fetch-Site': 'none' } }));
    const text = await ssr.text();
    expect(text).toContain(`data-staff-user-id="${valid.userId}"`);
    expect(text).toContain(`data-staff-subject="${valid.principal.subject}"`);
    expect(text).not.toContain(valid.sessionId);
    expect(text).not.toContain(token);
    expect(test.sessions.resolve).toHaveBeenCalledTimes(2);
    privateResponse(api); privateResponse(ssr);
  });
  it('escapes server fields in SSR text and quoted attributes', async () => {
    const evil = '<script>alert("x")</script>&\'';
    const test = fixture({ ...valid, userId: evil, displayName: evil, principal: { issuer: evil, subject: evil, email: null } });
    const response = await test.fetch(request('/staff'));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
    privateResponse(response);
  });
  it('has only a fixed sign-in redirect for unauthenticated SSR, never for API', async () => {
    const test = fixture(null);
    const ssr = await test.fetch(request('/staff'));
    expect(ssr.status).toBe(303);
    expect(ssr.headers.get('location')).toBe('/sign-in');
    const api = await test.fetch(request('/api/staff/session'));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    expect(api.headers.get('location')).toBeNull();
    privateResponse(ssr); privateResponse(api);
  });
  it('returns unavailable, not an anonymous redirect or raw DB error', async () => {
    const test = fixture();
    test.sessions.resolve.mockRejectedValue(new Error('private-user-sql-secret'));
    for (const path of ['/staff', '/api/staff/session']) {
      const response = await test.fetch(request(path));
      expect(response.status).toBe(503);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).not.toContain('private-user-sql-secret');
      privateResponse(response);
    }
  });
  it('keeps technical sign-in page independent of storage and without a misleading working form', async () => {
    const test = fixture();
    const response = await test.fetch(request('/sign-in'));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('Изолированный технический контур');
    expect(text).not.toContain('<form');
    expect(test.sessions.resolve).not.toHaveBeenCalled();
    privateResponse(response);
  });
  it('delegates login to the durable attempt limiter without a mocked password verifier', async () => {
    const test = fixture();
    const response = await test.fetch(request('/api/staff/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'doctor.a', password: 'synthetic test password' }),
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('13');
    expect(test.credentials.reserveAttempt).toHaveBeenCalledOnce();
    expect(test.sessions.create).not.toHaveBeenCalled();
    privateResponse(response);
  });
  it('does not allow login/logout POST without explicit same Origin', async () => {
    const test = fixture();
    for (const path of ['/api/staff/login', '/api/staff/logout']) {
      const response = await test.fetch(request(path, { method: 'POST' }));
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(test.credentials.reserveAttempt).not.toHaveBeenCalled();
    expect(test.sessions.revoke).not.toHaveBeenCalled();
  });
  it('clears cookie only after durable logout succeeds', async () => {
    const test = fixture();
    const req = () => request('/api/staff/logout', { method: 'POST', headers: { Origin: origin } });
    test.sessions.revoke.mockRejectedValueOnce(new Error('private storage failure'));
    const failed = await test.fetch(req());
    expect(failed.status).toBe(503);
    expect(failed.headers.get('set-cookie')).toBeNull();
    const success = await test.fetch(req());
    expect(success.status).toBe(204);
    expect(success.headers.get('set-cookie')).toContain('Max-Age=0');
    privateResponse(failed); privateResponse(success);
  });
});
