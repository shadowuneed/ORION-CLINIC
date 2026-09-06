import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';

export type SchedulingRole = 'clinician' | 'registrar';

export const schedulingPermissions = [
  'workspace.read',
  'preference.capture',
  'appointment.hold',
  'appointment.confirm',
  'appointment.cancel',
  'appointment.expire',
  'appointment.no_show',
  'queue.issue',
  'queue.arrive',
  'queue.call',
  'queue.start_service',
  'queue.complete',
  'queue.exception',
] as const;

export type SchedulingPermission = (typeof schedulingPermissions)[number];

const schedulingPermissionMatrix: Record<
  SchedulingRole,
  ReadonlySet<SchedulingPermission>
> = {
  clinician: new Set([
    'workspace.read',
    'preference.capture',
    'appointment.hold',
    'appointment.confirm',
    'appointment.cancel',
    'appointment.no_show',
    'queue.issue',
    'queue.arrive',
    'queue.call',
    'queue.start_service',
    'queue.complete',
    'queue.exception',
  ]),
  registrar: new Set([
    'workspace.read',
    'preference.capture',
    'appointment.hold',
    'appointment.confirm',
    'appointment.cancel',
    'appointment.no_show',
    'queue.issue',
    'queue.arrive',
    'queue.call',
    'queue.exception',
  ]),
};

export class SchedulingPermissionRequiredError extends Error {
  constructor(public readonly permission: SchedulingPermission) {
    super(`The ${permission} scheduling permission is required`);
    this.name = 'SchedulingPermissionRequiredError';
  }
}

export function hasSchedulingPermission(
  role: SchedulingRole,
  permission: SchedulingPermission,
) {
  return schedulingPermissionMatrix[role]?.has(permission) ?? false;
}

export function requireSchedulingPermission(
  role: SchedulingRole,
  permission: SchedulingPermission,
) {
  if (!hasSchedulingPermission(role, permission)) {
    throw new SchedulingPermissionRequiredError(permission);
  }
}

export function schedulingCapabilities(role: SchedulingRole) {
  return Object.fromEntries(
    schedulingPermissions.map((permission) => [
      permission,
      hasSchedulingPermission(role, permission),
    ]),
  ) as Record<SchedulingPermission, boolean>;
}

export type SchedulingScope = {
  organizationId: string;
  facilityId: string;
  userId: string;
  membershipId: string;
  accessAssignmentId: string;
  role: SchedulingRole;
};

export type SchedulingAccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
  role: SchedulingRole;
};

export type SchedulingAccess = {
  principal: IdentityPrincipal;
  assignment: AccessAssignmentSummary;
  assignments: SchedulingAccessAssignmentOption[];
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  scope: SchedulingScope;
};

export class MultipleSchedulingAccessSelectionRequiredError extends Error {
  constructor(public readonly assignments: SchedulingAccessAssignmentOption[]) {
    super('A scheduling access assignment must be selected');
    this.name = 'MultipleSchedulingAccessSelectionRequiredError';
  }
}

function schedulingRole(assignment: AccessAssignmentSummary) {
  if (assignment.roles.includes('doctor')) return 'clinician' as const;
  if (assignment.roles.includes('registrar')) return 'registrar' as const;
  return null;
}

function isSchedulingAssignment(assignment: AccessAssignmentSummary) {
  return (
    schedulingRole(assignment) !== null &&
    assignment.effectivePermissions.includes('scheduling.manage')
  );
}

function toOption(
  assignment: AccessAssignmentSummary,
): SchedulingAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentName: assignment.department.name,
    role: schedulingRole(assignment)!,
  };
}

/**
 * Resolves exactly one current interactive assignment. Roles and effective
 * permissions always come from that same assignment and are never merged.
 */
export async function resolveSchedulingAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
  requestedFacilityId?: string,
  now = Date.now(),
): Promise<SchedulingAccess> {
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
    if (!isSchedulingAssignment(selected)) {
      throw new AccessPermissionRequiredError('scheduling.manage');
    }
  } else {
    const candidates = current.filter(
      (assignment) =>
        (!requestedFacilityId || assignment.facility.id === requestedFacilityId) &&
        isSchedulingAssignment(assignment),
    );
    if (candidates.length === 0) {
      throw new AccessPermissionRequiredError('scheduling.manage');
    }
    if (candidates.length > 1) {
      throw new MultipleSchedulingAccessSelectionRequiredError(
        candidates.map(toOption),
      );
    }
    [selected] = candidates;
  }

  const role = schedulingRole(selected);
  if (!role) throw new AccessPermissionRequiredError('scheduling.manage');

  const assignments = current
    .filter(isSchedulingAssignment)
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
