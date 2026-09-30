/**
 * Unmounted local-material metadata contract. This is NOT an authorization
 * grant, encrypted envelope, storage implementation or successful DB CAS.
 * Never infer this owner from a role, URL, display name or legacy v1 record.
 * Current authority/consent pins belong to the operation context, not the owner.
 *
 * One material represents one explicit capture run in this first contract.
 * A future adapter must allocate fresh material/run IDs for a new recording;
 * hydration does not create them. This module validates, but does not allocate
 * IDs, prove their uniqueness/provenance, or increment persisted revisions.
 */
export type LocalMaterialOwner = Readonly<{
  audience: 'staff';
  userId: string;
  issuer: string;
  subject: string;
  organizationId: string;
  facilityId: string;
  accessAssignmentId: string;
  patientId: string;
  encounterId: string;
}>;

export type LocalMaterialDescriptor = Readonly<{
  schema: 'orion-local-material/v1';
  owner: LocalMaterialOwner;
  localMaterialId: string;
  recordingRunId: string;
  /** Positive version of this material; only storage can confirm a CAS commit. */
  revision: number;
}>;

const ownerIdentifiers = [
  'userId', 'issuer', 'subject', 'organizationId', 'facilityId',
  'accessAssignmentId', 'patientId', 'encounterId',
] as const;

function invalidDescriptor(): never {
  // No identifiers, clinical scope or user input in errors.
  throw new TypeError('Invalid local material descriptor');
}

function ownDataFields(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalidDescriptor();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalidDescriptor();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    return invalidDescriptor();
  }
  const fields: Record<string, unknown> = Object.create(null);
  for (const name of expected) {
    const property = Object.getOwnPropertyDescriptor(input, name);
    if (!property || !property.enumerable || !Object.hasOwn(property, 'value')) return invalidDescriptor();
    fields[name] = property.value;
  }
  return fields;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) || Array.from(value).some(char => {
      const point = char.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    })) return invalidDescriptor();
  return value;
}

/** Strict copy; ordinary accessors are never invoked. Proxy traps can still run. */
export function snapshotLocalMaterialDescriptor(input: unknown): LocalMaterialDescriptor {
  try {
    const fields = ownDataFields(input, ['schema', 'owner', 'localMaterialId', 'recordingRunId', 'revision']);
    if (fields.schema !== 'orion-local-material/v1') return invalidDescriptor();
    const ownerFields = ownDataFields(fields.owner, ['audience', ...ownerIdentifiers]);
    if (ownerFields.audience !== 'staff') return invalidDescriptor();
    const identities = {} as Record<(typeof ownerIdentifiers)[number], string>;
    for (const name of ownerIdentifiers) identities[name] = identifier(ownerFields[name]);
    if (typeof fields.revision !== 'number' || !Number.isSafeInteger(fields.revision) || fields.revision < 1) {
      return invalidDescriptor();
    }
    return Object.freeze({
      schema: 'orion-local-material/v1',
      owner: Object.freeze({ audience: 'staff', ...identities }),
      localMaterialId: identifier(fields.localMaterialId),
      recordingRunId: identifier(fields.recordingRunId),
      revision: fields.revision,
    });
  } catch {
    // Even a throwing Proxy must not put arbitrary contents into an error log.
    return invalidDescriptor();
  }
}

/**
 * Exact metadata equality only. It does not detect A->B->A or validate authority,
 * authenticity, stored revision, ciphertext integrity or a completed write.
 */
export function isSameLocalMaterialDescriptor(left: unknown, right: unknown): boolean {
  try {
    const a = snapshotLocalMaterialDescriptor(left);
    const b = snapshotLocalMaterialDescriptor(right);
    return a.localMaterialId === b.localMaterialId && a.recordingRunId === b.recordingRunId &&
      a.revision === b.revision && ownerIdentifiers.every(name => a.owner[name] === b.owner[name]);
  } catch {
    return false;
  }
}
