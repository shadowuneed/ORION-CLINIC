import { describe, expect, it } from 'vitest';
import { decodeCloudPatientCursor, encodeCloudPatientCursor } from './patient-cursor.server';
import { parseCloudPatientDetail, parseCloudPatientHistoryPage, parseCloudPatientListPage } from './response-contracts';

const base = { domainVersion: 1, organizationId: 'org-a', facilityId: 'facility-a',
  assignmentId: 'assignment-a', assignmentVersionId: 'version-a' };
const directory = { ...base, kind: 'directory', query: '', status: 'active', updatedAt: 1, patientId: 'patient-a' };
const profile = { ...base, kind: 'profile', patientId: 'patient-a', profileVersion: 2, beforeVersion: 2 };
const encounterCursor = { ...base, kind: 'encounters', patientId: 'patient-a', profileVersion: 2, updatedAt: 1, encounterId: 'encounter-a' };
const scope = { organizationId: 'org-a', facilityId: 'facility-a', assignmentVersionId: 'version-a' };
const end = { hasMore: false, nextCursor: null };
const patient = { id: 'patient-a', medicalRecordNumber: 'SYN-1', displayName: 'Synthetic patient', birthDate: null,
  sexAtBirth: 'female', status: 'active', testIin: null, phone: null, email: null, address: null, photoUrl: null,
  encounterCount: 0, latestEncounter: null, createdAt: 1, updatedAt: 1, version: 2 };
const row = { id: 'profile-2', version: 2, status: 'active', changeReason: 'Synthetic update', createdAt: 1, actorDisplayName: 'Synthetic employee' };
const detail = { ...patient, encounters: [], encountersPage: end, profileHistory: [row], profileHistoryCount: 2,
  profileHistoryPage: { hasMore: true, nextCursor: profile } };

describe('bounded patient continuation contract', () => {
  it.each([directory, profile, encounterCursor])('round-trips a strict cursor without treating it as authority', value => {
    expect(decodeCloudPatientCursor(encodeCloudPatientCursor(value))).toEqual(value);
  });
  it('only null means the initial page', () => {
    expect(decodeCloudPatientCursor(null)).toBeNull();
    expect(() => decodeCloudPatientCursor('')).toThrow();
  });
  it.each(['a'.repeat(2049), 'e30=', 'e30/', 'eyJraW5kIjoiZGlyZWN0b3J5In0', '_w', 'Zg'])('rejects malformed/oversized cursor %s', value => {
    expect(() => decodeCloudPatientCursor(value)).toThrow();
  });
  it.each([
    { ...directory, unexpectedField: 'not-authority' }, { ...directory, domainVersion: 2 }, { ...directory, updatedAt: -1 },
    { ...directory, patientId: 'x'.repeat(161) }, { ...directory, status: 'deleted' },
    { ...profile, beforeVersion: 0 }, { ...encounterCursor, updatedAt: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects unexpected or invalid database cursor', value => { expect(() => encodeCloudPatientCursor(value)).toThrow(); });
  it('exposes bounded URL continuation and retains explicit more metadata', () => {
    const result = parseCloudPatientListPage({ patients: [patient], page: { hasMore: true, nextCursor: directory },
      accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a', scope);
    expect(result.page.hasMore).toBe(true);
    expect(decodeCloudPatientCursor(result.page.nextCursor)).toEqual(directory);
    const resultDetail = parseCloudPatientDetail({ patient: detail, accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a', 'patient-a', scope);
    expect(resultDetail?.profileHistoryCount).toBe(2);
    expect(decodeCloudPatientCursor(resultDetail?.profileHistoryPage?.nextCursor ?? null)).toEqual(profile);
  });
  it.each(['organizationId', 'facilityId', 'assignmentId'])('rejects mismatched continuation %s', field => {
    expect(() => parseCloudPatientListPage({ patients: [patient], page: { hasMore: true, nextCursor: { ...directory, [field]: 'other' } },
      accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a', scope)).toThrow();
  });
  it('uses the RPC current assignment version instead of a stale preflight version', () => {
    const updated = { ...profile, assignmentVersionId: 'version-new' };
    const result = parseCloudPatientDetail({ patient: { ...detail, profileHistoryPage: { hasMore: true, nextCursor: updated } },
      accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a', 'patient-a', scope);
    expect(decodeCloudPatientCursor(result?.profileHistoryPage?.nextCursor ?? null)).toEqual(updated);
  });
  it.each([{ hasMore: true, nextCursor: null }, { hasMore: false, nextCursor: directory }])('rejects incomplete page metadata', page => {
    expect(() => parseCloudPatientListPage({ patients: [patient], page, accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a')).toThrow();
  });
  it('rejects legacy unbounded detail, inconsistent totals and duplicate versions', () => {
    for (const invalid of [
      { ...detail, profileHistoryPage: undefined }, { ...detail, profileHistoryCount: 0 },
      { ...detail, profileHistory: [row, row] }, { ...detail, profileHistory: Array(26).fill(row) },
      { ...detail, profileHistoryPage: end },
      { ...detail, profileHistoryPage: { hasMore: true, nextCursor: { ...profile, profileVersion: 1 } } },
    ]) expect(() => parseCloudPatientDetail({ patient: invalid, accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a', 'patient-a')).toThrow();
  });
  it('validates each history kind separately with exact patient/version/scope', () => {
    const value = { items: [row], page: end, historyKind: 'profile', patientId: 'patient-a', profileVersion: 2,
      accessAssignmentId: 'assignment-a', observedAt: 1 };
    expect(parseCloudPatientHistoryPage(value, 'assignment-a', 'patient-a', 'profile', scope).items).toEqual([row]);
    expect(() => parseCloudPatientHistoryPage(value, 'assignment-a', 'patient-a', 'encounters', scope)).toThrow();
    expect(() => parseCloudPatientHistoryPage(value, 'assignment-b', 'patient-a', 'profile', scope)).toThrow();
    expect(() => parseCloudPatientHistoryPage(value, 'assignment-a', 'patient-b', 'profile', scope)).toThrow();
    expect(() => parseCloudPatientHistoryPage({ ...value, items: [row, row] }, 'assignment-a', 'patient-a', 'profile', scope)).toThrow();
    expect(() => parseCloudPatientHistoryPage({ ...value, items: [], page: { hasMore: true, nextCursor: profile } }, 'assignment-a', 'patient-a', 'profile', scope)).toThrow();
  });
});
