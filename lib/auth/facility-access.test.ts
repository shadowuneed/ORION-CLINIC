import { describe, expect, it } from 'vitest';
import {
  FacilityAccessNotFoundError,
  MultipleFacilitySelectionRequiredError,
  PatientDirectoryMembershipRequiredError,
  PatientProfilePermissionRequiredError,
  patientProfilePermissions,
  requirePatientProfilePermission,
  resolveFacilityAccess,
} from './facility-access';
import type { ActiveMembership, IdentityPrincipal } from './workspace-access';

const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'local_seedy',
  email: 'doctor@example.test',
};

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

function repository(memberships: ActiveMembership[]) {
  return {
    async listActiveMemberships() {
      return memberships;
    },
  };
}

describe('facility patient-directory access', () => {
  it('resolves a clinician without requiring an existing encounter', async () => {
    const result = await resolveFacilityAccess(repository([clinician]), principal);
    expect(result.scope).toEqual({
      organizationId: 'org-a',
      facilityId: 'fac-a',
      userId: 'user-a',
      membershipId: 'membership-a',
      role: 'clinician',
    });
  });

  it('allows registrar demographics access', async () => {
    const result = await resolveFacilityAccess(
      repository([{ ...clinician, role: 'registrar' }]),
      principal,
    );
    expect(result.scope.role).toBe('registrar');
  });

  it('denies memberships that do not have patient-directory access', async () => {
    await expect(
      resolveFacilityAccess(
        repository([{ ...clinician, role: 'administrator' }]),
        principal,
      ),
    ).rejects.toBeInstanceOf(PatientDirectoryMembershipRequiredError);
  });

  it('requires an explicit facility when more than one scope is available', async () => {
    const result = resolveFacilityAccess(
      repository([
        clinician,
        {
          ...clinician,
          membershipId: 'membership-b',
          facilityId: 'fac-b',
          facilityName: 'Facility B',
        },
      ]),
      principal,
    );
    await expect(result).rejects.toBeInstanceOf(MultipleFacilitySelectionRequiredError);
    await expect(result).rejects.toMatchObject({
      facilities: [
        { facilityId: 'fac-a', facilityName: 'Facility A' },
        { facilityId: 'fac-b', facilityName: 'Facility B' },
      ],
    });
  });

  it('does not reveal an inaccessible requested facility', async () => {
    await expect(
      resolveFacilityAccess(repository([clinician]), principal, 'fac-b'),
    ).rejects.toBeInstanceOf(FacilityAccessNotFoundError);
  });

  it('makes patient profile mutation permissions explicit for current directory roles', () => {
    expect(patientProfilePermissions('clinician')).toEqual({
      canUpdate: true,
      canArchive: true,
    });
    expect(patientProfilePermissions('registrar')).toEqual({
      canUpdate: true,
      canArchive: true,
    });
  });

  it('denies profile mutation to a role outside the temporary permission matrix', () => {
    expect(() =>
      requirePatientProfilePermission(
        'nurse' as 'clinician',
        'patient.update',
      ),
    ).toThrow(PatientProfilePermissionRequiredError);
  });
});
