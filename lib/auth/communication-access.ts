import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import type { CommunicationSourceType } from '@/lib/domain/patient-communications';

export type CommunicationRole = 'clinician' | 'nurse' | 'registrar';
export const communicationPermissions = [
  'workspace.read',
  'consent.capture',
  'notification.schedule',
  'notification.process',
  'notification.cancel',
  'manual.start',
  'manual.response',
  'manual.complete',
  'manual.escalate',
  'manual.cancel',
] as const;
export type CommunicationPermission = (typeof communicationPermissions)[number];

export type CommunicationScope = {
  organizationId: string;
  facilityId: string;
  userId: string;
  membershipId: string;
  accessAssignmentId: string;
  role: CommunicationRole;
};

export type CommunicationAccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
  role: CommunicationRole;
};

export type CommunicationAccess = {
  principal: IdentityPrincipal;
  assignment: AccessAssignmentSummary;
  assignments: CommunicationAccessAssignmentOption[];
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  scope: CommunicationScope;
};

export class MultipleCommunicationAccessSelectionRequiredError extends Error {
  constructor(public readonly assignments: CommunicationAccessAssignmentOption[]) {
    super('A communication access assignment must be selected');
    this.name = 'MultipleCommunicationAccessSelectionRequiredError';
  }
}

export class CommunicationPermissionRequiredError extends Error {
  constructor(public readonly permission: CommunicationPermission) {
    super(`The ${permission} communication permission is required`);
    this.name = 'CommunicationPermissionRequiredError';
  }
}

const matrix: Record<CommunicationRole, ReadonlySet<CommunicationPermission>> = {
  clinician: new Set(communicationPermissions),
  nurse: new Set([
    'workspace.read',
    'consent.capture',
    'notification.schedule',
    'notification.process',
    'manual.start',
    'manual.response',
    'manual.complete',
    'manual.escalate',
    'manual.cancel',
  ]),
  registrar: new Set([
    'workspace.read',
    'consent.capture',
    'notification.schedule',
    'notification.process',
    'notification.cancel',
    'manual.start',
    'manual.response',
    'manual.complete',
    'manual.escalate',
    'manual.cancel',
  ]),
};

export function hasCommunicationPermission(
  role: CommunicationRole,
  permission: CommunicationPermission,
) {
  return matrix[role]?.has(permission) ?? false;
}

export function requireCommunicationPermission(
  role: CommunicationRole,
  permission: CommunicationPermission,
) {
  if (!hasCommunicationPermission(role, permission)) {
    throw new CommunicationPermissionRequiredError(permission);
  }
}

export function assertCommunicationSourceAllowed(
  role: CommunicationRole,
  sourceType: CommunicationSourceType,
) {
  if (role === 'registrar' && sourceType !== 'appointment') {
    throw new CommunicationPermissionRequiredError('notification.schedule');
  }
  if (role === 'nurse' && sourceType !== 'care_plan_task') {
    throw new CommunicationPermissionRequiredError('notification.schedule');
  }
}

export function communicationCapabilities(role: CommunicationRole) {
  return Object.fromEntries(
    communicationPermissions.map((permission) => [
      permission,
      hasCommunicationPermission(role, permission),
    ]),
  ) as Record<CommunicationPermission, boolean>;
}

function communicationRole(assignment: AccessAssignmentSummary) {
  if (assignment.roles.includes('doctor')) return 'clinician' as const;
  if (assignment.roles.includes('nurse')) return 'nurse' as const;
  if (assignment.roles.includes('registrar')) return 'registrar' as const;
  return null;
}

function isCommunicationAssignment(assignment: AccessAssignmentSummary) {
  return (
    communicationRole(assignment) !== null &&
    assignment.effectivePermissions.includes('communications.manage')
  );
}

function toOption(
  assignment: AccessAssignmentSummary,
): CommunicationAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentName: assignment.department.name,
    role: communicationRole(assignment)!,
  };
}

/**
 * Resolves exactly one current department assignment. Role and permission are
 * always taken from that same assignment; separate assignments are never merged.
 */
export async function resolveCommunicationAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
  requestedFacilityId?: string,
  now = Date.now(),
): Promise<CommunicationAccess> {
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
    if (!isCommunicationAssignment(selected)) {
      throw new AccessPermissionRequiredError('communications.manage');
    }
  } else {
    const candidates = current.filter(
      (assignment) =>
        (!requestedFacilityId ||
          assignment.facility.id === requestedFacilityId) &&
        isCommunicationAssignment(assignment),
    );
    if (candidates.length === 0) {
      throw new AccessPermissionRequiredError('communications.manage');
    }
    if (candidates.length > 1) {
      throw new MultipleCommunicationAccessSelectionRequiredError(
        candidates.map(toOption),
      );
    }
    [selected] = candidates;
  }

  const role = communicationRole(selected);
  if (!role) throw new AccessPermissionRequiredError('communications.manage');

  const assignments = current
    .filter(isCommunicationAssignment)
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
