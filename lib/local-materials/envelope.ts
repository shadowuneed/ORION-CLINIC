import { serializeLocalMaterialBinding } from './envelope-binding';

/**
 * Unmounted crypto primitive, NOT key custody, an access grant or persistence.
 * The caller must obtain the key and expected binding through current server
 * action authorization and fence every result before publishing it. See ADR-0003.
 * No owner IDs/AAD/key bytes are included in the returned envelope.
 */
export type LocalMaterialEnvelope = Readonly<{
  schema: 'orion-local-envelope/v1';
  profile: 'AES-256-GCM-96-128';
  keyId: string;
  keyVersion: number;
  iv: string;
  ciphertext: string;
}>;

// Engineering bound for one opaque payload, not a clinical retention/chunk policy.
export const MAX_LOCAL_MATERIAL_PAYLOAD_BYTES = 1024 * 1024;
const profile = 'AES-256-GCM-96-128';
const schema = 'orion-local-envelope/v1';
const message = 'Local material cryptography failed';

function fail(): never { throw new Error(message); }

function ownFields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) return fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(input, name);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return fail();
    result[name] = field.value;
  }
  return result;
}

function keyReference(keyId: unknown, keyVersion: unknown): { keyId: string; keyVersion: number } {
  // Opaque broker reference only. No arbitrary URL, clinical name or Unicode ID.
  if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(keyId) ||
    typeof keyVersion !== 'number' || !Number.isSafeInteger(keyVersion) || keyVersion < 1) return fail();
  return { keyId, keyVersion };
}

function snapshotScope(input: unknown) {
  const fields = ownFields(input, ['descriptor', 'payloadKind', 'keyId', 'keyVersion']);
  return Object.freeze({
    binding: serializeLocalMaterialBinding({ descriptor: fields.descriptor, payloadKind: fields.payloadKind }),
    ...keyReference(fields.keyId, fields.keyVersion),
  });
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const nativeOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const nativeLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const nativeTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const nativeArrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

function copyBytes(input: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  // Intrinsic getters ignore shadowed properties and reject Proxy/non-view input.
  // Only native Uint8Array views from this realm, not subclasses/Node Buffers.
  if (!input || Object.getPrototypeOf(input) !== Uint8Array.prototype || nativeTag.call(input) !== 'Uint8Array') return fail();
  const buffer = nativeBuffer.call(input) as ArrayBuffer;
  nativeArrayBufferLength.call(buffer); // Reject SharedArrayBuffer backing intrinsically.
  const length = nativeLength.call(input) as number;
  const offset = nativeOffset.call(input) as number;
  if (length < min || length > max) return fail();
  return new Uint8Array(new Uint8Array(buffer, offset, length));
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  if (binary.length < min || binary.length > max) return fail();
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (encode(bytes) !== value) return fail(); // Reject alternate/padded encodings.
  return bytes;
}

function aad(scope: ReturnType<typeof snapshotScope>, length: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([
    'ORION:LOCAL-MATERIAL:ENVELOPE', schema, profile, 'opaque-bytes/v1',
    scope.keyId, scope.keyVersion, length, scope.binding,
  ]));
}

/**
 * A single encryption attempt, consumed even on failure. The trusted broker must
 * issue a fresh 32-byte DEK per payload revision; reusing those bytes in another
 * sealer is NOT prevented globally. Native import fixes actual key strength;
 * accepting a CryptoKey with mutable public algorithm metadata would not.
 * The caller still owns its raw key bytes. We clear only our temporary copy.
 * Neither the raw bytes nor the imported key are returned or persisted here.
 */
export async function createLocalMaterialSealer(keyBytes: Uint8Array, expectedScope: unknown): Promise<Readonly<{
  seal(plaintext: Uint8Array): Promise<LocalMaterialEnvelope>;
}>> {
  let keyCopy: Uint8Array<ArrayBuffer> | undefined;
  try {
    const scope = snapshotScope(expectedScope);
    keyCopy = copyBytes(keyBytes, 32, 32);
    const key = await globalThis.crypto.subtle.importKey('raw', keyCopy, 'AES-GCM', false, ['encrypt']);
    let consumed = false;
    return Object.freeze({
      async seal(plaintext: Uint8Array): Promise<LocalMaterialEnvelope> {
        let copy: Uint8Array<ArrayBuffer> | undefined;
        try {
          if (consumed) return fail();
          consumed = true;
          copy = copyBytes(plaintext, 1, MAX_LOCAL_MATERIAL_PAYLOAD_BYTES);
          const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
          const encrypted = await globalThis.crypto.subtle.encrypt({
            name: 'AES-GCM', iv, tagLength: 128, additionalData: aad(scope, copy.length),
          }, key, copy);
          return Object.freeze({ schema, profile, keyId: scope.keyId, keyVersion: scope.keyVersion,
            iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) });
        } catch { return fail(); }
        finally { copy?.fill(0); } // Best effort for our copy, not a secure-erasure claim.
      },
    });
  } catch { return fail(); }
  finally { keyCopy?.fill(0); }
}

/**
 * expectedScope comes from the broker, never from the untrusted envelope. The
 * returned bytes are still sensitive and need a current target lease before use.
 * AEAD does not detect an old valid revision; the broker must check current head.
 */
export async function decryptLocalMaterialPayload(
  keyBytes: Uint8Array, expectedScope: unknown, input: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  let keyCopy: Uint8Array<ArrayBuffer> | undefined;
  try {
    const scope = snapshotScope(expectedScope);
    keyCopy = copyBytes(keyBytes, 32, 32);
    const fields = ownFields(input, ['schema', 'profile', 'keyId', 'keyVersion', 'iv', 'ciphertext']);
    if (fields.schema !== schema || fields.profile !== profile || fields.keyId !== scope.keyId ||
      fields.keyVersion !== scope.keyVersion) return fail();
    const iv = decode(fields.iv, 12, 12);
    const ciphertext = decode(fields.ciphertext, 17, MAX_LOCAL_MATERIAL_PAYLOAD_BYTES + 16);
    const key = await globalThis.crypto.subtle.importKey('raw', keyCopy, 'AES-GCM', false, ['decrypt']);
    const plaintext = await globalThis.crypto.subtle.decrypt({
      name: 'AES-GCM', iv, tagLength: 128, additionalData: aad(scope, ciphertext.length - 16),
    }, key, ciphertext);
    return new Uint8Array(plaintext);
  } catch { return fail(); }
  finally { keyCopy?.fill(0); }
}
