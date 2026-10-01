import { z } from 'zod';
import { observationContexts, observationValuesSchema } from '@/lib/domain/observations';
import { CLOUD_OBSERVATION_SOURCE, type CloudObservationTransportScope } from './observation-latest-contract.server';
import { cloudObservationCursorSchema, encodeCloudObservationCursor, requireCloudObservationCursorScope,
  type CloudObservationCursor } from './observation-cursor.server';

if (typeof window !== 'undefined') throw new Error('Cloud observation contracts are server-only.');

const clean = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum)
  .refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const id = clean(1, 160);
const version = z.number().int().positive().max(2147483647);
const time = z.number().int().min(946684800000).max(Number.MAX_SAFE_INTEGER);
const scaled = (minimum: number, maximum: number, scale: number) => z.number().min(minimum).max(maximum)
  .refine(value => Math.abs(value * scale - Math.round(value * scale)) < 0.000001);
const values = observationValuesSchema.safeExtend({
  heightCm: scaled(40, 250, 10).nullable(), weightKg: scaled(1, 500, 1000).nullable(),
  temperatureC: scaled(30, 45, 1000).nullable(), bmi: scaled(5, 100, 100).nullable(),
}).refine(value => {
  if (value.heightCm === null || value.weightKg === null) return value.bmi === null;
  return value.bmi !== null && Math.round(value.bmi * 100) ===
    Math.round(Math.round(value.weightKg * 1000) * 100000 / Math.round(value.heightCm * 10) ** 2);
});
const patient = z.object({ id, displayName: clean(2, 300), medicalRecordNumber: clean(1, 300) }).strict();
const observationVersion = z.object({ id, version, supersedesVersionId: id.nullable(), measuredAt: time,
  context: z.enum(observationContexts), values,
  units: z.object({ height: z.literal('cm'), weight: z.literal('kg'), bmi: z.literal('kg/m²'),
    pressure: z.literal('мм рт. ст.'), temperature: z.literal('°C') }).strict(),
  note: clean(3, 1000).nullable(), sourceType: z.literal('manual_test'), sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE),
  recordedByMembershipId: id, accessAssignmentId: id, recordedBy: clean(2, 300), recordedAt: time,
  changeReason: clean(3, 500), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => (value.version === 1) === (value.supersedesVersionId === null) && value.supersedesVersionId !== value.id);
const page = z.object({ hasMore: z.boolean(), nextCursor: cloudObservationCursorSchema.nullable() }).strict()
  .refine(value => value.hasMore === (value.nextCursor !== null));
const record = z.object({ id, patient, current: observationVersion, history: z.array(observationVersion).min(1).max(1),
  historyCount: version, currentVersion: version, historyPage: page }).strict();
const envelope = z.object({ organizationId: id, facilityId: id, patientId: id, accessAssignmentId: id,
  assignmentVersionId: id, role: z.enum(['clinician', 'nurse']), timeZone: clean(1, 100),
  sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE), observedAt: time, clinicalInterpretation: z.literal('not_performed') }).strict();
type Envelope = z.infer<typeof envelope>;
type Version = z.infer<typeof observationVersion>;
type RecordDto = z.infer<typeof record>;

function checkedEnvelope(value: Envelope, scope: CloudObservationTransportScope) {
  if (value.organizationId !== scope.organizationId || value.facilityId !== scope.facilityId ||
    value.patientId !== scope.patientId || value.accessAssignmentId !== scope.accessAssignmentId) throw new Error('Inconsistent observation scope.');
  try { new Intl.DateTimeFormat('ru', { timeZone: value.timeZone }); }
  catch { throw new Error('Invalid observation time zone.'); }
}
function checkedTime(value: Version, observedAt: number) {
  if (value.recordedAt > observedAt || value.measuredAt > observedAt + 300000) throw new Error('Inconsistent observation time.');
}
function checkedPage(value: z.infer<typeof page>, scope: Envelope, kind: CloudObservationCursor['kind'],
  observationId?: string, observationVersionNumber?: number, allowOldAssignmentVersion = false) {
  const cursor = value.nextCursor;
  requireCloudObservationCursorScope(cursor, scope, kind, observationId);
  if (cursor && ((!allowOldAssignmentVersion && cursor.assignmentVersionId !== scope.assignmentVersionId) ||
    (observationVersionNumber !== undefined && cursor.observationVersion !== observationVersionNumber))) throw new Error('Inconsistent observation continuation.');
  return { hasMore: value.hasMore, nextCursor: cursor ? encodeCloudObservationCursor(cursor) : null };
}
function checkedRecord(value: RecordDto, scope: Envelope, allowOldAssignmentVersion = false) {
  checkedTime(value.current, scope.observedAt);
  if (value.patient.id !== scope.patientId || value.currentVersion !== value.current.version || value.historyCount !== value.currentVersion ||
    JSON.stringify(value.history[0]) !== JSON.stringify(value.current) || value.historyPage.hasMore !== (value.currentVersion > 1)) {
    throw new Error('Inconsistent observation record/history window.');
  }
  const cursor = value.historyPage.nextCursor;
  if (cursor && (cursor.kind !== 'observation_history' || cursor.beforeVersion !== value.current.version)) throw new Error('Inconsistent history position.');
  return { ...value, historyPage: checkedPage(value.historyPage, scope, 'observation_history', value.id, value.currentVersion, allowOldAssignmentVersion) };
}
function after(left: RecordDto, right: RecordDto) {
  return right.current.measuredAt < left.current.measuredAt || (right.current.measuredAt === left.current.measuredAt &&
    (right.current.recordedAt < left.current.recordedAt || (right.current.recordedAt === left.current.recordedAt && right.id > left.id)));
}

export function parseCloudObservationsPage(value: unknown, scope: CloudObservationTransportScope,
  options: { limit?: number; cursor?: CloudObservationCursor | null } = {}) {
  const result = envelope.extend({ patient, observations: z.array(record).max(50), page }).strict().parse(value);
  checkedEnvelope(result, scope);
  if (result.patient.id !== scope.patientId || new Set(result.observations.map(item => item.id)).size !== result.observations.length ||
    result.observations.length > (options.limit ?? 50) || (result.page.hasMore && result.observations.length !== (options.limit ?? 50)) ||
    !result.observations.every((item, index) => JSON.stringify(item.patient) === JSON.stringify(result.patient) &&
      (index === 0 || after(result.observations[index - 1], item)))) throw new Error('Inconsistent observation page/order.');
  const last = result.observations.at(-1);
  const cursor = result.page.nextCursor;
  if (cursor && (cursor.kind !== 'observations' || cursor.observationId !== last?.id || cursor.observationVersion !== last.currentVersion ||
    cursor.measuredAt !== last.current.measuredAt || cursor.recordedAt !== last.current.recordedAt)) throw new Error('Inconsistent observation position.');
  if (options.cursor?.kind === 'observations' && result.observations[0]) {
    const first = result.observations[0];
    const anchor = options.cursor;
    if (!(first.current.measuredAt < anchor.measuredAt || (first.current.measuredAt === anchor.measuredAt &&
      (first.current.recordedAt < anchor.recordedAt || (first.current.recordedAt === anchor.recordedAt && first.id > anchor.observationId))))) {
      throw new Error('Observation continuation did not advance.');
    }
  }
  return { ...result, observations: result.observations.map(item => checkedRecord(item, result)), page: checkedPage(result.page, result, 'observations') };
}

export function parseCloudObservationHistoryPage(value: unknown, scope: CloudObservationTransportScope, observationId: string,
  options: { limit?: number; cursor?: CloudObservationCursor | null } = {}) {
  const result = envelope.extend({ observationId: id, observationVersion: version, items: z.array(observationVersion).max(50), page }).strict().parse(value);
  checkedEnvelope(result, scope);
  const requested = options.cursor;
  const upper = requested?.kind === 'observation_history' ? requested.beforeVersion - 1 : result.observationVersion;
  const last = result.items.at(-1);
  if (result.observationId !== observationId || (requested && (requested.kind !== 'observation_history' ||
    result.observationVersion !== requested.observationVersion)) || result.items.length > (options.limit ?? 50) ||
    result.items[0]?.version !== (upper === 0 ? undefined : upper) ||
    result.items.some((item, index) => item.version > result.observationVersion || (index > 0 &&
      (result.items[index - 1].version !== item.version + 1 || result.items[index - 1].supersedesVersionId !== item.id ||
        result.items[index - 1].recordedAt < item.recordedAt))) ||
    new Set(result.items.map(item => item.id)).size !== result.items.length ||
    result.page.hasMore !== Boolean(last && last.version > 1) ||
    (result.page.hasMore && result.items.length !== (options.limit ?? 50))) throw new Error('Inconsistent observation history window.');
  const cursor = result.page.nextCursor;
  if (cursor && (cursor.kind !== 'observation_history' || cursor.beforeVersion !== last?.version)) throw new Error('Inconsistent observation history position.');
  result.items.forEach(item => checkedTime(item, result.observedAt));
  return { ...result, historyCount: result.observationVersion, currentVersion: result.observationVersion,
    page: checkedPage(result.page, result, 'observation_history', observationId, result.observationVersion) };
}

export function parseCloudObservationMutation(value: unknown, scope: CloudObservationTransportScope,
  command: { observationId?: string; expectedVersion?: number }) {
  const result = envelope.extend({ observation: record, replayed: z.boolean() }).strict().parse(value);
  checkedEnvelope(result, scope);
  if ((command.observationId !== undefined && result.observation.id !== command.observationId) ||
    result.observation.currentVersion !== (command.expectedVersion === undefined ? 1 : command.expectedVersion + 1)) throw new Error('Inconsistent observation mutation.');
  // A committed receipt retains its exact command-time patient label and nested
  // history cursor. Only replayed=true may retain an older assignment version;
  // root tenant/patient/assignment/record bindings still must match fresh authority.
  return { ...result, observation: checkedRecord(result.observation, result, result.replayed) };
}
