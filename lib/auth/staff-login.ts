import type { StaffCredentialRepository } from '@/lib/repositories/staff-credentials';
import { isStaffPasswordInput, normalizeStaffLogin } from './staff-login-policy';
import { verifyStaffPassword } from './staff-password';
import {
  hashStaffSessionToken, isStaffSessionMutationOrigin, issueStaffSession,
  staffSessionCookie, type StaffSessionRepository,
} from './staff-session';

if (typeof window !== 'undefined') throw new Error('Staff login requires server execution');

const MAX_BODY_BYTES = 8192;
const BODY_DEADLINE_MS = 5000;

function response(status: number, code?: string, extra?: Record<string, string>) {
  return new Response(code ? JSON.stringify({ error: code }) : null, {
    status,
    headers: {
      'Cache-Control': 'no-store', Pragma: 'no-cache', Vary: 'Cookie, Origin',
      'Content-Type': 'application/json; charset=utf-8', ...extra,
    },
  });
}

async function readCredentials(request: Request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') ||
    request.headers.has('content-encoding')) throw new TypeError('Invalid payload');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d{1,5}$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new TypeError('Invalid payload');
  }
  if (!request.body || request.signal.aborted) throw new TypeError('Invalid payload');
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new TypeError('Invalid payload')), BODY_DEADLINE_MS);
    onAbort = () => reject(new TypeError('Invalid payload'));
    request.signal.addEventListener('abort', onAbort, { once: true });
  });
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new TypeError('Invalid payload');
      chunks.push(part.value);
    }
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Invalid payload');
    const body = parsed as Record<string, unknown>;
    if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'login') || !Object.hasOwn(body, 'password')) {
      throw new TypeError('Invalid payload');
    }
    const login = normalizeStaffLogin(body.login);
    if (!login || !isStaffPasswordInput(body.password)) throw new TypeError('Invalid payload');
    const { password } = body;
    return { login, password };
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', onAbort);
    // Do not let a hostile stream's cancel promise delay the failure response.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export type StaffLoginDependencies = {
  credentials: Pick<StaffCredentialRepository, 'reserveAttempt' | 'finishAttempt'>;
  sessions: StaffSessionRepository;
  /** Server dependency injection for contract tests, never a request option. */
  verifyPassword?: typeof verifyStaffPassword;
};

/** Unmounted ONLINE-1B2 transport. No Sites fallback, grants or role selectors. */
export async function handleStaffLogin(
  request: Request,
  dependencies: StaffLoginDependencies,
  options: { origin: string },
): Promise<Response> {
  if (request.method !== 'POST') return response(405, 'METHOD_NOT_ALLOWED', { Allow: 'POST' });
  try {
    if (!isStaffSessionMutationOrigin(request, options.origin)) return response(403, 'ACCESS_DENIED');
  } catch {
    return response(503, 'LOGIN_UNAVAILABLE');
  }
  let input: Awaited<ReturnType<typeof readCredentials>>;
  try { input = await readCredentials(request); }
  catch { return response(400, 'INVALID_LOGIN_REQUEST'); }

  try {
    const attempt = await dependencies.credentials.reserveAttempt(input.login, crypto.randomUUID());
    if (attempt.status === 'throttled') {
      return response(429, 'LOGIN_RETRY_LATER', {
        'Retry-After': String(Math.max(1, Math.min(300, Math.ceil(attempt.retryAfterSeconds)))),
      });
    }
    const credential = attempt.credential;
    const matches = await (dependencies.verifyPassword ?? verifyStaffPassword)(input.password, credential?.passwordHash ?? null);
    // No successful completion for a dummy verification even if an injected
    // verifier misbehaves. Abort/crash still consumes the reserved rate budget.
    const success = matches && credential !== null && !request.signal.aborted;
    const grant = await dependencies.credentials.finishAttempt(
      attempt.attemptId, success ? 'success' : 'failure', credential?.credentialVersion,
    );
    if (!success || !grant) return response(401, 'INVALID_CREDENTIALS');
    const issued = await issueStaffSession(dependencies.sessions, grant);
    if (!issued) return response(401, 'INVALID_CREDENTIALS');
    const tokenHash = await hashStaffSessionToken(issued.token);
    const current = await dependencies.sessions.resolve(tokenHash);
    if (!current || current.sessionId !== issued.session.sessionId || current.userId !== grant.userId ||
      current.principal.issuer !== grant.expectedIssuer || current.principal.subject !== grant.expectedSubject ||
      request.signal.aborted) {
      await dependencies.sessions.revoke(tokenHash);
      return response(401, 'INVALID_CREDENTIALS');
    }
    return response(204, undefined, { 'Set-Cookie': staffSessionCookie(issued.token, current.absoluteExpiresAt) });
  } catch {
    // Unknown storage/crypto/audit/issuance outcomes never become a login. Do not
    // reflect the exception, credentials, IDs or provider secrets in logs/response.
    return response(503, 'LOGIN_UNAVAILABLE');
  }
}
