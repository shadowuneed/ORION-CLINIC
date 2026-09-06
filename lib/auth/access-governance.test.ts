import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  InteractiveServiceAccessForbiddenError,
  MultipleAccessSelectionRequiredError,
  resolveAccessOverview,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import type { IdentityPrincipal } from './workspace-access';

const NOW = Date.UTC(2026, 8, 6, 9, 0);

const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'site-user-a',
  email: 'doctor@example.test',
};

function assignment(
  overrides: Partial<AccessAssignmentSummary> = {},
): AccessAssignmentSummary {
  return {
    assignmentId: 'assignment-a',
    assignmentVersionId: 'assignment-a-v1',
    assignmentVersion: 1,
    status: 'active',
    source: 'administrator',
    effectiveFrom: NOW - 60_000,
    effectiveUntil: null,
    organization: {
      id: 'org-a',
      name: 'Clinic A',
      status: 'active',
    },
    facility: {
      id: 'fac-a',
      name: 'Facility A',
      status: 'active',
    },
    department: {
      id: 'department-a',
      code: 'THERAPY',
      name: 'Therapy',
      kind: 'clinical',
      status: 'active',
    },
    membership: {
      id: 'membership-a',
      legacyRole: 'clinician',
      status: 'active',
    },
    user: {
      id: 'user-a',
      displayName: 'Doctor A',
      status: 'active',
    },
    roles: ['doctor'],
    allowPermissions: ['access.self.read'],
    denyPermissions: [],
    effectivePermissions: [
      'access.self.read',
      'encounter.read',
      'encounter.manage',
    ],
    ...overrides,
  };
}

function repository(
  assignments: AccessAssignmentSummary[],
): AccessGovernanceRepository {
  return {
    async listPrincipalAssignments(requestedPrincipal) {
      expect(requestedPrincipal).toEqual(principal);
      return assignments;
    },
  };
}

describe('central access overview', () => {
  it('denies a principal with no department access assignment', async () => {
    await expect(
      resolveAccessOverview(repository([]), principal, undefined, NOW),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });

  it('selects the only current interactive assignment without merging scopes', async () => {
    const current = assignment();

    await expect(
      resolveAccessOverview(repository([current]), principal, undefined, NOW),
    ).resolves.toEqual({
      principal,
      assignments: [current],
      selected: current,
    });
  });

  it.each([
    ['revoked assignment', assignment({ status: 'revoked' })],
    ['expired assignment', assignment({ status: 'expired' })],
    [
      'suspended organization',
      assignment({
        organization: {
          ...assignment().organization,
          status: 'suspended',
        },
      }),
    ],
    [
      'suspended facility',
      assignment({
        facility: { ...assignment().facility, status: 'suspended' },
      }),
    ],
    [
      'disabled department',
      assignment({
        department: { ...assignment().department, status: 'disabled' },
      }),
    ],
    [
      'disabled membership',
      assignment({
        membership: { ...assignment().membership, status: 'disabled' },
      }),
    ],
    [
      'invited user',
      assignment({
        user: { ...assignment().user, status: 'invited' },
      }),
    ],
    [
      'disabled user',
      assignment({
        user: { ...assignment().user, status: 'disabled' },
      }),
    ],
    ['not-yet-effective assignment', assignment({ effectiveFrom: NOW + 1 })],
    ['time-expired assignment', assignment({ effectiveUntil: NOW })],
  ])('denies a principal whose only scope has a %s', async (_label, inactive) => {
    await expect(
      resolveAccessOverview(repository([inactive]), principal, undefined, NOW),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });

  it('returns the same neutral error for unknown and inaccessible requested scopes', async () => {
    const active = assignment();
    const inaccessible = assignment({
      assignmentId: 'assignment-other-tenant',
      assignmentVersionId: 'assignment-other-tenant-v1',
      organization: {
        id: 'org-other',
        name: 'Other Clinic',
        status: 'suspended',
      },
    });

    const unknown = resolveAccessOverview(
      repository([active]),
      principal,
      'assignment-does-not-exist',
      NOW,
    );
    const crossScope = resolveAccessOverview(
      repository([active, inaccessible]),
      principal,
      inaccessible.assignmentId,
      NOW,
    );

    await expect(unknown).rejects.toEqual(new AccessAssignmentNotFoundError());
    await expect(crossScope).rejects.toEqual(new AccessAssignmentNotFoundError());
  });

  it('requires explicit selection when more than one current scope is available', async () => {
    const facilityB = assignment({
      assignmentId: 'assignment-b',
      assignmentVersionId: 'assignment-b-v1',
      facility: {
        id: 'fac-b',
        name: 'Facility B',
        status: 'active',
      },
      department: {
        id: 'department-b',
        code: 'DIAGNOSTICS',
        name: 'Diagnostics',
        kind: 'diagnostic',
        status: 'active',
      },
      allowPermissions: ['access.self.read', 'orders.manage'],
      effectivePermissions: ['access.self.read', 'orders.manage'],
    });
    const facilityA = assignment();

    const unresolved = resolveAccessOverview(
      repository([facilityB, facilityA]),
      principal,
      undefined,
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultipleAccessSelectionRequiredError,
    );
    await expect(unresolved).rejects.toMatchObject({
      assignments: [
        { assignmentId: 'assignment-a' },
        { assignmentId: 'assignment-b' },
      ],
    });

    const resolved = await resolveAccessOverview(
      repository([facilityB, facilityA]),
      principal,
      facilityB.assignmentId,
      NOW,
    );
    expect(resolved.selected).toBe(facilityB);
    expect(resolved.selected.effectivePermissions).toEqual([
      'access.self.read',
      'orders.manage',
    ]);
    expect(resolved.selected.effectivePermissions).not.toContain(
      'encounter.manage',
    );
  });

  it('denies a service role from the interactive self workspace', async () => {
    const service = assignment({
      roles: ['service'],
      allowPermissions: ['access.self.read', 'service.integration.execute'],
      effectivePermissions: [
        'access.self.read',
        'service.integration.execute',
      ],
    });

    await expect(
      resolveAccessOverview(repository([service]), principal, undefined, NOW),
    ).rejects.toBeInstanceOf(InteractiveServiceAccessForbiddenError);
  });

  it('honors an explicit deny of the self-access resource', async () => {
    const denied = assignment({
      allowPermissions: [],
      denyPermissions: ['access.self.read'],
      effectivePermissions: ['clinic.dashboard.read', 'encounter.read'],
    });

    await expect(
      resolveAccessOverview(repository([denied]), principal, undefined, NOW),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });

  it('denies mixed service and human roles from the interactive self workspace', async () => {
    const mixed = assignment({ roles: ['doctor', 'service'] });

    await expect(
      resolveAccessOverview(repository([mixed]), principal, undefined, NOW),
    ).rejects.toBeInstanceOf(InteractiveServiceAccessForbiddenError);
  });
});
