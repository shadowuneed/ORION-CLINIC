import { describe, expect, it, vi } from 'vitest';
import { serializeLocalMaterialBinding } from './envelope-binding';

function descriptor() {
  return {
    schema: 'orion-local-material/v1' as const,
    owner: {
      audience: 'staff' as const,
      userId: 'synthetic-user', issuer: 'orion:synthetic', subject: 'synthetic-external-subject',
      organizationId: 'synthetic-org', facilityId: 'synthetic-facility', accessAssignmentId: 'synthetic-assignment',
      patientId: 'synthetic-patient', encounterId: 'synthetic-encounter',
    },
    localMaterialId: 'synthetic-material', recordingRunId: 'synthetic-run', revision: 7,
  };
}
function binding(payloadKind: 'audio' | 'transcript' = 'audio') {
  return { descriptor: descriptor(), payloadKind };
}

// Published synthetic vector. Scope IDs are deliberately visible: the result is
// NOT anonymous/public metadata, ciphertext, a MAC, an authorization or a key.
const expectedAudio = '["ORION:LOCAL-MATERIAL:BINDING",1,"audio","orion-local-material/v1","staff","synthetic-user","orion:synthetic","synthetic-external-subject","synthetic-org","synthetic-facility","synthetic-assignment","synthetic-patient","synthetic-encounter","synthetic-material","synthetic-run",7]';
const genericError = 'Invalid local material binding';
const ownerIdentifiers = [
  'userId', 'issuer', 'subject', 'organizationId', 'facilityId',
  'accessAssignmentId', 'patientId', 'encounterId',
] as const;

function rejected(input: unknown) {
  try { serializeLocalMaterialBinding(input); }
  catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(genericError);
    return;
  }
  throw new Error('Malformed synthetic binding unexpectedly accepted');
}

describe('canonical local material binding string, no encryption, storage or authority', () => {
  it('matches the exact published audio vector and the fixed field order', () => {
    const serialized = serializeLocalMaterialBinding(binding());
    expect(serialized).toBe(expectedAudio);
    expect(typeof serialized).toBe('string');
    expect(JSON.parse(serialized)).toEqual([
      'ORION:LOCAL-MATERIAL:BINDING', 1, 'audio', 'orion-local-material/v1', 'staff',
      'synthetic-user', 'orion:synthetic', 'synthetic-external-subject', 'synthetic-org',
      'synthetic-facility', 'synthetic-assignment', 'synthetic-patient', 'synthetic-encounter',
      'synthetic-material', 'synthetic-run', 7,
    ]);
  });

  it('changes only the designated payload-kind position for the transcript vector', () => {
    const audio: unknown[] = JSON.parse(serializeLocalMaterialBinding(binding()));
    const transcript: unknown[] = JSON.parse(serializeLocalMaterialBinding(binding('transcript')));
    expect(transcript[2]).toBe('transcript');
    expect(transcript).not.toEqual(audio);
    transcript[2] = 'audio';
    expect(transcript).toEqual(audio);
  });

  it('is independent of input insertion order at every object level', () => {
    const value = descriptor();
    const owner = Object.fromEntries(Object.entries(value.owner).reverse());
    const reorderedDescriptor = Object.fromEntries(Object.entries({ ...value, owner }).reverse());
    const reordered = { payloadKind: 'audio', descriptor: reorderedDescriptor };
    expect(serializeLocalMaterialBinding(reordered)).toBe(expectedAudio);
  });

  it('accepts exact null-prototype wrappers, descriptors and owners', () => {
    const value = descriptor();
    for (const level of ['wrapper', 'descriptor', 'owner', 'all']) {
      const owner = Object.assign(level === 'owner' || level === 'all' ? Object.create(null) : {}, value.owner);
      const snapshot = Object.assign(level === 'descriptor' || level === 'all' ? Object.create(null) : {}, { ...value, owner });
      const input = Object.assign(level === 'wrapper' || level === 'all' ? Object.create(null) : {}, { descriptor: snapshot, payloadKind: 'audio' });
      expect(serializeLocalMaterialBinding(input)).toBe(expectedAudio);
    }
  });

  it('returns a detached primitive string without freezing or mutating caller-owned objects', () => {
    const input = binding();
    const initial = serializeLocalMaterialBinding(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.descriptor)).toBe(false);
    expect(Object.isFrozen(input.descriptor.owner)).toBe(false);
    input.descriptor.owner.subject = 'synthetic-new-subject';
    input.descriptor.localMaterialId = 'synthetic-new-material';
    input.descriptor.revision += 1;
    input.payloadKind = 'transcript';
    expect(initial).toBe(expectedAudio);
    expect(serializeLocalMaterialBinding(input)).not.toBe(initial);
    expect(serializeLocalMaterialBinding(binding())).toBe(initial);
  });

  it('also accepts frozen caller input without changing it', () => {
    const value = descriptor();
    Object.freeze(value.owner); Object.freeze(value);
    const input = Object.freeze({ descriptor: value, payloadKind: 'audio' });
    expect(serializeLocalMaterialBinding(input)).toBe(expectedAudio);
    expect(value.revision).toBe(7);
  });

  it.each(ownerIdentifiers)('binds exact owner.%s independently', field => {
    const input = binding();
    input.descriptor.owner[field] += '-other';
    expect(serializeLocalMaterialBinding(input)).not.toBe(expectedAudio);
  });

  it.each(['localMaterialId', 'recordingRunId'] as const)('binds exact %s within the same owner and encounter', field => {
    const input = binding();
    input.descriptor[field] += '-other';
    expect(serializeLocalMaterialBinding(input)).not.toBe(expectedAudio);
  });

  it('binds the exact numeric revision without incrementing or confirming a commit', () => {
    const input = binding();
    input.descriptor.revision = 8;
    expect(serializeLocalMaterialBinding(input)).not.toBe(expectedAudio);
    expect(input.descriptor.revision).toBe(8);
    expect(JSON.parse(serializeLocalMaterialBinding(input))[15]).toBe(8);
    input.descriptor.revision = Number.MAX_SAFE_INTEGER;
    expect(JSON.parse(serializeLocalMaterialBinding(input))[15]).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    ['plain concatenation', ['ab', 'c'], ['a', 'bc']],
    ['pipe separator', ['a|b', 'c'], ['a', 'b|c']],
    ['colon separator', ['a:b', 'c'], ['a', 'b:c']],
    ['JSON punctuation', ['a","b', 'c'], ['a', 'b","c']],
  ])('does not collapse ambiguous %s across material/run boundaries', (_label, first, second) => {
    const left = binding(); const right = binding();
    left.descriptor.localMaterialId = first[0]; left.descriptor.recordingRunId = first[1];
    right.descriptor.localMaterialId = second[0]; right.descriptor.recordingRunId = second[1];
    expect(serializeLocalMaterialBinding(left)).not.toBe(serializeLocalMaterialBinding(right));
  });

  it('keeps identity boundaries distinct when a naive concatenation would match', () => {
    const left = binding(); const right = binding();
    left.descriptor.owner.userId = 'ab'; left.descriptor.owner.issuer = 'c';
    right.descriptor.owner.userId = 'a'; right.descriptor.owner.issuer = 'bc';
    expect(serializeLocalMaterialBinding(left)).not.toBe(serializeLocalMaterialBinding(right));
  });

  it('round-trips quotes, slashes, backslashes and complete Unicode scalars as data', () => {
    const input = binding();
    input.descriptor.owner.subject = 'Қызметкер-Врач-😀-"quoted"-\\path/part';
    input.descriptor.localMaterialId = 'a],["payloadKind":"transcript"';
    const fields: unknown[] = JSON.parse(serializeLocalMaterialBinding(input));
    expect(fields).toHaveLength(16);
    expect(fields[2]).toBe('audio');
    expect(fields[7]).toBe(input.descriptor.owner.subject);
    expect(fields[13]).toBe(input.descriptor.localMaterialId);
  });

  it('preserves NFC versus NFD identity distinctions and does not normalize case', () => {
    const composed = binding(); const decomposed = binding();
    composed.descriptor.owner.subject = 'synthetic-\u00e9';
    decomposed.descriptor.owner.subject = 'synthetic-e\u0301';
    expect(composed.descriptor.owner.subject.normalize('NFD')).toBe(decomposed.descriptor.owner.subject);
    expect(serializeLocalMaterialBinding(composed)).not.toBe(serializeLocalMaterialBinding(decomposed));
    const upper = binding(); upper.descriptor.owner.subject = upper.descriptor.owner.subject.toUpperCase();
    expect(serializeLocalMaterialBinding(upper)).not.toBe(expectedAudio);
  });

  it('does not allocate entropy or keys to construct the binding', () => {
    const unavailable = () => { throw new Error('Synthetic crypto-allocation tripwire'); };
    const randomId = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(unavailable);
    const randomBytes = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(unavailable);
    const generateKey = vi.spyOn(globalThis.crypto.subtle, 'generateKey').mockImplementation(unavailable);
    try {
      expect(serializeLocalMaterialBinding(binding())).toBe(expectedAudio);
      expect(randomId).not.toHaveBeenCalled();
      expect(randomBytes).not.toHaveBeenCalled();
      expect(generateKey).not.toHaveBeenCalled();
    } finally {
      randomId.mockRestore(); randomBytes.mockRestore(); generateKey.mockRestore();
    }
  });

  it.each([
    ['null', null], ['undefined', undefined], ['array', []], ['string', 'synthetic'],
    ['number', 1], ['boolean', true], ['symbol', Symbol('synthetic')], ['Date', new Date(0)],
    ['Map', new Map()], ['function', () => undefined],
  ])('rejects a non-plain wrapper: %s', (_label, input) => rejected(input));

  it.each(['descriptor', 'payloadKind'] as const)('requires the own wrapper field %s', field => {
    const input: Record<string, unknown> = { ...binding() };
    delete input[field];
    rejected(input);
  });

  it.each(['Audio', 'TRANSCRIPT', ' audio', 'audio ', 'video', '', 1, true, null, undefined])('rejects unsupported/untrimmed payload kind %s', payloadKind => {
    rejected({ ...binding(), payloadKind });
  });

  it('does not coerce a boxed payload kind or execute valueOf/toString', () => {
    const toString = vi.fn(() => 'audio');
    const valueOf = vi.fn(() => 'audio');
    rejected({ ...binding(), payloadKind: { toString, valueOf } });
    rejected({ ...binding(), payloadKind: Object('audio') });
    expect(toString).not.toHaveBeenCalled(); expect(valueOf).not.toHaveBeenCalled();
  });

  it.each([
    'authorizationGeneration', 'consentVersions', 'role', 'canRead', 'token', 'sessionToken',
    'key', 'keyId', 'nonce', 'ciphertext', 'payload', 'plaintext', 'audio', 'transcript', 'schema',
  ])('rejects extra wrapper field %s, including undefined-valued extras', field => {
    rejected({ ...binding(), [field]: 'synthetic-extra' });
    rejected({ ...binding(), [field]: undefined });
  });

  it.each(['authorizationGeneration', 'consentVersions', 'key', 'payload', 'role'] as const)('rejects %s nested in the descriptor or owner', field => {
    const value = descriptor();
    rejected({ descriptor: { ...value, [field]: 'synthetic-extra' }, payloadKind: 'audio' });
    rejected({ descriptor: { ...value, owner: { ...value.owner, [field]: 'synthetic-extra' } }, payloadKind: 'audio' });
  });

  it.each([
    ['null descriptor', null], ['legacy history', { version: 1, id: 'synthetic-id' }],
    ['wrong schema', { ...descriptor(), schema: 'orion-local-material/v2' }],
    ['wrong audience', { ...descriptor(), owner: { ...descriptor().owner, audience: 'patient' } }],
    ['zero revision', { ...descriptor(), revision: 0 }], ['fractional revision', { ...descriptor(), revision: 1.5 }],
    ['unsafe revision', { ...descriptor(), revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['string revision', { ...descriptor(), revision: '7' }], ['NaN revision', { ...descriptor(), revision: Number.NaN }],
    ['missing identity', { ...descriptor(), owner: { ...descriptor().owner, userId: undefined } }],
  ])('normalizes descriptor rejection to the binding error: %s', (_label, value) => rejected({ descriptor: value, payloadKind: 'audio' }));

  it.each([
    ['empty', ''], ['leading space', ' synthetic'], ['trailing NBSP', 'synthetic\u00a0'],
    ['C0', 'synthetic\u0000id'], ['C1', 'synthetic\u009fid'], ['lone high surrogate', 'synthetic\ud800'],
    ['lone low surrogate', 'synthetic\udfff'], ['too long', 'a'.repeat(257)],
  ])('inherits strict identifier validation: %s', (_label, invalid) => {
    const value = descriptor();
    rejected({ descriptor: { ...value, localMaterialId: invalid }, payloadKind: 'audio' });
    rejected({ descriptor: { ...value, owner: { ...value.owner, subject: invalid } }, payloadKind: 'audio' });
  });

  it('does not execute JSON hooks on the wrapper, descriptor or owner', () => {
    for (const level of ['wrapper', 'descriptor', 'owner'] as const) {
      const input = binding();
      const toJSON = vi.fn(() => { throw new Error('Synthetic JSON hook must not run'); });
      const target = level === 'wrapper' ? input : level === 'descriptor' ? input.descriptor : input.descriptor.owner;
      Object.defineProperty(target, 'toJSON', { value: toJSON, enumerable: false });
      rejected(input);
      expect(toJSON).not.toHaveBeenCalled();
    }
  });

  it.each(['descriptor', 'payloadKind'] as const)('rejects a wrapper %s accessor without invoking it', field => {
    const input = binding();
    const getter = vi.fn(() => { throw new Error('Synthetic private accessor error'); });
    Object.defineProperty(input, field, { get: getter, enumerable: true });
    rejected(input);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects hidden fields, hidden extras, inherited fields and symbols on the wrapper', () => {
    for (const field of ['descriptor', 'payloadKind']) {
      const hidden = binding(); Object.defineProperty(hidden, field, { enumerable: false }); rejected(hidden);
    }
    const extra = binding(); Object.defineProperty(extra, 'hidden', { value: true }); rejected(extra);
    rejected(Object.create(binding()));
    const inherited = binding(); Object.setPrototypeOf(inherited, { inherited: true }); rejected(inherited);
    for (const enumerable of [false, true]) {
      const symbol = binding(); Object.defineProperty(symbol, Symbol('synthetic'), { value: true, enumerable }); rejected(symbol);
    }
  });

  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)('contains throwing %s Proxy traps at every object level', trap => {
    const fail = () => { throw new Error('synthetic-private-proxy-value'); };
    for (const level of ['wrapper', 'descriptor', 'owner']) {
      const input = binding();
      const target = level === 'wrapper' ? input : level === 'descriptor' ? input.descriptor : input.descriptor.owner;
      const proxy = new Proxy(target, { [trap]: fail });
      const changed = level === 'wrapper' ? proxy : level === 'descriptor'
        ? { ...input, descriptor: proxy }
        : { ...input, descriptor: { ...input.descriptor, owner: proxy } };
      rejected(changed);
    }
  });

  it('contains revoked Proxy failures without exposing engine or input details', () => {
    const revocable = Proxy.revocable(binding(), {}); revocable.revoke(); rejected(revocable.proxy);
    const nested = Proxy.revocable(descriptor(), {}); nested.revoke();
    rejected({ descriptor: nested.proxy, payloadKind: 'audio' });
  });
});
