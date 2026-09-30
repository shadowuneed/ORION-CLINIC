import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CloudConfigurationError } from './supabase-config.server';
import { parseCloudAuthConfig, type CloudAuthConfig } from './auth-config.server';
import { CloudAuthRejectedError, cloudAuthCookies, cloudCookie, exchangeCloudTokens, readCloudAuthJson,
  hasCloudSessionCookies, readCloudAuthSession, revokeCloudSession, type CloudTokenPair } from './auth-session.server';

if (typeof window !== 'undefined') throw new Error('Cloud authentication handlers are server-only.');

export type CloudAuthOperation = 'csrf' | 'login' | 'logout' | 'refresh' | 'session';
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const csrfSchema = z.object({ csrfToken: z.string().regex(NONCE) }).strict();
const loginSchema = csrfSchema.extend({ email: z.string().trim().email().max(320), password: z.string().min(1).max(1024) }).strict();
const safeHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

class RequestRejected extends Error {
  constructor(readonly status: number, readonly code: string) { super('Request rejected.'); }
}

function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: safeHeaders }); }
function setCookie(response: Response, name: string, value: string, maxAge: number, httpOnly = true) {
  response.headers.append('Set-Cookie', `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure;${httpOnly ? ' HttpOnly;' : ''} SameSite=Lax`);
}
function clearSession(response: Response) {
  for (const name of Object.values(cloudAuthCookies)) setCookie(response, name, '', 0, name !== cloudAuthCookies.generation);
}
function setSession(response: Response, pair: CloudTokenPair) {
  setCookie(response, cloudAuthCookies.access, pair.access, Math.min(pair.expiresIn, 3600));
  // Cookie retention is not a provider-side absolute session-lifetime guarantee.
  setCookie(response, cloudAuthCookies.refresh, pair.refresh, 8 * 3600);
  setCookie(response, cloudAuthCookies.csrf, Buffer.from(randomBytes(32)).toString('base64url'), 600);
  // Non-bearer stale-tab fencing signal only. The verified JWT and SQL session
  // checks still establish identity; a forged generation grants nothing.
  setCookie(response, cloudAuthCookies.generation, pair.session.sessionId.replaceAll('-', ''), 8 * 3600, false);
}

function requireOrigin(request: Request, config: CloudAuthConfig, mutating: boolean) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (url.origin !== config.publicOrigin || (origin !== null && origin !== config.publicOrigin) ||
    (mutating && origin !== config.publicOrigin) || (site !== null && site !== 'same-origin' && site !== 'none')) {
    throw new RequestRejected(403, 'REQUEST_ORIGIN_REJECTED');
  }
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new RequestRejected(415, 'JSON_REQUIRED');
  }
  let body: unknown;
  try { body = await readCloudAuthJson(new Response(request.body, { headers: request.headers }), 12_288); }
  catch { throw new RequestRejected(400, 'INVALID_AUTH_REQUEST'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestRejected(400, 'INVALID_AUTH_REQUEST');
  return body as Record<string, unknown>;
}

function requireCsrf(request: Request, token: unknown) {
  const cookie = cloudCookie(request.headers, cloudAuthCookies.csrf);
  if (typeof token !== 'string' || !NONCE.test(token) || !cookie || !NONCE.test(cookie) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(cookie))) throw new RequestRejected(403, 'CSRF_REJECTED');
}

export async function handleCloudAuth(operation: CloudAuthOperation, request: Request,
  source: Record<string, unknown> = process.env, options: { fetch?: typeof fetch } = {}): Promise<Response> {
  const send = options.fetch ?? fetch;
  let clearOnFailure = false;
  try {
    const config = parseCloudAuthConfig(source);
    const readOnly = operation === 'csrf' || operation === 'session';
    if (request.method !== (readOnly ? 'GET' : 'POST')) throw new RequestRejected(405, 'METHOD_NOT_ALLOWED');
    requireOrigin(request, config, !readOnly);
    if (operation === 'csrf') {
      const token = Buffer.from(randomBytes(32)).toString('base64url');
      const response = json({ csrfToken: token });
      setCookie(response, cloudAuthCookies.csrf, token, 600);
      return response;
    }
    if (operation === 'session') {
      const session = await readCloudAuthSession(request.headers, source, { fetch: send });
      if (!session) return json({ authenticated: false }, 401);
      // No roles, permissions, user_metadata, tokens or clinical readiness here.
      return json({ authenticated: true, principal: session.principal, generation: session.sessionId.replaceAll('-', '') });
    }
    const body = await requestBody(request);
    requireCsrf(request, body.csrfToken);
    if (operation === 'login') {
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) throw new RequestRejected(400, 'INVALID_AUTH_REQUEST');
      if (hasCloudSessionCookies(request.headers)) {
        throw new RequestRejected(409, 'SIGN_OUT_BEFORE_ACCOUNT_CHANGE');
      }
      const pair = await exchangeCloudTokens(config, { email: parsed.data.email, password: parsed.data.password }, send);
      const response = json({ authenticated: true });
      setSession(response, pair);
      return response;
    }
    if (!csrfSchema.safeParse(body).success) throw new RequestRejected(400, 'INVALID_AUTH_REQUEST');
    if (operation === 'logout') {
      clearOnFailure = true;
      await revokeCloudSession(config, request.headers, send);
      const response = json({ authenticated: false, providerSessionRevoked: true });
      clearSession(response);
      return response;
    }
    const refresh = cloudCookie(request.headers, cloudAuthCookies.refresh);
    if (!refresh) throw new CloudAuthRejectedError();
    const pair = await exchangeCloudTokens(config, { refresh_token: refresh }, send);
    const response = json({ authenticated: true });
    setSession(response, pair);
    return response;
  } catch (error) {
    let response: Response;
    if (error instanceof RequestRejected) response = json({ error: { code: error.code, message: 'Проверьте запрос и повторите вход.' } }, error.status);
    else if (error instanceof CloudAuthRejectedError) response = json({ error: { code: error.status === 429 ? 'AUTH_RATE_LIMITED' : 'AUTH_REJECTED',
      message: error.status === 429 ? 'Слишком много попыток. Повторите позже.' : 'Не удалось выполнить вход. Проверьте email и пароль.' } }, error.status);
    else response = json({ error: { code: error instanceof CloudConfigurationError ? 'AUTH_NOT_CONFIGURED' : 'AUTH_UNAVAILABLE',
      message: 'Сервис входа временно недоступен.' } }, 503);
    if (clearOnFailure || (operation === 'refresh' && error instanceof CloudAuthRejectedError && error.status === 401)) {
      clearSession(response);
      response.headers.set('X-ORION-Local-Session-Cleared', 'true');
    }
    return response;
  }
}
