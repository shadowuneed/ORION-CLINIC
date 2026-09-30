import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudSessionVerifier } from './session-verification-scheduler';
import { CloudAccountBoundary } from '@/app/cloud-account-boundary';
import { cloudGenerationCookie } from './account-fence';

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, index: 0,
  effect: undefined as undefined | (() => void | (() => void)) }));
vi.mock('react', () => ({
  useRef: (initial: unknown) => hooks.refs[hooks.index++] ??= { current: initial },
  useLayoutEffect: (effect: () => void | (() => void)) => { hooks.effect = effect; },
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  hooks.refs = []; hooks.index = 0; hooks.effect = undefined;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function scheduler() {
  const state = { visible: true, allowed: true };
  const verify = vi.fn<(signal: AbortSignal) => Promise<void>>().mockResolvedValue(undefined);
  const control = createCloudSessionVerifier({ isVisible: () => state.visible, canVerify: () => state.allowed, verify });
  return { state, verify, control };
}

describe('cloud session verification request scheduling', () => {
  it('has zero hidden-tab verification requests and no scheduled network timer', async () => {
    const fixture = scheduler(); fixture.state.visible = false; fixture.control.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.verify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves the ten-second visible revocation cadence without duplicating SSR verification', async () => {
    const fixture = scheduler(); fixture.control.start();
    expect(fixture.verify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.verify).toHaveBeenCalledTimes(6);
    fixture.control.dispose();
  });
  it('coalesces repeated focus and visibility wakeups with the same visible cadence', async () => {
    const fixture = scheduler(); fixture.control.start();
    for (let index = 0; index < 100; index++) fixture.control.wake();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.verify).toHaveBeenCalledOnce();
    for (let index = 0; index < 100; index++) fixture.control.wake();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fixture.verify).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.verify).toHaveBeenCalledTimes(2);
    fixture.control.dispose();
  });
  it('verifies immediately after a genuine hidden-to-visible transition, once per wakeup burst', async () => {
    const fixture = scheduler(); fixture.control.start();
    await vi.advanceTimersByTimeAsync(10_000);
    fixture.state.visible = false; fixture.control.pause();
    await vi.advanceTimersByTimeAsync(100);
    fixture.state.visible = true;
    for (let index = 0; index < 100; index++) fixture.control.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.verify).toHaveBeenCalledTimes(2);
    fixture.control.dispose();
  });
  it('allows only one in-flight request and queues one resumed check after abort settlement', async () => {
    const fixture = scheduler();
    let settle: (() => void) | undefined;
    fixture.verify.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
    fixture.control.start(); await vi.advanceTimersByTimeAsync(10_000);
    for (let index = 0; index < 100; index++) fixture.control.wake();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.verify).toHaveBeenCalledOnce();
    const active = fixture.verify.mock.calls[0][0];
    fixture.state.visible = false; fixture.control.pause(); expect(active.aborted).toBe(true);
    fixture.state.visible = true; fixture.control.wake(); fixture.control.wake();
    expect(fixture.verify).toHaveBeenCalledOnce();
    settle?.(); await vi.advanceTimersByTimeAsync(0);
    expect(fixture.verify).toHaveBeenCalledTimes(2);
    fixture.control.dispose();
  });
  it('retries unavailability on the existing cadence rather than treating it as a grant', async () => {
    const fixture = scheduler(); fixture.verify.mockRejectedValueOnce(new Error('Unavailable'));
    fixture.control.start(); await vi.advanceTimersByTimeAsync(20_000);
    expect(fixture.verify).toHaveBeenCalledTimes(2);
    fixture.control.dispose();
  });
  it('disposal aborts the active request and never reschedules after a late completion', async () => {
    const fixture = scheduler(); let settle: (() => void) | undefined;
    fixture.verify.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
    fixture.control.start(); await vi.advanceTimersByTimeAsync(10_000);
    fixture.control.dispose(); expect(fixture.verify.mock.calls[0][0].aborted).toBe(true);
    settle?.(); await vi.advanceTimersByTimeAsync(60_000);
    fixture.control.wake(); expect(fixture.verify).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not verify after the account fence is invalidated before a scheduled request', async () => {
    const fixture = scheduler(); fixture.control.start(); fixture.state.allowed = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.verify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

const generation = 'a'.repeat(32);
function browser(visible = true) {
  const documentListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ authenticated: true, generation }));
  const documentFixture = { cookie: `${cloudGenerationCookie}=${generation}`, visibilityState: visible ? 'visible' : 'hidden',
    documentElement: { style: { visibility: '' } },
    addEventListener: (name: string, listener: () => void) => { documentListeners.set(name, listener); },
    removeEventListener: (name: string) => { documentListeners.delete(name); } };
  const windowFixture = { fetch: transport, location: { href: 'https://orion.invalid/patients', origin: 'https://orion.invalid', replace: vi.fn(), reload: vi.fn() },
    setInterval, clearInterval,
    addEventListener: (name: string, listener: () => void) => { windowListeners.set(name, listener); },
    removeEventListener: (name: string) => { windowListeners.delete(name); } };
  vi.stubGlobal('window', windowFixture); vi.stubGlobal('document', documentFixture);
  CloudAccountBoundary({ generation, children: null });
  const cleanup = hooks.effect?.();
  return { documentFixture, windowFixture, documentListeners, windowListeners, transport, cleanup };
}

describe('account boundary verification lifecycle', () => {
  it('deduplicates foreground focus events and periodic checks', async () => {
    const fixture = browser();
    for (let index = 0; index < 100; index++) fixture.windowListeners.get('focus')?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.transport).toHaveBeenCalledOnce();
    fixture.windowListeners.get('focus')?.(); await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.transport).toHaveBeenCalledTimes(2);
    fixture.cleanup?.();
  });
  it('has no hidden-tab requests and coalesces visibility return with focus', async () => {
    const fixture = browser(false); await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.transport).not.toHaveBeenCalled();
    fixture.documentFixture.visibilityState = 'visible'; fixture.documentListeners.get('visibilitychange')?.();
    fixture.windowListeners.get('focus')?.(); await vi.advanceTimersByTimeAsync(0);
    expect(fixture.transport).toHaveBeenCalledOnce(); fixture.cleanup?.();
  });
  it('aborts verification on hide without interpreting an aborted late response as revocation', async () => {
    const fixture = browser(); let settle: ((response: Response) => void) | undefined;
    fixture.transport.mockImplementationOnce(() => new Promise<Response>(resolve => { settle = resolve; }));
    await vi.advanceTimersByTimeAsync(10_000);
    const signal = fixture.transport.mock.calls[0][1]?.signal;
    fixture.documentFixture.visibilityState = 'hidden'; fixture.documentListeners.get('visibilitychange')?.();
    expect(signal?.aborted).toBe(true);
    settle?.(Response.json({ generation: 'b'.repeat(32) })); await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.transport).toHaveBeenCalledOnce(); expect(fixture.windowFixture.location.replace).not.toHaveBeenCalled();
    fixture.cleanup?.();
  });
  it('still invalidates an account change locally while hidden and aborts its verification', async () => {
    const fixture = browser(); let settle: ((response: Response) => void) | undefined;
    fixture.transport.mockImplementationOnce(() => new Promise<Response>(resolve => { settle = resolve; }));
    await vi.advanceTimersByTimeAsync(10_000);
    const signal = fixture.transport.mock.calls[0][1]?.signal;
    fixture.documentFixture.visibilityState = 'hidden'; fixture.documentFixture.cookie = `${cloudGenerationCookie}=${'b'.repeat(32)}`;
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.windowFixture.location.replace).toHaveBeenCalledWith('/sign-in');
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden'); expect(signal?.aborted).toBe(true);
    settle?.(Response.json({ generation })); await vi.advanceTimersByTimeAsync(20_000);
    expect(fixture.transport).toHaveBeenCalledOnce(); fixture.cleanup?.();
  });
  it('disposes verification and event handlers on unmount without applying a late 401', async () => {
    const fixture = browser(); let settle: ((response: Response) => void) | undefined;
    fixture.transport.mockImplementationOnce(() => new Promise<Response>(resolve => { settle = resolve; }));
    await vi.advanceTimersByTimeAsync(10_000);
    const signal = fixture.transport.mock.calls[0][1]?.signal;
    fixture.cleanup?.(); expect(signal?.aborted).toBe(true);
    settle?.(new Response(null, { status: 401 })); await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.windowFixture.location.replace).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(fixture.documentListeners.size).toBe(0); expect(fixture.windowListeners.size).toBe(0);
  });
  it('still unloads immediately on a live verification 401', async () => {
    const fixture = browser(); fixture.transport.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.windowFixture.location.replace).toHaveBeenCalledWith('/sign-in');
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden'); fixture.cleanup?.();
  });
});
