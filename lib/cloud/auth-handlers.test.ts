import { describe, expect, it, vi } from 'vitest';
import { handleCloudAuth } from './auth-handlers.server';
import { cloudAuthCookies } from './auth-session.server';

const origin = 'https://orion.example.invalid';
const ref = 'abcdefghijklmnopqrst';
const source = { ORION_SUPABASE_PROJECT_REF: ref, ORION_SUPABASE_URL: `https://${ref}.supabase.co`,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'example'.repeat(5)}`, ORION_CLOUD_PUBLIC_ORIGIN: origin };
const nonce = 'n'.repeat(43);
const subject = '11111111-1111-4111-8111-111111111111';
const token = `example.${Buffer.from(JSON.stringify({ iss: `${source.ORION_SUPABASE_URL}/auth/v1`, sub: subject,
  session_id: '22222222-2222-4222-8222-222222222222', role: 'authenticated', is_anonymous: false,
  exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.example`;
const pair = { access_token: token, refresh_token: 'r'.repeat(12), expires_in: 3600, token_type: 'bearer' };
const user = { id: subject, email: 'staff@example.invalid', role: 'authenticated', is_anonymous: false };
const body = { csrfToken: nonce, email: user.email, password: 'example-password' };
function request(operation: string, payload: unknown = body, overrides: Record<string, string> = {}, method = 'POST') {
  return new Request(`${origin}/api/auth/cloud/${operation}`, { method,
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
      Cookie: `${cloudAuthCookies.csrf}=${nonce}`, ...overrides }, ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}) });
}

describe('cloud authentication HTTP boundary', () => {
  it('issues a nonce only through the exact same-origin endpoint', async () => {
    const response = await handleCloudAuth('csrf', request('csrf', null, {}, 'GET'), source);
    const value = await response.json() as { csrfToken: string };
    expect(response.status).toBe(200);
    expect(value.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Lax');
    expect(response.headers.get('set-cookie')).toContain('__Host-orion-cloud-csrf');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each<Record<string, string>>([{ Origin: 'https://evil.example.invalid' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' }])('rejects login from an untrusted origin/site', async (headers) => {
    const send = vi.fn<typeof fetch>();
    const response = await handleCloudAuth('login', request('login', body, headers), source, { fetch: send });
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it('requires the Origin header on mutation, ignoring forwarded identities/origins', async () => {
    const send = vi.fn<typeof fetch>();
    const value = request('login'); value.headers.delete('origin');
    value.headers.set('x-forwarded-host', new URL(origin).host);
    value.headers.set('oai-authenticated-user-id', subject);
    expect((await handleCloudAuth('login', value, source, { fetch: send })).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a foreign request URL even when the Origin and forwarded-host pretend to match', async () => {
    const send = vi.fn<typeof fetch>();
    const value = new Request('https://foreign.example.invalid/api/auth/cloud/login', { method: 'POST', headers: {
      Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', Cookie: `${cloudAuthCookies.csrf}=${nonce}`,
      'x-forwarded-host': new URL(origin).host,
    }, body: JSON.stringify(body) });
    expect((await handleCloudAuth('login', value, source, { fetch: send })).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ ...body, csrfToken: 'x'.repeat(43) }, { ...body, csrfToken: 'invalid' }, { ...body, csrfToken: undefined }])('rejects mismatched or absent CSRF tokens', async (payload) => {
    const send = vi.fn<typeof fetch>();
    expect((await handleCloudAuth('login', request('login', payload), source, { fetch: send })).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ ...body, role: 'administrator' }, { ...body, email: 'invalid' }, { ...body, password: '' }])('rejects extra grants or invalid credentials before provider access', async (payload) => {
    const send = vi.fn<typeof fetch>();
    expect((await handleCloudAuth('login', request('login', payload), source, { fetch: send })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects form submissions and oversized JSON', async () => {
    expect((await handleCloudAuth('login', request('login', body, { 'Content-Type': 'application/x-www-form-urlencoded' }), source)).status).toBe(415);
    expect((await handleCloudAuth('login', request('login', { ...body, password: 'x'.repeat(13_000) }), source)).status).toBe(400);
  });
  it('puts a legacy 12-character refresh token only in protected host cookies, never the response JSON', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pair)).mockResolvedValueOnce(Response.json(user));
    const response = await handleCloudAuth('login', request('login'), source, { fetch: send });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies.find(value => value.startsWith(`${cloudAuthCookies.refresh}=`))).toContain(`${cloudAuthCookies.refresh}=${pair.refresh_token};`);
    for (const value of cookies) {
      expect(value).toContain('Path=/'); expect(value).toContain('Secure');
      if (!value.startsWith(`${cloudAuthCookies.generation}=`)) expect(value).toContain('HttpOnly');
      expect(value).toContain('SameSite=Lax');
      expect(value).not.toContain('Domain=');
    }
    const generation = cookies.find(value => value.startsWith(`${cloudAuthCookies.generation}=`));
    expect(generation).toContain('22222222222242228222222222222222');
    expect(generation).not.toContain('HttpOnly');
  });
  it('requires explicit logout before changing accounts', async () => {
    const send = vi.fn<typeof fetch>();
    const response = await handleCloudAuth('login', request('login', body, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.access}=${token}` }), source, { fetch: send });
    expect(response.status).toBe(409); expect(send).not.toHaveBeenCalled();
  });
  it('does not bypass explicit logout through duplicate or malformed stored cookies', async () => {
    const send = vi.fn<typeof fetch>();
    const response = await handleCloudAuth('login', request('login', body, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.access}=malformed; ${cloudAuthCookies.access}=${token}` }), source, { fetch: send });
    expect(response.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it('clears a malformed local session without claiming that the provider revoked it', async () => {
    const send = vi.fn<typeof fetch>();
    const response = await handleCloudAuth('logout', request('logout', { csrfToken: nonce }, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.access}=malformed; ${cloudAuthCookies.access}=${token}` }), source, { fetch: send });
    expect(response.status).toBe(503);
    expect(response.headers.get('X-ORION-Local-Session-Cleared')).toBe('true');
    expect(await response.text()).not.toContain('providerSessionRevoked');
    expect(send).not.toHaveBeenCalled();
  });
  it('clears cookies only after an origin/CSRF-protected logout', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await handleCloudAuth('logout', request('logout', { csrfToken: nonce }, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.access}=${token}` }), source, { fetch: send });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, providerSessionRevoked: true });
    expect(response.headers.getSetCookie().every((value) => value.includes('Max-Age=0'))).toBe(true);
    expect(response.headers.getSetCookie()).toHaveLength(4);
    expect(response.headers.getSetCookie().find(value => value.startsWith(`${cloudAuthCookies.generation}=`))).not.toContain('HttpOnly');
  });
  it('reports failed provider revocation, even when local cookies are cleared', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('example-password'));
    const response = await handleCloudAuth('logout', request('logout', { csrfToken: nonce }, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.access}=${token}` }), source, { fetch: send });
    expect(response.status).toBe(503);
    expect(response.headers.get('X-ORION-Local-Session-Cleared')).toBe('true');
    expect(await response.text()).not.toContain('example-password');
  });
  it('rejects logout GET without touching provider sessions', async () => {
    const send = vi.fn<typeof fetch>();
    expect((await handleCloudAuth('logout', request('logout', null, {}, 'GET'), source, { fetch: send })).status).toBe(405);
    expect(send).not.toHaveBeenCalled();
  });
  it('refreshes only the HttpOnly cookie token and never returns tokens in JSON', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pair)).mockResolvedValueOnce(Response.json(user));
    const response = await handleCloudAuth('refresh', request('refresh', { csrfToken: nonce }, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.refresh}=${pair.refresh_token}` }), source, { fetch: send });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
    expect(response.headers.getSetCookie().find(value => value.startsWith(`${cloudAuthCookies.generation}=`))).toContain('22222222222242228222222222222222');
  });
  it.each([401, 429])('clears rejected refresh credentials, but preserves them on a provider rate limit %s', async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const response = await handleCloudAuth('refresh', request('refresh', { csrfToken: nonce }, { Cookie: `${cloudAuthCookies.csrf}=${nonce}; ${cloudAuthCookies.refresh}=${pair.refresh_token}` }), source, { fetch: send });
    expect(response.status).toBe(status);
    if (status === 401) {
      expect(response.headers.get('X-ORION-Local-Session-Cleared')).toBe('true');
      expect(response.headers.getSetCookie()).toHaveLength(4);
    } else {
      expect(response.headers.get('X-ORION-Local-Session-Cleared')).toBeNull();
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
  });
  it('exposes only verified non-bearer generation metadata for stale-tab fencing', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(user));
    const response = await handleCloudAuth('session', request('session', null, { Cookie: `${cloudAuthCookies.access}=${token}; ${cloudAuthCookies.generation}=forged` }, 'GET'), source, { fetch: send });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toEqual({ authenticated: true, principal: { issuer: `${source.ORION_SUPABASE_URL}/auth/v1`, subject, email: user.email }, generation: '22222222222242228222222222222222' });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(pair.refresh_token);
    expect(result).not.toHaveProperty('sessionId');
    expect(result).not.toHaveProperty('role');
  });
  it('does not expose provider errors or configuration values', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('example-password', { status: 401 }));
    const response = await handleCloudAuth('login', request('login'), source, { fetch: send });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('example-password');
    expect((await handleCloudAuth('login', request('login'), {})).status).toBe(503);
  });
});
