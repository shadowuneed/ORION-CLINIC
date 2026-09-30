import { describe, expect, it, vi } from 'vitest';
import {
  isSameLocalMaterialDescriptor,
  snapshotLocalMaterialDescriptor,
  type LocalMaterialDescriptor,
} from './descriptor';

function descriptor() {
  return {
    schema: 'orion-local-material/v1' as const,
    owner: {
      audience: 'staff' as const,
      userId: 'synthetic-doctor-a', issuer: 'orion:synthetic-staff', subject: 'external-individual-a',
      organizationId: 'synthetic-org', facilityId: 'synthetic-facility', accessAssignmentId: 'synthetic-assignment-a',
      patientId: 'synthetic-patient-a', encounterId: 'synthetic-encounter-a',
    },
    localMaterialId: 'synthetic-material-a', recordingRunId: 'synthetic-run-a', revision: 1,
  } satisfies LocalMaterialDescriptor;
}

const ownerIdentifiers = [
  'userId', 'issuer', 'subject', 'organizationId', 'facilityId',
  'accessAssignmentId', 'patientId', 'encounterId',
] as const;
const topIdentifiers = ['localMaterialId', 'recordingRunId'] as const;
const topFields = ['schema', 'owner', ...topIdentifiers, 'revision'] as const;
const ownerFields = ['audience', ...ownerIdentifiers] as const;

function errorFor(value: unknown): Error {
  try { snapshotLocalMaterialDescriptor(value); }
  catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error as Error;
  }
  throw new Error('Malformed synthetic fixture unexpectedly accepted');
}

function rejected(value: unknown) {
  expect(() => snapshotLocalMaterialDescriptor(value)).toThrow(TypeError);
  expect(isSameLocalMaterialDescriptor(value, descriptor())).toBe(false);
  expect(isSameLocalMaterialDescriptor(descriptor(), value)).toBe(false);
  expect(isSameLocalMaterialDescriptor(value, value)).toBe(false);
}

describe('unmounted material descriptor: strict metadata, not authority or storage', () => {
  it('copies and deeply freezes the exact descriptor without mutating the caller input', () => {
    const input = descriptor();
    const result = snapshotLocalMaterialDescriptor(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.owner).not.toBe(input.owner);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.owner)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.owner)).toBe(false);
    input.owner.userId = 'synthetic-doctor-b';
    input.owner.subject = 'external-individual-b';
    input.localMaterialId = 'synthetic-material-b';
    input.recordingRunId = 'synthetic-run-b';
    input.revision = 100;
    expect(result).toEqual(descriptor());
    expect(Reflect.set(result, 'revision', 2)).toBe(false);
    expect(Reflect.set(result.owner, 'userId', 'synthetic-doctor-b')).toBe(false);
    expect(Reflect.deleteProperty(result.owner, 'subject')).toBe(false);
  });

  it('accepts exact plain and null-prototype objects independently at both levels', () => {
    const value = descriptor();
    for (const [topNull, ownerNull] of [[false, false], [true, false], [false, true], [true, true]]) {
      const owner = Object.assign(ownerNull ? Object.create(null) : {}, value.owner);
      const input = Object.assign(topNull ? Object.create(null) : {}, { ...value, owner });
      expect(snapshotLocalMaterialDescriptor(input)).toEqual(value);
      expect(isSameLocalMaterialDescriptor(input, value)).toBe(true);
    }
  });

  it('ignores field insertion order without normalizing identifier values', () => {
    const value = descriptor();
    const owner = Object.fromEntries(Object.entries(value.owner).reverse());
    const reordered = Object.fromEntries(Object.entries({ ...value, owner }).reverse());
    expect(isSameLocalMaterialDescriptor(value, reordered)).toBe(true);
    expect(snapshotLocalMaterialDescriptor(reordered)).toEqual(value);
    expect(isSameLocalMaterialDescriptor(value, { ...value, localMaterialId: value.localMaterialId.toUpperCase() })).toBe(false);
  });

  it('accepts bounded Unicode scalar identifiers, including a complete surrogate pair', () => {
    const value = descriptor();
    value.owner.subject = 'Қызметкер-Врач-😀';
    value.localMaterialId = '録音-материал-01';
    value.recordingRunId = 'a'.repeat(256);
    expect(snapshotLocalMaterialDescriptor(value)).toEqual(value);
    expect(isSameLocalMaterialDescriptor(value, value)).toBe(true);
  });

  it.each(ownerIdentifiers)('compares the exact owner.%s, not role, name or a partial scope', field => {
    const first = descriptor();
    const changed = descriptor();
    changed.owner[field] = `${changed.owner[field]}-other`;
    expect(isSameLocalMaterialDescriptor(first, changed)).toBe(false);
    expect(isSameLocalMaterialDescriptor(changed, first)).toBe(false);
    expect(isSameLocalMaterialDescriptor(first, descriptor())).toBe(true);
  });

  it.each(topIdentifiers)('distinguishes %s even under the same owner, encounter and revision', field => {
    const first = descriptor();
    const changed = { ...first, [field]: `${first[field]}-other` };
    expect(isSameLocalMaterialDescriptor(first, changed)).toBe(false);
    expect(isSameLocalMaterialDescriptor(changed, first)).toBe(false);
  });

  it('distinguishes revisions without pretending to perform a storage compare-and-swap', () => {
    const first = descriptor();
    const newer = { ...first, revision: 2 };
    expect(snapshotLocalMaterialDescriptor(newer).revision).toBe(2);
    expect(isSameLocalMaterialDescriptor(first, newer)).toBe(false);
    expect(first.revision).toBe(1);
    // Equality of identical metadata is not evidence that a write committed.
    expect(isSameLocalMaterialDescriptor(first, descriptor())).toBe(true);
  });

  it('does not infer one identifier from another or merge two staff with the same clinical scope', () => {
    const first = descriptor();
    const second = descriptor();
    second.owner.userId = 'synthetic-doctor-b';
    second.owner.subject = 'external-individual-b';
    expect(second.owner.encounterId).toBe(first.owner.encounterId);
    expect(second.localMaterialId).toBe(first.localMaterialId);
    expect(isSameLocalMaterialDescriptor(first, second)).toBe(false);
    const copied = snapshotLocalMaterialDescriptor(first);
    expect(copied.owner.userId).not.toBe(copied.owner.subject);
    expect(copied.localMaterialId).not.toBe(copied.owner.encounterId);
    expect(copied.recordingRunId).not.toBe(copied.localMaterialId);
  });

  it('compares cloned or frozen valid descriptors and still validates identical references', () => {
    const value = descriptor();
    const snapshot = snapshotLocalMaterialDescriptor(value);
    expect(isSameLocalMaterialDescriptor(snapshot, snapshot)).toBe(true);
    expect(isSameLocalMaterialDescriptor(snapshot, value)).toBe(true);
    const invalid = { ...value, revision: 0 };
    expect(isSameLocalMaterialDescriptor(invalid, invalid)).toBe(false);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['string', 'synthetic'], ['number', 1],
    ['boolean', true], ['bigint', BigInt(1)], ['symbol', Symbol('synthetic')],
    ['array', []], ['function', () => undefined], ['Date', new Date(0)], ['Map', new Map()],
  ])('rejects non-object/non-plain top-level input: %s', (_name, value) => rejected(value));

  it.each([
    ['null', null], ['undefined', undefined], ['array', []], ['string', 'staff'],
    ['Date', new Date(0)], ['Map', new Map()], ['function', () => undefined],
  ])('rejects a non-plain owner: %s', (_name, owner) => rejected({ ...descriptor(), owner }));

  it.each(topFields)('requires the own enumerable top-level field %s', field => {
    const input: Record<string, unknown> = { ...descriptor() };
    delete input[field];
    rejected(input);
  });

  it.each(ownerFields)('requires the own enumerable owner field %s', field => {
    const value = descriptor();
    const owner: Record<string, unknown> = { ...value.owner };
    delete owner[field];
    rejected({ ...value, owner });
  });

  it.each(['orion-local-material/v2', 'ORION-local-material/v1', '', undefined, 1])('rejects an unknown schema tag (%s)', schema => {
    rejected({ ...descriptor(), schema });
  });

  it.each(['patient', 'caregiver', 'service', 'doctor', undefined])('does not infer staff audience from %s', audience => {
    const value = descriptor();
    rejected({ ...value, owner: { ...value.owner, audience } });
  });

  it.each(ownerIdentifiers)('validates owner.%s without coercion', field => {
    const value = descriptor();
    rejected({ ...value, owner: { ...value.owner, [field]: 7 } });
    rejected({ ...value, owner: { ...value.owner, [field]: '' } });
    rejected({ ...value, owner: { ...value.owner, [field]: 'a'.repeat(257) } });
  });

  it.each(topIdentifiers)('validates %s without coercion', field => {
    rejected({ ...descriptor(), [field]: Object('synthetic-id') });
    rejected({ ...descriptor(), [field]: null });
    rejected({ ...descriptor(), [field]: 'a'.repeat(257) });
  });

  it.each([
    ['leading space', ' synthetic'], ['trailing space', 'synthetic '], ['leading NBSP', '\u00a0synthetic'],
    ['trailing BOM', 'synthetic\ufeff'], ['null', 'synthetic\u0000id'], ['tab', 'synthetic\tid'],
    ['newline', 'synthetic\nid'], ['DEL', 'synthetic\u007fid'], ['C1 start', 'synthetic\u0080id'],
    ['C1 end', 'synthetic\u009fid'], ['lone high surrogate', 'synthetic\ud800id'],
    ['lone low surrogate', 'synthetic\udfffid'], ['reversed surrogates', '\udfff\ud800'],
  ])('rejects malformed identifier scalars: %s', (_name, invalid) => {
    const value = descriptor();
    rejected({ ...value, localMaterialId: invalid });
    rejected({ ...value, owner: { ...value.owner, subject: invalid } });
  });

  it.each([
    ['zero', 0], ['negative zero', -0], ['negative', -1], ['fraction', 1.5], ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY], ['negative infinity', Number.NEGATIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['string', '1'], ['bigint', BigInt(1)],
    ['boxed number', Object(1)], ['undefined', undefined], ['null', null], ['boolean', true],
  ])('rejects invalid revision: %s', (_name, revision) => rejected({ ...descriptor(), revision }));

  it('accepts the positive safe-integer boundary without deriving a next revision', () => {
    const result = snapshotLocalMaterialDescriptor({ ...descriptor(), revision: Number.MAX_SAFE_INTEGER });
    expect(result.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(isSameLocalMaterialDescriptor(result, { ...descriptor(), revision: Number.MAX_SAFE_INTEGER })).toBe(true);
    expect(isSameLocalMaterialDescriptor(result, descriptor())).toBe(false);
  });

  it.each([
    'authorizationGeneration', 'consentVersions', 'role', 'displayName', 'email', 'sessionToken',
    'transcript', 'audio', 'ciphertext', 'key', 'encryptionKey', 'canRead', 'storageRevision',
  ])('rejects extra %s metadata instead of turning it into owner evidence or content', field => {
    const value = descriptor();
    rejected({ ...value, [field]: 'synthetic-extra' });
    rejected({ ...value, owner: { ...value.owner, [field]: 'synthetic-extra' } });
  });

  it('does not accept a legacy v1 history row as a staff-owned descriptor', () => {
    rejected({ version: 1, id: 'synthetic-encounter-a', clinicianName: 'Synthetic clinician', transcript: [], audio: null });
  });

  it.each(['top', 'owner'] as const)('rejects inherited/custom-prototype metadata at %s level', level => {
    const value = descriptor();
    const target = level === 'top' ? value : value.owner;
    const inherited = Object.create(target);
    rejected(level === 'top' ? inherited : { ...value, owner: inherited });
    Object.setPrototypeOf(target, { syntheticInheritedExtra: true });
    rejected(value);
  });

  it.each(['top', 'owner'] as const)('rejects accessors without invoking their getter at %s level', level => {
    const value = descriptor();
    const getter = vi.fn(() => { throw new Error('Synthetic getter should never execute'); });
    Object.defineProperty(level === 'top' ? value : value.owner, level === 'top' ? 'localMaterialId' : 'userId', {
      enumerable: true, configurable: true, get: getter,
    });
    rejected(value);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['top', 'owner'] as const)('rejects hidden required fields and hidden extras at %s level', level => {
    const hiddenRequired = descriptor();
    Object.defineProperty(level === 'top' ? hiddenRequired : hiddenRequired.owner,
      level === 'top' ? 'recordingRunId' : 'subject', { enumerable: false });
    rejected(hiddenRequired);
    const hiddenExtra = descriptor();
    Object.defineProperty(level === 'top' ? hiddenExtra : hiddenExtra.owner, 'syntheticHiddenExtra', { value: true, enumerable: false });
    rejected(hiddenExtra);
  });

  it.each(['top', 'owner'] as const)('rejects enumerable and hidden symbol fields at %s level', level => {
    for (const enumerable of [false, true]) {
      const value = descriptor();
      Object.defineProperty(level === 'top' ? value : value.owner, Symbol('synthetic'), { value: true, enumerable });
      rejected(value);
    }
  });

  it('uses one generic TypeError without leaking malformed descriptor values', () => {
    const generic = errorFor(null).message;
    const syntheticMarker = 'synthetic-private-value-should-not-appear';
    for (const invalid of [
      { ...descriptor(), schema: syntheticMarker },
      { ...descriptor(), localMaterialId: `${syntheticMarker}\u0000` },
      { ...descriptor(), owner: { ...descriptor().owner, userId: `${syntheticMarker} ` } },
    ]) {
      const error = errorFor(invalid);
      expect(error.message).toBe(generic);
      expect(error.message).not.toContain(syntheticMarker);
    }
  });

  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)('contains a throwing %s Proxy trap without leaking the trap error', trap => {
    const generic = errorFor(null).message;
    const throwTrap = () => { throw new Error('synthetic-private-proxy-error'); };
    for (const level of ['top', 'owner']) {
      const value = descriptor();
      const proxied = new Proxy(level === 'top' ? value : value.owner, { [trap]: throwTrap });
      const input = level === 'top' ? proxied : { ...value, owner: proxied };
      expect(errorFor(input).message).toBe(generic);
      expect(() => isSameLocalMaterialDescriptor(input, value)).not.toThrow();
      expect(isSameLocalMaterialDescriptor(input, value)).toBe(false);
      expect(isSameLocalMaterialDescriptor(value, input)).toBe(false);
    }
  });

  it('contains a revoked Proxy as invalid input', () => {
    const revocable = Proxy.revocable(descriptor(), {});
    revocable.revoke();
    expect(errorFor(revocable.proxy).message).toBe(errorFor(null).message);
    expect(isSameLocalMaterialDescriptor(revocable.proxy, revocable.proxy)).toBe(false);
  });
});
