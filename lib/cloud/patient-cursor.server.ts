import { z } from 'zod';

if (typeof window !== 'undefined') throw new Error('Cloud cursor transport is server-only.');

const id = z.string().min(1).max(160);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const base = { domainVersion: z.literal(1), organizationId: id, facilityId: id,
  assignmentId: id, assignmentVersionId: id };
export const cloudPatientCursorSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('directory'), query: z.string().max(120),
    status: z.enum(['active', 'inactive', 'merged', 'all']), updatedAt: time, patientId: id }).strict(),
  z.object({ ...base, kind: z.literal('profile'), patientId: id,
    profileVersion: z.number().int().positive(), beforeVersion: z.number().int().positive() }).strict(),
  z.object({ ...base, kind: z.literal('encounters'), patientId: id,
    profileVersion: z.number().int().positive(), updatedAt: time, encounterId: id }).strict(),
]);
export type CloudPatientCursor = z.infer<typeof cloudPatientCursorSchema>;

// A cursor carries only a continuation position, never authority or a bearer token.
// Every SQL call independently verifies live session, tenant and current assignment.
export function encodeCloudPatientCursor(value: unknown): string {
  const parsed = cloudPatientCursorSchema.parse(value);
  const result = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
  if (result.length > 2048) throw new Error('Invalid continuation cursor.');
  return result;
}

export function decodeCloudPatientCursor(value: string | null): CloudPatientCursor | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid continuation cursor.');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Invalid continuation cursor.');
  return cloudPatientCursorSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
