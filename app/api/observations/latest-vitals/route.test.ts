import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { ObservationAuditUnavailableError } from '@/lib/repositories/patient-observations';

const mocks = vi.hoisted(() => ({ access: vi.fn(), latest: vi.fn(), audit: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
vi.mock('@/lib/auth/observation-access', async (original) => ({
  ...await original<object>(), resolveObservationAccess: mocks.access,
}));
vi.mock('@/lib/repositories/patient-observations', async (original) => ({
  ...await original<object>(), D1PatientObservationRepository: class {
    latestVitals = mocks.latest;
    recordListRead = mocks.audit;
  },
}));

import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ scope: { organizationId: 'org-a', facilityId: 'fac-a',
    accessAssignmentId: 'assignment-a', membershipId: 'membership-a', userId: 'user-a', role: 'clinician' } });
  mocks.latest.mockResolvedValue({ anthropometry: { observationId: 'observation-a', heightCm: 170, weightKg: 68.2 },
    temperature: { observationId: 'observation-a', temperatureC: 36.6 }, bloodPressure: null });
  mocks.audit.mockResolvedValue(undefined);
});

const authorizedRead = () => GET(new Request('https://orion.test/api/observations/latest-vitals?patientId=patient-a&facilityId=fac-a&accessAssignmentId=assignment-a', {
  headers: { 'oai-authenticated-user-id': 'doctor-a' },
}));

describe('latest patient vitals API boundary', () => {
  it('requires an unambiguous patient and selected scope', async () => {
    for (const suffix of ['', '?patientId=a&patientId=b', '?patientId=a&facilityId=x&facilityId=y', '?patientId=a&accessAssignmentId=x&accessAssignmentId=y']) {
      const response = await GET(new Request(`https://orion.test/api/observations/latest-vitals${suffix}`));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('denies anonymous reads without opening D1', async () => {
    const response = await GET(new Request('https://orion.test/api/observations/latest-vitals?patientId=patient-a&facilityId=fac-a&accessAssignmentId=assignment-a'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it('audits distinct source records then rechecks the same exact assignment before release', async () => {
    const response = await authorizedRead();
    expect(response.status).toBe(200);
    expect(mocks.latest).toHaveBeenCalledWith('patient-a');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'patient-a', resultCount: 1 }));
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(mocks.access.mock.calls[1].slice(2)).toEqual(['assignment-a', 'fac-a']);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not release readings after revoke during loading or audit failure', async () => {
    mocks.access.mockRejectedValueOnce(new AccessPermissionRequiredError('observations.manage'));
    expect((await authorizedRead()).status).toBe(403);
    expect(mocks.latest).not.toHaveBeenCalled();

    mocks.access.mockResolvedValueOnce({ scope: { accessAssignmentId: 'assignment-a', facilityId: 'fac-a' } })
      .mockRejectedValueOnce(new AccessPermissionRequiredError('observations.manage'));
    const revoked = await authorizedRead();
    expect(revoked.status).toBe(403);
    expect(await revoked.text()).not.toContain('170');

    mocks.audit.mockRejectedValueOnce(new ObservationAuditUnavailableError());
    const unavailable = await authorizedRead();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('temperatureC');
  });
});
