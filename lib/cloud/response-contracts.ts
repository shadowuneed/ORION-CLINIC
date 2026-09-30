import { z } from 'zod';
import { clinicPermissions, organizationRoles, parseAccessAssignment } from '@/lib/domain/access-governance';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import type { PatientDetail, PatientSummary } from '@/lib/repositories/patient-registry';

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
const detail = patient.extend({
  encounters: z.array(z.object({ id, status: encounterStatus, reasonForVisit: z.string().max(500).nullable(),
    startedAt: time.nullable(), endedAt: time.nullable(), createdAt: time, updatedAt: time,
    version: z.number().int().positive() }).strict()).max(1000),
  profileHistory: z.array(z.object({ id, version: z.number().int().positive(), status: z.enum(['active', 'inactive', 'merged']),
    changeReason: z.string().max(300), createdAt: time, actorDisplayName: text }).strict()).max(1000),
}).strict();

export function parseCloudPatientList(value: unknown, assignmentId: string): PatientSummary[] {
  const result = z.object({ patients: z.array(patient).max(100), accessAssignmentId: id, observedAt: time }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || new Set(result.patients.map(item => item.id)).size !== result.patients.length) {
    throw new Error('Inconsistent cloud patient scope.');
  }
  return result.patients;
}

export function parseCloudPatientDetail(value: unknown, assignmentId: string, patientId: string): PatientDetail | null {
  const result = z.object({ patient: detail.nullable(), accessAssignmentId: id, observedAt: time }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || (result.patient && result.patient.id !== patientId)) {
    throw new Error('Inconsistent cloud patient scope.');
  }
  return result.patient;
}

export function parseCloudPatientMutation(value: unknown, assignmentId: string, patientId?: string): PatientDetail {
  const result = z.object({ patient: detail, accessAssignmentId: id, observedAt: time, replayed: z.boolean() }).strict().parse(value);
  if (result.accessAssignmentId !== assignmentId || (patientId && result.patient.id !== patientId)) {
    throw new Error('Inconsistent cloud patient scope.');
  }
  return result.patient;
}
