import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), save: vi.fn(), enroll: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
vi.mock('@/lib/auth/site-identity', () => ({
  getSiteIdentity: () => ({ id: 'isolated-test-identity' }),
  toSiteIdentityPrincipal: () => ({ issuer: 'test', subject: 'isolated-test-identity' }),
}));
vi.mock('@/lib/auth/chronic-care-access', async (original) => ({
  ...await original<typeof import('@/lib/auth/chronic-care-access')>(),
  resolveChronicCareAccess: mocks.resolve,
}));
vi.mock('@/lib/repositories/chronic-care-workflow', async (original) => ({
  ...await original<typeof import('@/lib/repositories/chronic-care-workflow')>(),
  D1ChronicCareWorkflowRepository: class { saveSignedPlan = mocks.save; createEnrollment = mocks.enroll; },
}));
import { POST } from './route';
import { POST as enroll } from '../enrollments/route';

function enrollmentRequest() {
  return new Request('https://orion.test/api/care/enrollments', {
    method: 'POST', headers: { origin: 'https://orion.test', 'content-type': 'application/json' },
    body: JSON.stringify({ facilityId: 'fac-test', accessAssignmentId: 'selected-test-assignment',
      patientId: 'patient-test', basisEncounterId: 'encounter-test', basisProtocolVersionId: 'protocol-test',
      registryCode: 'TEST', diagnosisDisplay: 'Synthetic label', diagnosisCode: null,
      diagnosisBasis: 'Synthetic basis for permission test', doctorConfirmed: true,
      localSourceAcknowledged: true, reason: 'Synthetic test',
      idempotencyKey: '734f439c-9697-437d-8433-a097288b16cc' }),
  });
}

function request() {
  return new Request('https://orion.test/api/care/plans', {
    method: 'POST', headers: { origin: 'https://orion.test', 'content-type': 'application/json' },
    body: JSON.stringify({
      facilityId: 'fac-test', accessAssignmentId: 'selected-test-assignment',
      enrollmentId: 'enrollment-test', expectedEnrollmentVersion: 1, expectedPlanVersion: null,
      doctorConfirmed: true, localSourceAcknowledged: true, reason: 'Synthetic API boundary check',
      idempotencyKey: '734f439c-9697-437d-8433-a097288b16cc',
      content: {
        effectiveFrom: '2026-09-15', effectiveTo: '2026-10-15', goals: ['Synthetic goal'],
        treatmentPlan: 'Synthetic treatment text', dietPlan: 'Synthetic diet text', medications: [],
        tasks: [{ key: 'followup', kind: 'follow_up_visit', title: 'Synthetic followup',
          dueDate: '2026-10-01', ownerRole: 'clinician', assignedMembershipId: 'member-test', instructions: null }],
      },
    }),
  });
}

describe('care plan API role boundary (isolated, no live database)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ id: 'plan-test' }); });
  it('rejects nurse enrollment before any repository write', async () => {
    mocks.resolve.mockResolvedValue({ scope: { role: 'nurse' } });
    const response = await enroll(enrollmentRequest());
    expect(response.status).toBe(403);
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it('passes clinician enrollment to the existing persistence boundary', async () => {
    mocks.resolve.mockResolvedValue({ scope: { role: 'clinician' } });
    mocks.enroll.mockResolvedValue({ id: 'enrollment-test' });
    expect((await enroll(enrollmentRequest())).status).toBe(201);
    expect(mocks.enroll).toHaveBeenCalledOnce();
  });
  it('rejects nurse even when the request claims doctor confirmation', async () => {
    mocks.resolve.mockResolvedValue({ scope: { role: 'nurse' } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('CHRONIC_CARE_FORBIDDEN');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('allows resolved clinician through to repository without changing selected scope', async () => {
    mocks.resolve.mockResolvedValue({ scope: { role: 'clinician' } });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'selected-test-assignment', 'fac-test');
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});
