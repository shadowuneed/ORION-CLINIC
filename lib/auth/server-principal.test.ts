import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveStaffServerPrincipal } from './server-principal';
import {
  STAFF_SESSION_COOKIE,
  hashStaffSessionToken,
  type StaffSession,
  type StaffSessionRepository,
} from './staff-session';

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);

function session(label = 'a'): StaffSession {
  return {
    sessionId: `synthetic-session-${label}`,
    userId: `internal-user-${label}`,
    displayName: `Synthetic Doctor ${label.toUpperCase()}`,
    principal: {
      issuer: 'orion:individual-staff',
      subject: `external-subject-${label}`,
      email: `${label}@staff.example.test`,
    },
    // Deliberately unrelated to the application clock: only the durable
    // repository may decide whether this synthetic session is current.
    createdAt: 1_000,
    lastSeenAt: 2_000,
    idleExpiresAt: 1_802_000,
    absoluteExpiresAt: 28_801_000,
  };
}

function repository(result: unknown = session()): StaffSessionRepository {
  return {
    // Unknown fixture results deliberately exercise a broken adapter boundary.
    create: vi.fn(async () => null),
    resolve: vi.fn(async () => result as StaffSession | null),
    revoke: vi.fn(async () => {}),
    revokeAll: vi.fn(async () => {}),
  };
}

function requestHeaders(token = tokenA) {
  return new Headers({ Cookie: `${STAFF_SESSION_COOKIE}=${token}` });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('unmounted shared staff principal boundary', () => {
  it('keeps the internal user distinct from the exact external principal despite hostile identity headers', async () => {
    const store = repository(session('b'));
    const headers = requestHeaders(tokenB);
    headers.set('oai-authenticated-user-id', 'forged-sites-subject-a');
    headers.set('oai-authenticated-user-email', 'forged@invalid.example');
    headers.set('oai-authenticated-user-full-name', 'Forged administrator');
    headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
    headers.set('Authorization', `Bearer ${tokenA}`);
    headers.set('X-User-Id', 'forged-internal-user-a');
    headers.set('X-Forwarded-User', 'forged-subject-a');
    headers.set('X-Role', 'administrator');

    const result = await resolveStaffServerPrincipal(headers, store);

    expect(result).toEqual({
      status: 'authenticated',
      identity: {
        user: { id: 'internal-user-b', displayName: 'Synthetic Doctor B', email: 'b@staff.example.test' },
        principal: { issuer: 'orion:individual-staff', subject: 'external-subject-b', email: 'b@staff.example.test' },
      },
    });
    expect(store.resolve).toHaveBeenCalledExactlyOnceWith(await hashStaffSessionToken(tokenB));
    expect(store.create).not.toHaveBeenCalled();
    expect(store.revoke).not.toHaveBeenCalled();
    expect(store.revokeAll).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['unrelated', 'role=administrator; userId=internal-user-a'],
    ['short token', `${STAFF_SESSION_COOKIE}=${tokenA.slice(1)}`],
    ['uppercase token', `${STAFF_SESSION_COOKIE}=${tokenA.toUpperCase()}`],
    ['encoded token', `${STAFF_SESSION_COOKIE}=%61${tokenA.slice(1)}`],
    ['quoted token', `${STAFF_SESSION_COOKIE}="${tokenA}"`],
    ['trailing token whitespace', `${STAFF_SESSION_COOKIE}=${tokenA} ; theme=dark`],
    ['duplicate same token', `${STAFF_SESSION_COOKIE}=${tokenA}; ${STAFF_SESSION_COOKIE}=${tokenA}`],
    ['duplicate different token', `${STAFF_SESSION_COOKIE}=${tokenA}; ${STAFF_SESSION_COOKIE}=${tokenB}`],
    ['malformed first duplicate', `${STAFF_SESSION_COOKIE}=broken; ${STAFF_SESSION_COOKIE}=${tokenA}`],
    ['repeated header separator', `${STAFF_SESSION_COOKIE}=${tokenA}, ${STAFF_SESSION_COOKIE}=${tokenB}`],
    ['oversized cookie header', `extra=${'x'.repeat(8192)}; ${STAFF_SESSION_COOKIE}=${tokenA}`],
  ] as const)('denies %s cookie before repository lookup without Sites or bearer fallback', async (_label, cookie) => {
    const store = repository();
    const headers = new Headers({
      'oai-authenticated-user-id': 'forged-sites-subject',
      Authorization: `Bearer ${tokenA}`,
    });
    if (cookie !== null) headers.set('Cookie', cookie);

    const result = await resolveStaffServerPrincipal(headers, store);

    expect(result).toEqual({ status: 'unauthenticated' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(store.resolve).not.toHaveBeenCalled();
  });

  it('denies repeated Cookie fields instead of selecting either identity', async () => {
    const store = repository();
    const headers = requestHeaders();
    headers.append('Cookie', `${STAFF_SESSION_COOKIE}=${tokenB}`);
    expect(await resolveStaffServerPrincipal(headers, store)).toEqual({ status: 'unauthenticated' });
    expect(store.resolve).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'revoked', 'idle-expired', 'absolute-expired', 'disabled', 'reset-version'])(
    'preserves the durable repository denial for a %s session without inventing an identity', async () => {
      const store = repository(null);
      const headers = requestHeaders();
      headers.set('oai-authenticated-user-id', 'forged-sites-subject');
      expect(await resolveStaffServerPrincipal(headers, store)).toEqual({ status: 'unauthenticated' });
      expect(store.resolve).toHaveBeenCalledExactlyOnceWith(await hashStaffSessionToken(tokenA));
    },
  );

  it('maps repository failure to unavailable without logging or reflecting sensitive exception text', async () => {
    const store = repository();
    const privateFailure = `synthetic database failure ${tokenA} private@example.test`;
    vi.mocked(store.resolve).mockRejectedValueOnce(new Error(privateFailure));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const regularLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const headers = requestHeaders();
    headers.set('oai-authenticated-user-id', 'forged-sites-subject');

    const result = await resolveStaffServerPrincipal(headers, store);

    expect(result).toEqual({ status: 'unavailable' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(privateFailure);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
    expect(regularLog).not.toHaveBeenCalled();
  });

  it('maps crypto failure to unavailable before storage lookup', async () => {
    const store = repository();
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('synthetic crypto unavailable'));
    expect(await resolveStaffServerPrincipal(requestHeaders(), store)).toEqual({ status: 'unavailable' });
    expect(store.resolve).not.toHaveBeenCalled();
  });

  const malformed: Array<[string, () => unknown]> = [
    ['undefined row', () => undefined],
    ['scalar row', () => 'invalid'],
    ['array row', () => []],
    ['empty row', () => ({})],
    ['missing internal user', () => ({ ...session(), userId: undefined })],
    ['numeric internal user', () => ({ ...session(), userId: 7 })],
    ['empty internal user', () => ({ ...session(), userId: '' })],
    ['whitespace internal user', () => ({ ...session(), userId: ' user-a' })],
    ['oversized internal user', () => ({ ...session(), userId: 'u'.repeat(257) })],
    ['control in internal user', () => ({ ...session(), userId: 'user\u0000a' })],
    ['missing display name', () => ({ ...session(), displayName: undefined })],
    ['null display name', () => ({ ...session(), displayName: null })],
    ['empty display name', () => ({ ...session(), displayName: '' })],
    ['blank display name', () => ({ ...session(), displayName: ' \t ' })],
    ['oversized display name', () => ({ ...session(), displayName: 'x'.repeat(501) })],
    ['missing principal', () => ({ ...session(), principal: undefined })],
    ['null principal', () => ({ ...session(), principal: null })],
    ['array principal', () => ({ ...session(), principal: [] })],
    ['missing issuer', () => ({ ...session(), principal: { ...session().principal, issuer: undefined } })],
    ['empty issuer', () => ({ ...session(), principal: { ...session().principal, issuer: '' } })],
    ['control in issuer', () => ({ ...session(), principal: { ...session().principal, issuer: 'orion:\nstaff' } })],
    ['missing subject', () => ({ ...session(), principal: { ...session().principal, subject: undefined } })],
    ['numeric subject', () => ({ ...session(), principal: { ...session().principal, subject: 7 } })],
    ['empty subject', () => ({ ...session(), principal: { ...session().principal, subject: '' } })],
    ['whitespace subject', () => ({ ...session(), principal: { ...session().principal, subject: 'subject-a ' } })],
    ['oversized subject', () => ({ ...session(), principal: { ...session().principal, subject: 's'.repeat(257) } })],
    ['missing nullable email', () => ({ ...session(), principal: { ...session().principal, email: undefined } })],
    ['numeric email', () => ({ ...session(), principal: { ...session().principal, email: 7 } })],
    ['oversized email', () => ({ ...session(), principal: { ...session().principal, email: 'e'.repeat(321) } })],
    ['throwing adapter accessor', () => {
      const value = session();
      Object.defineProperty(value, 'userId', { get() { throw new Error('synthetic private adapter failure'); } });
      return value;
    }],
  ];

  it.each(malformed)('treats %s as unavailable, never as authenticated or anonymous', async (_label, invalid) => {
    const store = repository();
    vi.mocked(store.resolve).mockResolvedValueOnce(invalid() as StaffSession | null);
    const headers = requestHeaders();
    headers.set('oai-authenticated-user-id', 'forged-sites-subject');
    const result = await resolveStaffServerPrincipal(headers, store);
    expect(result).toEqual({ status: 'unavailable' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each(['userId', 'displayName', 'issuer', 'subject', 'email'] as const)(
    'rejects C0/C1 controls and isolated surrogates in projected %s', async field => {
      for (const invalid of ['\u0000', '\u001f', '\u007f', '\u0080', '\u009f', '\ud800', '\udfff', '\ud800x', 'x\udc00']) {
        const input = session();
        const value = `synthetic-${invalid}-value`;
        if (field === 'userId' || field === 'displayName') input[field] = value;
        else input.principal[field] = value;
        expect(await resolveStaffServerPrincipal(requestHeaders(), repository(input)),
          `${field} must reject ${JSON.stringify(invalid)}`).toEqual({ status: 'unavailable' });
      }
    },
  );

  it.each(['', '   '])('rejects empty or blank non-null email %j rather than inventing an address', async email => {
    const input = session(); input.principal.email = email;
    expect(await resolveStaffServerPrincipal(requestHeaders(), repository(input))).toEqual({ status: 'unavailable' });
  });

  it('preserves valid Unicode pairs and ordinary display/email whitespace without normalization', async () => {
    const input = session();
    input.userId = 'Internal-USER-🧑';
    input.displayName = '  Synthetic Әлия 🧑  ';
    input.principal = {
      issuer: 'orion:STAFF-🧑',
      subject: 'External-SUBJECT-🧑',
      email: '  Mixed.Case+Тест@Example.TEST  ',
    };
    expect(await resolveStaffServerPrincipal(requestHeaders(), repository(input))).toEqual({
      status: 'authenticated',
      identity: {
        user: { id: input.userId, displayName: input.displayName, email: input.principal.email },
        principal: input.principal,
      },
    });
  });

  it('returns a minimal deeply frozen copy without session, role, credential or arbitrary adapter fields', async () => {
    const input = {
      ...session(),
      token: tokenA,
      tokenHash: 'synthetic-stored-hash',
      passwordHash: 'synthetic-password-hash',
      expectedUserVersion: 7,
      role: 'administrator',
      assignments: ['foreign-assignment'],
      principal: { ...session().principal, role: 'administrator', forwardedIdentity: 'forged' },
    };
    const result = await resolveStaffServerPrincipal(requestHeaders(), repository(input));
    expect(result.status).toBe('authenticated');
    if (result.status !== 'authenticated') throw new Error('Expected synthetic identity');

    expect(Object.keys(result)).toEqual(['status', 'identity']);
    expect(Object.keys(result.identity)).toEqual(['user', 'principal']);
    expect(Object.keys(result.identity.user)).toEqual(['id', 'displayName', 'email']);
    expect(Object.keys(result.identity.principal)).toEqual(['issuer', 'subject', 'email']);
    for (const value of [result, result.identity, result.identity.user, result.identity.principal]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(result.identity.principal).not.toBe(input.principal);
    expect(Reflect.set(result.identity.user, 'id', 'another-user')).toBe(false);
    expect(Reflect.set(result.identity.principal, 'subject', 'another-subject')).toBe(false);
    input.userId = 'modified-adapter-user';
    input.displayName = 'Modified adapter';
    input.principal.issuer = 'modified:issuer';
    input.principal.subject = 'modified-subject';
    input.principal.email = 'modified@example.test';
    expect(result.identity.user.id).toBe('internal-user-a');
    expect(result.identity.user.displayName).toBe('Synthetic Doctor A');
    expect(result.identity.principal).toEqual(session().principal);
    expect(JSON.stringify(result)).not.toContain(tokenA);
    expect(JSON.stringify(result)).not.toContain('synthetic-session-a');
    expect(JSON.stringify(result)).not.toContain('synthetic-password-hash');
  });

  it('preserves null email rather than filling it from identity headers', async () => {
    const input = session(); input.principal.email = null;
    const headers = requestHeaders(); headers.set('oai-authenticated-user-email', 'forged@example.test');
    const result = await resolveStaffServerPrincipal(headers, repository(input));
    expect(result).toMatchObject({ status: 'authenticated', identity: { user: { email: null }, principal: { email: null } } });
  });

  it('uses the current database liveness/version decision on every call without caching a prior grant', async () => {
    const store = repository();
    const refreshed = session(); refreshed.displayName = 'Current database name';
    vi.mocked(store.resolve)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(null) // Durable repository rejected a changed user epoch.
      .mockRejectedValueOnce(new Error('synthetic DB outage'))
      .mockResolvedValueOnce(null);
    const headers = requestHeaders();

    expect(await resolveStaffServerPrincipal(headers, store)).toMatchObject({ status: 'authenticated', identity: { user: { displayName: 'Synthetic Doctor A' } } });
    expect(await resolveStaffServerPrincipal(headers, store)).toMatchObject({ status: 'authenticated', identity: { user: { displayName: 'Current database name' } } });
    expect(await resolveStaffServerPrincipal(headers, store)).toEqual({ status: 'unauthenticated' });
    expect(await resolveStaffServerPrincipal(headers, store)).toEqual({ status: 'unavailable' });
    expect(await resolveStaffServerPrincipal(headers, store)).toEqual({ status: 'unauthenticated' });
    expect(store.resolve).toHaveBeenCalledTimes(5);
    for (const [hash] of vi.mocked(store.resolve).mock.calls) expect(hash).toBe(await hashStaffSessionToken(tokenA));
  });

  it('does not reject a repository-current session using the application clock', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Application clock must not decide session liveness'); });
    expect(await resolveStaffServerPrincipal(requestHeaders(), repository())).toMatchObject({ status: 'authenticated' });
  });

  it('keeps two same-role users independent when lookups complete in the opposite order', async () => {
    const store = repository();
    const a = deferred<StaffSession | null>(); const b = deferred<StaffSession | null>();
    const hashA = await hashStaffSessionToken(tokenA); const hashB = await hashStaffSessionToken(tokenB);
    vi.mocked(store.resolve).mockImplementation(hash => {
      if (hash === hashA) return a.promise;
      if (hash === hashB) return b.promise;
      throw new Error('Unexpected synthetic hash');
    });
    const first = resolveStaffServerPrincipal(requestHeaders(tokenA), store);
    const second = resolveStaffServerPrincipal(requestHeaders(tokenB), store);
    await vi.waitFor(() => expect(store.resolve).toHaveBeenCalledTimes(2));
    b.resolve(session('b'));
    const resultB = await second;
    a.resolve(session('a'));
    const resultA = await first;

    expect(resultA).toMatchObject({ status: 'authenticated', identity: { user: { id: 'internal-user-a' }, principal: { subject: 'external-subject-a' } } });
    expect(resultB).toMatchObject({ status: 'authenticated', identity: { user: { id: 'internal-user-b' }, principal: { subject: 'external-subject-b' } } });
    expect(resultA).not.toBe(resultB);
  });

  it('returns a new snapshot rather than sharing a prior result even when the adapter reuses its row object', async () => {
    const store = repository();
    const first = await resolveStaffServerPrincipal(requestHeaders(), store);
    const second = await resolveStaffServerPrincipal(requestHeaders(), store);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    if (first.status !== 'authenticated' || second.status !== 'authenticated') throw new Error('Expected synthetic identities');
    expect(first.identity).not.toBe(second.identity);
    expect(first.identity.principal).not.toBe(second.identity.principal);
    expect(store.resolve).toHaveBeenCalledTimes(2);
  });

  it('rejects browser execution without depending on a framework or Sites runtime', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    await expect(import('./server-principal')).rejects.toThrow(/require[s]? server execution/);
  });
});
