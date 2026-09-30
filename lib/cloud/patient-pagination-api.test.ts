import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as list } from '@/app/api/patients/route';
import { GET as history } from '@/app/api/patients/[patientId]/history/route';
import { encodeCloudPatientCursor } from './patient-cursor.server';
import { CloudRpcError } from './supabase-rpc.server';

const control = vi.hoisted(() => ({ access: vi.fn(), call: vi.fn() }));
vi.mock('./patient-api.server', async importOriginal => ({
  ...await importOriginal<typeof import('./patient-api.server')>(), cloudPatientAccess: control.access,
}));
const cursorBase = { domainVersion: 1, organizationId: 'org-a', facilityId: 'facility-a',
  assignmentId: 'assignment-a', assignmentVersionId: 'version-a', patientId: 'patient-a' };
const profileCursor = { ...cursorBase, kind: 'profile', profileVersion: 2, beforeVersion: 2 };
const directoryCursor = { ...cursorBase, kind: 'directory', query: '', status: 'active', updatedAt: 1 };
const row = { id: 'profile-1', version: 1, status: 'active', changeReason: 'Synthetic create', createdAt: 1, actorDisplayName: 'Synthetic employee' };
const end = { hasMore: false, nextCursor: null };
const params = { params: Promise.resolve({ patientId: 'patient-a' }) };
const request = (path: string) => new Request(`https://orion.invalid${path}`);

beforeEach(() => {
  control.call.mockReset();
  control.access.mockReset().mockResolvedValue({ database: { call: control.call }, access: {
    user: { id: 'staff-a', displayName: 'Synthetic employee' }, organization: { id: 'org-a' },
    facility: { id: 'facility-a' }, assignment: { assignmentId: 'assignment-a', assignmentVersionId: 'version-new', roles: ['doctor'] },
    assignments: [],
  } });
});
afterEach(() => vi.restoreAllMocks());

describe('cloud patient pagination API', () => {
  it('requests a small directory window and forwards explicit continuation metadata', async () => {
    control.call.mockResolvedValue({ patients: [], page: end, accessAssignmentId: 'assignment-a', observedAt: 1 });
    const response = await list(request('/api/patients'));
    expect(response.status).toBe(200);
    expect(control.call).toHaveBeenCalledWith('orion_patients_list', {
      assignment_id: 'assignment-a', facility_id: 'facility-a', query: null, status: 'active', max_results: 25, cursor: null,
    });
    expect((await response.json() as { page: unknown }).page).toEqual(end);
  });
  it('decodes the directory cursor only for the current independently authorized call', async () => {
    control.call.mockResolvedValue({ patients: [], page: end, accessAssignmentId: 'assignment-a', observedAt: 1 });
    expect((await list(request(`/api/patients?cursor=${encodeCloudPatientCursor(directoryCursor)}`))).status).toBe(200);
    expect(control.access).toHaveBeenCalledOnce();
    expect(control.call.mock.calls[0][1].cursor).toEqual(directoryCursor);
  });
  it.each(['?limit=100', '?limit=0', '?cursor=', '?cursor=bad', '?cursor=e30&cursor=e30',
    `?cursor=${encodeCloudPatientCursor(profileCursor)}`, `?cursor=${'a'.repeat(2049)}`])('rejects invalid directory query before authorization/network %s', async query => {
    expect((await list(request(`/api/patients${query}`))).status).toBe(400);
    expect(control.access).not.toHaveBeenCalled();
    expect(control.call).not.toHaveBeenCalled();
  });
  it('requests only the selected older history kind, matching current patient profile version', async () => {
    control.call.mockResolvedValue({ items: [row], page: end, historyKind: 'profile', patientId: 'patient-a', profileVersion: 2,
      accessAssignmentId: 'assignment-a', observedAt: 1 });
    const response = await history(request(`/api/patients/patient-a/history?kind=profile&cursor=${encodeCloudPatientCursor(profileCursor)}`), params);
    expect(response.status).toBe(200);
    expect(control.call).toHaveBeenCalledWith('orion_patient_history_page', {
      assignment_id: 'assignment-a', facility_id: 'facility-a', patient_id: 'patient-a', history_kind: 'profile', max_results: 25, cursor: profileCursor,
    });
    expect(await response.json()).toMatchObject({ items: [row], page: end, historyKind: 'profile', patientId: 'patient-a', profileVersion: 2 });
  });
  it.each(['?kind=profile', '?kind=profile&cursor=', '?kind=profile&cursor=bad', '?kind=other&cursor=e30',
    `?kind=profile&limit=51&cursor=${encodeCloudPatientCursor(profileCursor)}`,
    `?kind=encounters&cursor=${encodeCloudPatientCursor(profileCursor)}`,
    `?kind=profile&cursor=${encodeCloudPatientCursor({ ...profileCursor, patientId: 'patient-b' })}`])('rejects invalid history before authorization/network %s', async query => {
    expect((await history(request(`/api/patients/patient-a/history${query}`), params)).status).toBe(400);
    expect(control.access).not.toHaveBeenCalled();
  });
  it.each([['conflict', 409], ['invalid', 400], ['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]] as const)(
    'retains current SQL denial %s without leaking private content', async (kind, status) => {
      control.call.mockRejectedValue(new CloudRpcError(kind));
      const response = await history(request(`/api/patients/patient-a/history?kind=profile&cursor=${encodeCloudPatientCursor(profileCursor)}`), params);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain('bearer');
    });
  it('rejects malformed/cross-version upstream page rather than exposing mixed history', async () => {
    control.call.mockResolvedValue({ items: [row], page: end, historyKind: 'profile', patientId: 'patient-a', profileVersion: 3,
      accessAssignmentId: 'assignment-a', observedAt: 1 });
    expect((await history(request(`/api/patients/patient-a/history?kind=profile&cursor=${encodeCloudPatientCursor(profileCursor)}`), params)).status).toBe(503);
  });
});
