import { describe, expect, it, vi } from 'vitest';
import { createLocalMaterialLifecycle, type LocalMaterialContext } from './lifecycle';

function context(userId = 'synthetic-doctor-a') {
  return {
    audience: 'staff' as const, userId, issuer: 'orion:staff-test', subject: `subject-${userId}`,
    organizationId: 'org-test', facilityId: 'facility-test', accessAssignmentId: `assignment-${userId}`,
    patientId: 'synthetic-patient-a', encounterId: 'synthetic-encounter-a', authorizationGeneration: 'server-generation-a',
    consentVersions: { care: 1, transcriptStorage: 2, audioRetention: 3, transientAudioProcessing: 4, externalAiProcessing: null as number | null },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const action = () => vi.fn<() => undefined>();

describe('unmounted local material lifecycle, no storage or authorization', () => {
  it('starts unbound and accepts repeated invalidation without making an owner', () => {
    const lifecycle = createLocalMaterialLifecycle();
    expect(Object.isFrozen(lifecycle)).toBe(true);
    expect(lifecycle.capture()).toBeNull();
    lifecycle.invalidate(); lifecycle.invalidate();
    expect(lifecycle.capture()).toBeNull();
  });

  it('copies and freezes all identity, scope and consent version pins', () => {
    const lifecycle = createLocalMaterialLifecycle();
    const input = context();
    lifecycle.replaceContext(input);
    const lease = lifecycle.capture()!;
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.isFrozen(lease.context)).toBe(true);
    expect(Object.isFrozen(lease.context.consentVersions)).toBe(true);
    expect(lease.context).toEqual(input);
    expect(lease.context).not.toBe(input);
    expect(lease.context.consentVersions).not.toBe(input.consentVersions);
    input.userId = 'synthetic-doctor-b';
    input.consentVersions.audioRetention = 900;
    expect(lease.context.userId).toBe('synthetic-doctor-a');
    expect(lease.context.consentVersions.audioRetention).toBe(3);
    expect(Reflect.set(lease.context, 'userId', 'synthetic-doctor-b')).toBe(false);
    expect(Reflect.set(lease.context.consentVersions, 'care', 500)).toBe(false);
  });

  it('keeps an explicit null consent pin without treating it as a grant', () => {
    const lifecycle = createLocalMaterialLifecycle();
    const input = context();
    lifecycle.replaceContext({ ...input, consentVersions: Object.fromEntries(Object.keys(input.consentVersions).map(key => [key, null])) });
    const lease = lifecycle.capture()!;
    expect(Object.values(lease.context.consentVersions)).toEqual([null, null, null, null, null]);
    expect(lease.isCurrent()).toBe(true); // Current lease is not consent authorization.
  });

  it('commits one synchronous publication and cannot replay the same lease', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!;
    const publish = action();
    expect(lease.commit(publish)).toBe(true);
    expect(lease.commit(publish)).toBe(false);
    expect(lease.isCurrent()).toBe(false);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('closes before a throwing publication and does not claim side-effect rollback', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!;
    let alreadyPublished = 0;
    expect(() => lease.commit(() => { alreadyPublished += 1; throw new Error('synthetic failure'); })).toThrow('synthetic failure');
    expect(alreadyPublished).toBe(1);
    expect(lease.isCurrent()).toBe(false);
    const replay = action();
    expect(lease.commit(replay)).toBe(false);
    expect(replay).not.toHaveBeenCalled();
  });

  it('finishes an unused lease without closing another operation in the same generation', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const first = lifecycle.capture()!; const second = lifecycle.capture()!;
    first.finish(); first.finish();
    expect(first.commit(action())).toBe(false);
    expect(second.isCurrent()).toBe(true);
    lifecycle.invalidate();
    expect(first.signal.aborted).toBe(false); // Already completed, not outstanding.
    expect(second.signal.aborted).toBe(true);
  });

  it('switches between two individual staff who may hold the same role without using that role', () => {
    const lifecycle = createLocalMaterialLifecycle();
    lifecycle.replaceContext(context('synthetic-doctor-a'));
    const first = lifecycle.capture()!;
    const revoke = action(); first.registerCleanup(revoke);
    lifecycle.replaceContext(context('synthetic-doctor-b'));
    const second = lifecycle.capture()!;
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(first.commit(action())).toBe(false);
    expect(revoke).toHaveBeenCalledOnce();
    expect(second.context.userId).toBe('synthetic-doctor-b');
    expect(second.context.subject).not.toBe(first.context.subject);
    expect(second.isCurrent()).toBe(true);
    expect(second.context).not.toHaveProperty('role');
  });

  it.each([
    'userId', 'issuer', 'subject', 'organizationId', 'facilityId', 'accessAssignmentId',
    'patientId', 'encounterId', 'authorizationGeneration',
  ] as const)('fences an old operation when only %s changes', field => {
    const lifecycle = createLocalMaterialLifecycle();
    const initial = context(); lifecycle.replaceContext(initial);
    const first = lifecycle.capture()!;
    lifecycle.replaceContext({ ...initial, [field]: `${initial[field]}-next` });
    expect(first.signal.aborted).toBe(true);
    expect(first.commit(action())).toBe(false);
    expect(lifecycle.capture()!.context[field]).toBe(`${initial[field]}-next`);
  });

  it.each(['care', 'transcriptStorage', 'audioRetention', 'transientAudioProcessing', 'externalAiProcessing'] as const)(
    'fences an old operation when only consentVersions.%s changes', field => {
      const lifecycle = createLocalMaterialLifecycle();
      const initial = context(); lifecycle.replaceContext(initial);
      const first = lifecycle.capture()!;
      lifecycle.replaceContext({ ...initial, consentVersions: { ...initial.consentVersions, [field]: 10 } });
      expect(first.signal.aborted).toBe(true);
      expect(first.isCurrent()).toBe(false);
      expect(lifecycle.capture()!.context.consentVersions[field]).toBe(10);
    },
  );

  it('does not resurrect leases when owner A returns after B or an identical context is reinstalled', () => {
    const lifecycle = createLocalMaterialLifecycle(); const a = context();
    lifecycle.replaceContext(a); const first = lifecycle.capture()!;
    lifecycle.replaceContext(context('synthetic-doctor-b'));
    lifecycle.replaceContext(a); const returned = lifecycle.capture()!;
    expect(first.isCurrent()).toBe(false);
    lifecycle.replaceContext(a);
    expect(returned.isCurrent()).toBe(false);
    expect(lifecycle.capture()!.isCurrent()).toBe(true);
  });

  it.each(['resolve', 'reject'] as const)('ignores an old task that later %s after owner replacement', async outcome => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!; // Capture before the operation, not after await.
    const pending = deferred<string>();
    const publish = action(); const publishError = action();
    const task = (async () => {
      try { await pending.promise; lease.commit(publish); }
      catch { lease.commit(publishError); }
      finally { lease.finish(); }
    })();
    lifecycle.replaceContext(context('synthetic-doctor-b'));
    if (outcome === 'resolve') pending.resolve('synthetic private material A');
    else pending.reject(new Error('synthetic owner A failure'));
    await task;
    expect(publish).not.toHaveBeenCalled(); expect(publishError).not.toHaveBeenCalled();
    expect(lifecycle.capture()!.context.userId).toBe('synthetic-doctor-b');
  });

  it('keeps a committed resource registered until explicit release or invalidation', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!; const cleanup = action();
    const release = lease.registerCleanup(cleanup);
    expect(lease.commit(action())).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();
    lifecycle.invalidate(); release(); lifecycle.invalidate();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(lease.signal.aborted).toBe(false); // Resource lifetime is separate from operation completion.
  });

  it('immediately releases a resource registered by an old promise and never gives it to the new owner', async () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const oldLease = lifecycle.capture()!; const pending = deferred<string>(); const revokeOld = action();
    const task = (async () => {
      await pending.promise;
      return oldLease.registerCleanup(revokeOld);
    })();
    lifecycle.replaceContext(context('synthetic-doctor-b'));
    const newLease = lifecycle.capture()!; const revokeNew = action(); newLease.registerCleanup(revokeNew);
    pending.resolve('synthetic-object-url-a');
    const releaseOld = await task;
    expect(revokeOld).toHaveBeenCalledOnce(); expect(revokeNew).not.toHaveBeenCalled();
    expect(newLease.isCurrent()).toBe(true);
    releaseOld(); lifecycle.invalidate();
    expect(revokeOld).toHaveBeenCalledOnce(); expect(revokeNew).toHaveBeenCalledOnce();
  });

  it('makes explicit cleanup release idempotent without retiring other resources', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!; const first = action(); const second = action();
    const release = lease.registerCleanup(first); lease.registerCleanup(second);
    release(); release();
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
    expect(lease.isCurrent()).toBe(true);
    lifecycle.invalidate();
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  });

  it('cleans up once even when a cleanup throws, recursively invalidates or releases a sibling', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!;
    const bad = vi.fn<() => undefined>(() => { throw new Error('synthetic cleanup failure'); });
    const sibling = action();
    let releaseSibling = () => {};
    lease.registerCleanup(bad);
    lease.registerCleanup(() => { lifecycle.invalidate(); releaseSibling(); });
    releaseSibling = lease.registerCleanup(sibling);
    lifecycle.invalidate(); lifecycle.invalidate();
    expect(lease.signal.aborted).toBe(true);
    expect(bad).toHaveBeenCalledOnce(); expect(sibling).toHaveBeenCalledOnce();
    expect(lifecycle.capture()).toBeNull();
  });

  it('detaches before abort callbacks and denies capture/publication during cleanup', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!; const another = lifecycle.capture()!;
    const publish = action(); const observations: unknown[] = [];
    lease.signal.addEventListener('abort', () => { observations.push(lifecycle.capture(), another.commit(publish)); });
    lease.registerCleanup(() => { observations.push(lifecycle.capture(), lease.commit(publish)); });
    lifecycle.invalidate();
    expect(observations).toEqual([null, false, null, false]);
    expect(publish).not.toHaveBeenCalled(); expect(another.signal.aborted).toBe(true);
  });

  it('cancels an outer context replacement when cleanup invalidates the pending transition', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!; const sibling = action();
    lease.registerCleanup(() => { lifecycle.invalidate(); }); lease.registerCleanup(sibling);
    expect(() => lifecycle.replaceContext(context('synthetic-doctor-b'))).toThrow('replacement was invalidated');
    expect(sibling).toHaveBeenCalledOnce(); expect(lifecycle.capture()).toBeNull();
    lifecycle.replaceContext(context('synthetic-doctor-b'));
    expect(lifecycle.capture()!.context.userId).toBe('synthetic-doctor-b');
  });

  it('does not let reentrant cleanup replace an owner or skip sibling cleanup', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const lease = lifecycle.capture()!; const sibling = action();
    lease.registerCleanup(() => { lifecycle.replaceContext(context('synthetic-doctor-c')); });
    lease.registerCleanup(sibling);
    expect(() => lifecycle.replaceContext(context('synthetic-doctor-b'))).toThrow('replacement was invalidated');
    expect(lifecycle.capture()).toBeNull(); expect(sibling).toHaveBeenCalledOnce();
    expect(lease.isCurrent()).toBe(false);
  });

  it('also blocks owner replacement from a late stale cleanup callback outside invalidate', () => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const oldLease = lifecycle.capture()!;
    lifecycle.replaceContext(context('synthetic-doctor-b'));
    const newLease = lifecycle.capture()!; const revokeNew = action(); newLease.registerCleanup(revokeNew);
    oldLease.registerCleanup(() => { lifecycle.replaceContext(context('synthetic-doctor-c')); });
    expect(lifecycle.capture()).toBeNull();
    expect(newLease.signal.aborted).toBe(true); expect(revokeNew).toHaveBeenCalledOnce();
  });

  const malformed: Array<[string, () => unknown]> = [
    ['null', () => null], ['array', () => []], ['patient audience', () => ({ ...context(), audience: 'patient' })],
    ['name as owner', () => ({ name: 'Synthetic Doctor', role: 'doctor' })],
    ['extra role', () => ({ ...context(), role: 'doctor' })],
    ['extra URL', () => ({ ...context(), url: '/patient/synthetic-patient-a' })],
    ['missing exact assignment', () => { const value: Record<string, unknown> = context(); delete value.accessAssignmentId; return value; }],
    ['empty identity', () => ({ ...context(), userId: '' })],
    ['whitespace identity', () => ({ ...context(), userId: ' synthetic-doctor-a' })],
    ['control character', () => ({ ...context(), subject: 'synthetic\nsubject' })],
    ['isolated surrogate', () => ({ ...context(), issuer: '\ud800' })],
    ['oversized identity', () => ({ ...context(), issuer: 'x'.repeat(257) })],
    ['numeric generation', () => ({ ...context(), authorizationGeneration: 1 })],
    ['missing consent category', () => ({ ...context(), consentVersions: { care: 1 } })],
    ['extra consent category', () => ({ ...context(), consentVersions: { ...context().consentVersions, role: 'doctor' } })],
    ['zero consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: 0 } })],
    ['negative consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: -1 } })],
    ['fractional consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: 1.5 } })],
    ['NaN consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: NaN } })],
    ['unsafe consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: Number.MAX_SAFE_INTEGER + 1 } })],
    ['string consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: '1' } })],
    ['undefined consent version', () => ({ ...context(), consentVersions: { ...context().consentVersions, care: undefined } })],
    ['symbol extra field', () => ({ ...context(), [Symbol('unapproved')]: true })],
    ['inherited scope', () => Object.create(context())],
  ];

  it.each(malformed)('rejects %s and still retires the previously active context', (_label, makeInvalid) => {
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
    const oldLease = lifecycle.capture()!; const cleanup = action(); oldLease.registerCleanup(cleanup);
    expect(() => lifecycle.replaceContext(makeInvalid())).toThrow('Invalid local material context');
    expect(oldLease.signal.aborted).toBe(true); expect(cleanup).toHaveBeenCalledOnce();
    expect(oldLease.commit(action())).toBe(false); expect(lifecycle.capture()).toBeNull();
  });

  it('rejects accessors without invoking getter code or retaining their mutable source', () => {
    const lifecycle = createLocalMaterialLifecycle(); const getter = vi.fn(() => 'synthetic-doctor-b');
    const input = context(); Object.defineProperty(input, 'userId', { get: getter, enumerable: true });
    expect(() => lifecycle.replaceContext(input)).toThrow('Invalid local material context');
    expect(getter).not.toHaveBeenCalled(); expect(lifecycle.capture()).toBeNull();
  });

  describe.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'defensive reentrancy during %s structural validation', trap => {
      it.each(['capture', 'invalidate', 'replace'] as const)('keeps %s inside the pending transition fail-closed', operation => {
        const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(context());
        const oldLease = lifecycle.capture()!; const cleanup = action(); oldLease.registerCleanup(cleanup);
        let invoked = false;
        const observedCaptures: unknown[] = [];
        const interceptedErrors: string[] = [];
        const reenter = (method: typeof trap) => {
          if (method !== trap || invoked) return;
          invoked = true;
          observedCaptures.push(lifecycle.capture());
          if (operation === 'invalidate') lifecycle.invalidate();
          if (operation === 'replace') {
            // A trap can catch the nested error. It must still be impossible for
            // that nested context to remain current after the outer call fails.
            try { lifecycle.replaceContext(context('synthetic-doctor-c')); }
            catch (error) { interceptedErrors.push((error as Error).message); }
          }
          observedCaptures.push(lifecycle.capture());
        };
        const input = new Proxy(context('synthetic-doctor-b'), {
          getPrototypeOf(target) { reenter('getPrototypeOf'); return Reflect.getPrototypeOf(target); },
          ownKeys(target) { reenter('ownKeys'); return Reflect.ownKeys(target); },
          getOwnPropertyDescriptor(target, key) {
            reenter('getOwnPropertyDescriptor'); return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
        if (operation === 'capture') {
          lifecycle.replaceContext(input);
          expect(lifecycle.capture()!.context.userId).toBe('synthetic-doctor-b');
        } else {
          expect(() => lifecycle.replaceContext(input)).toThrow('replacement was invalidated');
          expect(lifecycle.capture()).toBeNull();
        }
        expect(invoked).toBe(true);
        expect(observedCaptures).toEqual([null, null]);
        expect(cleanup).toHaveBeenCalledOnce(); expect(oldLease.signal.aborted).toBe(true);
        if (operation === 'replace') expect(interceptedErrors).toHaveLength(1);
      });
    },
  );

  it('requires no storage/browser APIs and never treats a typed context as authenticated evidence', () => {
    const lifecycle = createLocalMaterialLifecycle();
    const supplied: LocalMaterialContext = context();
    lifecycle.replaceContext(supplied);
    expect(lifecycle.capture()!.context).toEqual(supplied);
    // The adapter, not this pure lifecycle, must establish provenance and authority.
    expect(lifecycle).not.toHaveProperty('authenticate');
    expect(lifecycle).not.toHaveProperty('readStorage');
  });
});
