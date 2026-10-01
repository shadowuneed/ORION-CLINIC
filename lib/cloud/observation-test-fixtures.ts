// Unit-test fixtures only. Never imported by a page, route or production provider.
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import { CLOUD_OBSERVATION_SOURCE } from './observation-latest-contract.server';

export const observationNow = 1790840000000;
export const observationScope = { organizationId: 'org-a', facilityId: 'facility-a', patientId: 'patient-a', accessAssignmentId: 'assignment-a' };
export const observationPatient = { id: 'patient-a', displayName: 'Синтетический пациент', medicalRecordNumber: 'SYN-TEST-1' };
export const observationEnvelope = () => ({ ...observationScope, assignmentVersionId: 'assignment-version-a',
  role: 'clinician' as const, timeZone: 'Asia/Almaty', sourceLabel: CLOUD_OBSERVATION_SOURCE, observedAt: observationNow,
  clinicalInterpretation: 'not_performed' as const });
export const observationCursorBase = () => ({ domainVersion: 1 as const, organizationId: observationScope.organizationId,
  facilityId: observationScope.facilityId, patientId: observationScope.patientId, assignmentId: observationScope.accessAssignmentId,
  assignmentVersionId: 'assignment-version-a' });
export const historyCursor = (version = 2, beforeVersion = version, observationId = 'observation-a') => ({ ...observationCursorBase(),
  kind: 'observation_history' as const, observationId, observationVersion: version, beforeVersion });
export const observationVersion = (version = 1) => ({ id: `observation-version-${version}`, version,
  supersedesVersionId: version === 1 ? null : `observation-version-${version - 1}`,
  measuredAt: observationNow - 10000, context: 'pre_visit' as const,
  values: { heightCm: 165, weightKg: 64, bmi: 23.51, systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 36.5 },
  units: { height: 'cm' as const, weight: 'kg' as const, bmi: 'kg/m²' as const, pressure: 'мм рт. ст.' as const, temperature: '°C' as const },
  note: null, sourceType: 'manual_test' as const, sourceLabel: CLOUD_OBSERVATION_SOURCE,
  recordedByMembershipId: 'membership-a', accessAssignmentId: 'assignment-a', recordedBy: 'Синтетический сотрудник',
  recordedAt: observationNow - 10000 + version, changeReason: 'Синтетический ручной ввод', inputHash: 'a'.repeat(64) });
export const observationRecord = (version = 1, observationId = 'observation-a') => {
  const current = observationVersion(version);
  return { id: observationId, patient: { ...observationPatient }, current, history: [{ ...current }], historyCount: version,
    currentVersion: version, historyPage: { hasMore: version > 1, nextCursor: version > 1 ? historyCursor(version, version, observationId) : null } };
};
export const observationList = (version = 1) => ({ ...observationEnvelope(), patient: { ...observationPatient },
  observations: [observationRecord(version)], page: { hasMore: false, nextCursor: null } });
export const observationMutation = (version = 1, replayed = false) => ({ ...observationEnvelope(), observation: observationRecord(version), replayed });
export const observationCommand = () => ({ facilityId: 'facility-a', accessAssignmentId: 'assignment-a', patientId: 'patient-a',
  measuredAt: observationNow - 10000, context: 'pre_visit', values: { heightCm: 165, weightKg: 64,
    systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 36.5 }, note: null, reason: 'Синтетический ручной ввод',
  syntheticDataAcknowledged: true, idempotencyKey: 'f035904c-c835-4e0f-8875-b2317eec480c' });
export const observationAssignment = (overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary => ({
  assignmentId: 'assignment-a', assignmentVersionId: 'assignment-version-a', assignmentVersion: 1,
  status: 'active', source: 'administrator', effectiveFrom: observationNow - 100000, effectiveUntil: null,
  organization: { id: 'org-a', name: 'Синтетическая клиника', status: 'active' }, facility: { id: 'facility-a', name: 'Синтетический корпус', status: 'active' },
  department: { id: 'department-a', name: 'Терапия', code: 'therapy', kind: 'clinical', status: 'active' },
  membership: { id: 'membership-a', legacyRole: 'clinician', status: 'active' }, user: { id: 'staff-a', displayName: 'Синтетический сотрудник', status: 'active' },
  roles: ['doctor'], allowPermissions: [], denyPermissions: [], effectivePermissions: ['observations.manage'], ...overrides,
});
