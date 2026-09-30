import { z } from 'zod';

/** Future, synthetic-only contract. This is not a credential verifier or a mounted API.
 * All facts, current pins and time must come from trusted server adapters, never
 * request JSON/headers. The caller still owes durable audit and a final DB recheck.
 */
export const PATIENT_PROTOCOL_PROJECTION_POLICY = 'synthetic_patient_protocol_view_v1';

export const patientProtocolSectionCodes = [
  'complaints', 'history_of_present_illness', 'past_medical_history',
  'allergy_status', 'objective_findings', 'preliminary_diagnosis',
  'examination_plan', 'treatment_plan',
] as const;

const id = z.string().min(1).max(200).regex(/^[^\s\u0000-\u001f\u007f]+$/u);
const version = z.number().int().positive().safe();
const time = z.number().int().positive().safe();
const hash = z.string().length(64).regex(/^[a-f0-9]+$/);
const name = z.string().min(1).max(200).refine(value => value.trim().length > 0);
const scope = { organizationId: id, facilityId: id, patientId: id };

const inputSchema = z.strictObject({
  now: time,
  principal: z.strictObject({
    audience: z.literal('patient'), verification: z.literal('server_verified'),
    actorId: id, issuer: id, subject: id, identityVersion: version,
    sessionId: id, status: z.literal('active'), expiresAt: time,
  }),
  relationship: z.strictObject({
    id, version, kind: z.literal('self'), eligibility: z.literal('adult_self'),
    status: z.literal('active'), purpose: z.literal('protocol.read'),
    actorId: id, issuer: id, subject: id, identityVersion: version,
    ...scope, verifiedAt: time, validFrom: time, expiresAt: time.nullable(),
    revokedAt: z.null(),
  }),
  release: z.strictObject({
    id, version, status: z.literal('released'), audience: z.literal('patient_self'),
    ...scope, encounterId: id, protocolId: id, protocolVersion: version,
    sourceHash: hash, projectionPolicy: z.literal(PATIENT_PROTOCOL_PROJECTION_POLICY),
    releasedAt: time, effectiveAt: time, expiresAt: time.nullable(), revokedAt: z.null(),
  }),
  source: z.strictObject({
    ...scope, encounterId: id, encounterStatus: z.enum(['finalized', 'amended']),
    protocolId: id, protocolVersion: version, status: z.literal('signed'),
    sourceHash: hash, signedAt: time, signedByDisplayName: name,
    // Bounded input for this first contract; no network/body parsing happens here.
    contentJson: z.string().min(1).max(2_000_000),
  }),
  current: z.strictObject({
    actorId: id, sessionId: id, identityVersion: version,
    relationshipId: id, relationshipVersion: version,
    releaseId: id, releaseVersion: version, signedProtocolId: id,
    organizationStatus: z.literal('active'), facilityStatus: z.literal('active'),
    patientStatus: z.literal('active'),
  }),
});

// Parse only the fields relevant to the patient view; never spread source JSON.
// The full signed source can legitimately contain transcript/provenance/evidence.
// Missing clinical arrays or review states are NOT filled with permissive defaults.
const contentSchema = z.object({
  schemaVersion: z.literal(1), dataMode: z.literal('synthetic-only'),
  encounter: z.object({ id }),
  patient: z.object({ displayName: name }),
  sections: z.array(z.object({
    code: z.enum(patientProtocolSectionCodes), content: z.string().max(80_000),
    reviewState: z.enum(['reviewed', 'explicitly_absent']),
    reviewedByMembershipId: id, reviewedAt: time,
  })).length(8).refine(sections => new Set(sections.map(section => section.code)).size === 8),
  recommendations: z.array(z.object({
    state: z.enum(['accepted', 'edited_and_accepted']),
    effective: z.object({ title: z.string().max(8_000), content: z.string().max(80_000) }),
    reviewedByMembershipId: id, reviewedAt: time,
  })).max(100),
  amendments: z.array(z.object({
    text: z.string().min(1).max(8_000), signedAt: time,
    signedByMembershipId: id, signedByDisplayName: name,
  })).max(100),
});

export type PatientProtocolProjection = {
  schemaVersion: 1;
  dataMode: 'synthetic-only';
  projectionPolicy: typeof PATIENT_PROTOCOL_PROJECTION_POLICY;
  release: { id: string; version: number; releasedAt: number };
  protocol: {
    id: string; version: number; sourceHash: string;
    signedAt: number; signedByDisplayName: string;
  };
  patient: { displayName: string };
  sections: Array<{
    code: (typeof patientProtocolSectionCodes)[number]; content: string;
    reviewState: 'reviewed' | 'explicitly_absent';
  }>;
  recommendations: Array<{ title: string; content: string }>;
  amendments: Array<{ text: string; signedAt: number; signedByDisplayName: string }>;
};

export type PatientProtocolDecision =
  | { allowed: false }
  | { allowed: true; projection: PatientProtocolProjection };

/** No I/O, persistence, logging, session issuance or clinical state transitions.
 * Current pins detect a supplied stale snapshot, not an unseen DB change. A later
 * adapter must resolve them independently and recheck after audit, before bytes.
 * Operational WebCrypto failure throws; it must not become an auth fallback.
 */
export async function evaluatePatientProtocolRelease(input: unknown): Promise<PatientProtocolDecision> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { allowed: false };
  const { now, principal, relationship, release, source, current } = parsed.data;
  if (
    principal.expiresAt <= now || principal.actorId !== current.actorId ||
    principal.sessionId !== current.sessionId || principal.identityVersion !== current.identityVersion ||
    relationship.actorId !== principal.actorId || relationship.issuer !== principal.issuer ||
    relationship.subject !== principal.subject || relationship.identityVersion !== principal.identityVersion ||
    relationship.id !== current.relationshipId || relationship.version !== current.relationshipVersion ||
    relationship.verifiedAt > relationship.validFrom || relationship.validFrom > now ||
    (relationship.expiresAt !== null && relationship.expiresAt <= now) ||
    release.id !== current.releaseId || release.version !== current.releaseVersion ||
    release.releasedAt > release.effectiveAt || release.effectiveAt > now ||
    (release.expiresAt !== null && release.expiresAt <= now) ||
    relationship.organizationId !== release.organizationId || relationship.facilityId !== release.facilityId ||
    relationship.patientId !== release.patientId || source.organizationId !== release.organizationId ||
    source.facilityId !== release.facilityId || source.patientId !== release.patientId ||
    source.encounterId !== release.encounterId || source.protocolId !== release.protocolId ||
    source.protocolId !== current.signedProtocolId || source.protocolVersion !== release.protocolVersion ||
    source.sourceHash !== release.sourceHash || source.signedAt > release.releasedAt
  ) return { allowed: false };

  // Hash the exact immutable string, not a reserialized/trimmed JSON object.
  const bytes = new TextEncoder().encode(source.contentJson);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actualHash !== source.sourceHash) return { allowed: false };

  let rawContent: unknown;
  try { rawContent = JSON.parse(source.contentJson) as unknown; }
  catch { return { allowed: false }; }
  const content = contentSchema.safeParse(rawContent);
  if (!content.success || content.data.encounter.id !== source.encounterId ||
    content.data.sections.some(item => item.reviewedAt > source.signedAt) ||
    content.data.recommendations.some(item => item.reviewedAt > source.signedAt) ||
    content.data.amendments.some(item => item.signedAt > source.signedAt)) return { allowed: false };

  return {
    allowed: true,
    projection: {
      schemaVersion: 1, dataMode: 'synthetic-only', projectionPolicy: PATIENT_PROTOCOL_PROJECTION_POLICY,
      release: { id: release.id, version: release.version, releasedAt: release.releasedAt },
      protocol: {
        id: source.protocolId, version: source.protocolVersion, sourceHash: source.sourceHash,
        signedAt: source.signedAt, signedByDisplayName: source.signedByDisplayName,
      },
      patient: { displayName: content.data.patient.displayName },
      sections: content.data.sections.map(section => ({
        code: section.code, content: section.content, reviewState: section.reviewState,
      })),
      recommendations: content.data.recommendations.map(item => ({
        title: item.effective.title, content: item.effective.content,
      })),
      amendments: content.data.amendments.map(item => ({
        text: item.text, signedAt: item.signedAt, signedByDisplayName: item.signedByDisplayName,
      })),
    },
  };
}
