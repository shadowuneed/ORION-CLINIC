import { describe, expect, it, vi } from 'vitest';
import {
  STAFF_SESSION_COOKIE,
  clearStaffSessionCookie,
  handleStaffLogout,
  hashStaffSessionToken,
  isStaffSessionMutationOrigin,
  isStaffSessionToken,
  issueStaffSession,
  readStaffSessionCookie,
  resolveStaffSession,
  staffSessionCookie,
  type StaffSession,
  type StaffSessionRepository,
} from './staff-session';

const bearer = 'a'.repeat(64);
const origin = 'https://clinic.example.test';
const session: StaffSession = {
  sessionId: 'session-a', userId: 'doctor-a', displayName: 'Synthetic Doctor A',
  principal: { issuer: 'orion:staff', subject: 'individual-a', email: null },
  createdAt: 1000, lastSeenAt: 1000, idleExpiresAt: 1_801_000, absoluteExpiresAt: 28_801_000,
};
const grant = {
  userId: 'doctor-a', expectedUserVersion: 1, expectedIssuer: 'orion:staff', expectedSubject: 'individual-a',
};

function repository(): StaffSessionRepository {
  return {
    create: vi.fn(async () => session), resolve: vi.fn(async () => session),
    revoke: vi.fn(async () => {}), revokeAll: vi.fn(async () => {}),
  };
}

function logoutRequest(headers: HeadersInit = {}, method = 'POST', url = `${origin}/logout`) {
  const requestHeaders = new Headers({ Origin: origin, Cookie: `${STAFF_SESSION_COOKIE}=${bearer}` });
  new Headers(headers).forEach((value, name) => requestHeaders.set(name, value));
  return new Request(url, { method, headers: requestHeaders });
}

describe('staff opaque session foundation', () => {
  it('rejects accidental browser-side execution', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    try {
      await expect(import('./staff-session')).rejects.toThrow('Staff sessions require server execution');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('issues unique 256-bit random tokens and persists only their hashes and an independent identity grant', async () => {
    const store = repository();
    const first = await issueStaffSession(store, grant);
    const second = await issueStaffSession(store, grant);
    expect(first?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(second?.token).not.toBe(first?.token);
    const written = vi.mocked(store.create).mock.calls[0][0];
    expect(written).toMatchObject({ ...grant, tokenHash: await hashStaffSessionToken(first!.token) });
    expect(written.sessionId).not.toBe(vi.mocked(store.create).mock.calls[1][0].sessionId);
    expect(JSON.stringify(written)).not.toContain(first!.token);
    expect(written).not.toHaveProperty('roles');
  });

  it('does not return a token if the current user grant was denied and propagates storage failure', async () => {
    const store = repository();
    vi.mocked(store.create).mockResolvedValueOnce(null);
    expect(await issueStaffSession(store, grant)).toBeNull();
    vi.mocked(store.create).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(issueStaffSession(store, grant)).rejects.toThrow('storage unavailable');
  });

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${bearer}\n`, `${bearer} `, `%61${bearer.slice(1)}`])(
    'rejects noncanonical bearer values without normalization', async token => {
      expect(isStaffSessionToken(token)).toBe(false);
      await expect(hashStaffSessionToken(token)).rejects.toThrow('Invalid session token');
    },
  );

  it('reads only the exact cookie and accepts ordinary whitespace between unrelated cookies', async () => {
    const store = repository();
    const headers = new Headers({ Cookie: `theme=dark; ${STAFF_SESSION_COOKIE}=${bearer}; language=ru` });
    expect(readStaffSessionCookie(headers)).toEqual({ status: 'present', token: bearer });
    expect(await resolveStaffSession(headers, store)).toEqual(session);
    expect(store.resolve).toHaveBeenCalledExactlyOnceWith(await hashStaffSessionToken(bearer));
  });

  it.each([
    `${STAFF_SESSION_COOKIE}=${bearer}; ${STAFF_SESSION_COOKIE}=${bearer}`,
    `${STAFF_SESSION_COOKIE}=broken; ${STAFF_SESSION_COOKIE}=${bearer}`,
    `${STAFF_SESSION_COOKIE}=${bearer}; ${STAFF_SESSION_COOKIE}`,
    `${STAFF_SESSION_COOKIE} =${bearer}`,
    `${STAFF_SESSION_COOKIE}=${bearer} ; next=1`,
    `${STAFF_SESSION_COOKIE}="${bearer}"`,
    `${STAFF_SESSION_COOKIE}=%61${bearer.slice(1)}`,
    `${STAFF_SESSION_COOKIE}=${bearer}, second=1`,
    `extra=${'x'.repeat(8192)}; ${STAFF_SESSION_COOKIE}=${bearer}`,
  ])('rejects ambiguous or malformed cookies before storage lookup', async cookie => {
    const store = repository();
    const headers = new Headers({ Cookie: cookie });
    expect(readStaffSessionCookie(headers).status).toBe('invalid');
    expect(await resolveStaffSession(headers, store)).toBeNull();
    expect(store.resolve).not.toHaveBeenCalled();
  });

  it('rejects repeated Cookie fields joined by Headers', async () => {
    const store = repository();
    const headers = new Headers();
    headers.append('Cookie', `${STAFF_SESSION_COOKIE}=${bearer}`);
    headers.append('Cookie', `${STAFF_SESSION_COOKIE}=${bearer}`);
    expect(await resolveStaffSession(headers, store)).toBeNull();
    expect(store.resolve).not.toHaveBeenCalled();
  });

  it('never falls back to forged Sites identity or an Authorization bearer', async () => {
    const store = repository();
    const headers = new Headers({
      'oai-authenticated-user-id': 'doctor-a', 'oai-authenticated-user-email': 'staff@example.test',
      Authorization: `Bearer ${bearer}`, Cookie: 'role=administrator; userId=doctor-a',
    });
    expect(await resolveStaffSession(headers, store)).toBeNull();
    expect(store.resolve).not.toHaveBeenCalled();
  });

  it('propagates resolution storage errors without returning a header identity', async () => {
    const store = repository();
    vi.mocked(store.resolve).mockRejectedValueOnce(new Error('unavailable'));
    await expect(resolveStaffSession(new Headers({ Cookie: `${STAFF_SESSION_COOKIE}=${bearer}`,
      'oai-authenticated-user-id': 'doctor-a' }), store)).rejects.toThrow('unavailable');
  });

  it('sets identical host-only protections on issuance and deletion, without wiping local storage', () => {
    const issued = staffSessionCookie(bearer, Date.UTC(2026, 8, 24, 12));
    const removed = clearStaffSessionCookie();
    for (const cookie of [issued, removed]) {
      expect(cookie).toContain(`${STAFF_SESSION_COOKIE}=`);
      expect(cookie).toContain('Path=/; HttpOnly; Secure; SameSite=Strict');
      expect(cookie).not.toMatch(/Domain=/i);
    }
    expect(issued).toContain('Expires=Thu, 24 Sep 2026 12:00:00 GMT');
    expect(removed).toContain('Max-Age=0');
    expect(() => staffSessionCookie('bad', 1000)).toThrow();
    expect(() => staffSessionCookie(bearer, Number.NaN)).toThrow();
  });
});

describe('staff POST logout boundary (not mounted in primary runtime)', () => {
  it('revokes durably before returning success and clears the secure cookie', async () => {
    const store = repository();
    let release!: () => void;
    vi.mocked(store.revoke).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    let completed = false;
    const pending = handleStaffLogout(logoutRequest(), store, { origin }).then(response => { completed = true; return response; });
    await vi.waitFor(() => expect(store.revoke).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release();
    const response = await pending;
    expect(store.revoke).toHaveBeenCalledWith(await hashStaffSessionToken(bearer));
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBe(clearStaffSessionCookie());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it.each(['GET', 'HEAD', 'PUT'])('rejects %s without touching the session', async method => {
    const store = repository();
    const response = await handleStaffLogout(logoutRequest({}, method), store, { origin });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(store.revoke).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each<Record<string, string>>([
    { Origin: 'null' }, { Origin: '' }, { Origin: 'https://other.example.test' },
    { Origin: `${origin}, ${origin}` }, { Origin: `${origin}/` },
    { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
    { Origin: origin, 'Sec-Fetch-Site': 'same-site' },
  ])('rejects cross-origin or ambiguous logout', async headers => {
    const store = repository();
    const response = await handleStaffLogout(logoutRequest(headers), store, { origin });
    expect(response.status).toBe(403);
    expect(store.revoke).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('requires Origin, accepts same-origin metadata and ignores forwarded host spoofing', async () => {
    const store = repository();
    expect((await handleStaffLogout(new Request(`${origin}/logout`, { method: 'POST' }), store, { origin })).status).toBe(403);
    expect(isStaffSessionMutationOrigin(logoutRequest({ 'Sec-Fetch-Site': 'same-origin' }), origin)).toBe(true);
    const spoofed = logoutRequest({ Host: 'clinic.example.test', 'X-Forwarded-Host': 'clinic.example.test',
      'X-Forwarded-Proto': 'https' }, 'POST', 'https://other.example.test/logout');
    expect((await handleStaffLogout(spoofed, store, { origin })).status).toBe(403);
    expect(store.revoke).not.toHaveBeenCalled();
  });

  it.each(['http://clinic.example.test', `${origin}/`, `${origin}/path`, `${origin}?query`, `${origin}#hash`,
    'https://staff:password@clinic.example.test'])('refuses unsafe origin configuration', async unsafe => {
    await expect(handleStaffLogout(logoutRequest(), repository(), { origin: unsafe })).rejects.toThrow();
  });

  it('does not clear cookie or report logout success when storage is unavailable', async () => {
    const store = repository();
    vi.mocked(store.revoke).mockRejectedValueOnce(new Error('internal private details'));
    const response = await handleStaffLogout(logoutRequest(), store, { origin });
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('rejects ambiguous session cookies and supports idempotent absent-session logout', async () => {
    const store = repository();
    const invalid = await handleStaffLogout(logoutRequest({ Cookie: `${STAFF_SESSION_COOKIE}=bad` }), store, { origin });
    expect(invalid.status).toBe(400);
    const absent = await handleStaffLogout(logoutRequest({ Cookie: '' }), store, { origin });
    expect(absent.status).toBe(204);
    expect(absent.headers.get('set-cookie')).toBe(clearStaffSessionCookie());
    expect(store.revoke).not.toHaveBeenCalled();
  });
});
