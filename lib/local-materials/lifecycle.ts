/**
 * Unmounted, process-local publication fence for staff-owned local materials.
 * The caller must first resolve current staff identity, exact assignment/scope,
 * consent decisions and these version pins through the trusted server boundary.
 * This module does NOT authenticate cookies/signatures, grant access, evaluate
 * consent, or turn names, roles, route parameters or URLs into ownership.
 *
 * There is no storage, encryption, cross-tab signalling, patient/mobile identity,
 * IndexedDB transaction or automatic deletion/reassignment of legacy materials.
 * An adapter must invalidate on every observed loss/change of authority; this
 * fence cannot discover a server revocation or erase bytes already published.
 * The context does not yet pin a localMaterialId/recordingRunId. A future adapter
 * must capture the exact record/run and invalidate when that run changes; an
 * encounter-level lease alone cannot authorize publishing into another recording.
 */
export type LocalMaterialConsentVersions = Readonly<{
  care: number | null;
  transcriptStorage: number | null;
  audioRetention: number | null;
  transientAudioProcessing: number | null;
  externalAiProcessing: number | null;
}>;

export type LocalMaterialContext = Readonly<{
  audience: 'staff';
  userId: string;
  issuer: string;
  subject: string;
  organizationId: string;
  facilityId: string;
  accessAssignmentId: string;
  patientId: string;
  encounterId: string;
  /** Opaque authoritative generation, not a locally invented permission or role. */
  authorizationGeneration: string;
  /** Version pins only; null or a version does not assert consent is granted. */
  consentVersions: LocalMaterialConsentVersions;
}>;

/** Synchronous only. Do not schedule a later publication/cleanup from a callback. */
type SynchronousAction = () => undefined;

export type LocalMaterialLease = Readonly<{
  context: LocalMaterialContext;
  signal: AbortSignal;
  isCurrent(): boolean;
  /**
   * One-shot synchronous publication. Capture the lease BEFORE starting/awaiting
   * work, then call commit after it settles. A stale callback is never invoked.
   * Async callbacks are not supported. Arbitrary callback side effects cannot be
   * rolled back; this is not an atomic storage or authorization transaction.
   */
  commit(publish: SynchronousAction): boolean;
  /**
   * Register an already-created resource's synchronous cleanup (e.g. revoke URL)
   * BEFORE commit. Returns an idempotent release function. A stale registration
   * cleans up immediately and cannot attach itself to a new owner's generation.
   * Registered resources survive successful commit/finish until release/invalidate.
   * A callback must revoke its captured resource, not mutate a shared UI pointer.
   */
  registerCleanup(cleanup: SynchronousAction): () => void;
  /** Close an unsuccessful/unused operation; published-resource cleanup is separate. */
  finish(): void;
}>;

export type LocalMaterialLifecycle = Readonly<{
  /** Always retires the previous generation, even for equal or malformed input. */
  replaceContext(trustedContext: unknown): void;
  /** Detach first, then abort outstanding operations and release registered resources. */
  invalidate(): void;
  /** Returns null while unbound or while abort/cleanup callbacks are being drained. */
  capture(): LocalMaterialLease | null;
}>;

const identityFields = [
  'userId', 'issuer', 'subject', 'organizationId', 'facilityId',
  'accessAssignmentId', 'patientId', 'encounterId', 'authorizationGeneration',
] as const;
const consentFields = [
  'care', 'transcriptStorage', 'audioRetention', 'transientAudioProcessing', 'externalAiProcessing',
] as const;

function invalidContext(): never {
  // Do not put identities or clinical scope into thrown errors/logs.
  throw new TypeError('Invalid local material context');
}

function ownDataFields(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidContext();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidContext();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    return invalidContext();
  }
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // Reject inherited fields, accessors and hidden properties; never invoke getters.
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return invalidContext();
    copy[key] = descriptor.value;
  }
  return copy;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) || Array.from(value).some(char => {
      const point = char.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    })) return invalidContext();
  return value;
}

function snapshotContext(input: unknown): LocalMaterialContext {
  const fields = ownDataFields(input, ['audience', ...identityFields, 'consentVersions']);
  if (fields.audience !== 'staff') return invalidContext();
  const consentInput = ownDataFields(fields.consentVersions, consentFields);
  const consentCopy = {} as Record<(typeof consentFields)[number], number | null>;
  for (const name of consentFields) {
    const value = consentInput[name];
    if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) return invalidContext();
    consentCopy[name] = value;
  }
  const identities = {} as Record<(typeof identityFields)[number], string>;
  for (const name of identityFields) identities[name] = identifier(fields[name]);
  return Object.freeze({ audience: 'staff', ...identities, consentVersions: Object.freeze(consentCopy) });
}

type Operation = { controller: AbortController; closed: boolean };
type Generation = {
  token: symbol;
  context: LocalMaterialContext;
  operations: Set<Operation>;
  cleanups: Set<() => void>;
};

export function createLocalMaterialLifecycle(): LocalMaterialLifecycle {
  let current: Generation | null = null;
  let token = Symbol('unbound');
  let transitionDepth = 0;

  function retire() {
    const retired = current;
    const replacementToken = Symbol('local-material-generation');
    token = replacementToken;
    current = null;
    if (!retired) return replacementToken;
    const operations = [...retired.operations];
    const cleanups = [...retired.cleanups];
    retired.operations.clear();
    retired.cleanups.clear();
    // Reentrant code sees no current owner. Nested invalidation changes token and
    // cancels an outer replacement; no late cleanup may install another owner.
    transitionDepth += 1;
    try {
      for (const operation of operations) {
        operation.closed = true;
        operation.controller.abort();
      }
      for (const cleanup of cleanups) cleanup();
    } finally {
      transitionDepth -= 1;
    }
    return replacementToken;
  }

  function replaceContext(trustedContext: unknown) {
    if (transitionDepth > 0) {
      retire();
      throw new Error('Local material replacement is unavailable during cleanup');
    }
    // Structural validation can encounter a Proxy trap even though ordinary
    // accessor properties are rejected. Guard the entire transition, not just
    // retirement: reentrant validation cannot expose/install a nested owner.
    transitionDepth += 1;
    try {
      const replacementToken = retire();
      const context = snapshotContext(trustedContext);
      if (token !== replacementToken) throw new Error('Local material replacement was invalidated');
      current = { token: replacementToken, context, operations: new Set(), cleanups: new Set() };
    } finally {
      transitionDepth -= 1;
    }
  }

  function capture(): LocalMaterialLease | null {
    const generation = current;
    if (!generation || transitionDepth > 0) return null;
    const operation: Operation = { controller: new AbortController(), closed: false };
    generation.operations.add(operation);
    const isCurrent = () => !operation.closed && !operation.controller.signal.aborted &&
      transitionDepth === 0 && current === generation && token === generation.token;
    const finish = () => {
      operation.closed = true;
      generation.operations.delete(operation);
    };
    return Object.freeze({
      context: generation.context,
      signal: operation.controller.signal,
      isCurrent,
      commit(publish: SynchronousAction) {
        if (!isCurrent()) return false;
        if (typeof publish !== 'function') throw new TypeError('Invalid local material publication');
        // Close before invoking caller code: throwing/reentrant callbacks cannot
        // publish this lease twice. Do not pretend later async effects are fenced.
        finish();
        publish();
        return true;
      },
      registerCleanup(cleanup: SynchronousAction) {
        if (typeof cleanup !== 'function') throw new TypeError('Invalid local material cleanup');
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          generation.cleanups.delete(release);
          transitionDepth += 1;
          try { cleanup(); }
          catch { /* Best effort: one failed revocation must not prevent other cleanups. */ }
          finally { transitionDepth -= 1; }
        };
        if (isCurrent()) generation.cleanups.add(release);
        else release();
        return release;
      },
      finish,
    });
  }

  return Object.freeze({ replaceContext, invalidate() { retire(); }, capture });
}
