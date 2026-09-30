import { snapshotLocalMaterialDescriptor } from '@/lib/local-materials/descriptor';
import { serializeLocalMaterialBinding } from '@/lib/local-materials/envelope-binding';

if (typeof window !== 'undefined') throw new Error('Local material registry is server-only.');

const databaseNow = "cast(unixepoch('subsec') * 1000 as integer)";
export const LOCAL_MATERIAL_RESERVATION_MS = 120_000;
const hex = /^[a-f0-9]{64}$/;
const keyIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const reasons = ['expired', 'cancelled', 'authority_changed', 'preparation_failed'] as const;
type RetireReason = (typeof reasons)[number];
type State = 'preparing' | 'prepared' | 'committed' | 'retired';

export type LocalMaterialRegistryOperation = Readonly<{
  operationId: string;
  requestHash: string;
  state: State;
  keyId: string;
  createdAt: number;
  expiresAt: number;
  receiptId: string | null;
  envelopeHash: string | null;
  envelopeBytes: number | null;
  retireReason: RetireReason | null;
  /** Historical receipt does not imply that it is still this stream's head. */
  currentHead: boolean;
}>;
export type LocalMaterialRegistryResult =
  | Readonly<{ status: 'stored' | 'replayed'; operation: LocalMaterialRegistryOperation }>
  | Readonly<{ status: 'invalid' | 'conflict' }>;

function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(k => typeof k !== 'string' || !names.includes(k))) throw new TypeError();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const property = Object.getOwnPropertyDescriptor(input, name);
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw new TypeError();
    result[name] = property.value;
  }
  return result;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value.trim() !== value ||
    /[\p{Cc}\p{Surrogate}]/u.test(value)) throw new TypeError();
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 64 || !hex.test(value)) throw new TypeError();
  return value;
}
function operationIdentifier(value: unknown): string {
  const result = identifier(value);
  if (result.length > 128) throw new TypeError();
  return result;
}
function reference(input: Record<string, unknown>) {
  return { operationId: operationIdentifier(input.operationId), requestHash: digest(input.requestHash) };
}
function outcome(status: 'invalid' | 'conflict'): LocalMaterialRegistryResult { return Object.freeze({ status }); }

const projection = `select reservation.id as operationId, reservation.request_hash as requestHash,
  reservation.state, reservation.key_id as keyId, reservation.created_at as createdAt,
  reservation.expires_at as expiresAt, reservation.retire_reason as retireReason,
  receipt.id as receiptId, receipt.envelope_hash as envelopeHash, receipt.envelope_bytes as envelopeBytes,
  case when head.receipt_id = receipt.id then 1 else 0 end as currentHead
  from local_material_reservations reservation
  left join local_material_receipts receipt on receipt.reservation_id = reservation.id
  left join local_material_heads head on head.material_id = reservation.material_id
    and head.payload_kind = reservation.payload_kind`;

/**
 * INTERNAL persistence primitive, intentionally NOT an authorization boundary.
 * No route imports it. A future broker must authorize the exact current staff,
 * writable encounter and consent INSIDE its committing SQL, and invoke an
 * approved wrapping facility. A supplied fingerprint/session ID is not a grant.
 *
 * This class stores only metadata and opaque wrapped bytes supplied by a trusted
 * caller. It neither creates/unwraps/releases a key nor proves those bytes are
 * wrapped. Required config is an explicit test/deployment dependency, not policy
 * approval or key custody. Do not mount this directly behind authentication.
 * No legacy history, plaintext, browser persistence, export or offline access.
 */
export class D1LocalMaterialRegistry {
  private readonly policyId: string;
  private readonly wrappingProviderId: string;

  constructor(private readonly database: D1Database, configuration: unknown) {
    try {
      const config = fields(configuration, ['policyId', 'wrappingProviderId']);
      this.policyId = identifier(config.policyId);
      this.wrappingProviderId = identifier(config.wrappingProviderId);
    } catch { throw new TypeError('Local material registry configuration required.'); }
  }

  async reserve(input: unknown): Promise<LocalMaterialRegistryResult> {
    let snapshot;
    try {
      const value = fields(input, ['operationId', 'descriptor', 'payloadKind', 'expectedReceiptId', 'authorityFingerprint', 'sessionId', 'keyId']);
      const descriptor = snapshotLocalMaterialDescriptor(value.descriptor);
      if (value.payloadKind !== 'audio' && value.payloadKind !== 'transcript') throw new TypeError();
      const keyId = identifier(value.keyId);
      if (!keyIdPattern.test(keyId)) throw new TypeError();
      const expectedReceiptId = value.expectedReceiptId === null ? null : operationIdentifier(value.expectedReceiptId);
      if ((descriptor.revision === 1) !== (expectedReceiptId === null)) throw new TypeError();
      snapshot = Object.freeze({
        operationId: operationIdentifier(value.operationId), descriptor, payloadKind: value.payloadKind,
        expectedReceiptId, authorityFingerprint: digest(value.authorityFingerprint),
        sessionId: identifier(value.sessionId), keyId,
      });
    } catch { return outcome('invalid'); }
    // Copy every caller-owned field before the first asynchronous boundary.
    const binding = serializeLocalMaterialBinding({ descriptor: snapshot.descriptor, payloadKind: snapshot.payloadKind });
    let requestHash: string;
    try {
      const encoded = new TextEncoder().encode(JSON.stringify([
        'ORION:LOCAL-MATERIAL:RESERVATION', 1, snapshot.operationId, binding,
        snapshot.expectedReceiptId, snapshot.authorityFingerprint, snapshot.sessionId,
        snapshot.keyId, this.policyId, this.wrappingProviderId,
      ]));
      requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), b => b.toString(16).padStart(2, '0')).join('');
    } catch { throw new Error('Local material registry unavailable.'); }
    const descriptorJson = JSON.stringify(snapshot.descriptor);
    return this.publish(
      () => this.database.prepare(`insert into local_material_reservations (
        id,request_hash,descriptor_json,payload_kind,material_id,recording_run_id,owner_user_id,revision,
        expected_receipt_id,authority_fingerprint,session_id,key_id,policy_id,wrapping_provider_id,
        created_at,expires_at,state
      ) select ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,${databaseNow},
        ${databaseNow} + ${LOCAL_MATERIAL_RESERVATION_MS},'preparing'
      where not exists (select 1 from local_material_reservations where id=?1 or key_id=?12)
        and not exists (select 1 from local_material_reservations where material_id=?5
          and (recording_run_id<>?6 or owner_user_id<>?7 or json_extract(descriptor_json,'$.owner')<>json_extract(?3,'$.owner')))
        and ((?8=1 and not exists (select 1 from local_material_heads where material_id=?5 and payload_kind=?4))
          or exists (select 1 from local_material_heads where material_id=?5 and payload_kind=?4 and receipt_id=?9 and revision=?8-1))
      `).bind(snapshot.operationId, requestHash, descriptorJson, snapshot.payloadKind,
        snapshot.descriptor.localMaterialId, snapshot.descriptor.recordingRunId, snapshot.descriptor.owner.userId,
        snapshot.descriptor.revision, snapshot.expectedReceiptId, snapshot.authorityFingerprint, snapshot.sessionId,
        snapshot.keyId, this.policyId, this.wrappingProviderId),
      { operationId: snapshot.operationId, requestHash }, 'reserved',
      `(reservation.state in ('preparing','prepared') and reservation.expires_at>${databaseNow}) or reservation.state='committed'`,
    );
  }

  async prepare(input: unknown): Promise<LocalMaterialRegistryResult> {
    let value: ReturnType<typeof reference> & { wrappingKeyRef: string; wrappedKey: string };
    try {
      const source = fields(input, ['operationId', 'requestHash', 'wrappingKeyRef', 'wrappedKey']);
      if (typeof source.wrappedKey !== 'string' || !source.wrappedKey.length || source.wrappedKey.length > 16_384 ||
        /[^A-Za-z0-9_\-]/.test(source.wrappedKey)) throw new TypeError();
      value = { ...reference(source), wrappingKeyRef: identifier(source.wrappingKeyRef), wrappedKey: source.wrappedKey };
    } catch { return outcome('invalid'); }
    return this.publish(() => this.database.prepare(`update local_material_reservations
      set state='prepared',wrapping_key_ref=?1,wrapped_key=?2
      where id=?3 and request_hash=?4 and policy_id=?5 and wrapping_provider_id=?6
        and state='preparing' and expires_at>${databaseNow}`)
      .bind(value.wrappingKeyRef, value.wrappedKey, value.operationId, value.requestHash, this.policyId, this.wrappingProviderId),
    value, 'prepared', `reservation.state in ('prepared','committed')
      and (reservation.state='committed' or reservation.expires_at>${databaseNow})
      and reservation.wrapping_key_ref=?5 and reservation.wrapped_key=?6`, [value.wrappingKeyRef, value.wrappedKey]);
  }

  async finalize(input: unknown): Promise<LocalMaterialRegistryResult> {
    let value: ReturnType<typeof reference> & { receiptId: string; envelopeHash: string; envelopeBytes: number };
    try {
      const source = fields(input, ['operationId', 'requestHash', 'receiptId', 'envelopeHash', 'envelopeBytes']);
      if (typeof source.envelopeBytes !== 'number' || !Number.isSafeInteger(source.envelopeBytes) ||
        source.envelopeBytes < 1 || source.envelopeBytes > 2_097_152) throw new TypeError();
      value = { ...reference(source), receiptId: operationIdentifier(source.receiptId), envelopeHash: digest(source.envelopeHash), envelopeBytes: source.envelopeBytes };
    } catch { return outcome('invalid'); }
    return this.publish(() => this.database.prepare(`insert into local_material_receipts (id,reservation_id,envelope_hash,envelope_bytes,created_at)
      select ?1,reservation.id,?2,?3,${databaseNow} from local_material_reservations reservation
      where reservation.id=?4 and reservation.request_hash=?5 and reservation.policy_id=?6 and reservation.wrapping_provider_id=?7
        and reservation.state='prepared' and reservation.expires_at>${databaseNow}
        and not exists (select 1 from local_material_receipts where id=?1 or reservation_id=?4)
        and ((reservation.expected_receipt_id is null and not exists (select 1 from local_material_heads
              where material_id=reservation.material_id and payload_kind=reservation.payload_kind))
          or exists (select 1 from local_material_heads where material_id=reservation.material_id
            and payload_kind=reservation.payload_kind and receipt_id=reservation.expected_receipt_id and revision=reservation.revision-1))`)
      .bind(value.receiptId, value.envelopeHash, value.envelopeBytes, value.operationId, value.requestHash, this.policyId, this.wrappingProviderId),
    value, 'committed', `reservation.state='committed' and receipt.id=?5 and receipt.envelope_hash=?6 and receipt.envelope_bytes=?7`,
    [value.receiptId, value.envelopeHash, value.envelopeBytes]);
  }

  async retire(input: unknown): Promise<LocalMaterialRegistryResult> {
    let value: ReturnType<typeof reference> & { reason: RetireReason };
    try {
      const source = fields(input, ['operationId', 'requestHash', 'reason']);
      if (!reasons.includes(source.reason as RetireReason)) throw new TypeError();
      value = { ...reference(source), reason: source.reason as RetireReason };
    } catch { return outcome('invalid'); }
    return this.publish(() => this.database.prepare(`update local_material_reservations set state='retired',retire_reason=?1
      where id=?2 and request_hash=?3 and policy_id=?4 and wrapping_provider_id=?5
        and state in ('preparing','prepared') and (?1<>'expired' or expires_at<=${databaseNow})`)
      .bind(value.reason, value.operationId, value.requestHash, this.policyId, this.wrappingProviderId),
    value, 'retired', "reservation.state='retired' and reservation.retire_reason=?5", [value.reason]);
  }

  /** Internal operation status, including expired/terminal history. NOT a key lease. */
  async inspect(input: unknown): Promise<LocalMaterialRegistryResult> {
    let value;
    try { value = reference(fields(input, ['operationId', 'requestHash'])); }
    catch { return outcome('invalid'); }
    try {
      const row = await this.readStatement(value, '1=1', []).first();
      return row ? Object.freeze({ status: 'replayed', operation: this.project(row) }) : outcome('conflict');
    } catch { throw new Error('Local material registry unavailable.'); }
  }

  private readStatement(value: { operationId: string; requestHash: string }, predicate: string, extra: (string | number)[]) {
    return this.database.prepare(`${projection} where reservation.id=?1 and reservation.request_hash=?2
      and reservation.policy_id=?3 and reservation.wrapping_provider_id=?4 and (${predicate})`)
      .bind(value.operationId, value.requestHash, this.policyId, this.wrappingProviderId, ...extra);
  }

  private async publish(statement: () => D1PreparedStatement, value: { operationId: string; requestHash: string },
    event: string, predicate: string, extra: (string | number)[] = []): Promise<LocalMaterialRegistryResult> {
    try {
      const results = await this.database.batch([
        statement(),
        // Trigger writes inflate D1 meta.changes. Check direct changes() AND the
        // publication in the same transaction, never a racy post-commit lookup.
        this.database.prepare(`select changes() as directChanges, case when changes()=0 or exists (
          select 1 from local_material_registry_events event join local_material_reservations reservation on reservation.id=event.reservation_id
          where reservation.id=?1 and reservation.request_hash=?2 and event.event_type=?3
        ) then 1 else json('local_material_publication_incomplete') end as verified`)
          .bind(value.operationId, value.requestHash, event),
        this.readStatement(value, predicate, extra),
      ]);
      const direct = (results[1]?.results?.[0] as { directChanges?: unknown } | undefined)?.directChanges;
      if (direct !== 0 && direct !== 1) throw new Error();
      const row = results[2]?.results?.[0];
      if (!row) return outcome('conflict');
      return Object.freeze({ status: direct === 1 ? 'stored' : 'replayed', operation: this.project(row) });
    } catch { throw new Error('Local material registry unavailable.'); }
  }

  private project(input: unknown): LocalMaterialRegistryOperation {
    const row = fields(input, ['operationId', 'requestHash', 'state', 'keyId', 'createdAt', 'expiresAt', 'retireReason',
      'receiptId', 'envelopeHash', 'envelopeBytes', 'currentHead']);
    if (!['preparing', 'prepared', 'committed', 'retired'].includes(row.state as string) ||
      typeof row.keyId !== 'string' || !keyIdPattern.test(identifier(row.keyId)) ||
      typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 ||
      typeof row.expiresAt !== 'number' || row.expiresAt !== row.createdAt + LOCAL_MATERIAL_RESERVATION_MS ||
      !Number.isSafeInteger(row.expiresAt) || (row.currentHead !== 0 && row.currentHead !== 1)) throw new TypeError();
    if (row.state === 'committed') {
      operationIdentifier(row.receiptId); digest(row.envelopeHash);
      if (typeof row.envelopeBytes !== 'number' || !Number.isSafeInteger(row.envelopeBytes) || row.envelopeBytes < 1 || row.envelopeBytes > 2_097_152) throw new TypeError();
    } else if (row.receiptId !== null || row.envelopeHash !== null || row.envelopeBytes !== null || row.currentHead !== 0) throw new TypeError();
    if ((row.state === 'retired' && !reasons.includes(row.retireReason as RetireReason)) ||
      (row.state !== 'retired' && row.retireReason !== null)) throw new TypeError();
    return Object.freeze({
      operationId: operationIdentifier(row.operationId), requestHash: digest(row.requestHash), state: row.state as State,
      keyId: row.keyId, createdAt: row.createdAt, expiresAt: row.expiresAt,
      receiptId: row.receiptId as string | null, envelopeHash: row.envelopeHash as string | null,
      envelopeBytes: row.envelopeBytes as number | null, retireReason: row.retireReason as RetireReason | null,
      currentHead: row.currentHead === 1,
    });
  }
}
