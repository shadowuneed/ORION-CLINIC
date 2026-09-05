import { describe, expect, it } from 'vitest';
import type { ActiveMembership, IdentityPrincipal } from './workspace-access';
import {
  ObservationFacilityNotFoundError,
  ObservationFacilitySelectionRequiredError,
  ObservationMembershipRequiredError,
  hasObservationPermission,
  resolveObservationAccess,
} from './observation-access';

const principal: IdentityPrincipal = {
  issuer: 'sites',
  subject: 'user-a',
  email: 'doctor@example.test',
};

function membership(
  role: ActiveMembership['role'],
  facilityId = 'fac-a',
): ActiveMembership {
  return {
    membershipId: `membership-${role}-${facilityId}`,
    organizationId: `org-${facilityId}`,
    organizationName: `Organization ${facilityId}`,
    facilityId,
    facilityName: `Facility ${facilityId}`,
    userId: 'user-a',
    userDisplayName: 'Тестовый сотрудник',
    role,
  };
}

describe('observation access', () => {
  it('allows clinicians and nurses to record and correct observations', () => {
    expect(hasObservationPermission('clinician', 'observation.record')).toBe(true);
    expect(hasObservationPermission('nurse', 'observation.correct')).toBe(true);
  });

  it('filters out registrar-only membership', async () => {
    const repository = {
      listActiveMemberships: async () => [membership('registrar')],
    };

    await expect(resolveObservationAccess(repository, principal)).rejects.toBeInstanceOf(
      ObservationMembershipRequiredError,
    );
  });

  it('requires an explicit facility when more than one scope is available', async () => {
    const repository = {
      listActiveMemberships: async () => [
        membership('clinician', 'fac-a'),
        membership('nurse', 'fac-b'),
      ],
    };

    await expect(resolveObservationAccess(repository, principal)).rejects.toBeInstanceOf(
      ObservationFacilitySelectionRequiredError,
    );
    await expect(
      resolveObservationAccess(repository, principal, 'fac-c'),
    ).rejects.toBeInstanceOf(ObservationFacilityNotFoundError);
    await expect(
      resolveObservationAccess(repository, principal, 'fac-b'),
    ).resolves.toMatchObject({ scope: { facilityId: 'fac-b', role: 'nurse' } });
  });
});
