import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  MultiplePatientAccessSelectionRequiredError,
  resolvePatientDirectoryAccess,
} from './patient-directory-access';
import type { IdentityPrincipal } from './workspace-access';

const NOW = Date.UTC(2026, 8, 6, 12, 0);
const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'patient-directory-user',
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
    effectiveFrom: NOW - 1,
    effectiveUntil: null,
    organization: { id: 'org-a', name: 'Clinic A', status: 'active' },
    facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
    department: {
      id: 'department-a',
      code: 'therapy',
      name: 'Therapy',
      kind: 'clinical',
      status: 'active',
    },
    membership: {
      id: 'membership-a',
      legacyRole: 'clinician',
      status: 'active',
    },
    user: { id: 'user-a', displayName: 'Doctor A', status: 'active' },
    roles: ['doctor'],
    allowPermissions: [],
    denyPermissions: [],
    effectivePermissions: [
      'patient.directory.read',
      'patient.profile.write',
      'encounter.manage',
    ],
    ...overrides,
  };
}

function repository(
  assignments: AccessAssignmentSummary[],
): AccessGovernanceRepository {
  return {
    async listPrincipalAssignments(received) {
      expect(received).toEqual(principal);
      return assignments;
    },
  };
}

describe('patient directory assignment access', () => {
  it('derives the repository scope from one effective assignment', async () => {
    const selected = assignment();

    await expect(
      resolvePatientDirectoryAccess(
        repository([selected]),
        principal,
        'patient.directory.read',
        undefined,
        undefined,
        NOW,
      ),
    ).resolves.toMatchObject({
      assignment: { assignmentId: 'assignment-a' },
      scope: {
        organizationId: 'org-a',
        facilityId: 'fac-a',
        membershipId: 'membership-a',
        userId: 'user-a',
        role: 'clinician',
      },
    });
  });

  it('never merges two eligible assignments and requires an explicit choice', async () => {
    const second = assignment({
      assignmentId: 'assignment-b',
      assignmentVersionId: 'assignment-b-v1',
      department: {
        ...assignment().department,
        id: 'department-b',
        code: 'diagnostics',
        name: 'Diagnostics',
      },
    });

    const unresolved = resolvePatientDirectoryAccess(
      repository([assignment(), second]),
      principal,
      'patient.directory.read',
      undefined,
      'fac-a',
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultiplePatientAccessSelectionRequiredError,
    );
    await expect(unresolved).rejects.toMatchObject({
      assignments: [
        { assignmentId: 'assignment-a' },
        { assignmentId: 'assignment-b' },
      ],
    });
  });

  it('honors explicit deny and a mismatched facility without falling back', async () => {
    const denied = assignment({
      denyPermissions: ['patient.profile.write'],
      effectivePermissions: ['patient.directory.read'],
    });

    await expect(
      resolvePatientDirectoryAccess(
        repository([denied]),
        principal,
        'patient.profile.write',
        denied.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);

    await expect(
      resolvePatientDirectoryAccess(
        repository([assignment()]),
        principal,
        'patient.directory.read',
        'assignment-a',
        'fac-other',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
  });

  it('fails closed for inactive and service-only assignments', async () => {
    await expect(
      resolvePatientDirectoryAccess(
        repository([assignment({ status: 'revoked' })]),
        principal,
        'patient.directory.read',
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);

    await expect(
      resolvePatientDirectoryAccess(
        repository([
          assignment({
            roles: ['service'],
            effectivePermissions: [
              'patient.directory.read',
              'service.integration.execute',
            ],
          }),
        ]),
        principal,
        'patient.directory.read',
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });
});
