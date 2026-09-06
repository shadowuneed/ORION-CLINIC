import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  MultipleOrderAccessSelectionRequiredError,
  resolveOrderWorkflowAccess,
} from './order-workflow-access';
import type { IdentityPrincipal } from './workspace-access';

const NOW = Date.UTC(2026, 8, 6, 12, 0);
const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'orders-user',
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
    effectivePermissions: ['orders.manage', 'access.self.read'],
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

describe('order workflow assignment access', () => {
  it('derives an exact order scope from one effective assignment', async () => {
    await expect(
      resolveOrderWorkflowAccess(
        repository([assignment()]),
        principal,
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
        accessAssignmentId: 'assignment-a',
        role: 'clinician',
      },
    });
  });

  it('requires an explicit choice instead of merging eligible assignments', async () => {
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

    const unresolved = resolveOrderWorkflowAccess(
      repository([assignment(), second]),
      principal,
      undefined,
      'fac-a',
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultipleOrderAccessSelectionRequiredError,
    );
    await expect(unresolved).rejects.toMatchObject({
      assignments: [
        { assignmentId: 'assignment-a' },
        { assignmentId: 'assignment-b' },
      ],
    });
  });

  it('honors explicit deny and does not fall back from a selected assignment', async () => {
    const denied = assignment({
      denyPermissions: ['orders.manage'],
      effectivePermissions: ['access.self.read'],
    });

    await expect(
      resolveOrderWorkflowAccess(
        repository([denied, assignment({ assignmentId: 'assignment-b' })]),
        principal,
        denied.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);

    await expect(
      resolveOrderWorkflowAccess(
        repository([assignment()]),
        principal,
        'assignment-a',
        'fac-other',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
  });

  it('does not turn a non-doctor explicit grant into a clinician', async () => {
    const nurse = assignment({
      roles: ['nurse'],
      allowPermissions: ['orders.manage'],
      effectivePermissions: ['orders.manage', 'access.self.read'],
    });

    await expect(
      resolveOrderWorkflowAccess(
        repository([nurse]),
        principal,
        nurse.assignmentId,
        nurse.facility.id,
        NOW,
      ),
    ).resolves.toMatchObject({
      assignment: { roles: ['nurse'] },
      scope: { role: 'registrar' },
    });
  });

  it('fails closed for inactive and service-only assignments', async () => {
    await expect(
      resolveOrderWorkflowAccess(
        repository([assignment({ status: 'revoked' })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);

    await expect(
      resolveOrderWorkflowAccess(
        repository([
          assignment({
            roles: ['service'],
            effectivePermissions: [
              'orders.manage',
              'service.integration.execute',
            ],
          }),
        ]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });
});
