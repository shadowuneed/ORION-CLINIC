import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';

export type ObservationRole = 'clinician' | 'nurse';
export const observationPermissions = [
  'workspace.read',
  'observation.record',
  'observation.correct',
] as const;
export type ObservationPermission = (typeof observationPermissions)[number];

export type ObservationScope = {
  organizationId: string;
  facilityId: string;
  userId: string;
  membershipId: string;
  accessAssignmentId: string;
  role: ObservationRole;
};

export type ObservationAccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
  role: ObservationRole;
};

export type ObservationAccess = {
  principal: IdentityPrincipal;
  assignment: AccessAssignmentSummary;
  assignments: ObservationAccessAssignmentOption[];
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  scope: ObservationScope;
};

export class MultipleObservationAccessSelectionRequiredError extends Error {
  constructor(public readonly assignments: ObservationAccessAssignmentOption[]) {
    super('An observation access assignment must be selected');
    this.name = 'MultipleObservationAccessSelectionRequiredError';
  }
}

export class ObservationPermissionRequiredError extends Error {
  constructor(public readonly permission: ObservationPermission) {
    super(`The ${permission} observation permission is required`);
    this.name = 'ObservationPermissionRequiredError';
  }
}

const permissionMatrix: Record<
  ObservationRole,
  ReadonlySet<ObservationPermission>
> = {
  clinician: new Set(observationPermissions),
  nurse: new Set(observationPermissions),
};

export function hasObservationPermission(
  role: ObservationRole,
  permission: ObservationPermission,
) {
  return permissionMatrix[role]?.has(permission) ?? false;
}

export function requireObservationPermission(
  role: ObservationRole,
  permission: ObservationPermission,
) {
  if (!hasObservationPermission(role, permission)) {
    throw new ObservationPermissionRequiredError(permission);
  }
}

export function observationCapabilities(role: ObservationRole) {
  return Object.fromEntries(
    observationPermissions.map((permission) => [
      permission,
      hasObservationPermission(role, permission),
    ]),
  ) as Record<ObservationPermission, boolean>;
}

function observationRole(assignment: AccessAssignmentSummary) {
  if (assignment.roles.includes('doctor')) return 'clinician' as const;
  if (assignment.roles.includes('nurse')) return 'nurse' as const;
  return null;
}

function isObservationAssignment(assignment: AccessAssignmentSummary) {
  return (
    observationRole(assignment) !== null &&
    assignment.effectivePermissions.includes('observations.manage')
  );
}

function toOption(
  assignment: AccessAssignmentSummary,
): ObservationAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentName: assignment.department.name,
    role: observationRole(assignment)!,
  };
}

/**
 * Resolves exactly one current department assignment. Role and permission are
 * always taken from that same assignment; permissions from two assignments are
 * never merged, including assignments in the same facility.
 */
export async function resolveObservationAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
  requestedFacilityId?: string,
  now = Date.now(),
): Promise<ObservationAccess> {
  const current = (await repository.listPrincipalAssignments(principal))
    .filter((assignment) => isAccessAssignmentCurrentlyActive(assignment, now))
    .filter((assignment) => !assignment.roles.includes('service'));

  if (current.length === 0) throw new AccessMembershipRequiredError();

  let selected: AccessAssignmentSummary | undefined;
  if (requestedAssignmentId) {
    selected = current.find(
      (assignment) => assignment.assignmentId === requestedAssignmentId,
    );
    if (!selected) throw new AccessAssignmentNotFoundError();
    if (requestedFacilityId && selected.facility.id !== requestedFacilityId) {
      throw new AccessAssignmentNotFoundError();
    }
    if (!isObservationAssignment(selected)) {
      throw new AccessPermissionRequiredError('observations.manage');
    }
  } else {
    const candidates = current.filter(
      (assignment) =>
        (!requestedFacilityId ||
          assignment.facility.id === requestedFacilityId) &&
        isObservationAssignment(assignment),
    );
    if (candidates.length === 0) {
      throw new AccessPermissionRequiredError('observations.manage');
    }
    if (candidates.length > 1) {
      throw new MultipleObservationAccessSelectionRequiredError(
        candidates.map(toOption),
      );
    }
    [selected] = candidates;
  }

  const role = observationRole(selected);
  if (!role) throw new AccessPermissionRequiredError('observations.manage');

  const assignments = current
    .filter(isObservationAssignment)
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
      role,
    },
  };
}
