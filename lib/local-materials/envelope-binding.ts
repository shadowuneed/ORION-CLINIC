import { snapshotLocalMaterialDescriptor } from './descriptor';

export type LocalMaterialPayloadKind = 'audio' | 'transcript';

/**
 * Unmounted canonical metadata codec, NOT an encrypted envelope, authentication
 * tag, signature, key lease or authority/consent decision. A future reviewed
 * crypto adapter may use its UTF-8 representation as authenticated metadata.
 * That adapter must separately validate encryption parameters and action access.
 *
 * The string contains staff/patient/encounter identifiers. Do NOT log it, publish
 * it or label it anonymous. The envelope privacy/key/retention design is still
 * pending. Nothing here allocates keys/nonces/IDs, reads legacy v1, persists bytes
 * or authenticates the caller-supplied descriptor.
 *
 * Format is a fixed JSON array (domain, version, kind, descriptor schema, exact
 * owner fields, material, run, revision); no delimiter concatenation or implicit
 * Unicode normalization. Output is an immutable string, not a shared byte buffer.
 * Current authorization generation/consent pins are deliberately NOT ownership.
 */
export function serializeLocalMaterialBinding(input: unknown): string {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || keys.some(key => key !== 'descriptor' && key !== 'payloadKind')) throw new TypeError();
    const descriptorProperty = Object.getOwnPropertyDescriptor(input, 'descriptor');
    const kindProperty = Object.getOwnPropertyDescriptor(input, 'payloadKind');
    if (!descriptorProperty?.enumerable || !Object.hasOwn(descriptorProperty, 'value') ||
      !kindProperty?.enumerable || !Object.hasOwn(kindProperty, 'value')) throw new TypeError();
    const kind: unknown = kindProperty.value;
    if (kind !== 'audio' && kind !== 'transcript') throw new TypeError();
    const descriptor = snapshotLocalMaterialDescriptor(descriptorProperty.value);
    const owner = descriptor.owner;
    return JSON.stringify([
      'ORION:LOCAL-MATERIAL:BINDING', 1, kind, descriptor.schema,
      owner.audience, owner.userId, owner.issuer, owner.subject,
      owner.organizationId, owner.facilityId, owner.accessAssignmentId,
      owner.patientId, owner.encounterId,
      descriptor.localMaterialId, descriptor.recordingRunId, descriptor.revision,
    ]);
  } catch {
    // Even throwing Proxy traps must not leak arbitrary input into caller logs.
    throw new TypeError('Invalid local material binding');
  }
}
