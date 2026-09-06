import {
  AccessAssignmentNotFoundError,
  AccessPermissionRequiredError,
  MultipleAccessSelectionRequiredError,
  isAccessAssignmentCurrentlyActive,
  requireAccessPermission,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import type { IdentityPrincipal } from './workspace-access';

export type AccessAdministrationScope = {
  organizationId: string;
  facilityId: string;
  actorUserId: string;
  actorMembershipId: string;
  actorAssignmentId: string;
  actorAssignmentVersionId: string;
};

export async function resolveAccessAdministration(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
) {
  const assignments = (await repository.listPrincipalAssignments(principal))
    .filter(
      (assignment) =>
        isAccessAssignmentCurrentlyActive(assignment) &&
        !assignment.roles.includes('service') &&
        assignment.effectivePermissions.includes('access.self.read') &&
        assignment.effectivePermissions.includes('access.manage'),
    )
    .sort((left, right) =>
      `${left.organization.name}:${left.facility.name}:${left.department.name}:${left.assignmentId}`
        .localeCompare(
          `${right.organization.name}:${right.facility.name}:${right.department.name}:${right.assignmentId}`,
        ),
    );
  if (assignments.length === 0) {
    throw new AccessPermissionRequiredError('access.manage');
  }
  const selected = requestedAssignmentId
    ? assignments.find(
        (assignment) => assignment.assignmentId === requestedAssignmentId,
      )
    : assignments.length === 1
      ? assignments[0]
      : undefined;
  if (requestedAssignmentId && !selected) {
    throw new AccessAssignmentNotFoundError();
  }
  if (!requestedAssignmentId && assignments.length > 1) {
    throw new MultipleAccessSelectionRequiredError(assignments);
  }
  if (!selected) throw new AccessPermissionRequiredError('access.manage');
  requireAccessPermission(selected, 'access.manage');
  return {
    principal,
    assignments,
    selected,
  };
}

export function toAccessAdministrationScope(
  assignment: AccessAssignmentSummary,
): AccessAdministrationScope {
  requireAccessPermission(assignment, 'access.manage');
  return {
    organizationId: assignment.organization.id,
    facilityId: assignment.facility.id,
    actorUserId: assignment.user.id,
    actorMembershipId: assignment.membership.id,
    actorAssignmentId: assignment.assignmentId,
    actorAssignmentVersionId: assignment.assignmentVersionId,
  };
}
