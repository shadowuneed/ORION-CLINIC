import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';

export type CloudDashboardSelection = {
  facilityId?: string | string[];
  accessAssignmentId?: string | string[];
};

export class InvalidCloudDashboardSelectionError extends Error {}
export class MultipleCloudDashboardSelectionRequiredError extends Error {
  constructor(public readonly assignments: ReadonlyArray<AccessAssignmentSummary>) {
    super('Select one current dashboard assignment.');
  }
}

const permissions = ['clinic.dashboard.read', 'patient.directory.read'] as const;

/** Both rights must belong to the same current interactive assignment. */
export function hasCloudDashboardAccess(assignment: AccessAssignmentSummary, now = Date.now()) {
  return isAccessAssignmentCurrentlyActive(assignment, now) && !assignment.roles.includes('service') &&
    permissions.every(permission => assignment.effectivePermissions.includes(permission) &&
      !assignment.denyPermissions.includes(permission));
}

function selector(value: string | string[] | undefined, maxLength: number) {
  if (value === undefined) return undefined;
  // An array is an ambiguous Next searchParams selection, even if it has one item.
  if (typeof value !== 'string' || value.length > maxLength || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new InvalidCloudDashboardSelectionError('Invalid dashboard operating scope.');
  }
  return value;
}

export function cloudDashboardSelection(query: CloudDashboardSelection) {
  return { facilityId: selector(query.facilityId, 100), accessAssignmentId: selector(query.accessAssignmentId, 160) };
}

/** Preserve malformed explicit selectors through sign-in; never turn them into implicit scope. */
export function cloudDashboardReturnTo(query: CloudDashboardSelection) {
  const params = new URLSearchParams();
  for (const key of ['accessAssignmentId', 'facilityId'] as const) {
    const value = query[key];
    for (const item of value === undefined ? [] : Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `/dashboard${params.size ? `?${params}` : ''}`;
}

export async function resolveCloudDashboardAccess(repository: AccessGovernanceRepository, principal: IdentityPrincipal,
  query: CloudDashboardSelection, now = Date.now()) {
  // Reject invalid selection before reading any assignments or trying a fallback.
  const selection = cloudDashboardSelection(query);
  const current = (await repository.listPrincipalAssignments(principal))
    .filter(assignment => isAccessAssignmentCurrentlyActive(assignment, now) && !assignment.roles.includes('service'));
  if (current.length === 0) throw new AccessMembershipRequiredError();

  if (selection.accessAssignmentId !== undefined) {
    const selected = current.find(assignment => assignment.assignmentId === selection.accessAssignmentId);
    if (!selected || (selection.facilityId !== undefined && selected.facility.id !== selection.facilityId)) {
      throw new AccessAssignmentNotFoundError();
    }
    for (const permission of permissions) {
      if (!selected.effectivePermissions.includes(permission) || selected.denyPermissions.includes(permission)) {
        throw new AccessPermissionRequiredError(permission);
      }
    }
    return selected;
  }

  const candidates = current.filter(assignment => hasCloudDashboardAccess(assignment, now) &&
    (selection.facilityId === undefined || assignment.facility.id === selection.facilityId))
    .sort((left, right) => `${left.organization.name}:${left.facility.name}:${left.department.name}:${left.assignmentId}`
      .localeCompare(`${right.organization.name}:${right.facility.name}:${right.department.name}:${right.assignmentId}`));
  if (candidates.length === 0) throw new AccessPermissionRequiredError('clinic.dashboard.read');
  if (candidates.length > 1) throw new MultipleCloudDashboardSelectionRequiredError(candidates);
  return candidates[0];
}
