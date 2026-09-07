import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';

export type ChronicCareRole = 'clinician' | 'nurse';
export const chronicCarePermissions = [
  'workspace.read',
  'enrollment.confirm',
  'plan.sign',
  'task.start',
  'task.response',
  'task.escalate',
  'task.complete',
  'task.resolve',
  'task.cancel',
] as const;
export type ChronicCarePermission = (typeof chronicCarePermissions)[number];

export type ChronicCareScope = {
  organizationId: string;
  facilityId: string;
  userId: string;
  membershipId: string;
  accessAssignmentId: string;
  role: ChronicCareRole;
};

export type ChronicCareAccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
  role: ChronicCareRole;
};

export type ChronicCareAccess = {
  principal: IdentityPrincipal;
  assignment: AccessAssignmentSummary;
  assignments: ChronicCareAccessAssignmentOption[];
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  scope: ChronicCareScope;
};

export class MultipleChronicCareAccessSelectionRequiredError extends Error {
  constructor(public readonly assignments: ChronicCareAccessAssignmentOption[]) {
    super('A chronic-care access assignment must be selected');
    this.name = 'MultipleChronicCareAccessSelectionRequiredError';
  }
}

export class ChronicCarePermissionRequiredError extends Error {
  constructor(public readonly permission: ChronicCarePermission) {
    super(`The ${permission} chronic-care permission is required`);
    this.name = 'ChronicCarePermissionRequiredError';
  }
}

const permissionMatrix: Record<
  ChronicCareRole,
  ReadonlySet<ChronicCarePermission>
> = {
  clinician: new Set([
    'workspace.read',
    'enrollment.confirm',
    'plan.sign',
    'task.start',
    'task.complete',
    'task.resolve',
    'task.cancel',
  ]),
  nurse: new Set([
    'workspace.read',
    'task.start',
    'task.response',
    'task.escalate',
    'task.complete',
  ]),
};

export function hasChronicCarePermission(
  role: ChronicCareRole,
  permission: ChronicCarePermission,
) {
  return permissionMatrix[role]?.has(permission) ?? false;
}

export function requireChronicCarePermission(
  role: ChronicCareRole,
  permission: ChronicCarePermission,
) {
  if (!hasChronicCarePermission(role, permission)) {
    throw new ChronicCarePermissionRequiredError(permission);
  }
}

export function chronicCareCapabilities(role: ChronicCareRole) {
  return Object.fromEntries(
    chronicCarePermissions.map((permission) => [
      permission,
      hasChronicCarePermission(role, permission),
    ]),
  ) as Record<ChronicCarePermission, boolean>;
}

function chronicCareRole(assignment: AccessAssignmentSummary) {
  if (assignment.roles.includes('doctor')) return 'clinician' as const;
  if (assignment.roles.includes('nurse')) return 'nurse' as const;
  return null;
}

function isChronicCareAssignment(assignment: AccessAssignmentSummary) {
  return (
    chronicCareRole(assignment) !== null &&
    assignment.effectivePermissions.includes('care.manage')
  );
}

function toOption(
  assignment: AccessAssignmentSummary,
): ChronicCareAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentName: assignment.department.name,
    role: chronicCareRole(assignment)!,
  };
}

/**
 * Resolves exactly one current department assignment. Role and permission are
 * always taken from that same assignment; separate assignments are never merged.
 */
export async function resolveChronicCareAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
  requestedFacilityId?: string,
  now = Date.now(),
): Promise<ChronicCareAccess> {
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
    if (!isChronicCareAssignment(selected)) {
      throw new AccessPermissionRequiredError('care.manage');
    }
  } else {
    const candidates = current.filter(
      (assignment) =>
        (!requestedFacilityId ||
          assignment.facility.id === requestedFacilityId) &&
        isChronicCareAssignment(assignment),
    );
    if (candidates.length === 0) {
      throw new AccessPermissionRequiredError('care.manage');
    }
    if (candidates.length > 1) {
      throw new MultipleChronicCareAccessSelectionRequiredError(
        candidates.map(toOption),
      );
    }
    [selected] = candidates;
  }

  const role = chronicCareRole(selected);
  if (!role) throw new AccessPermissionRequiredError('care.manage');

  const assignments = current
    .filter(isChronicCareAssignment)
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
