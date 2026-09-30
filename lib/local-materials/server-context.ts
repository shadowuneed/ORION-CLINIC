import { z } from 'zod';
import { resolveStaffServerPrincipal } from '../auth/server-principal';
import { hashStaffSessionToken, readStaffSessionCookie, type StaffSessionRepository } from '../auth/staff-session';
import type { LocalMaterialContext } from './lifecycle';

if (typeof window !== 'undefined') throw new Error('Local material context requires server execution');

const identifier = z.string().min(1).max(256).refine(value =>
  value.trim() === value && !/[\p{Cc}\p{Surrogate}]/u.test(value));
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const selectionSchema = z.object({
  accessAssignmentId: identifier, facilityId: identifier, patientId: identifier, encounterId: identifier,
}).strict();

export type LocalMaterialSelection = z.infer<typeof selectionSchema>;
export type LocalMaterialContextReadInput = LocalMaterialSelection & {
  tokenHash: string; userId: string; issuer: string; subject: string;
};
export interface LocalMaterialContextSnapshotReader {
  /** One coherent final DB-clock read. Never accept the input as a trusted grant. */
  readSnapshot(input: LocalMaterialContextReadInput): Promise<unknown | null>;
}

export const localMaterialConsentTypes = [
  'care', 'transcript_storage', 'audio_retention', 'transient_audio_processing', 'external_ai_processing',
] as const;
type ContextConsentType = typeof localMaterialConsentTypes[number];
const consentSchema = z.object({
  type: z.enum(localMaterialConsentTypes), eventId: identifier, version: positive,
  decision: z.enum(['granted', 'denied', 'withdrawn']), effectiveAt: instant, expiresAt: instant.nullable(),
  policyVersion: identifier, policyHash: identifier, externalProcessor: identifier.nullable(),
}).strict().refine(value => value.expiresAt === null || value.expiresAt > value.effectiveAt);
const consentListSchema = z.array(consentSchema).max(5).refine(value => new Set(value.map(item => item.type)).size === value.length);

const rowSchema = z.object({
  observedAt: positive, sessionId: identifier, userVersion: positive,
  membershipVersion: positive, organizationVersion: positive, facilityVersion: positive,
  assignmentVersion: positive, assignmentVersionId: identifier,
  departmentVersion: positive, departmentVersionId: identifier,
  encounterVersion: positive, patientVersion: positive, patientVersionId: identifier.nullable(),
  membershipId: identifier, organizationId: identifier, facilityId: identifier,
  departmentId: identifier, accessAssignmentId: identifier,
  userId: identifier, issuer: identifier, subject: identifier,
  patientId: identifier, encounterId: identifier,
  encounterStatus: z.enum(['draft', 'ready', 'in_progress', 'review', 'finalized', 'amended', 'cancelled']),
  canManage: z.union([z.literal(0), z.literal(1)]),
  consentsIntegrity: z.literal(1), consentsJson: z.string().max(65_536),
});
type ContextConsent = Readonly<z.infer<typeof consentSchema> & {
  /** Temporal decision only: NOT processor/policy approval or permission to act. */
  effectiveByTime: boolean;
}>;
export type ResolvedLocalMaterialContext = Readonly<{
  status: 'resolved';
  observedAt: number;
  context: LocalMaterialContext;
  versions: Readonly<{ user: number; membership: number; organization: number; facility: number;
    assignment: number; department: number; patient: number; encounter: number }>;
  consents: Readonly<Record<ContextConsentType, ContextConsent | null>>;
}>;
export type LocalMaterialContextResolution = ResolvedLocalMaterialContext | Readonly<{
  status: 'invalid-request' | 'unauthenticated' | 'forbidden' | 'unavailable';
}>;

const consentPins = {
  care: 'care', transcript_storage: 'transcriptStorage', audio_retention: 'audioRetention',
  transient_audio_processing: 'transientAudioProcessing', external_ai_processing: 'externalAiProcessing',
} as const;

/**
 * Unmounted ONLINE-1C1a metadata-only boundary. No transcript, audio, key release,
 * IndexedDB, v1 adoption, patient identity, role selection or clinical mutation.
 * Missing/denied consent remains visible as metadata to the assigned doctor; a
 * resolved snapshot DOES NOT grant a material read/write/capture/export action.
 * The caller must reauthorize the exact action, current consent/processor/policy
 * and current session at its publication/commit boundary. This is not an offline
 * entitlement and cannot invalidate already-read bytes. Do not cache as authority.
 */
export async function resolveLocalMaterialContext(
  headers: Headers,
  selection: unknown,
  dependencies: { sessions: StaffSessionRepository; contexts: LocalMaterialContextSnapshotReader },
): Promise<LocalMaterialContextResolution> {
  try {
    const selected = selectionSchema.safeParse(selection);
    if (!selected.success) return Object.freeze({ status: 'invalid-request' });
    // Capture the cookie before any await; a mutable Headers object must not
    // change the final-query session after the initial identity was resolved.
    const capturedHeaders = new Headers(headers);
    const cookie = readStaffSessionCookie(capturedHeaders);
    if (cookie.status !== 'present') return Object.freeze({ status: 'unauthenticated' });
    const identity = await resolveStaffServerPrincipal(capturedHeaders, dependencies.sessions);
    if (identity.status !== 'authenticated') return Object.freeze({ status: identity.status });
    const input: LocalMaterialContextReadInput = {
      ...selected.data, tokenHash: await hashStaffSessionToken(cookie.token),
      userId: identity.identity.user.id, issuer: identity.identity.principal.issuer, subject: identity.identity.principal.subject,
    };
    const raw = await dependencies.contexts.readSnapshot(Object.freeze(input));
    // Uniform denial avoids disclosing whether a requested patient/encounter or
    // another employee's assignment exists. A concurrent logout can reach here.
    if (raw === null) return Object.freeze({ status: 'forbidden' });
    const row = rowSchema.parse(raw);
    for (const field of ['userId', 'issuer', 'subject', 'accessAssignmentId', 'facilityId', 'patientId', 'encounterId'] as const) {
      if (row[field] !== input[field]) return Object.freeze({ status: 'unavailable' });
    }
    const entries = consentListSchema.parse(JSON.parse(row.consentsJson));
    const consents = {} as Record<ContextConsentType, ContextConsent | null>;
    const versions = {} as Record<typeof consentPins[ContextConsentType], number | null>;
    for (const type of localMaterialConsentTypes) {
      const consent = entries.find(entry => entry.type === type);
      consents[type] = consent ? Object.freeze({
        ...consent,
        effectiveByTime: consent.decision === 'granted' && consent.effectiveAt <= row.observedAt &&
          (consent.expiresAt === null || consent.expiresAt > row.observedAt),
      }) : null;
      versions[consentPins[type]] = consent?.version ?? null;
    }
    // A non-bearer change fingerprint for local operation fencing, NOT a signed
    // grant or a complete revocation log. No raw session ID/hash enters the DTO.
    // Ignore touch/observation time, but include temporal consent transitions and
    // exact head IDs as well as versions; A->regrant cannot reuse an old head.
    const fingerprint = JSON.stringify([
      'orion-local-context-v1', row.sessionId, row.userId, row.issuer, row.subject, row.userVersion,
      row.organizationId, row.organizationVersion, row.facilityId, row.facilityVersion,
      row.departmentId, row.membershipId, row.membershipVersion, row.accessAssignmentId,
      row.assignmentVersionId, row.assignmentVersion, row.departmentVersionId, row.departmentVersion,
      row.patientId, row.patientVersion, row.patientVersionId,
      row.encounterId, row.encounterVersion, row.encounterStatus, row.canManage,
      localMaterialConsentTypes.map(type => consents[type]),
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const generation = `context-v1:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
    return Object.freeze({
      status: 'resolved', observedAt: row.observedAt,
      context: Object.freeze({
        audience: 'staff', userId: row.userId, issuer: row.issuer, subject: row.subject,
        organizationId: row.organizationId, facilityId: row.facilityId,
        accessAssignmentId: row.accessAssignmentId, patientId: row.patientId, encounterId: row.encounterId,
        authorizationGeneration: generation, consentVersions: Object.freeze(versions),
      }),
      versions: Object.freeze({ user: row.userVersion, membership: row.membershipVersion,
        organization: row.organizationVersion, facility: row.facilityVersion, assignment: row.assignmentVersion,
        department: row.departmentVersion, patient: row.patientVersion, encounter: row.encounterVersion }),
      consents: Object.freeze(consents),
    });
  } catch {
    // Error details may contain identities, tokens or SQL. Do not expose/log them.
    return Object.freeze({ status: 'unavailable' });
  }
}
