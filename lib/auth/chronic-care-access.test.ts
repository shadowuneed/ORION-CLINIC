import { describe, expect, it } from 'vitest';
import type { ActiveMembership } from './workspace-access';
import {
  ChronicCareFacilitySelectionRequiredError,
  ChronicCarePermissionRequiredError,
  chronicCareCapabilities,
  hasChronicCarePermission,
  requireChronicCarePermission,
  resolveChronicCareAccess,
} from './chronic-care-access';

const clinician: ActiveMembership = {
  userId: 'user-a',
  userDisplayName: 'Doctor A',
  membershipId: 'membership-a',
  organizationId: 'org-a',
  organizationName: 'Clinic A',
  facilityId: 'fac-a',
  facilityName: 'Facility A',
  role: 'clinician',
};

const principal = { issuer: 'test', subject: 'user-a', email: null };

describe('chronic-care access', () => {
  it('keeps doctor-only enrollment and plan signing separate from nurse work', () => {
    expect(hasChronicCarePermission('clinician', 'enrollment.confirm')).toBe(true);
    expect(hasChronicCarePermission('nurse', 'enrollment.confirm')).toBe(false);
    expect(hasChronicCarePermission('nurse', 'plan.sign')).toBe(false);
    expect(hasChronicCarePermission('nurse', 'task.response')).toBe(true);
    expect(hasChronicCarePermission('nurse', 'task.resolve')).toBe(false);
    expect(chronicCareCapabilities('clinician')['task.resolve']).toBe(true);
    expect(chronicCareCapabilities('clinician')['task.response']).toBe(false);
    expect(chronicCareCapabilities('clinician')['task.escalate']).toBe(false);
    expect(() =>
      requireChronicCarePermission('nurse', 'plan.sign'),
    ).toThrow(ChronicCarePermissionRequiredError);
  });

  it('prefers a clinician membership when the same user has two care roles', async () => {
    const access = await resolveChronicCareAccess(
      {
        listActiveMemberships: async () => [
          { ...clinician, role: 'nurse', membershipId: 'membership-nurse' },
          clinician,
        ],
      },
      principal,
    );
    expect(access.scope).toMatchObject({
      facilityId: 'fac-a',
      role: 'clinician',
      membershipId: 'membership-a',
    });
  });

  it('requires an explicit facility when care memberships span facilities', async () => {
    await expect(
      resolveChronicCareAccess(
        {
          listActiveMemberships: async () => [
            clinician,
            {
              ...clinician,
              membershipId: 'membership-b',
              facilityId: 'fac-b',
              facilityName: 'Facility B',
              role: 'nurse',
            },
          ],
        },
        principal,
      ),
    ).rejects.toBeInstanceOf(ChronicCareFacilitySelectionRequiredError);
  });
});
