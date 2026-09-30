import { z } from 'zod';
import { clinicPermissions, organizationRoles, parseAccessAssignment } from '@/lib/domain/access-governance';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import type { PatientContinuationPage, PatientDetail, PatientSummary } from '@/lib/repositories/patient-registry';
import { cloudPatientCursorSchema, encodeCloudPatientCursor } from './patient-cursor.server';

const id = z.string().min(1).max(160);
const text = z.string().min(1).max(300);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const assignment = z.object({
  assignmentId: id, assignmentVersionId: id, assignmentVersion: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'expired']), source: z.enum(['bootstrap', 'administrator']),
  effectiveFrom: time, effectiveUntil: time.nullable(),
  organization: z.object({ id, name: text, status: z.enum(['active', 'suspended']) }).strict(),
  facility: z.object({ id, name: text, status: z.enum(['active', 'suspended']) }).strict(),
  department: z.object({ id, code: text, name: text,
    kind: z.enum(['clinical', 'diagnostic', 'administrative', 'support']), status: z.enum(['active', 'disabled']) }).strict(),
  membership: z.object({ id, legacyRole: z.enum(['clinician', 'nurse', 'registrar', 'administrator', 'auditor']),
    status: z.enum(['active', 'disabled']) }).strict(),
  user: z.object({ id, displayName: text, status: z.enum(['invited', 'active', 'disabled']) }).strict(),
  roles: z.array(z.enum(organizationRoles)).min(1).max(7),
  allowPermissions: z.array(z.enum(clinicPermissions)).max(clinicPermissions.length),
  denyPermissions: z.array(z.enum(clinicPermissions)).max(clinicPermissions.length),
  effectivePermissions: z.array(z.enum(clinicPermissions)).max(clinicPermissions.length),
}).strict();

export const accessOverviewSchema = z.object({
  user: z.object({ id, displayName: text }).strict(), assignments: z.array(assignment).max(200), observedAt: time,
}).strict();

export function parseCloudAccessOverview(value: unknown) {
  const overview = accessOverviewSchema.parse(value);
  const seen = new Set<string>();
  for (const item of overview.assignments) {
    if (seen.has(item.assignmentId) || item.user.id !== overview.user.id || item.user.displayName !== overview.user.displayName) {
      throw new Error('Inconsistent cloud access response.');
    }
    seen.add(item.assignmentId);
    const parsed = parseAccessAssignment({ rolesJson: JSON.stringify(item.roles),
      allowPermissionsJson: JSON.stringify(item.allowPermissions), denyPermissionsJson: JSON.stringify(item.denyPermissions) });
    const supplied = [...item.effectivePermissions].sort();
    if (JSON.stringify([...parsed.effectivePermissions].sort()) !== JSON.stringify(supplied)) {
      throw new Error('Inconsistent cloud permissions.');
    }
  }
  return { ...overview, assignments: overview.assignments as AccessAssignmentSummary[] };
}

const encounterStatus = z.enum(['draft', 'ready', 'in_progress', 'review', 'finalized', 'amended', 'cancelled']);
const patient = z.object({
  id, medicalRecordNumber: text, displayName: text, birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sexAtBirth: z.enum(['female', 'male', 'unknown', 'not_recorded']), status: z.enum(['active', 'inactive', 'merged']),
  testIin: z.string().regex(/^\d{12}$/).nullable(), phone: z.string().max(40).nullable(),
  email: z.string().max(160).nullable(), address: z.string().max(300).nullable(),
  // Object storage is a separate scoped port. Until it is implemented no upstream URL is rendered.
  photoUrl: z.null(), encounterCount: z.number().int().nonnegative(),
  latestEncounter: z.object({ id, status: encounterStatus, reasonForVisit: z.string().max(500).nullable(), updatedAt: time }).strict().nullable(),
  createdAt: time, updatedAt: time, version: z.number().int().positive(),
}).strict();
const encounter = z.object({ id, status: encounterStatus, reasonForVisit: z.string().max(500).nullable(),
    startedAt: time.nullable(), endedAt: time.nullable(), createdAt: time, updatedAt: time,
    version: z.number().int().positive() }).strict();
const profileHistoryEntry = z.object({ id, version: z.number().int().positive(), status: z.enum(['active', 'inactive', 'merged']),
    changeReason: z.string().max(300), createdAt: time, actorDisplayName: text }).strict();
const continuationPage = z.object({ hasMore: z.boolean(), nextCursor: cloudPatientCursorSchema.nullable() }).strict()
  .refine(value => value.hasMore === (value.nextCursor !== null));
const detail = patient.extend({
  encounters: z.array(encounter).max(25),
  profileHistory: z.array(profileHistoryEntry).max(25),
  profileHistoryCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  encountersPage: continuationPage, profileHistoryPage: continuationPage,
}).strict();

function validSummary(value: z.infer<typeof patient>) {
  return (value.encounterCount === 0) === (value.latestEncounter === null);
}
function validEncounterOrder(rows: z.infer<typeof encounter>[]) {
  return rows.every((row, index) => index === 0 || rows[index - 1].updatedAt > row.updatedAt ||
    (rows[index - 1].updatedAt === row.updatedAt && rows[index - 1].id > row.id));
}
function validProfileOrder(rows: z.infer<typeof profileHistoryEntry>[], version: number) {
  return rows.every((row, index) => row.version <= version && (index === 0 || rows[index - 1].version > row.version));
}
function cursorMatchesLast(page: z.infer<typeof continuationPage>, rows: Array<z.infer<typeof encounter> | z.infer<typeof profileHistoryEntry>>) {
  const cursor = page.nextCursor;
  if (!cursor) return true;
  const last = rows.at(-1);
  if (!last) return false;
  if (cursor.kind === 'profile') return cursor.beforeVersion === last.version;
  return cursor.kind === 'encounters' && 'updatedAt' in last &&
    cursor.updatedAt === last.updatedAt && cursor.encounterId === last.id;
}

type CursorScope = { organizationId: string; facilityId: string };
function parsedPage(value: z.infer<typeof continuationPage>, assignmentId: string,
  kind: 'directory' | 'profile' | 'encounters', patientId?: string, version?: number,
  scope?: CursorScope): PatientContinuationPage {
  const cursor = value.nextCursor;
  if (cursor && (cursor.assignmentId !== assignmentId || cursor.kind !== kind ||
      (patientId && cursor.patientId !== patientId) ||
      (cursor.kind !== 'directory' && version !== undefined && cursor.profileVersion !== version) ||
      (scope && (cursor.organizationId !== scope.organizationId || cursor.facilityId !== scope.facilityId)))) {
    throw new Error('Inconsistent cloud continuation scope.');
  }
  // The committing RPC's live assignment version is authoritative. Comparing it
  // to a prior preflight would falsely fail after a concurrent approved grant update.
  // SQL validates the cursor version again before any continuation read.
  return { hasMore: value.hasMore, nextCursor: cursor ? encodeCloudPatientCursor(cursor) : null };
}

function parsedDetail(value: z.infer<typeof detail>, assignmentId: string, scope?: CursorScope): PatientDetail {
  if (!validSummary(value) || value.profileHistoryCount !== value.version || value.profileHistory[0]?.version !== value.version ||
      !validEncounterOrder(value.encounters) || !validProfileOrder(value.profileHistory, value.version) ||
      !cursorMatchesLast(value.encountersPage, value.encounters) || !cursorMatchesLast(value.profileHistoryPage, value.profileHistory) ||
      (value.latestEncounter !== null && (value.encounters[0]?.id !== value.latestEncounter.id ||
        value.encounters[0]?.updatedAt !== value.latestEncounter.updatedAt || value.encounters[0]?.status !== value.latestEncounter.status ||
        value.encounters[0]?.reasonForVisit !== value.latestEncounter.reasonForVisit)) ||
      new Set(value.encounters.map(item => item.id)).size !== value.encounters.length ||
      new Set(value.profileHistory.map(item => item.id)).size !== value.profileHistory.length ||
      value.encounters.length > value.encounterCount || value.profileHistory.length > value.profileHistoryCount ||
      value.encountersPage.hasMore !== (value.encounters.length < value.encounterCount) ||
      value.profileHistoryPage.hasMore !== (value.profileHistory.length < value.profileHistoryCount)) {
    throw new Error('Inconsistent cloud history window.');
  }
  return { ...value, encountersPage: parsedPage(value.encountersPage, assignmentId, 'encounters', value.id, value.version, scope),
    profileHistoryPage: parsedPage(value.profileHistoryPage, assignmentId, 'profile', value.id, value.version, scope) };
}

export function parseCloudPatientListPage(value: unknown, assignmentId: string, scope?: CursorScope) {
  const result = z.object({ patients: z.array(patient).max(50), page: continuationPage,
    accessAssignmentId: id, observedAt: time }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || result.patients.some(item => !validSummary(item)) ||
      new Set(result.patients.map(item => item.id)).size !== result.patients.length) {
    throw new Error('Inconsistent cloud patient scope.');
  }
  const last = result.patients.at(-1);
  if (result.page.nextCursor && (result.page.nextCursor.kind !== 'directory' ||
      result.page.nextCursor.patientId !== last?.id || result.page.nextCursor.updatedAt !== last?.updatedAt)) {
    throw new Error('Inconsistent cloud directory position.');
  }
  if (result.page.hasMore && result.patients.length === 0) throw new Error('Invalid empty continuation.');
  return { patients: result.patients as PatientSummary[], page: parsedPage(result.page, assignmentId, 'directory', undefined, undefined, scope) };
}

export function parseCloudPatientList(value: unknown, assignmentId: string): PatientSummary[] {
  return parseCloudPatientListPage(value, assignmentId).patients;
}

export function parseCloudPatientDetail(value: unknown, assignmentId: string, patientId: string, scope?: CursorScope): PatientDetail | null {
  const result = z.object({ patient: detail.nullable(), accessAssignmentId: id, observedAt: time }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || (result.patient && result.patient.id !== patientId)) {
    throw new Error('Inconsistent cloud patient scope.');
  }
  return result.patient ? parsedDetail(result.patient, assignmentId, scope) : null;
}

export function parseCloudPatientMutation(value: unknown, assignmentId: string, patientId?: string, scope?: CursorScope): PatientDetail {
  const result = z.object({ patient: detail, accessAssignmentId: id, observedAt: time, replayed: z.boolean() }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || (patientId && result.patient.id !== patientId)) {
    throw new Error('Inconsistent cloud patient scope.');
  }
  return parsedDetail(result.patient, assignmentId, scope);
}

export function parseCloudPatientHistoryPage(value: unknown, assignmentId: string, patientId: string,
  kind: 'profile' | 'encounters', scope?: CursorScope, expectedProfileVersion?: number) {
  const common = { page: continuationPage, historyKind: z.literal(kind), patientId: id,
    profileVersion: z.number().int().positive(), accessAssignmentId: id, observedAt: time };
  const result = kind === 'profile'
    ? z.object({ ...common, items: z.array(profileHistoryEntry).max(50) }).strict().parse(value)
    : z.object({ ...common, items: z.array(encounter).max(50) }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || result.patientId !== patientId ||
      (expectedProfileVersion !== undefined && result.profileVersion !== expectedProfileVersion) ||
      new Set(result.items.map(item => item.id)).size !== result.items.length ||
      (result.page.hasMore && result.items.length === 0)) throw new Error('Inconsistent cloud history scope.');
  if (!cursorMatchesLast(result.page, result.items) || (kind === 'profile'
    ? !validProfileOrder(result.items as z.infer<typeof profileHistoryEntry>[], result.profileVersion)
    : !validEncounterOrder(result.items as z.infer<typeof encounter>[]))) throw new Error('Inconsistent cloud history order.');
  return { items: result.items, page: parsedPage(result.page, assignmentId, kind, patientId, result.profileVersion, scope),
    historyKind: kind, patientId, profileVersion: result.profileVersion };
}
