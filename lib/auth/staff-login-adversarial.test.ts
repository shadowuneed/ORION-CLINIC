import { describe, expect, it, vi } from 'vitest';
import type { StaffCredentialRepository } from '@/lib/repositories/staff-credentials';
import { handleStaffLogin, type StaffLoginDependencies } from './staff-login';
import { hashStaffPassword, type verifyStaffPassword } from './staff-password';
import {
  STAFF_SESSION_COOKIE, hashStaffSessionToken,
  type StaffSession, type StaffSessionGrant, type StaffSessionRepository,
} from './staff-session';

const origin = 'https://clinic.example.test';
const password = 'synthetic independent passphrase';
const encoded = `orion$scrypt$v1$32768$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const credentialVersion = 7;
const grant: StaffSessionGrant = {
  userId: 'synthetic-doctor-a', expectedUserVersion: 12,
  expectedIssuer: 'orion:staff', expectedSubject: 'synthetic-individual-a',
};
const session: StaffSession = {
  sessionId: 'overwritten-by-create', userId: grant.userId, displayName: 'Synthetic Doctor A',
  principal: { issuer: grant.expectedIssuer, subject: grant.expectedSubject, email: null },
  createdAt: 1000, lastSeenAt: 1000, idleExpiresAt: 1_801_000, absoluteExpiresAt: 28_801_000,
};

function fixture() {
  let saved: StaffSession | null = null;
  const credentials = {
    reserveAttempt: vi.fn<StaffCredentialRepository['reserveAttempt']>().mockImplementation(async (_login, id) => ({
      status: 'reserved', attemptId: id, credential: { passwordHash: encoded, credentialVersion },
    })),
    finishAttempt: vi.fn<StaffCredentialRepository['finishAttempt']>().mockResolvedValue(grant),
  };
  const sessions = {
    create: vi.fn<StaffSessionRepository['create']>().mockImplementation(async input => {
      saved = { ...session, sessionId: input.sessionId };
      return saved;
    }),
    resolve: vi.fn<StaffSessionRepository['resolve']>().mockImplementation(async () => saved),
    revoke: vi.fn<StaffSessionRepository['revoke']>().mockResolvedValue(undefined),
    revokeAll: vi.fn<StaffSessionRepository['revokeAll']>().mockResolvedValue(undefined),
  };
  const verifyPassword = vi.fn<typeof verifyStaffPassword>().mockResolvedValue(true);
  return { credentials, sessions, verifyPassword } satisfies StaffLoginDependencies;
}

function request(body: unknown = { login: 'doctor.a', password }, init: RequestInit = {}) {
  return new Request(`${origin}/api/staff/login`, {
    method: 'POST', ...init,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...init.headers },
    body: JSON.stringify(body),
  });
}

async function denied(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('location')).toBeNull();
  expect(await response.json()).toEqual({ error: code });
}

describe('unmounted individual login independent adversarial contract', () => {
  it('does not derive the principal or bearer from forged Sites headers or an existing cookie', async () => {
    const dependencies = fixture();
    const suppliedToken = 'c'.repeat(64);
    const result = await handleStaffLogin(request(undefined, { headers: {
      Cookie: `${STAFF_SESSION_COOKIE}=${suppliedToken}`,
      'x-chatgpt-user-id': 'attacker-admin', 'x-chatgpt-user-email': 'admin@example.test',
      Authorization: 'Bearer attacker-controlled', 'x-forwarded-user': 'attacker-admin',
    } }), dependencies, { origin });

    expect(result.status).toBe(204);
    const cookie = result.headers.get('set-cookie')!;
    expect(cookie).toContain(`${STAFF_SESSION_COOKIE}=`);
    expect(cookie).not.toContain(suppliedToken);
    const sessionToken = cookie.split(';')[0].split('=')[1];
    expect(dependencies.sessions.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...grant, tokenHash: await hashStaffSessionToken(sessionToken),
    }));
    expect(dependencies.sessions.resolve).toHaveBeenCalledExactlyOnceWith(await hashStaffSessionToken(sessionToken));
    expect(JSON.stringify(dependencies.sessions.create.mock.calls)).not.toContain('attacker');
  });

  it.each(['userId', 'role', 'issuer', 'subject', 'attemptId', 'expectedUserVersion']) (
    'rejects a client-selected %s instead of accepting it as an authorization hint', async field => {
      const dependencies = fixture();
      await denied(await handleStaffLogin(request({ login: 'doctor.a', password, [field]: 'attacker' }), dependencies, { origin }),
        400, 'INVALID_LOGIN_REQUEST');
      expect(dependencies.credentials.reserveAttempt).not.toHaveBeenCalled();
      expect(dependencies.verifyPassword).not.toHaveBeenCalled();
      expect(dependencies.sessions.create).not.toHaveBeenCalled();
    },
  );

  it('keeps unknown, disabled and wrong-password outcomes outwardly identical and refuses a dummy match', async () => {
    const responses: Array<{ status: number; headers: [string, string][]; text: string }> = [];
    for (const kind of ['unknown', 'disabled', 'wrong-password'] as const) {
      const dependencies = fixture();
      if (kind !== 'wrong-password') {
        dependencies.credentials.reserveAttempt.mockImplementation(async (_login, id) => ({
          status: 'reserved', attemptId: id, credential: null,
        }));
        // Even a defective injected verifier must not authenticate a dummy account.
        dependencies.verifyPassword.mockResolvedValue(true);
      } else dependencies.verifyPassword.mockResolvedValue(false);
      const result = await handleStaffLogin(request(), dependencies, { origin });
      responses.push({ status: result.status, headers: [...result.headers], text: await result.text() });
      expect(dependencies.verifyPassword).toHaveBeenCalledExactlyOnceWith(password, kind === 'wrong-password' ? encoded : null);
      expect(dependencies.credentials.finishAttempt).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'failure',
        kind === 'wrong-password' ? credentialVersion : undefined);
      expect(dependencies.sessions.create).not.toHaveBeenCalled();
    }
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[1]).toEqual(responses[2]);
    expect(responses[0].status).toBe(401);
  });

  it.each(['reservation', 'verification', 'completion', 'issuance', 'resolution'] as const)(
    'fails closed without reflecting exception details when %s fails', async stage => {
      const dependencies = fixture();
      const sensitive = new Error(`DO_NOT_REFLECT:${password}:${encoded}`);
      if (stage === 'reservation') dependencies.credentials.reserveAttempt.mockRejectedValueOnce(sensitive);
      if (stage === 'verification') dependencies.verifyPassword.mockRejectedValueOnce(sensitive);
      if (stage === 'completion') dependencies.credentials.finishAttempt.mockRejectedValueOnce(sensitive);
      if (stage === 'issuance') dependencies.sessions.create.mockRejectedValueOnce(sensitive);
      if (stage === 'resolution') dependencies.sessions.resolve.mockRejectedValueOnce(sensitive);
      await denied(await handleStaffLogin(request(), dependencies, { origin }), 503, 'LOGIN_UNAVAILABLE');
      if (stage === 'reservation') expect(dependencies.verifyPassword).not.toHaveBeenCalled();
      if (stage === 'verification') expect(dependencies.credentials.finishAttempt).not.toHaveBeenCalled();
      if (stage === 'completion') expect(dependencies.sessions.create).not.toHaveBeenCalled();
    },
  );

  it('uses the verified credential version when a reset occurs while KDF is pending', async () => {
    const dependencies = fixture();
    let release: (matches: boolean) => void = () => {};
    let currentVersion = credentialVersion;
    dependencies.verifyPassword.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    dependencies.credentials.finishAttempt.mockImplementation(async (_id, outcome, expectedVersion) =>
      outcome === 'success' && expectedVersion === currentVersion ? grant : null);
    const pending = handleStaffLogin(request(), dependencies, { origin });
    await vi.waitFor(() => expect(dependencies.verifyPassword).toHaveBeenCalledOnce());
    currentVersion += 1; // Models the repository's reset guard, not a SQL integration test.
    release(true);
    await denied(await pending, 401, 'INVALID_CREDENTIALS');
    expect(dependencies.credentials.finishAttempt).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'success', credentialVersion);
    expect(dependencies.credentials.reserveAttempt).toHaveBeenCalledOnce();
    expect(dependencies.sessions.create).not.toHaveBeenCalled();
  });

  it('does not emit a cookie when the user grant becomes stale after successful completion', async () => {
    const dependencies = fixture();
    dependencies.sessions.create.mockResolvedValueOnce(null);
    await denied(await handleStaffLogin(request(), dependencies, { origin }), 401, 'INVALID_CREDENTIALS');
    expect(dependencies.sessions.resolve).not.toHaveBeenCalled();
  });

  it.each(['missing', 'session', 'user', 'issuer', 'subject'] as const)(
    'revokes the just-created bearer when the final current session has a %s mismatch', async mismatch => {
      const dependencies = fixture();
      dependencies.sessions.resolve.mockImplementationOnce(async () => {
        if (mismatch === 'missing') return null;
        const value = { ...session, sessionId: dependencies.sessions.create.mock.calls[0][0].sessionId,
          principal: { ...session.principal } };
        if (mismatch === 'session') value.sessionId = 'another-session';
        if (mismatch === 'user') value.userId = 'another-user';
        if (mismatch === 'issuer') value.principal.issuer = 'another-issuer';
        if (mismatch === 'subject') value.principal.subject = 'another-subject';
        return value;
      });
      await denied(await handleStaffLogin(request(), dependencies, { origin }), 401, 'INVALID_CREDENTIALS');
      expect(dependencies.sessions.revoke).toHaveBeenCalledExactlyOnceWith(dependencies.sessions.create.mock.calls[0][0].tokenHash);
    },
  );

  it('does not convert failed compensating revocation into a successful response', async () => {
    const dependencies = fixture();
    dependencies.sessions.resolve.mockResolvedValueOnce(null);
    dependencies.sessions.revoke.mockRejectedValueOnce(new Error('synthetic revoke failure'));
    await denied(await handleStaffLogin(request(), dependencies, { origin }), 503, 'LOGIN_UNAVAILABLE');
  });

  it('does not issue after an abort during password verification', async () => {
    const dependencies = fixture();
    const controller = new AbortController();
    dependencies.verifyPassword.mockImplementationOnce(async () => { controller.abort(); return true; });
    await denied(await handleStaffLogin(request(undefined, { signal: controller.signal }), dependencies, { origin }),
      401, 'INVALID_CREDENTIALS');
    expect(dependencies.credentials.finishAttempt).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'failure', credentialVersion);
    expect(dependencies.sessions.create).not.toHaveBeenCalled();
  });

  it('revokes after a late abort during the final current-user check', async () => {
    const dependencies = fixture();
    const controller = new AbortController();
    dependencies.sessions.resolve.mockImplementationOnce(async () => {
      controller.abort();
      return { ...session, sessionId: dependencies.sessions.create.mock.calls[0][0].sessionId };
    });
    await denied(await handleStaffLogin(request(undefined, { signal: controller.signal }), dependencies, { origin }),
      401, 'INVALID_CREDENTIALS');
    expect(dependencies.sessions.revoke).toHaveBeenCalledOnce();
  });

  it('reserves distinct server-side nonces for repeated identical submitted credentials', async () => {
    const dependencies = fixture();
    dependencies.verifyPassword.mockResolvedValue(false);
    await handleStaffLogin(request(), dependencies, { origin });
    await handleStaffLogin(request(), dependencies, { origin });
    const calls = dependencies.credentials.reserveAttempt.mock.calls;
    expect(calls[0][1]).toMatch(/^[a-f0-9-]{36}$/);
    expect(calls[1][1]).not.toBe(calls[0][1]);
    expect(dependencies.credentials.finishAttempt.mock.calls.map(call => call[0])).toEqual(calls.map(call => call[1]));
  });

  it('does not begin KDF or finalize any nonce when durable reservation denies capacity', async () => {
    const dependencies = fixture();
    dependencies.credentials.reserveAttempt.mockResolvedValueOnce({ status: 'throttled', retryAfterSeconds: 15.2 });
    const result = await handleStaffLogin(request(), dependencies, { origin });
    expect(result.headers.get('retry-after')).toBe('16');
    await denied(result, 429, 'LOGIN_RETRY_LATER');
    expect(dependencies.verifyPassword).not.toHaveBeenCalled();
    expect(dependencies.credentials.finishAttempt).not.toHaveBeenCalled();
    expect(dependencies.sessions.create).not.toHaveBeenCalled();
  });

  it('does not trust Content-Length to bypass the cumulative streamed body cap', async () => {
    const dependencies = fixture();
    const payload = new TextEncoder().encode(JSON.stringify({ login: 'doctor.a', password, padding: 'x'.repeat(8192) }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(payload.slice(0, 4096));
      controller.enqueue(payload.slice(4096));
      controller.close();
    } });
    const streamed = new Request(`${origin}/api/staff/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': '1' },
      body: stream, duplex: 'half',
    } as RequestInit);
    await denied(await handleStaffLogin(streamed, dependencies, { origin }), 400, 'INVALID_LOGIN_REQUEST');
    expect(dependencies.credentials.reserveAttempt).not.toHaveBeenCalled();
  });

  it.each(['never-settles', 'rejects'] as const)(
    'enforces the five-second body deadline even if hostile stream cancellation %s', async cancellation => {
      vi.useFakeTimers();
      const dependencies = fixture();
      const onUnhandled = vi.fn();
      process.on('unhandledRejection', onUnhandled);
      const cancel = vi.fn(() => cancellation === 'never-settles'
        ? new Promise<void>(() => {})
        : Promise.reject(new Error('synthetic hostile cancellation')));
      // A stream which never enqueues or closes cannot make reader.read settle.
      const body = new ReadableStream<Uint8Array>({ cancel });
      let outcome: Response | Error | undefined;
      try {
        const stalled = new Request(`${origin}/api/staff/login`, {
          method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
          body, duplex: 'half',
        } as RequestInit);
        const settled = handleStaffLogin(stalled, dependencies, { origin }).then(
          value => { outcome = value; }, error => { outcome = error; },
        );
        await vi.advanceTimersByTimeAsync(4999);
        expect(outcome).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toBeInstanceOf(Response);
        await settled;
        await denied(outcome as Response, 400, 'INVALID_LOGIN_REQUEST');
        expect(cancel).toHaveBeenCalledOnce();
        expect(dependencies.credentials.reserveAttempt).not.toHaveBeenCalled();
        expect(dependencies.verifyPassword).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(onUnhandled).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        vi.useRealTimers();
      }
    },
  );

  it('aborts a stalled body read before its deadline without beginning a reservation or KDF', async () => {
    vi.useFakeTimers();
    const dependencies = fixture();
    const abort = new AbortController();
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    let outcome: Response | Error | undefined;
    try {
      const stalled = new Request(`${origin}/api/staff/login`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body, signal: abort.signal, duplex: 'half',
      } as RequestInit);
      const settled = handleStaffLogin(stalled, dependencies, { origin }).then(
        value => { outcome = value; }, error => { outcome = error; },
      );
      await vi.advanceTimersByTimeAsync(25);
      expect(outcome).toBeUndefined();
      abort.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toBeInstanceOf(Response);
      await settled;
      await denied(outcome as Response, 400, 'INVALID_LOGIN_REQUEST');
      expect(cancel).toHaveBeenCalledOnce();
      expect(dependencies.credentials.reserveAttempt).not.toHaveBeenCalled();
      expect(dependencies.verifyPassword).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      vi.useRealTimers();
    }
  });

  it('rejects malformed UTF-8 without lossy decoding into another password', async () => {
    const dependencies = fixture();
    const before = new TextEncoder().encode('{"login":"doctor.a","password":"');
    const after = new TextEncoder().encode('"}');
    const body = new Uint8Array([...before, 0xc3, 0x28, ...after]);
    const malformed = new Request(`${origin}/api/staff/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
    });
    await denied(await handleStaffLogin(malformed, dependencies, { origin }), 400, 'INVALID_LOGIN_REQUEST');
    expect(dependencies.verifyPassword).not.toHaveBeenCalled();
  });

  it('passes exact Unicode and whitespace password bytes to the verifier while normalizing only login', async () => {
    const dependencies = fixture();
    const exact = '  Kazakh қазақша пароль e\u0301  ';
    expect((await handleStaffLogin(request({ login: '  Doctor.A  ', password: exact }), dependencies, { origin })).status).toBe(204);
    expect(dependencies.verifyPassword).toHaveBeenCalledExactlyOnceWith(exact, encoded);
    expect(dependencies.credentials.reserveAttempt).toHaveBeenCalledExactlyOnceWith('doctor.a', expect.any(String));
  });

  it('integrates the default real scrypt verifier without cookie publication for corrupt stored hashes', async () => {
    const dependencies = fixture();
    const realHash = await hashStaffPassword(password);
    dependencies.credentials.reserveAttempt.mockImplementation(async (_login, id) => ({
      status: 'reserved', attemptId: id, credential: { passwordHash: realHash, credentialVersion },
    }));
    const realDependencies: StaffLoginDependencies = { credentials: dependencies.credentials, sessions: dependencies.sessions };
    expect((await handleStaffLogin(request(), realDependencies, { origin })).status).toBe(204);
    dependencies.credentials.reserveAttempt.mockImplementation(async (_login, id) => ({
      status: 'reserved', attemptId: id, credential: { passwordHash: `${realHash}\n`, credentialVersion },
    }));
    dependencies.credentials.finishAttempt.mockClear();
    dependencies.sessions.create.mockClear();
    await denied(await handleStaffLogin(request(), realDependencies, { origin }), 503, 'LOGIN_UNAVAILABLE');
    expect(dependencies.credentials.finishAttempt).not.toHaveBeenCalled();
    expect(dependencies.sessions.create).not.toHaveBeenCalled();
  });
});
