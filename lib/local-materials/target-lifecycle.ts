import { snapshotLocalMaterialDescriptor, type LocalMaterialDescriptor } from './descriptor';
import { createLocalMaterialLifecycle, type LocalMaterialLease } from './lifecycle';

/** Capture BEFORE starting asynchronous work; never re-read a mutable UI target. */
export type LocalMaterialTargetLease = LocalMaterialLease & Readonly<{
  descriptor: LocalMaterialDescriptor;
}>;

export type LocalMaterialTargetLifecycle = Readonly<{
  /** Every call retires outstanding work, including equal or malformed targets. */
  replaceTarget(trustedContext: unknown, descriptor: unknown): void;
  invalidate(): void;
  capture(): LocalMaterialTargetLease | null;
}>;

const ownerFields = [
  'audience', 'userId', 'issuer', 'subject', 'organizationId', 'facilityId',
  'accessAssignmentId', 'patientId', 'encounterId',
] as const;

/**
 * Unmounted, single-instance publication fence. Composes authority/consent pins
 * with exact material/run/revision, without putting changing authority in owner.
 * It does not authenticate metadata, decide consent, persist/encrypt/delete bytes,
 * arbitrate concurrent writers, discover revocation or coordinate other tabs.
 *
 * Adapter obligations: trusted current server context + action authorization,
 * invalidate on every observed target/authority change, storage CAS separately.
 * A late Blob, export, error or finally callback uses its ORIGINAL lease only.
 * commit is one-shot synchronous publication, never an async storage transaction.
 */
export function createLocalMaterialTargetLifecycle(): LocalMaterialTargetLifecycle {
  const lifecycle = createLocalMaterialLifecycle();
  let current: LocalMaterialDescriptor | null = null;
  let token = Symbol('unbound-target');
  let transitionDepth = 0;

  function retire() {
    const replacementToken = Symbol('local-material-target');
    token = replacementToken;
    current = null;
    lifecycle.invalidate();
    return replacementToken;
  }

  function invalidate() {
    transitionDepth += 1;
    try { retire(); }
    finally { transitionDepth -= 1; }
  }

  function replaceTarget(trustedContext: unknown, input: unknown) {
    if (transitionDepth > 0) {
      invalidate();
      throw new Error('Local material target replacement is unavailable during transition');
    }
    transitionDepth += 1;
    try {
      const replacementToken = retire();
      const descriptor = snapshotLocalMaterialDescriptor(input);
      if (token !== replacementToken) throw new Error('Local material target replacement was invalidated');
      lifecycle.replaceContext(trustedContext);
      if (token !== replacementToken) throw new Error('Local material target replacement was invalidated');
      const validationLease = lifecycle.capture();
      if (!validationLease) throw new Error('Local material target context is unavailable');
      validationLease.finish();
      if (ownerFields.some(name => descriptor.owner[name] !== validationLease.context[name])) {
        throw new TypeError('Local material target owner does not match context');
      }
      current = descriptor;
    } catch {
      // A malformed replacement never leaves the previous target usable.
      retire();
      // Validation may encounter throwing Proxy traps in either input. Never
      // forward their arbitrary message/identity contents to a UI or log.
      throw new TypeError('Invalid or invalidated local material target');
    } finally {
      transitionDepth -= 1;
    }
  }

  function capture(): LocalMaterialTargetLease | null {
    if (!current || transitionDepth > 0) return null;
    const descriptor = current;
    const capturedToken = token;
    const lease = lifecycle.capture();
    if (!lease) return null;
    const isCurrent = () => transitionDepth === 0 && current === descriptor &&
      capturedToken === token && lease.isCurrent();
    return Object.freeze({
      context: lease.context,
      descriptor,
      signal: lease.signal,
      isCurrent,
      commit(publish: () => undefined) {
        if (!isCurrent()) return false;
        return lease.commit(publish);
      },
      registerCleanup: lease.registerCleanup,
      finish: lease.finish,
    });
  }

  return Object.freeze({ replaceTarget, invalidate, capture });
}
