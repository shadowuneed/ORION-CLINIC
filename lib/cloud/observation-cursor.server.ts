import { z } from 'zod';
import type { CloudObservationTransportScope } from './observation-latest-contract.server';

if (typeof window !== 'undefined') throw new Error('Cloud observation cursors are server-only.');

const id = z.string().min(1).max(160).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const version = z.number().int().positive().max(2147483647);
const time = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const common = { domainVersion: z.literal(1), organizationId: id, facilityId: id, assignmentId: id,
  assignmentVersionId: id, patientId: id, observationId: id, observationVersion: version };
export const cloudObservationCursorSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('observations'), measuredAt: time, recordedAt: time }).strict(),
  z.object({ ...common, kind: z.literal('observation_history'), beforeVersion: version }).strict(),
]).refine(value => value.kind !== 'observation_history' || value.beforeVersion <= value.observationVersion);
export type CloudObservationCursor = z.infer<typeof cloudObservationCursorSchema>;

export class InvalidCloudObservationCursorError extends Error {}

/** Continuation position only, never authority. SQL rechecks the live session, grant and head. */
export function encodeCloudObservationCursor(value: unknown): string {
  const parsed = cloudObservationCursorSchema.parse(value);
  const bytes = Buffer.from(JSON.stringify(parsed), 'utf8');
  const encoded = bytes.toString('base64url');
  if (bytes.byteLength > 1536 || encoded.length > 2048) throw new InvalidCloudObservationCursorError();
  return encoded;
}

export function decodeCloudObservationCursor(value: string | null): CloudObservationCursor | null {
  if (value === null) return null;
  try {
    if (value.length === 0 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.byteLength > 1536 || bytes.toString('base64url') !== value) throw new Error();
    const parsed = cloudObservationCursorSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    // Our encoder emits one canonical JSON shape. Reject duplicate JSON keys,
    // alternate escape/order encodings and any noncanonical continuation token.
    if (encodeCloudObservationCursor(parsed) !== value) throw new Error();
    return parsed;
  } catch { throw new InvalidCloudObservationCursorError(); }
}

export function requireCloudObservationCursorScope(cursor: CloudObservationCursor | null,
  scope: CloudObservationTransportScope, kind: CloudObservationCursor['kind'], observationId?: string) {
  if (cursor && (cursor.kind !== kind || cursor.organizationId !== scope.organizationId || cursor.facilityId !== scope.facilityId ||
    cursor.patientId !== scope.patientId || cursor.assignmentId !== scope.accessAssignmentId ||
    (observationId !== undefined && cursor.observationId !== observationId))) throw new InvalidCloudObservationCursorError();
  // Do not compare a stale preflight assignmentVersionId. The transaction's
  // committing current scope is authoritative and SQL returns409 for stale cursors.
}
