import type { IdentityPrincipal } from './workspace-access';

// This module is an authentication boundary, not a browser-side role/session switch.
if (typeof window !== 'undefined') throw new Error('Staff sessions require server execution');

export const STAFF_SESSION_IDLE_MS = 30 * 60 * 1000;
export const STAFF_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const STAFF_SESSION_COOKIE = '__Host-orion_staff_session';

/** A server-side grant from a credential verifier, never a browser role/user selector. */
export type StaffSessionGrant = {
  userId: string;
  expectedUserVersion: number;
  expectedIssuer: string;
  expectedSubject: string;
};

export type CreateStaffSessionInput = StaffSessionGrant & {
  sessionId: string;
  tokenHash: string;
};

/** Authentication only. Exact department permissions must still be resolved from D1. */
export type StaffSession = {
  sessionId: string;
  userId: string;
  displayName: string;
  principal: IdentityPrincipal;
  createdAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
};

export interface StaffSessionRepository {
  create(input: CreateStaffSessionInput): Promise<StaffSession | null>;
  resolve(tokenHash: string): Promise<StaffSession | null>;
  revoke(tokenHash: string): Promise<void>;
  /** Invalidates existing sessions, not future logins; credential disable is separate. */
  revokeAll(userId: string): Promise<void>;
}

const tokenPattern = /^[a-f0-9]{64}$/;
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function isStaffSessionToken(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && tokenPattern.test(value);
}

export async function hashStaffSessionToken(token: string): Promise<string> {
  if (!isStaffSessionToken(token)) throw new TypeError('Invalid session token');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/**
 * Issue only after independent credentials have been verified. This function does
 * not authenticate a login, select a role, provision staff or expose an HTTP route.
 * The raw bearer token is returned once to the cookie transport, never persisted.
 */
export async function issueStaffSession(repository: StaffSessionRepository, grant: StaffSessionGrant) {
  const token = toHex(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const session = await repository.create({
    ...grant, sessionId: crypto.randomUUID(), tokenHash: await hashStaffSessionToken(token),
  });
  return session ? { token, session } : null;
}

export type StaffCookieResult =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'present'; token: string };

/** Reject ambiguity; never recover an identity from a second header, URL or body. */
export function readStaffSessionCookie(headers: Headers): StaffCookieResult {
  const cookie = headers.get('cookie');
  if (cookie === null || cookie === '') return { status: 'absent' };
  // Headers combines repeated Cookie fields using comma; comma is not cookie-octet.
  if (cookie.length > 8192 || cookie.includes(',') || /[\r\n]/.test(cookie)) return { status: 'invalid' };
  const values: string[] = [];
  for (const part of cookie.split(';')) {
    // Whitespace between cookie-pairs is allowed, but not inside our bearer value.
    const pair = part.trimStart();
    const split = pair.indexOf('=');
    const name = split < 0 ? pair.trim() : pair.slice(0, split).trim();
    if (name !== STAFF_SESSION_COOKIE) continue;
    if (split < 0 || pair.slice(0, split) !== STAFF_SESSION_COOKIE) return { status: 'invalid' };
    values.push(pair.slice(split + 1));
  }
  if (!values.length) return { status: 'absent' };
  if (values.length !== 1 || !isStaffSessionToken(values[0])) return { status: 'invalid' };
  return { status: 'present', token: values[0] };
}

/** Caller must treat repository failures as unavailable, not fall back to Sites headers. */
export async function resolveStaffSession(headers: Headers, repository: StaffSessionRepository) {
  const cookie = readStaffSessionCookie(headers);
  if (cookie.status !== 'present') return null;
  return repository.resolve(await hashStaffSessionToken(cookie.token));
}

export function staffSessionCookie(token: string, absoluteExpiresAt: number) {
  if (!isStaffSessionToken(token) || !Number.isSafeInteger(absoluteExpiresAt) ||
    absoluteExpiresAt <= 0 || Number.isNaN(new Date(absoluteExpiresAt).getTime())) {
    throw new TypeError('Invalid session cookie');
  }
  return `${STAFF_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(absoluteExpiresAt).toUTCString()}`;
}

export function clearStaffSessionCookie() {
  return `${STAFF_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function configuredOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new TypeError('Staff authentication requires an exact HTTPS origin');
  }
  return url.origin;
}

/** Explicit deployment config is authoritative; forwarded/request Host headers are not. */
export function isStaffSessionMutationOrigin(request: Request, origin: string) {
  const expected = configuredOrigin(origin);
  const target = new URL(request.url);
  const fetchSite = request.headers.get('sec-fetch-site');
  return target.origin === expected && !target.username && !target.password &&
    request.headers.get('origin') === expected &&
    (fetchSite === null || fetchSite === 'same-origin');
}

function privateHeaders() {
  return new Headers({ 'Cache-Control': 'no-store', Pragma: 'no-cache', Vary: 'Cookie' });
}

/**
 * Provider-neutral POST logout handler, not yet mounted in the current Sites runtime.
 * A successful response means durable revocation succeeded, not just cookie removal.
 */
export async function handleStaffLogout(
  request: Request,
  repository: StaffSessionRepository,
  options: { origin: string },
): Promise<Response> {
  configuredOrigin(options.origin);
  const headers = privateHeaders();
  if (request.method !== 'POST') {
    headers.set('Allow', 'POST');
    return new Response(null, { status: 405, headers });
  }
  if (!isStaffSessionMutationOrigin(request, options.origin)) {
    return new Response(null, { status: 403, headers });
  }
  const cookie = readStaffSessionCookie(request.headers);
  if (cookie.status === 'invalid') return new Response(null, { status: 400, headers });
  if (cookie.status === 'present') {
    try {
      await repository.revoke(await hashStaffSessionToken(cookie.token));
    } catch {
      // Do not claim success or clear the only browser handle when revocation failed.
      return new Response(null, { status: 503, headers });
    }
  }
  headers.set('Set-Cookie', clearStaffSessionCookie());
  return new Response(null, { status: 204, headers });
}
