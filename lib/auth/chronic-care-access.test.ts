import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  ChronicCarePermissionRequiredError,
  MultipleChronicCareAccessSelectionRequiredError,
  chronicCareCapabilities,
  hasChronicCarePermission,
  requireChronicCarePermission,
  resolveChronicCareAccess,
} from './chronic-care-access';
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
    effectivePermissions: ['care.manage', 'access.self.read'],
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

describe('chronic-care assignment access', () => {
  it('preserves the doctor and nurse action matrix inside one selected assignment', async () => {
    expect(hasChronicCarePermission('clinician', 'enrollment.confirm')).toBe(true);
    expect(hasChronicCarePermission('nurse', 'enrollment.confirm')).toBe(false);
    expect(hasChronicCarePermission('nurse', 'plan.sign')).toBe(false);
    expect(hasChronicCarePermission('nurse', 'task.response')).toBe(true);
    expect(hasChronicCarePermission('nurse', 'task.resolve')).toBe(false);
    expect(chronicCareCapabilities('clinician')['task.resolve']).toBe(true);
    expect(chronicCareCapabilities('clinician')['task.response']).toBe(false);
    expect(() => requireChronicCarePermission('nurse', 'plan.sign')).toThrow(
      ChronicCarePermissionRequiredError,
    );

    await expect(
      resolveChronicCareAccess(
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

    const nurse = assignment({
      assignmentId: 'assignment-nurse',
      assignmentVersionId: 'assignment-nurse-v1',
      membership: {
        id: 'membership-nurse',
        legacyRole: 'registrar',
        status: 'active',
      },
      roles: ['nurse'],
    });
    await expect(
      resolveChronicCareAccess(
        repository([nurse]),
        principal,
        nurse.assignmentId,
        'fac-a',
        NOW,
      ),
    ).resolves.toMatchObject({
      scope: {
        accessAssignmentId: 'assignment-nurse',
        membershipId: 'membership-nurse',
        role: 'nurse',
      },
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
    const unresolved = resolveChronicCareAccess(
      repository([assignment(), second]),
      principal,
      undefined,
      'fac-a',
      NOW,
    );
    await expect(unresolved).rejects.toBeInstanceOf(
      MultipleChronicCareAccessSelectionRequiredError,
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
      denyPermissions: ['care.manage'],
      effectivePermissions: ['access.self.read'],
    });
    await expect(
      resolveChronicCareAccess(
        repository([denied, assignment({ assignmentId: 'assignment-b' })]),
        principal,
        denied.assignmentId,
        'fac-a',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('does not turn an unrelated role grant into a chronic-care actor', async () => {
    const registrar = assignment({
      roles: ['registrar'],
      allowPermissions: ['care.manage'],
    });
    await expect(
      resolveChronicCareAccess(
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
      resolveChronicCareAccess(
        repository([assignment({ status: 'revoked' })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveChronicCareAccess(
        repository([assignment({ effectiveUntil: NOW })]),
        principal,
        undefined,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessMembershipRequiredError);
    await expect(
      resolveChronicCareAccess(
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
      resolveChronicCareAccess(
        repository([assignment()]),
        principal,
        'assignment-a',
        'fac-other',
        NOW,
      ),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
    await expect(
      resolveChronicCareAccess(
        repository([assignment({ roles: ['nurse', 'doctor'] })]),
        principal,
        'assignment-a',
        'fac-a',
        NOW,
      ),
    ).resolves.toMatchObject({ scope: { role: 'clinician' } });
  });
});
