import { describe, expect, it, vi } from 'vitest';
import { createLocalMaterialTargetLifecycle, type LocalMaterialTargetLease } from './target-lifecycle';

function context() {
  return {
    audience: 'staff' as const, userId: 'synthetic-doctor-a', issuer: 'orion:test', subject: 'subject-a',
    organizationId: 'org-a', facilityId: 'facility-a', accessAssignmentId: 'assignment-a',
    patientId: 'synthetic-patient-a', encounterId: 'synthetic-encounter-a', authorizationGeneration: 'generation-a',
    consentVersions: { care: 1, transcriptStorage: 2, audioRetention: 3, transientAudioProcessing: 4, externalAiProcessing: null as number | null },
  };
}

function descriptor() {
  const ctx = context();
  const owner = {
    audience: ctx.audience, userId: ctx.userId, issuer: ctx.issuer, subject: ctx.subject,
    organizationId: ctx.organizationId, facilityId: ctx.facilityId, accessAssignmentId: ctx.accessAssignmentId,
    patientId: ctx.patientId, encounterId: ctx.encounterId,
  };
  return { schema: 'orion-local-material/v1' as const, owner, localMaterialId: 'material-a', recordingRunId: 'run-a', revision: 1 };
}

const action = () => vi.fn<() => undefined>();
function bound() {
  const lifecycle = createLocalMaterialTargetLifecycle();
  lifecycle.replaceTarget(context(), descriptor());
  return lifecycle;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('unmounted material/run/revision publication fence, not storage or authorization', () => {
  it('starts unbound and exposes immutable methods', () => {
    const lifecycle = createLocalMaterialTargetLifecycle();
    expect(Object.isFrozen(lifecycle)).toBe(true);
    expect(lifecycle.capture()).toBeNull();
    lifecycle.invalidate(); lifecycle.invalidate();
    expect(lifecycle.capture()).toBeNull();
  });

  it('copies both inputs, keeping operation authority separate from immutable ownership', () => {
    const lifecycle = createLocalMaterialTargetLifecycle();
    const input = descriptor(); const currentContext = context();
    lifecycle.replaceTarget(currentContext, input);
    const lease = lifecycle.capture()!;
    input.owner.userId = 'another-user'; input.localMaterialId = 'another-material'; input.revision = 99;
    currentContext.authorizationGeneration = 'another-generation'; currentContext.consentVersions.care = 99;
    expect(lease.descriptor).toEqual(descriptor());
    expect(lease.context).toEqual(context());
    expect(lease.descriptor.owner).not.toBe(input.owner);
    expect(lease.context.consentVersions).not.toBe(currentContext.consentVersions);
    for (const value of [lease, lease.context, lease.context.consentVersions, lease.descriptor, lease.descriptor.owner]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Reflect.set(lease.descriptor, 'revision', 2)).toBe(false);
    expect(Reflect.set(lease.descriptor.owner, 'userId', 'another-user')).toBe(false);
    expect(lease.descriptor.owner).not.toHaveProperty('authorizationGeneration');
    expect(lease.descriptor.owner).not.toHaveProperty('consentVersions');
  });

  for (const field of ['userId', 'issuer', 'subject', 'organizationId', 'facilityId', 'accessAssignmentId', 'patientId', 'encounterId'] as const) {
    it(`rejects mismatched owner ${field} and retires existing operations/resources`, () => {
      const lifecycle = bound(); const previous = lifecycle.capture()!;
      const cleanup = action(); previous.registerCleanup(cleanup);
      const wrong = descriptor(); wrong.owner[field] = 'different';
      expect(() => lifecycle.replaceTarget(context(), wrong)).toThrow('Invalid or invalidated local material target');
      expect(previous.signal.aborted).toBe(true);
      expect(previous.commit(action())).toBe(false);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(lifecycle.capture()).toBeNull();
    });
  }

  for (const malformed of ['context', 'descriptor', 'audience'] as const) {
    it(`fails closed on malformed ${malformed}`, () => {
      const lifecycle = bound(); const previous = lifecycle.capture()!;
      const invalidContext = malformed === 'context' ? { ...context(), extra: true } : context();
      const invalidTarget = malformed === 'descriptor' ? { ...descriptor(), revision: 0 }
        : malformed === 'audience' ? { ...descriptor(), owner: { ...descriptor().owner, audience: 'patient' } } : descriptor();
      expect(() => lifecycle.replaceTarget(invalidContext, invalidTarget)).toThrow();
      expect(previous.isCurrent()).toBe(false);
      expect(lifecycle.capture()).toBeNull();
    });
  }

  const replacements = {
    material(lifecycle: ReturnType<typeof bound>) { lifecycle.replaceTarget(context(), { ...descriptor(), localMaterialId: 'material-b' }); },
    run(lifecycle: ReturnType<typeof bound>) { lifecycle.replaceTarget(context(), { ...descriptor(), recordingRunId: 'run-b' }); },
    revision(lifecycle: ReturnType<typeof bound>) { lifecycle.replaceTarget(context(), { ...descriptor(), revision: 2 }); },
    authority(lifecycle: ReturnType<typeof bound>) { lifecycle.replaceTarget({ ...context(), authorizationGeneration: 'generation-b' }, descriptor()); },
    consent(lifecycle: ReturnType<typeof bound>) {
      lifecycle.replaceTarget({ ...context(), consentVersions: { ...context().consentVersions, audioRetention: 4 } }, descriptor());
    },
    equal(lifecycle: ReturnType<typeof bound>) { lifecycle.replaceTarget(context(), descriptor()); },
    invalidate(lifecycle: ReturnType<typeof bound>) { lifecycle.invalidate(); },
  };

  for (const [name, replace] of Object.entries(replacements)) {
    it(`${name} replacement retires old lease and cannot revive it after A -> B -> A`, () => {
      const lifecycle = bound(); const previous = lifecycle.capture()!;
      const cleanup = action(); previous.registerCleanup(cleanup);
      replace(lifecycle);
      expect(previous.signal.aborted).toBe(true);
      expect(cleanup).toHaveBeenCalledOnce();
      lifecycle.replaceTarget(context(), descriptor());
      expect(previous.descriptor).toEqual(lifecycle.capture()!.descriptor);
      expect(previous.isCurrent()).toBe(false);
      expect(previous.commit(action())).toBe(false);
      expect(lifecycle.capture()!.isCurrent()).toBe(true);
    });

    for (const outcome of ['resolve', 'reject'] as const) {
      it(`fences late ${outcome}/finally after ${name} for recorder, autosave, rename or export adapters`, async () => {
        const lifecycle = bound(); const lease = lifecycle.capture()!;
        const work = deferred<string>();
        const success = action(); const error = action(); const final = action();
        const pending = work.promise.then(() => lease.commit(success), () => lease.commit(error))
          .finally(() => { lease.commit(final); lease.finish(); });
        replace(lifecycle);
        lifecycle.replaceTarget(context(), { ...descriptor(), localMaterialId: 'material-current', recordingRunId: 'run-current' });
        if (outcome === 'resolve') work.resolve('synthetic result');
        else work.reject(new Error('synthetic operation failure'));
        await pending;
        expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(final).not.toHaveBeenCalled();
        expect(lease.descriptor.localMaterialId).toBe('material-a');
        expect(lifecycle.capture()!.descriptor.localMaterialId).toBe('material-current');
      });
    }
  }

  it('does not interpret absent consent pins as a grant or enforce action policy itself', () => {
    const lifecycle = createLocalMaterialTargetLifecycle();
    lifecycle.replaceTarget({ ...context(), consentVersions: {
      care: null, transcriptStorage: null, audioRetention: null, transientAudioProcessing: null, externalAiProcessing: null,
    } }, descriptor());
    expect(lifecycle.capture()!.isCurrent()).toBe(true); // A publication pin, not clinical permission.
  });

  it('commits only once, closes before reentrant callback, preserves cleanup until release', () => {
    const lifecycle = bound(); const lease = lifecycle.capture()!;
    const cleanup = action(); const release = lease.registerCleanup(cleanup); const replay = action();
    expect(lease.commit(() => { expect(lease.commit(replay)).toBe(false); })).toBe(true);
    expect(replay).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
    release(); release(); lifecycle.invalidate();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('cannot roll back a throwing publication but closes before it and keeps sibling independent', () => {
    const lifecycle = bound(); const lease = lifecycle.capture()!; const sibling = lifecycle.capture()!;
    expect(() => lease.commit(() => { throw new Error('synthetic publication'); })).toThrow('synthetic publication');
    expect(lease.commit(action())).toBe(false); lease.finish();
    expect(sibling.isCurrent()).toBe(true);
    expect(sibling.commit(action())).toBe(true);
  });

  it('finishes an unused operation without revoking a sibling or an already published resource', () => {
    const lifecycle = bound(); const first = lifecycle.capture()!; const second = lifecycle.capture()!;
    const cleanup = action(); first.registerCleanup(cleanup); first.finish(); first.finish();
    expect(first.commit(action())).toBe(false); expect(second.isCurrent()).toBe(true);
    expect(cleanup).not.toHaveBeenCalled(); lifecycle.invalidate(); expect(cleanup).toHaveBeenCalledOnce();
  });

  it('a late resource belongs to the stale lease only and cannot revoke a current resource', () => {
    const lifecycle = bound(); const oldLease = lifecycle.capture()!;
    lifecycle.replaceTarget(context(), { ...descriptor(), recordingRunId: 'run-b' });
    const currentLease = lifecycle.capture()!;
    const oldUrl = action(); const currentUrl = action(); currentLease.registerCleanup(currentUrl);
    const release = oldLease.registerCleanup(oldUrl);
    expect(oldUrl).toHaveBeenCalledOnce(); expect(currentUrl).not.toHaveBeenCalled();
    release(); release(); expect(currentLease.isCurrent()).toBe(true);
    lifecycle.invalidate(); expect(currentUrl).toHaveBeenCalledOnce();
  });

  for (const source of ['context', 'descriptor', 'owner'] as const) {
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const) {
      for (const effect of ['capture', 'invalidate', 'replace'] as const) {
        it(`guards ${source}.${trap} reentrant ${effect} throughout validation`, () => {
          const lifecycle = bound(); const previous = lifecycle.capture()!;
          let called = false;
          function reenter() {
            if (called) return; called = true;
            expect(lifecycle.capture()).toBeNull();
            if (effect === 'invalidate') lifecycle.invalidate();
            if (effect === 'replace') expect(() => lifecycle.replaceTarget(context(), descriptor())).toThrow();
          }
          const proxy = <T extends object>(value: T) => new Proxy(value, {
            getPrototypeOf(target) { if (trap === 'getPrototypeOf') reenter(); return Reflect.getPrototypeOf(target); },
            ownKeys(target) { if (trap === 'ownKeys') reenter(); return Reflect.ownKeys(target); },
            getOwnPropertyDescriptor(target, key) {
              if (trap === 'getOwnPropertyDescriptor') reenter(); return Reflect.getOwnPropertyDescriptor(target, key);
            },
          });
          const inputContext = source === 'context' ? proxy(context()) : context();
          const inputDescriptor = source === 'descriptor' ? proxy(descriptor())
            : source === 'owner' ? { ...descriptor(), owner: proxy(descriptor().owner) } : descriptor();
          if (effect === 'capture') {
            lifecycle.replaceTarget(inputContext, inputDescriptor);
            expect(lifecycle.capture()!.isCurrent()).toBe(true);
          } else {
            expect(() => lifecycle.replaceTarget(inputContext, inputDescriptor)).toThrow();
            expect(lifecycle.capture()).toBeNull();
          }
          expect(called).toBe(true); expect(previous.isCurrent()).toBe(false);
        });
      }
    }
  }

  for (const location of ['abort', 'cleanup'] as const) {
    for (const effect of ['capture', 'invalidate', 'replace'] as const) {
      it(`guards ${effect} during ${location} triggered by replacement`, () => {
        const lifecycle = bound(); const previous = lifecycle.capture()!;
        let calls = 0;
        const callback = (): undefined => {
          calls += 1; expect(lifecycle.capture()).toBeNull();
          if (effect === 'invalidate') lifecycle.invalidate();
          if (effect === 'replace') expect(() => lifecycle.replaceTarget(context(), descriptor())).toThrow();
        };
        if (location === 'abort') previous.signal.addEventListener('abort', callback);
        else previous.registerCleanup(callback);
        const replace = () => lifecycle.replaceTarget(context(), { ...descriptor(), recordingRunId: 'run-b' });
        if (effect === 'capture') { replace(); expect(lifecycle.capture()!.isCurrent()).toBe(true); }
        else { expect(replace).toThrow(); expect(lifecycle.capture()).toBeNull(); }
        expect(calls).toBe(1); expect(previous.isCurrent()).toBe(false);
      });
    }
  }

  for (const source of ['context', 'consents', 'descriptor', 'owner'] as const) {
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const) {
      it(`sanitizes a throwing ${source}.${trap} without retaining a target`, () => {
        const lifecycle = bound(); const previous = lifecycle.capture()!;
        const cleanup = action(); previous.registerCleanup(cleanup);
        const proxy = <T extends object>(value: T) => new Proxy(value, {
          [trap]() { throw new Error('synthetic private context marker'); },
        });
        const inputContext = source === 'context' ? proxy(context())
          : source === 'consents' ? { ...context(), consentVersions: proxy(context().consentVersions) } : context();
        const inputDescriptor = source === 'descriptor' ? proxy(descriptor())
          : source === 'owner' ? { ...descriptor(), owner: proxy(descriptor().owner) } : descriptor();
        expect(() => lifecycle.replaceTarget(inputContext, inputDescriptor)).toThrow(new TypeError('Invalid or invalidated local material target'));
        expect(lifecycle.capture()).toBeNull(); expect(previous.isCurrent()).toBe(false);
        expect(cleanup).toHaveBeenCalledOnce();
      });
    }
  }

  for (const releaseMode of ['manual', 'stale-registration'] as const) {
    it(`does not let ${releaseMode} cleanup install another target or skip sibling cleanup`, () => {
      const lifecycle = bound(); const first = lifecycle.capture()!;
      if (releaseMode === 'stale-registration') lifecycle.replaceTarget(context(), { ...descriptor(), recordingRunId: 'run-b' });
      const sibling = lifecycle.capture()!; const siblingCleanup = action(); sibling.registerCleanup(siblingCleanup);
      let captures = 0;
      const release = first.registerCleanup(() => {
        captures += 1; expect(lifecycle.capture()).toBeNull();
        expect(() => lifecycle.replaceTarget(context(), { ...descriptor(), recordingRunId: 'nested' })).toThrow();
        throw new Error('synthetic cleanup failure');
      });
      release(); release();
      expect(captures).toBe(1); expect(siblingCleanup).toHaveBeenCalledOnce();
      expect(lifecycle.capture()).toBeNull(); expect(sibling.isCurrent()).toBe(false);
    });
  }

  it('does not create storage, run IDs or a new revision when capturing or publishing', () => {
    const lifecycle = bound(); const lease = lifecycle.capture()!;
    expect(lease.commit(action())).toBe(true);
    const nextOperation = lifecycle.capture()!;
    expect(nextOperation.descriptor).toEqual(descriptor());
    expect(nextOperation.descriptor.revision).toBe(1);
  });
});

// Compile-time contract only; never invoke side effects from this type check.
function synchronousCallbacksOnly(lease: LocalMaterialTargetLease) {
  // @ts-expect-error A Promise-returning publisher is not a fenced synchronous commit.
  lease.commit(async () => {});
  // @ts-expect-error Cleanup may not schedule asynchronous resource release.
  lease.registerCleanup(async () => {});
}
void synchronousCallbacksOnly;
