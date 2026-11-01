import { z } from 'zod';

const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const time = z.string().datetime({ precision: 3 });
const version = z.number().int().positive().max(2147483647);
const text = z.string().trim().max(20000);
export const clinicalActorSchema = z.object({ issuer: z.string().min(1).max(256), subject: z.string().min(1).max(256) }).strict();
export type ClinicalActor = z.infer<typeof clinicalActorSchema>;
export const clinicalNoteContentSchema = z.object({ complaints: text, history: text, examination: text, assessment: text, plan: text }).strict();
export type ClinicalNoteContent = z.infer<typeof clinicalNoteContentSchema>;
export const clinicalPatientSchema = z.object({ id, name: z.string().min(1).max(160), mrn: z.string().min(1).max(160), sex: z.enum(['female','male','unknown']), birthDate: z.string().date().nullable() }).strict();
export const clinicalPractitionerSchema = z.object({ id, staffId: id, name: z.string().min(1).max(160), specialty: z.string().min(1).max(160) }).strict();
export const clinicalEncounterSchema = z.object({ id, patientId: id, practitionerId: id, visitId: id.nullable(), referralId: id.nullable(), status: z.enum(['in_progress','completed']), version, currentNoteId: id.nullable(), publishedNoteId: id.nullable(), createdAt: time, updatedAt: time }).strict();
export const clinicalNoteSchema = z.object({ id, encounterId: id, patientId: id, practitionerId: id, version, content: clinicalNoteContentSchema, source: z.enum(['clinician','ai_assisted']), status: z.enum(['draft','published']), createdAt: time, publishedAt: time.nullable() }).strict();
export const clinicalReferralSchema = z.object({ id, patientId: id, encounterId: id, sourcePractitionerId: id, recipientPractitionerId: id, noteId: id, reason: z.string().min(1).max(4000), priority: z.enum(['routine','urgent']), status: z.enum(['pending','accepted','declined','revoked']), version, resultingEncounterId: id.nullable(), createdAt: time, updatedAt: time }).strict();
export const clinicalConsentSchema = z.object({ encounterId: id, care: z.boolean(), transcriptStorage: z.boolean(), localAudioProcessing: z.boolean(), externalAiProcessing: z.boolean(), version }).strict();
export const clinicalTranscriptSchema = z.object({ id, encounterId: id, sequence: version, role: z.enum(['doctor','patient','unknown']), language: z.enum(['ru','kk','auto']), text: z.string().min(1).max(20000), startedAtMs: z.number().int().nonnegative(), endedAtMs: z.number().int().nonnegative(), createdAt: time }).strict();
export const clinicalSnapshotSchema = z.object({
  schemaVersion: z.literal(1), clinicId: id, practitioner: clinicalPractitionerSchema,
  practitioners: z.array(clinicalPractitionerSchema).max(200), patients: z.array(clinicalPatientSchema).max(1000),
  encounters: z.array(clinicalEncounterSchema).max(2000), notes: z.array(clinicalNoteSchema).max(4000),
  referrals: z.array(clinicalReferralSchema).max(2000), consents: z.array(clinicalConsentSchema).max(2000),
  transcript: z.array(clinicalTranscriptSchema).max(4000), generatedAt: time,
}).strict();
export type ClinicalSnapshot = z.infer<typeof clinicalSnapshotSchema>;
const base = { idempotencyKey: z.string().uuid() };
const encounter = { encounterId: id, expectedVersion: version };
export const clinicalCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('patient.register'), name: z.string().trim().min(2).max(160), birthDate: z.string().date().nullable(), sex: z.enum(['female','male','unknown']) }).strict(),
  z.object({ ...base, type: z.literal('encounter.start'), patientId: id, visitId: id.optional() }).strict(),
  z.object({ ...base, type: z.literal('note.save'), ...encounter, content: clinicalNoteContentSchema, source: z.enum(['clinician','ai_assisted']) }).strict(),
  z.object({ ...base, type: z.literal('note.publish'), ...encounter, noteId: id, reviewAcknowledged: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('encounter.complete'), ...encounter }).strict(),
  z.object({ ...base, type: z.literal('consent.record'), ...encounter, care: z.boolean(), transcriptStorage: z.boolean(), localAudioProcessing: z.boolean(), externalAiProcessing: z.boolean().default(false), patientConfirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('referral.create'), ...encounter, recipientPractitionerId: id, reason: z.string().trim().min(1).max(4000), priority: z.enum(['routine','urgent']), reviewAcknowledged: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('referral.accept'), referralId: id, expectedVersion: version }).strict(),
  z.object({ ...base, type: z.literal('referral.decline'), referralId: id, expectedVersion: version, reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ ...base, type: z.literal('referral.revoke'), referralId: id, expectedVersion: version, reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export type ClinicalCommand = z.infer<typeof clinicalCommandSchema>;
// Browser command parsing must never accept this union; only the trusted local
// speech bridge may submit authenticated, bounded provider results.
export const clinicalTranscriptAppendSchema = z.object({ ...base, type: z.literal('transcript.append'), encounterId: id,
  sessionId: z.string().uuid(), utteranceIndex: z.number().int().nonnegative().max(100000), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().trim().min(1).max(20000), role: z.enum(['doctor','patient','unknown']), language: z.enum(['ru','kk','auto']),
  startedAtMs: z.number().int().nonnegative().max(86400000), endedAtMs: z.number().int().nonnegative().max(86400000),
}).strict().refine(v => v.endedAtMs >= v.startedAtMs, 'Invalid segment interval');
export const clinicalInternalCommandSchema = z.union([clinicalCommandSchema, clinicalTranscriptAppendSchema]);
export type ClinicalInternalCommand = z.infer<typeof clinicalInternalCommandSchema>;
export const clinicalCommandResultSchema = z.object({ resourceId: id, encounterId: id.nullable(), version, replayed: z.boolean() }).strict();
export type ClinicalCommandResult = z.infer<typeof clinicalCommandResultSchema>;
