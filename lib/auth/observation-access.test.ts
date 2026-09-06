import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  MultipleObservationAccessSelectionRequiredError,
  hasObservationPermission,
  resolveObservationAccess,
} from './observation-access';
import type { IdentityPrincipal } from './workspace-access';

const NOW = Date.UTC(2026, 8, 6, 12, 0);
const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'observation-user',
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
    effectivePermissions: ['observations.manage', 'access.self.read'],
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

describe('observation assignment access', () => {
  it('keeps doctor and nurse correction semantics inside one selected assignment', async () => {
    expect(hasObservationPermission('clinician', 'observation.record')).toBe(true);
    expect(hasObservationPermission('nurse', 'observation.correct')).toBe(true);

    await expect(
      resolveObservationAccess(repository([assignment()]), principal, undefined, undefined, NOW),
    ).resolves.toMatchObject({
      scope: {
        accessAssignmentId: 'assignment-a',
        membershipId: 'membership-a',
        role: 'clinician',
      },
    });

    const nurse = assignment({
      assignmentId: 'assignment-nurse',
      assignmentVersionId: 'assignment-nurse-v1',
      membership: { id: 'membership-nurse', legacyRole: 'registrar', status: 'active' },
      roles: ['nurse'],
    });
    await expect(
      resolveObservationAccess(repository([nurse]), principal, nurse.assignmentId, 'fac-a', NOW),
    ).resolves.toMatchObject({ scope: { role: 'nurse', membershipId: 'membership-nurse' } });
  });

  it('requires exact selection for two eligible assignments in the same facility', async () => {
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
    const unresolved = resolveObservationAccess(
      repository([assignment(), second]),
      principal,
      undefined,
      'fac-a',
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultipleObservationAccessSelectionRequiredError,
    );
    await expect(unresolved).rejects.toMatchObject({
      assignments: [
        { assignmentId: 'assignment-a', departmentName: 'Therapy' },
        { assignmentId: 'assignment-b', departmentName: 'Diagnostics' },
      ],
    });
  });

  it('honors explicit deny without falling back to another assignment', async () => {
    const denied = assignment({
      denyPermissions: ['observations.manage'],
      effectivePermissions: ['access.self.read'],
    });
    await expect(
      resolveObservationAccess(
        repository([denied, assignment({ assignmentId: 'assignment-b' })]),
        principal,
        denied.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('does not turn a registrar explicit grant into a clinical actor', async () => {
    const registrar = assignment({
      roles: ['registrar'],
      allowPermissions: ['observations.manage'],
    });
    await expect(
      resolveObservationAccess(repository([registrar]), principal, registrar.assignmentId, 'fac-a', NOW),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('fails closed for inactive, expired and service assignments', async () => {
    await expect(
      resolveObservationAccess(repository([assignment({ status: 'revoked' })]), principal, undefined, undefined, NOW),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveObservationAccess(repository([assignment({ effectiveUntil: NOW })]), principal, undefined, undefined, NOW),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveObservationAccess(repository([assignment({ roles: ['doctor', 'service'] })]), principal, undefined, undefined, NOW),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });

  it('validates selected facility and gives doctor precedence for a mixed role', async () => {
    await expect(
      resolveObservationAccess(repository([assignment()]), principal, 'assignment-a', 'fac-other', NOW),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
    await expect(
      resolveObservationAccess(
        repository([assignment({ roles: ['nurse', 'doctor'] })]),
        principal,
        'assignment-a',
        'fac-a',
        NOW,
      ),
    ).resolves.toMatchObject({ scope: { role: 'clinician' } });
  });
});
