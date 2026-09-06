import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  MultipleSchedulingAccessSelectionRequiredError,
  SchedulingPermissionRequiredError,
  hasSchedulingPermission,
  requireSchedulingPermission,
  resolveSchedulingAccess,
  schedulingCapabilities,
} from './scheduling-access';
import type { IdentityPrincipal } from './workspace-access';

const NOW = Date.UTC(2026, 8, 6, 12, 0);
const principal: IdentityPrincipal = {
  issuer: 'openai:sites',
  subject: 'scheduling-user',
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
    effectivePermissions: ['scheduling.manage', 'access.self.read'],
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

describe('scheduling access', () => {
  it('gives a clinician scheduling and in-room controls', () => {
    expect(hasSchedulingPermission('clinician', 'appointment.hold')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.arrive')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.call')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.start_service')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.complete')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'appointment.no_show')).toBe(true);
  });

  it('gives a registrar front-desk controls but no clinical completion', () => {
    expect(hasSchedulingPermission('registrar', 'appointment.hold')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'queue.arrive')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'queue.call')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'appointment.no_show')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'queue.complete')).toBe(false);
  });

  it('fails closed for unsupported actions', () => {
    expect(() =>
      requireSchedulingPermission('registrar', 'queue.start_service'),
    ).toThrow(SchedulingPermissionRequiredError);
    expect(schedulingCapabilities('registrar')['queue.start_service']).toBe(false);
  });

  it('reserves hold expiry for a trusted process instead of an interactive role', () => {
    expect(hasSchedulingPermission('clinician', 'appointment.expire')).toBe(false);
    expect(hasSchedulingPermission('registrar', 'appointment.expire')).toBe(false);
  });

  it('resolves one exact doctor or registrar assignment', async () => {
    await expect(
      resolveSchedulingAccess(
        repository([assignment()]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).resolves.toMatchObject({
      scope: {
        accessAssignmentId: 'assignment-a',
        membershipId: 'membership-a',
        role: 'clinician',
      },
    });

    const registrar = assignment({
      assignmentId: 'assignment-registrar',
      assignmentVersionId: 'assignment-registrar-v1',
      roles: ['registrar'],
      membership: {
        id: 'membership-registrar',
        legacyRole: 'registrar',
        status: 'active',
      },
    });
    await expect(
      resolveSchedulingAccess(
        repository([registrar]),
        principal,
        registrar.assignmentId,
        'fac-a',
        NOW,
      ),
    ).resolves.toMatchObject({
      scope: { role: 'registrar', membershipId: 'membership-registrar' },
    });
  });

  it('requires exact selection for two eligible assignments in one facility', async () => {
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
    const unresolved = resolveSchedulingAccess(
      repository([assignment(), second]),
      principal,
      undefined,
      'fac-a',
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultipleSchedulingAccessSelectionRequiredError,
    );
    await expect(unresolved).rejects.toMatchObject({
      assignments: [
        { assignmentId: 'assignment-a', departmentName: 'Therapy' },
        { assignmentId: 'assignment-b', departmentName: 'Diagnostics' },
      ],
    });
  });

  it('honors exact deny and never falls back to another assignment', async () => {
    const denied = assignment({
      denyPermissions: ['scheduling.manage'],
      effectivePermissions: ['access.self.read'],
    });
    await expect(
      resolveSchedulingAccess(
        repository([denied, assignment({ assignmentId: 'assignment-b' })]),
        principal,
        denied.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('fails closed for inactive, expired, service and mismatched assignments', async () => {
    await expect(
      resolveSchedulingAccess(
        repository([assignment({ status: 'revoked' })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveSchedulingAccess(
        repository([assignment({ effectiveUntil: NOW })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveSchedulingAccess(
        repository([assignment({ roles: ['doctor', 'service'] })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveSchedulingAccess(
        repository([assignment()]),
        principal,
        'assignment-a',
        'fac-other',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
  });

  it('gives doctor precedence when one assignment contains both roles', async () => {
    await expect(
      resolveSchedulingAccess(
        repository([assignment({ roles: ['registrar', 'doctor'] })]),
        principal,
        'assignment-a',
        'fac-a',
        NOW,
      ),
    ).resolves.toMatchObject({ scope: { role: 'clinician' } });
  });
});
