import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import { verifySupabasePrincipal, CloudIdentityUnavailableError } from './supabase-principal.server';
import { parseCloudAuthConfig, type CloudAuthConfig } from './auth-config.server';

if (typeof window !== 'undefined') throw new Error('Cloud sessions are server-only.');

export const cloudAuthCookies = Object.freeze({
  access: '__Host-orion-cloud-access', refresh: '__Host-orion-cloud-refresh', csrf: '__Host-orion-cloud-csrf',
  generation: '__Host-orion-cloud-generation',
});
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// Supabase also issues 12-character legacy refresh tokens. This only bounds
// opaque, cookie-safe transport; authenticity is checked by the provider.
function validRefreshToken(value: string): boolean {
  return value.length >= 12 && value.length <= 2048 && !/[^A-Za-z0-9_-]/.test(value);
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type CloudAuthSession = Readonly<{ principal: IdentityPrincipal; sessionId: string }>;
export type CloudTokenPair = Readonly<{ access: string; refresh: string; expiresIn: number; session: CloudAuthSession }>;

export class CloudAuthRejectedError extends Error {
  constructor(readonly status = 401) { super('Cloud authentication was rejected.'); this.name = 'CloudAuthRejectedError'; }
}

function validateConfig(config: CloudAuthConfig): CloudAuthConfig {
  return parseCloudAuthConfig({ ORION_SUPABASE_PROJECT_REF: config.supabase.projectRef,
    ORION_SUPABASE_URL: config.supabase.origin, ORION_SUPABASE_PUBLISHABLE_KEY: config.supabase.publishableKey,
    ORION_CLOUD_PUBLIC_ORIGIN: config.publicOrigin });
}

export function cloudCookie(headers: Pick<Headers, 'get'>, name: string): string | null {
  const raw = headers.get('cookie') ?? '';
  if (raw.length > 16_384) return null;
  const found = raw.split(';').map((item) => item.trim()).filter((item) => item.startsWith(`${name}=`));
  if (found.length !== 1) return null;
  const value = found[0].slice(name.length + 1);
  return value && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null;
}

function hasCookie(headers: Pick<Headers, 'get'>, name: string): boolean {
  const raw = headers.get('cookie') ?? '';
  return raw.length > 16_384 || raw.split(';').some(item => item.trim().startsWith(`${name}=`));
}

/** Presence only: it grants no identity and also catches malformed/duplicate cookies. */
export function hasCloudSessionCookies(headers: Pick<Headers, 'get'>): boolean {
  return hasCookie(headers, cloudAuthCookies.access) || hasCookie(headers, cloudAuthCookies.refresh);
}

/** Server transport only. This value never belongs in JSON, logs or client props. */
export function readCloudAccessToken(headers: Pick<Headers, 'get'>): string | null {
  const value = cloudCookie(headers, cloudAuthCookies.access);
  return value && value.length <= 8192 && JWT.test(value) ? value : null;
}

// This is identity/session metadata, not authorization. Clinical resolvers must
// independently require a live auth.sessions row AND active internal assignments.
async function verifiedSession(config: CloudAuthConfig, token: string | null, send: typeof fetch): Promise<CloudAuthSession | null> {
  const principal = await verifySupabasePrincipal(config.supabase, token, { fetch: send });
  if (!principal || !token) return null;
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new CloudIdentityUnavailableError(); }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) || claims.iss !== principal.issuer ||
    claims.sub !== principal.subject || typeof claims.session_id !== 'string' || !UUID.test(claims.session_id) ||
    claims.role !== 'authenticated' || claims.is_anonymous !== false || typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) throw new CloudIdentityUnavailableError();
  return Object.freeze({ principal, sessionId: claims.session_id });
}

export async function readCloudAuthSession(headers: Pick<Headers, 'get'>, source: Record<string, unknown> = process.env,
  options: { fetch?: typeof fetch } = {}): Promise<CloudAuthSession | null> {
  const config = parseCloudAuthConfig(source);
  return verifiedSession(config, readCloudAccessToken(headers), options.fetch ?? fetch);
}

export async function readCloudAuthJson(response: Response, limit = 65_536): Promise<unknown> {
  const length = response.headers.get('content-length');
  if ((length && (!/^\d+$/.test(length) || Number(length) > limit)) ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    throw new CloudIdentityUnavailableError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new CloudIdentityUnavailableError();
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new CloudIdentityUnavailableError();
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new CloudIdentityUnavailableError(); }
}

export async function exchangeCloudTokens(config: CloudAuthConfig,
  grant: { email: string; password: string } | { refresh_token: string }, send: typeof fetch = fetch): Promise<CloudTokenPair> {
  config = validateConfig(config);
  if ('refresh_token' in grant && !validRefreshToken(grant.refresh_token)) throw new CloudAuthRejectedError();
  const url = `${config.supabase.origin}/auth/v1/token?grant_type=${'email' in grant ? 'password' : 'refresh_token'}`;
  let response: Response;
  try {
    response = await send(url, { method: 'POST', headers: { apikey: config.supabase.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(grant), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000) });
  } catch { throw new CloudIdentityUnavailableError(); }
  if (response.redirected || (response.url && response.url !== url)) throw new CloudIdentityUnavailableError();
  if ([400, 401, 403, 422].includes(response.status)) throw new CloudAuthRejectedError();
  if (response.status === 429) throw new CloudAuthRejectedError(429);
  if (!response.ok) throw new CloudIdentityUnavailableError();
  const body = await readCloudAuthJson(response);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CloudIdentityUnavailableError();
  const pair = body as Record<string, unknown>;
  if (typeof pair.access_token !== 'string' || pair.access_token.length > 3800 || !JWT.test(pair.access_token) ||
    typeof pair.refresh_token !== 'string' || !validRefreshToken(pair.refresh_token) || pair.token_type !== 'bearer' ||
    typeof pair.expires_in !== 'number' || !Number.isSafeInteger(pair.expires_in) || pair.expires_in < 1 || pair.expires_in > 86_400) {
    throw new CloudIdentityUnavailableError();
  }
  const session = await verifiedSession(config, pair.access_token, send);
  if (!session) throw new CloudAuthRejectedError();
  return Object.freeze({ access: pair.access_token, refresh: pair.refresh_token, expiresIn: pair.expires_in, session });
}

export async function revokeCloudSession(config: CloudAuthConfig, headers: Headers, send: typeof fetch = fetch): Promise<boolean> {
  config = validateConfig(config);
  let token = readCloudAccessToken(headers);
  const refresh = cloudCookie(headers, cloudAuthCookies.refresh);
  if ((hasCookie(headers, cloudAuthCookies.access) && !token) ||
    (hasCookie(headers, cloudAuthCookies.refresh) && (!refresh || !validRefreshToken(refresh)))) throw new CloudIdentityUnavailableError();
  if (!token && !refresh) return true;
  if (!token && refresh) token = (await exchangeCloudTokens(config, { refresh_token: refresh }, send)).access;
  const url = `${config.supabase.origin}/auth/v1/logout?scope=local`;
  let response: Response;
  try {
    response = await send(url, { method: 'POST', headers: { apikey: config.supabase.publishableKey, authorization: `Bearer ${token}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000) });
  } catch { throw new CloudIdentityUnavailableError(); }
  if (response.redirected || (response.url && response.url !== url)) throw new CloudIdentityUnavailableError();
  if (response.status === 401 && refresh) {
    const pair = await exchangeCloudTokens(config, { refresh_token: refresh }, send);
    const rotated = new Headers(); rotated.set('cookie', `${cloudAuthCookies.access}=${pair.access}`);
    return revokeCloudSession(config, rotated, send);
  }
  if (response.status !== 204) throw new CloudIdentityUnavailableError();
  return true;
}
