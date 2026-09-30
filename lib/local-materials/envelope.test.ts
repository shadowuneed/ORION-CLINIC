import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalMaterialSealer, decryptLocalMaterialPayload,
  MAX_LOCAL_MATERIAL_PAYLOAD_BYTES,
} from './envelope';

const error = 'Local material cryptography failed';
const text = new TextEncoder().encode('Искусственная запись · Қазақша');
function scope() {
  return {
    descriptor: {
      schema: 'orion-local-material/v1',
      owner: {
        audience: 'staff', userId: 'staff-a', issuer: 'issuer', subject: 'subject',
        organizationId: 'org-a', facilityId: 'fac-a', accessAssignmentId: 'assignment-a',
        patientId: 'patient-a', encounterId: 'encounter-a',
      },
      localMaterialId: 'material-a', recordingRunId: 'run-a', revision: 1,
    },
    payloadKind: 'transcript', keyId: 'opaque_test_key_0001', keyVersion: 1,
  };
}
async function key() {
  return crypto.getRandomValues(new Uint8Array(32));
}
async function fixture() {
  const k = await key();
  const selected = scope();
  const envelope = await (await createLocalMaterialSealer(k, selected)).seal(text);
  return { k, selected, envelope };
}
afterEach(() => vi.restoreAllMocks());

describe('isolated local-material AEAD envelope', () => {
  it('uses real Web Crypto to round-trip bytes, with no identity or key bytes persisted', async () => {
    const { k, selected, envelope } = await fixture();
    expect(await decryptLocalMaterialPayload(k, selected, envelope)).toEqual(text);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.keys(envelope)).toEqual(['schema', 'profile', 'keyId', 'keyVersion', 'iv', 'ciphertext']);
    expect(envelope.iv).toHaveLength(16);
    expect(JSON.stringify(envelope)).not.toContain('patient-a');
    expect(JSON.stringify(envelope)).not.toContain('staff-a');
    expect(JSON.stringify(envelope)).not.toContain('Искусственная');
  });

  it('accepts only the selected byte view, not surrounding bytes', async () => {
    const k = await key();
    const source = new Uint8Array([90, 91, 1, 2, 3, 92]);
    const encrypted = await (await createLocalMaterialSealer(k, scope())).seal(source.subarray(2, 5));
    expect(await decryptLocalMaterialPayload(k, scope(), encrypted)).toEqual(new Uint8Array([1, 2, 3]));
    expect(source).toEqual(new Uint8Array([90, 91, 1, 2, 3, 92]));
  });

  it('snapshots scope at creation and bytes before the encryption await', async () => {
    const k = await key();
    const selected = scope();
    const sealerPromise = createLocalMaterialSealer(k, selected);
    selected.descriptor.owner.patientId = 'other';
    selected.keyId = 'other_test_key_0002';
    const sealer = await sealerPromise;
    const source = new Uint8Array(text);
    const pending = sealer.seal(source);
    source.fill(0);
    expect(await decryptLocalMaterialPayload(k, scope(), await pending)).toEqual(text);
  });

  it('snapshots expected scope and envelope before the decryption await', async () => {
    const { k, selected, envelope } = await fixture();
    const mutable = { ...envelope };
    const pending = decryptLocalMaterialPayload(k, selected, mutable);
    mutable.ciphertext = 'invalid';
    selected.descriptor.owner.patientId = 'changed';
    expect(await pending).toEqual(text);
  });

  it('consumes its encryption attempt before an overlapping call', async () => {
    const k = await key();
    const sealer = await createLocalMaterialSealer(k, scope());
    const first = sealer.seal(text);
    await expect(sealer.seal(text)).rejects.toThrow(error);
    expect(await decryptLocalMaterialPayload(k, scope(), await first)).toEqual(text);
    await expect(sealer.seal(text)).rejects.toThrow(error);
  });

  it('does not reuse an attempt after validation failure', async () => {
    const sealer = await createLocalMaterialSealer(await key(), scope());
    await expect(sealer.seal(new Uint8Array())).rejects.toThrow(error);
    await expect(sealer.seal(text)).rejects.toThrow(error);
  });

  it('does not reuse an attempt after crypto failure or expose its exception', async () => {
    const k = await key();
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValue(new Error('PRIVATE provider detail'));
    const sealer = await createLocalMaterialSealer(k, scope());
    await expect(sealer.seal(text)).rejects.toThrow(new Error(error));
    await expect(sealer.seal(text)).rejects.toThrow(new Error(error));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fails closed if entropy is unavailable', async () => {
    const k = await key();
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw new Error('private'); });
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt');
    await expect((await createLocalMaterialSealer(k, scope())).seal(text)).rejects.toThrow(new Error(error));
    expect(encrypt).not.toHaveBeenCalled();
  });

  it.each(['userId', 'issuer', 'subject', 'organizationId', 'facilityId',
    'accessAssignmentId', 'patientId', 'encounterId'] as const)('rejects changed owner %s', async field => {
    const { k, selected, envelope } = await fixture();
    selected.descriptor.owner[field] += '-other';
    await expect(decryptLocalMaterialPayload(k, selected, envelope)).rejects.toThrow(error);
  });
  it.each(['localMaterialId', 'recordingRunId'] as const)('rejects changed %s', async field => {
    const { k, selected, envelope } = await fixture();
    selected.descriptor[field] += '-other';
    await expect(decryptLocalMaterialPayload(k, selected, envelope)).rejects.toThrow(error);
  });
  it.each(['revision', 'kind', 'keyId', 'keyVersion'])('rejects changed expected %s', async field => {
    const { k, selected, envelope } = await fixture();
    if (field === 'revision') selected.descriptor.revision++;
    if (field === 'kind') selected.payloadKind = 'audio';
    if (field === 'keyId') selected.keyId += 'z';
    if (field === 'keyVersion') selected.keyVersion++;
    await expect(decryptLocalMaterialPayload(k, selected, envelope)).rejects.toThrow(error);
  });

  it('authenticates key header even when the expected header is also substituted', async () => {
    const { k, selected, envelope } = await fixture();
    selected.keyId = 'other_test_key_0002';
    selected.keyVersion = 2;
    await expect(decryptLocalMaterialPayload(k, selected, { ...envelope,
      keyId: selected.keyId, keyVersion: 2 })).rejects.toThrow(error);
  });

  it('rejects the wrong cryptographic key with otherwise identical metadata', async () => {
    const { selected, envelope } = await fixture();
    await expect(decryptLocalMaterialPayload(await key(), selected, envelope)).rejects.toThrow(error);
  });

  it.each(['schema', 'profile', 'keyId', 'keyVersion', 'iv', 'ciphertext'] as const)(
    'rejects altered envelope %s', async field => {
      const { k, selected, envelope } = await fixture();
      const changed = { ...envelope, [field]: field === 'keyVersion' ? 2 :
        field === 'iv' || field === 'ciphertext' ? (envelope[field][0] === 'A' ? 'B' : 'A') + envelope[field].slice(1) : 'unknown' };
      await expect(decryptLocalMaterialPayload(k, selected, changed)).rejects.toThrow(error);
    });

  it.each(['', 'AA', 'AAAA=', 'abc+', 'abc/', 'a b', '===='])('rejects noncanonical or truncated bytes %s', async value => {
    const { k, selected, envelope } = await fixture();
    await expect(decryptLocalMaterialPayload(k, selected, { ...envelope, iv: value })).rejects.toThrow(error);
    await expect(decryptLocalMaterialPayload(k, selected, { ...envelope, ciphertext: value })).rejects.toThrow(error);
  });

  it('rejects truncation of an authentic tag and appended bytes', async () => {
    const { k, selected, envelope } = await fixture();
    for (const ciphertext of [envelope.ciphertext.slice(0, -4), envelope.ciphertext + 'AAAA']) {
      await expect(decryptLocalMaterialPayload(k, selected, { ...envelope, ciphertext })).rejects.toThrow(error);
    }
  });

  it.each([0, 16, 24, 31, 33, 64])('rejects raw key length %i', async length => {
    const k = new Uint8Array(length);
    await expect(createLocalMaterialSealer(k, scope())).rejects.toThrow(error);
  });

  it('does not trust altered CryptoKey public metadata for actual key strength', async () => {
    const weak = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
    (weak.algorithm as AesKeyAlgorithm).length = 256;
    const { envelope } = await fixture();
    await expect(createLocalMaterialSealer(weak as unknown as Uint8Array, scope())).rejects.toThrow(error);
    await expect(decryptLocalMaterialPayload(weak as unknown as Uint8Array, scope(), envelope)).rejects.toThrow(error);
  });

  it.each([null, [], {}, 'scope', { ...scope(), extra: 'private' },
    { ...scope(), keyId: 'https://private.invalid/key' }, { ...scope(), keyVersion: 0 },
    { ...scope(), keyVersion: Number.MAX_SAFE_INTEGER + 1 }, { ...scope(), payloadKind: 'other' },
  ])('rejects malformed scope without crypto: %j', async selected => {
    const k = await key();
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt');
    await expect(createLocalMaterialSealer(k, selected)).rejects.toThrow(new Error(error));
    expect(encrypt).not.toHaveBeenCalled();
  });

  it('rejects accessors without invoking them, and genericizes proxy failures', async () => {
    const { k, selected, envelope } = await fixture();
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    const invalidScope = { ...selected };
    Object.defineProperty(invalidScope, 'keyId', { enumerable: true, get: getter });
    await expect(createLocalMaterialSealer(k, invalidScope)).rejects.toThrow(new Error(error));
    const invalidEnvelope = { ...envelope };
    Object.defineProperty(invalidEnvelope, 'iv', { enumerable: true, get: getter });
    await expect(decryptLocalMaterialPayload(k, selected, invalidEnvelope)).rejects.toThrow(new Error(error));
    expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy({}, { ownKeys() { throw new Error('PRIVATE'); } });
    await expect(decryptLocalMaterialPayload(k, selected, proxy)).rejects.toThrow(new Error(error));
  });

  it('rejects unknown, hidden and symbol envelope fields', async () => {
    const { k, selected, envelope } = await fixture();
    for (const changed of [{ ...envelope, extra: true }, { ...envelope, [Symbol('x')]: true },
      Object.defineProperty({ ...envelope }, 'hidden', { value: true })]) {
      await expect(decryptLocalMaterialPayload(k, selected, changed)).rejects.toThrow(error);
    }
  });

  it('accepts the exact payload bound and rejects excess before cryptography', async () => {
    const k = await key();
    const bytes = new Uint8Array(MAX_LOCAL_MATERIAL_PAYLOAD_BYTES).fill(7);
    const envelope = await (await createLocalMaterialSealer(k, scope())).seal(bytes);
    const decrypted = await decryptLocalMaterialPayload(k, scope(), envelope);
    // Compare every byte and the length natively, without a million-entry deep
    // assertion walk that can consume the test deadline on a busy workstation.
    expect(decrypted).toBeInstanceOf(Uint8Array);
    expect(decrypted.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(decrypted).equals(Buffer.from(bytes))).toBe(true);
    const spy = vi.spyOn(crypto.subtle, 'encrypt');
    await expect((await createLocalMaterialSealer(await key(), scope())).seal(
      new Uint8Array(MAX_LOCAL_MATERIAL_PAYLOAD_BYTES + 1))).rejects.toThrow(error);
    expect(spy).not.toHaveBeenCalled();
    await expect(decryptLocalMaterialPayload(k, scope(), { ...envelope,
      ciphertext: envelope.ciphertext + 'AAAA' })).rejects.toThrow(error);
  });

  it('rejects shared memory, detached memory and non-byte views', async () => {
    const k = await key();
    const detached = new Uint8Array([1]);
    structuredClone(detached, { transfer: [detached.buffer] });
    for (const value of [new Uint8Array(new SharedArrayBuffer(8)), detached,
      new DataView(new ArrayBuffer(8)), new Uint16Array([1]), [1], null]) {
      await expect((await createLocalMaterialSealer(k, scope())).seal(value as Uint8Array)).rejects.toThrow(error);
    }
  });

  it('uses intrinsic byte view properties, ignoring shadow getters entirely', async () => {
    const k = await key();
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    const bytes = new Uint8Array([1, 2, 3]);
    for (const field of ['buffer', 'byteLength', 'byteOffset']) {
      Object.defineProperty(bytes, field, { get: getter });
    }
    const envelope = await (await createLocalMaterialSealer(k, scope())).seal(bytes);
    expect(await decryptLocalMaterialPayload(k, scope(), envelope)).toEqual(new Uint8Array([1, 2, 3]));
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects length and backing-memory spoofing before encryption', async () => {
    const k = await key();
    const huge = new Uint8Array(MAX_LOCAL_MATERIAL_PAYLOAD_BYTES + 1);
    Object.defineProperty(huge, 'byteLength', { value: 1 });
    const shared = new Uint8Array(new SharedArrayBuffer(3));
    Object.defineProperty(shared, 'buffer', { value: new ArrayBuffer(3) });
    class DerivedBytes extends Uint8Array {}
    const spoof = Object.setPrototypeOf({}, Uint8Array.prototype);
    const wrongView = Object.setPrototypeOf(new Uint16Array([1]), Uint8Array.prototype);
    const spy = vi.spyOn(crypto.subtle, 'encrypt');
    for (const bytes of [huge, shared, new DerivedBytes([1]), spoof, wrongView, new Proxy(text, {})]) {
      await expect((await createLocalMaterialSealer(k, scope())).seal(bytes)).rejects.toThrow(error);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a spoofed raw key length/shared backing before native import', async () => {
    const weak = new Uint8Array(16);
    Object.defineProperty(weak, 'byteLength', { value: 32 });
    const shared = new Uint8Array(new SharedArrayBuffer(32));
    Object.defineProperty(shared, 'buffer', { value: new ArrayBuffer(32) });
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    for (const k of [weak, shared]) await expect(createLocalMaterialSealer(k, scope())).rejects.toThrow(error);
    expect(spy).not.toHaveBeenCalled();
  });

  it('copies raw key before await, imports256 nonextractable and erases only its own copy', async () => {
    const original = await key();
    const callerKey = new Uint8Array(original);
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    const pending = createLocalMaterialSealer(callerKey, scope());
    callerKey.fill(0);
    const sealer = await pending;
    expect(spy).toHaveBeenCalledWith('raw', expect.any(Uint8Array), 'AES-GCM', false, ['encrypt']);
    const captured = spy.mock.calls[0][1] as Uint8Array;
    expect([...captured]).toEqual(Array(32).fill(0));
    const envelope = await sealer.seal(text);
    const revealKey = new Uint8Array(original);
    const reveal = decryptLocalMaterialPayload(revealKey, scope(), envelope);
    revealKey.fill(0);
    expect(await reveal).toEqual(text);
    expect(original.some(byte => byte !== 0)).toBe(true);
  });
});
