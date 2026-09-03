import { describe, expect, it } from 'vitest';
import {
  AccessibleEncounterNotFoundError,
  type ActiveMembership,
  type AccessibleEncounter,
  ClinicianRoleRequiredError,
  MembershipRequiredError,
  resolveClinicianWorkspaceAccess,
  type WorkspaceAccessRepository,
} from './workspace-access';

const principal = {
  issuer: 'openai:sites',
  subject: 'local_seedy',
  email: 'local@example.test',
};

const clinicianMembership: ActiveMembership = {
  userId: 'user-a',
  userDisplayName: 'Doctor A',
  membershipId: 'membership-a',
  organizationId: 'org-a',
  organizationName: 'Clinic A',
  facilityId: 'fac-a',
  facilityName: 'Facility A',
  role: 'clinician',
};

const encounter: AccessibleEncounter = {
  id: 'encounter-a',
  organizationId: 'org-a',
  organizationName: 'Clinic A',
  facilityId: 'fac-a',
  facilityName: 'Facility A',
  clinicianMembershipId: 'membership-a',
  status: 'in_progress',
  reasonForVisit: 'Synthetic visit',
  startedAt: 1_000,
  updatedAt: 1_000,
  version: 1,
  patient: {
    id: 'patient-a',
    medicalRecordNumber: 'SYN-001',
    displayName: 'Synthetic Patient',
    birthDate: '1984-04-12',
    sexAtBirth: 'female',
  },
};

class StubAccessRepository implements WorkspaceAccessRepository {
  constructor(
    private readonly memberships: ActiveMembership[],
    private readonly encounters: AccessibleEncounter[],
  ) {}

  async listActiveMemberships() {
    return this.memberships;
  }

  async listAssignedEncounters(memberships: readonly ActiveMembership[]) {
    const allowed = new Set(memberships.map((item) => item.membershipId));
    return this.encounters.filter((item) =>
      allowed.has(item.clinicianMembershipId),
    );
  }
}

describe('clinician workspace access', () => {
  it('requires an active membership after identity authentication', async () => {
    await expect(
      resolveClinicianWorkspaceAccess(
        new StubAccessRepository([], []),
        principal,
      ),
    ).rejects.toBeInstanceOf(MembershipRequiredError);
  });

  it('denies a non-clinician membership', async () => {
    await expect(
      resolveClinicianWorkspaceAccess(
        new StubAccessRepository(
          [{ ...clinicianMembership, role: 'registrar' }],
          [encounter],
        ),
        principal,
      ),
    ).rejects.toBeInstanceOf(ClinicianRoleRequiredError);
  });

  it('does not reveal an unassigned or cross-tenant encounter', async () => {
    await expect(
      resolveClinicianWorkspaceAccess(
        new StubAccessRepository([clinicianMembership], [encounter]),
        principal,
        'encounter-b',
      ),
    ).rejects.toBeInstanceOf(AccessibleEncounterNotFoundError);
  });

  it('binds the scope to the exact assigned membership and encounter', async () => {
    const result = await resolveClinicianWorkspaceAccess(
      new StubAccessRepository([clinicianMembership], [encounter]),
      principal,
      'encounter-a',
    );

    expect(result.scope).toEqual({
      organizationId: 'org-a',
      facilityId: 'fac-a',
      encounterId: 'encounter-a',
      reviewerMembershipId: 'membership-a',
    });
    expect(result.user).toEqual({ id: 'user-a', displayName: 'Doctor A' });
  });

  it('selects the newest accessible encounter when none is requested', async () => {
    const newest = { ...encounter, id: 'encounter-new', updatedAt: 2_000 };
    const result = await resolveClinicianWorkspaceAccess(
      new StubAccessRepository(
        [clinicianMembership],
        [newest, encounter],
      ),
      principal,
    );

    expect(result.encounter.id).toBe('encounter-new');
    expect(result.encounters).toHaveLength(2);
  });

  it('prefers a resumable encounter over a newer terminal record', async () => {
    const terminal = {
      ...encounter,
      id: 'encounter-finalized',
      status: 'finalized' as const,
      updatedAt: 5_000,
    };
    const result = await resolveClinicianWorkspaceAccess(
      new StubAccessRepository(
        [clinicianMembership],
        [terminal, encounter],
      ),
      principal,
    );

    expect(result.encounter.id).toBe('encounter-a');
    expect(result.encounters.map((item) => item.id)).toEqual([
      'encounter-a',
      'encounter-finalized',
    ]);
  });
});
