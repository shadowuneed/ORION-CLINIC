import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudRpcName } from './supabase-rpc.server';

const control = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return {
    scope: new AsyncLocalStorage<{ memo: Map<unknown, unknown>; headers: Headers }>(),
    session: vi.fn(), access: vi.fn(), transport: vi.fn(), headers: vi.fn(), clinic: vi.fn(),
  };
});

// Model React's request-scoped memo dispatcher, never a process/global cache.
vi.mock('react', () => ({ cache: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
  const memo = control.scope.getStore()?.memo;
  if (!memo) return fn(...args);
  if (!memo.has(fn)) memo.set(fn, fn(...args));
  return memo.get(fn);
} }));
vi.mock('next/headers', () => ({ headers: control.headers }));
vi.mock('./auth-session.server', () => ({ readCloudAuthSession: control.session, readCloudAccessToken: control.access }));
vi.mock('./supabase-rpc.server', async importOriginal => ({
  ...await importOriginal<typeof import('./supabase-rpc.server')>(), callCloudRpc: control.transport,
}));
vi.mock('@/app/authenticated-clinic-page', () => ({
  getAuthenticatedClinicContext: control.clinic, AuthenticatedClinicPage: () => null,
}));

import { cloudDatabaseForPage, cloudDatabaseForRequest } from './database-context.server';
import { cloudAccessRepositoryForPage } from './access-repository.server';
import AccessPage from '@/app/access/page';

const issuer = `https://${'a'.repeat(20)}.supabase.co/auth/v1`;
const sessionId = '00000000-0000-4000-8000-000000000002';
const principal = (subject = 'synthetic-a') => ({ issuer, subject, email: 'synthetic@example.invalid' });
function pageRequest<T>(run: () => T, subject = 'synthetic-a') {
  return control.scope.run({ memo: new Map(), headers: new Headers({ 'x-synthetic-subject': subject }) }, run);
}

beforeEach(() => {
  vi.stubEnv('ORION_SUPABASE_PROJECT_REF', 'a'.repeat(20));
  vi.stubEnv('ORION_SUPABASE_URL', `https://${'a'.repeat(20)}.supabase.co`);
  vi.stubEnv('ORION_SUPABASE_PUBLISHABLE_KEY', `sb_publishable_${'b'.repeat(24)}`);
  control.headers.mockReset().mockImplementation(async () => control.scope.getStore()?.headers ?? new Headers());
  control.session.mockReset().mockImplementation(async (headers: Headers) => ({
    principal: principal(headers.get('x-synthetic-subject') ?? undefined), sessionId,
  }));
  control.access.mockReset().mockReturnValue('synthetic.payload.signature');
  control.transport.mockReset().mockResolvedValue({
    user: { id: 'staff-synthetic', displayName: 'Synthetic staff' }, assignments: [], observedAt: 1,
  });
  control.clinic.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('SSR-only request-scoped access RPC dedupe', () => {
  it('shares one verified context between concurrent consumers in the same SSR request', async () => {
    await pageRequest(async () => {
      const [layout, identity, repository] = await Promise.all([
        cloudDatabaseForPage(), cloudDatabaseForPage(), cloudDatabaseForPage(),
      ]);
      expect(layout).toBe(identity);
      expect(identity).toBe(repository);
      expect(Object.isFrozen(layout)).toBe(true);
    });
    expect(control.headers).toHaveBeenCalledOnce();
    expect(control.session).toHaveBeenCalledOnce();
    expect(control.transport).not.toHaveBeenCalled();
  });

  it('runs the live SQL session/grant check and audit once for identical no-args access consumers', async () => {
    await pageRequest(async () => {
      const [shell, picker] = await Promise.all([cloudAccessRepositoryForPage(), cloudAccessRepositoryForPage()]);
      const [first, second] = await Promise.all([
        shell.listPrincipalAssignments(principal()), picker.listPrincipalAssignments(principal()),
      ]);
      expect(first).toEqual([]);
      expect(second).toEqual(first);
      const context = await cloudDatabaseForPage();
      await context.call('orion_access_overview');
    });
    expect(control.session).toHaveBeenCalledOnce();
    expect(control.transport).toHaveBeenCalledOnce();
    expect(control.transport.mock.calls[0][0]).toMatchObject({ name: 'orion_access_overview', args: undefined });
  });

  it('does not cache authentication or access snapshots across requests/accounts', async () => {
    const first = await pageRequest(async () => {
      const context = await cloudDatabaseForPage();
      await context.call('orion_access_overview');
      return context;
    });
    const second = await pageRequest(async () => {
      const context = await cloudDatabaseForPage();
      await context.call('orion_access_overview');
      return context;
    }, 'synthetic-b');
    expect(first).not.toBe(second);
    expect(first.principal.subject).toBe('synthetic-a');
    expect(second.principal.subject).toBe('synthetic-b');
    expect(control.session).toHaveBeenCalledTimes(2);
    expect(control.transport).toHaveBeenCalledTimes(2);
  });

  it('keeps a rejected access snapshot failed closed in that request, but rechecks the next request', async () => {
    const unavailable = new Error('Synthetic upstream unavailable');
    control.transport.mockRejectedValueOnce(unavailable);
    await pageRequest(async () => {
      const context = await cloudDatabaseForPage();
      const first = context.call('orion_access_overview');
      const second = context.call('orion_access_overview');
      expect(second).toBe(first);
      await expect(first).rejects.toBe(unavailable);
      await expect(second).rejects.toBe(unavailable);
    });
    expect(control.transport).toHaveBeenCalledOnce();
    await pageRequest(async () => {
      await expect((await cloudDatabaseForPage()).call('orion_access_overview')).resolves.toBeDefined();
    });
    expect(control.transport).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe access calls with explicit args, even an empty object', async () => {
    await pageRequest(async () => {
      const context = await cloudDatabaseForPage();
      await context.call('orion_access_overview', {});
      await context.call('orion_access_overview', {});
      await context.call('orion_access_overview');
      await context.call('orion_access_overview');
    });
    expect(control.transport).toHaveBeenCalledTimes(3);
  });

  it.each(['orion_patients_list', 'orion_patient_detail', 'orion_patient_create', 'orion_patient_update', 'orion_patient_archive'] as const)(
    'never caches %s in an SSR context', async name => {
      await pageRequest(async () => {
        const context = await cloudDatabaseForPage();
        await context.call(name, { assignment_id: 'synthetic-assignment' });
        await context.call(name, { assignment_id: 'synthetic-assignment' });
      });
      expect(control.transport).toHaveBeenCalledTimes(2);
    },
  );

  it('forwards unknown calls to the existing fail-closed allowlist, without dedupe', async () => {
    control.transport.mockRejectedValue(new Error('Unknown RPC rejected'));
    await pageRequest(async () => {
      const context = await cloudDatabaseForPage();
      await expect(context.call('query' as CloudRpcName)).rejects.toThrow('Unknown RPC rejected');
      await expect(context.call('query' as CloudRpcName)).rejects.toThrow('Unknown RPC rejected');
    });
    expect(control.transport).toHaveBeenCalledTimes(2);
  });

  it('keeps API contexts fresh and still requires the exact live session generation', async () => {
    const request = new Request('https://orion.invalid/api/patients', {
      headers: { 'orion-session-generation': sessionId.replaceAll('-', '') },
    });
    await pageRequest(async () => {
      const first = await cloudDatabaseForRequest(request);
      const second = await cloudDatabaseForRequest(request);
      expect(first).not.toBe(second);
      await first.call('orion_access_overview');
      await first.call('orion_access_overview');
      await second.call('orion_access_overview');
      request.headers.set('orion-session-generation', 'f'.repeat(32));
      await expect(cloudDatabaseForRequest(request)).rejects.toThrow();
    });
    expect(control.session).toHaveBeenCalledTimes(3);
    expect(control.transport).toHaveBeenCalledTimes(3);
  });

  it('does not repeat the access-page picker lookup when the shell check already failed', async () => {
    control.clinic.mockResolvedValue({ user: { userId: 'synthetic-a', email: null, issuer }, accessCheck: 'unavailable' });
    await pageRequest(async () => { await AccessPage({ searchParams: Promise.resolve({}) }); });
    expect(control.clinic).toHaveBeenCalledWith('/access');
    expect(control.session).not.toHaveBeenCalled();
    expect(control.transport).not.toHaveBeenCalled();
  });
});
