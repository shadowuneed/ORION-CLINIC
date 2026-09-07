import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  MultipleCommunicationAccessSelectionRequiredError,
  resolveCommunicationAccess,
} from './communication-access';
import type { IdentityPrincipal } from './workspace-access';

const NOW = Date.UTC(2026, 8, 6, 12, 0);
const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'care-user',
  email: 'clinician@example.test',
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
      code: 'endocrinology',
      name: 'Endocrinology',
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
    effectivePermissions: ['communications.manage', 'access.self.read'],
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

describe('communication assignment access', () => {
  it.each(['doctor', 'nurse', 'registrar'] as const)('resolves %s from the selected assignment, not legacy membership', async (role) => {
    await expect(resolveCommunicationAccess(repository([assignment({
      roles: [role], membership: { id: 'membership-a', legacyRole: 'administrator', status: 'active' },
    })]), principal, 'assignment-a', 'fac-a', NOW)).resolves.toMatchObject({
      scope: { accessAssignmentId: 'assignment-a', role: role === 'doctor' ? 'clinician' : role },
    });
  });

  it('requires exact selection for two eligible assignments in one facility', async () => {
    const second = assignment({
      assignmentId: 'assignment-b',
      assignmentVersionId: 'assignment-b-v1',
      department: {
        ...assignment().department,
        id: 'department-b',
        code: 'diabetes-school',
        name: 'Diabetes school',
      },
    });
    const unresolved = resolveCommunicationAccess(
      repository([assignment(), second]),
      principal,
      undefined,
      'fac-a',
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultipleCommunicationAccessSelectionRequiredError,
    );
    await expect(unresolved).rejects.toMatchObject({
      assignments: [
        { assignmentId: 'assignment-a', departmentName: 'Endocrinology' },
        { assignmentId: 'assignment-b', departmentName: 'Diabetes school' },
      ],
    });
  });

  it('honors explicit deny without falling back to another assignment', async () => {
    const denied = assignment({
      denyPermissions: ['communications.manage'],
      effectivePermissions: ['access.self.read'],
    });
    await expect(
      resolveCommunicationAccess(
        repository([denied, assignment({ assignmentId: 'assignment-b' })]),
        principal,
        denied.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('does not turn an unrelated role grant into a communication actor', async () => {
    const registrar = assignment({
      roles: ['auditor'],
      allowPermissions: ['communications.manage'],
    });
    await expect(
      resolveCommunicationAccess(
        repository([registrar]),
        principal,
        registrar.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('fails closed for inactive, expired and service assignments', async () => {
    await expect(
      resolveCommunicationAccess(
        repository([assignment({ status: 'revoked' })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveCommunicationAccess(
        repository([assignment({ effectiveUntil: NOW })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveCommunicationAccess(
        repository([assignment({ roles: ['doctor', 'service'] })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });

  it('validates the selected facility and gives doctor precedence within a mixed assignment', async () => {
    await expect(
      resolveCommunicationAccess(
        repository([assignment()]),
        principal,
        'assignment-a',
        'fac-other',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
    await expect(
      resolveCommunicationAccess(
        repository([assignment({ roles: ['nurse', 'doctor'] })]),
        principal,
        'assignment-a',
        'fac-a',
        NOW,
      ),
    ).resolves.toMatchObject({ scope: { role: 'clinician' } });
  });
});
