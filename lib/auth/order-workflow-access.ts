import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';

export type OrderAccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
};

export type OrderWorkflowAccessScope = {
  organizationId: string;
  facilityId: string;
  userId: string;
  membershipId: string;
  accessAssignmentId: string;
  // Transitional repository discriminator. orders.manage allows this route to
  // select the assignment, while only a doctor assignment may cross the
  // repository's clinician-only clinical-action boundary.
  role: 'clinician' | 'registrar';
};

export type OrderWorkflowAccess = {
  principal: IdentityPrincipal;
  assignment: AccessAssignmentSummary;
  assignments: OrderAccessAssignmentOption[];
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  scope: OrderWorkflowAccessScope;
};

export class MultipleOrderAccessSelectionRequiredError extends Error {
  constructor(public readonly assignments: OrderAccessAssignmentOption[]) {
    super('An order-workflow access assignment must be selected');
    this.name = 'MultipleOrderAccessSelectionRequiredError';
  }
}

function toOption(
  assignment: AccessAssignmentSummary,
): OrderAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentName: assignment.department.name,
  };
}

/**
 * Resolves one department assignment with orders.manage. Permissions from two
 * assignments are never combined. The order repository still enforces the
 * exact treating-clinician encounter, current patient, consent and lifecycle.
 */
export async function resolveOrderWorkflowAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
  requestedFacilityId?: string,
  now = Date.now(),
): Promise<OrderWorkflowAccess> {
  const current = (await repository.listPrincipalAssignments(principal))
    .filter((assignment) => isAccessAssignmentCurrentlyActive(assignment, now))
    .filter((assignment) => !assignment.roles.includes('service'));

  if (current.length === 0) {
    throw new AccessMembershipRequiredError();
  }

  let selected: AccessAssignmentSummary | undefined;
  if (requestedAssignmentId) {
    selected = current.find(
      (assignment) => assignment.assignmentId === requestedAssignmentId,
    );
    if (!selected) throw new AccessAssignmentNotFoundError();
    if (requestedFacilityId && selected.facility.id !== requestedFacilityId) {
      throw new AccessAssignmentNotFoundError();
    }
  } else {
    const candidates = current.filter(
      (assignment) =>
        (!requestedFacilityId ||
          assignment.facility.id === requestedFacilityId) &&
        assignment.effectivePermissions.includes('orders.manage'),
    );
    if (candidates.length === 0) {
      throw new AccessPermissionRequiredError('orders.manage');
    }
    if (candidates.length > 1) {
      throw new MultipleOrderAccessSelectionRequiredError(
        candidates.map(toOption),
      );
    }
    [selected] = candidates;
  }

  if (!selected.effectivePermissions.includes('orders.manage')) {
    throw new AccessPermissionRequiredError('orders.manage');
  }

  const assignments = current
    .filter((assignment) =>
      assignment.effectivePermissions.includes('orders.manage'),
    )
    .map(toOption)
    .sort((left, right) =>
      `${left.organizationName}:${left.facilityName}:${left.departmentName}:${left.assignmentId}`.localeCompare(
        `${right.organizationName}:${right.facilityName}:${right.departmentName}:${right.assignmentId}`,
      ),
    );

  return {
    principal,
    assignment: selected,
    assignments,
    user: { id: selected.user.id, displayName: selected.user.displayName },
    organization: {
      id: selected.organization.id,
      name: selected.organization.name,
    },
    facility: { id: selected.facility.id, name: selected.facility.name },
    scope: {
      organizationId: selected.organization.id,
      facilityId: selected.facility.id,
      userId: selected.user.id,
      membershipId: selected.membership.id,
      accessAssignmentId: selected.assignmentId,
      role: selected.roles.includes('doctor') ? 'clinician' : 'registrar',
    },
  };
}
