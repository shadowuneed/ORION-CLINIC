import { describe, expect, it, vi } from 'vitest';
import { parseCloudAuthConfig } from './auth-config.server';
import { cloudAuthCookies, cloudCookie, exchangeCloudTokens, readCloudAccessToken, readCloudAuthJson,
  readCloudAuthSession, revokeCloudSession } from './auth-session.server';

const ref = 'abcdefghijklmnopqrst';
const source = { ORION_SUPABASE_PROJECT_REF: ref, ORION_SUPABASE_URL: `https://${ref}.supabase.co`,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'example'.repeat(5)}`, ORION_CLOUD_PUBLIC_ORIGIN: 'https://orion.example.invalid' };
const config = parseCloudAuthConfig(source);
const subject = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const claims = { iss: config.supabase.issuer, sub: subject, session_id: sessionId, role: 'authenticated', is_anonymous: false,
  exp: Math.floor(Date.now() / 1000) + 3600 };
const jwt = (values = claims) => `example.${Buffer.from(JSON.stringify(values)).toString('base64url')}.example`;
const token = jwt();
const pair = { access_token: token, refresh_token: 'r'.repeat(12), expires_in: 3600, token_type: 'bearer',
  user: { id: subject, app_metadata: { roles: ['administrator'] } } };
const user = { id: subject, role: 'authenticated', is_anonymous: false, email: 'staff@example.invalid', user_metadata: { role: 'administrator' } };
const cookie = (value = token) => new Headers({ cookie: `${cloudAuthCookies.access}=${value}` });

describe('cloud auth configuration and cookies', () => {
  it.each(['http://orion.example.invalid', 'https://orion.example.invalid/path', 'https://orion.example.invalid?key=example',
    'https://user:example@orion.example.invalid', 'https://orion.example.invalid:444', 'https://localhost', 'https://127.0.0.1', 'https://[::1]'])('rejects unsafe public origin %s', (origin) => {
    expect(() => parseCloudAuthConfig({ ...source, ORION_CLOUD_PUBLIC_ORIGIN: origin })).toThrow('missing or invalid');
  });
  it('rejects missing cloud origin instead of trusting forwarded headers', () => {
    expect(() => parseCloudAuthConfig({ ...source, ORION_CLOUD_PUBLIC_ORIGIN: undefined })).toThrow();
  });
  it('rejects duplicate, malformed or excessively large bearer cookies', () => {
    expect(readCloudAccessToken(cookie())).toBe(token);
    expect(readCloudAccessToken(new Headers({ cookie: `${cloudAuthCookies.access}=${token}; ${cloudAuthCookies.access}=forged` }))).toBeNull();
    expect(readCloudAccessToken(cookie('not-a-jwt'))).toBeNull();
    expect(readCloudAccessToken(cookie(`${'x'.repeat(8193)}.x.x`))).toBeNull();
    expect(cloudCookie(cookie('example%2eexample%2eexample'), cloudAuthCookies.access)).toBeNull();
  });
});

describe('verified cloud identity and password protocol', () => {
  it('verifies the upstream user before accepting JWT session metadata', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(user));
    const session = await readCloudAuthSession(cookie(), source, { fetch: send });
    expect(session).toEqual({ principal: { issuer: config.supabase.issuer, subject, email: user.email }, sessionId });
    expect(session).not.toHaveProperty('role');
    expect(session).not.toHaveProperty('permissions');
    expect(session).not.toHaveProperty('access');
  });
  it('ignores forged Sites headers completely', async () => {
    const send = vi.fn<typeof fetch>();
    const headers = new Headers({ 'oai-authenticated-user-id': subject, 'x-orion-local-issuer': 'admin', 'x-orion-local-generation': 'a'.repeat(32) });
    expect(await readCloudAuthSession(headers, source, { fetch: send })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ ...claims, iss: 'https://other.example.invalid/auth/v1' }, { ...claims, sub: sessionId },
    { ...claims, session_id: 'forged' }, { ...claims, role: 'service_role' }, { ...claims, is_anonymous: true },
    { ...claims, exp: 1 }])('rejects claims inconsistent with verified upstream identity', async (invalid) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(user));
    await expect(readCloudAuthSession(cookie(jwt(invalid)), source, { fetch: send })).rejects.toThrow('temporarily unavailable');
  });
  it.each(['r'.repeat(12), 'r'.repeat(32)])('accepts provider refresh-token formats after password grant and user verification', async (refresh) => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...pair, refresh_token: refresh })).mockResolvedValueOnce(Response.json(user));
    const result = await exchangeCloudTokens(config, { email: user.email, password: 'example password' }, send);
    expect(result.session.principal.subject).toBe(subject);
    expect(result.refresh).toBe(refresh);
    expect(send.mock.calls[0][0]).toBe(`${config.supabase.origin}/auth/v1/token?grant_type=password`);
    expect(send.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'error', cache: 'no-store',
      body: JSON.stringify({ email: user.email, password: 'example password' }) }));
    expect(send.mock.calls[1][0]).toBe(`${config.supabase.origin}/auth/v1/user`);
    expect(result.session).not.toHaveProperty('app_metadata');
  });
  it('rotates the refresh token through the real refresh grant', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pair)).mockResolvedValueOnce(Response.json(user));
    await exchangeCloudTokens(config, { refresh_token: pair.refresh_token }, send);
    expect(send.mock.calls[0][0]).toBe(`${config.supabase.origin}/auth/v1/token?grant_type=refresh_token`);
    expect(send.mock.calls[0][1]?.body).toBe(JSON.stringify({ refresh_token: pair.refresh_token }));
  });
  it.each(['r'.repeat(11), 'r'.repeat(2049), `${'r'.repeat(12)};injected=value`, `${'r'.repeat(12)}\r\n`, `${'r'.repeat(12)}\n`,
    `${'r'.repeat(12)} space`, `${'r'.repeat(12)}%2e`])('rejects unsafe refresh transport before provider access', async (refresh) => {
    const send = vi.fn<typeof fetch>();
    await expect(exchangeCloudTokens(config, { refresh_token: refresh }, send)).rejects.toThrow('authentication was rejected');
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['r'.repeat(11), 'r'.repeat(2049), `${'r'.repeat(12)};injected=value`, `${'r'.repeat(12)}\r\n`, `${'r'.repeat(12)}\n`])('rejects unsafe refresh transport in a provider response', async (refresh) => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...pair, refresh_token: refresh }));
    await expect(exchangeCloudTokens(config, { email: user.email, password: 'example password' }, send)).rejects.toThrow('temporarily unavailable');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 422, 429])('sanitizes upstream denial %s', async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('example-password', { status }));
    await expect(exchangeCloudTokens(config, { email: user.email, password: 'example password' }, send)).rejects.toThrow('authentication was rejected');
  });
  it.each([{ ...pair, access_token: 'forged' }, { ...pair, refresh_token: 'invalid' }, { ...pair, expires_in: 0 },
    { ...pair, expires_in: 86401 }, { ...pair, token_type: 'service_role' }])('rejects invalid token pair', async (invalid) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(invalid));
    await expect(exchangeCloudTokens(config, { email: user.email, password: 'example password' }, send)).rejects.toThrow('temporarily unavailable');
  });
  it('never posts passwords to a forged provider configuration', async () => {
    const send = vi.fn<typeof fetch>();
    await expect(exchangeCloudTokens({ ...config, supabase: { ...config.supabase, origin: 'https://other.example.invalid' } },
      { email: user.email, password: 'example password' }, send)).rejects.toThrow('missing or invalid');
    expect(send).not.toHaveBeenCalled();
  });
  it('bounds upstream streamed JSON', async () => {
    await expect(readCloudAuthJson(new Response('x'.repeat(65_537), { headers: { 'Content-Type': 'application/json' } }))).rejects.toThrow('temporarily unavailable');
  });
  it('logs out only the current provider session, not every staff device', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await revokeCloudSession(config, cookie(), send)).toBe(true);
    expect(send.mock.calls[0][0]).toBe(`${config.supabase.origin}/auth/v1/logout?scope=local`);
  });
  it('can revoke a refresh-only legacy session after provider verification', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pair)).mockResolvedValueOnce(Response.json(user))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await revokeCloudSession(config, new Headers({ cookie: `${cloudAuthCookies.refresh}=${pair.refresh_token}` }), send)).toBe(true);
    expect(send.mock.calls[0][0]).toBe(`${config.supabase.origin}/auth/v1/token?grant_type=refresh_token`);
    expect(send.mock.calls[1][0]).toBe(`${config.supabase.origin}/auth/v1/user`);
    expect(send.mock.calls[2][0]).toBe(`${config.supabase.origin}/auth/v1/logout?scope=local`);
  });
  it('does not claim provider logout on an upstream outage', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('example provider failure'));
    await expect(revokeCloudSession(config, cookie(), send)).rejects.toThrow('temporarily unavailable');
  });
});
