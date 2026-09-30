import { describe, expect, it, vi } from 'vitest';
import { parseSupabaseCloudConfig } from './supabase-config.server';
import { verifySupabasePrincipal } from './supabase-principal.server';

const ref = 'abcdefghijklmnopqrst';
const source = { ORION_SUPABASE_PROJECT_REF: ref, ORION_SUPABASE_URL: `https://${ref}.supabase.co`,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'example'.repeat(5)}` };
const config = parseSupabaseCloudConfig(source);
const token = 'example.example.example';
const user = { id: '11111111-1111-4111-8111-111111111111', role: 'authenticated',
  is_anonymous: false, email: 'staff@example.invalid', app_metadata: { role: 'administrator' } };

describe('dedicated Supabase cloud configuration', () => {
  it('normalizes and freezes the exact HTTPS project', () => {
    expect(config.origin).toBe(`https://${ref}.supabase.co`);
    expect(config.issuer).toBe(`${config.origin}/auth/v1`);
    expect(Object.isFrozen(config)).toBe(true);
  });
  it.each(['http://abcdefghijklmnopqrst.supabase.co', 'https://other.example.invalid',
    `https://${ref}.supabase.co/path`, `https://${ref}.supabase.co?key=example`,
    `https://user:example@${ref}.supabase.co`, `https://${ref}.supabase.co:444`])('rejects unsafe endpoint %s', (url) => {
    expect(() => parseSupabaseCloudConfig({ ...source, ORION_SUPABASE_URL: url })).toThrow('missing or invalid');
  });
  it('rejects missing settings and elevated keys without echoing inputs', () => {
    expect(() => parseSupabaseCloudConfig({})).toThrow('missing or invalid');
    const sensitive = `sb_secret_${'example'.repeat(5)}`;
    try { parseSupabaseCloudConfig({ ...source, ORION_SUPABASE_PUBLISHABLE_KEY: sensitive }); }
    catch (error) { expect(String(error)).not.toContain(sensitive); }
    expect(() => parseSupabaseCloudConfig({ ...source, ORION_SUPABASE_PUBLISHABLE_KEY: sensitive })).toThrow();
  });
});

describe('server-verified Supabase principal foundation', () => {
  it('uses only the verified server response, never token claims or profile roles', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(user));
    const principal = await verifySupabasePrincipal(config, token, { fetch: send });
    expect(principal).toEqual({ issuer: config.issuer, subject: user.id, email: user.email });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(send).toHaveBeenCalledWith(`${config.origin}/auth/v1/user`, expect.objectContaining({
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` },
    }));
    expect(principal).not.toHaveProperty('role');
    expect(principal).not.toHaveProperty('accessAssignmentId');
  });
  it.each([null, '', 'forged-header-id', 'bad\n.example.example', 'x'.repeat(8_193)])('rejects invalid tokens before network', async (value) => {
    const send = vi.fn<typeof fetch>();
    expect(await verifySupabasePrincipal(config, value, { fetch: send })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it.each([401, 403])('fails closed for rejected or revoked identity %s', async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    expect(await verifySupabasePrincipal(config, token, { fetch: send })).toBeNull();
  });
  it.each([{ ...user, is_anonymous: true }, { ...user, role: 'service_role' }, { ...user, id: 'forged' },
    { ...user, email: 'x'.repeat(321) }, {}, [user]])('rejects untrusted response shape', async (value) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
    await expect(verifySupabasePrincipal(config, token, { fetch: send })).rejects.toThrow('temporarily unavailable');
  });
  it('bounds streamed response bytes even without content-length', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(16_385), { headers: { 'content-type': 'application/json' } }));
    await expect(verifySupabasePrincipal(config, token, { fetch: send })).rejects.toThrow('temporarily unavailable');
  });
  it('does not send a token to a forged configuration origin', async () => {
    const send = vi.fn<typeof fetch>();
    await expect(verifySupabasePrincipal({ ...config, origin: 'https://other.example.invalid' }, token, { fetch: send })).rejects.toThrow('missing or invalid');
    expect(send).not.toHaveBeenCalled();
  });
  it('does not publish an upstream error or token in error text', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error(`example-upstream ${token}`));
    await expect(verifySupabasePrincipal(config, token, { fetch: send })).rejects.toThrow('temporarily unavailable');
  });
  it('honors cancellation before verification', async () => {
    const send = vi.fn<typeof fetch>();
    await expect(verifySupabasePrincipal(config, token, { fetch: send, signal: AbortSignal.abort() })).rejects.toThrow('temporarily unavailable');
    expect(send).not.toHaveBeenCalled();
  });
});
