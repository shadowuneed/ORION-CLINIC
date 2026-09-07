import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from './access-governance';
import type { IdentityPrincipal } from './workspace-access';

export type EncounterAccessPermission = 'encounter.read' | 'encounter.manage';
export type EncounterAccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
};

export class EncounterAccessSelectionRequiredError extends Error {
  constructor(readonly assignments: EncounterAccessAssignmentOption[]) {
    super('Select an exact encounter access assignment');
    this.name = 'EncounterAccessSelectionRequiredError';
  }
}

function option(assignment: AccessAssignmentSummary): EncounterAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentName: assignment.department.name,
  };
}

// This checks the acting department scope, not the treatment relationship.
// Encounter consumers must additionally authorize exact clinician ownership.
export async function resolveEncounterAssignmentAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  permission: EncounterAccessPermission,
  selection: { accessAssignmentId?: string; facilityId?: string } = {},
  now = Date.now(),
) {
  const current = (await repository.listPrincipalAssignments(principal)).filter(
    (assignment) => isAccessAssignmentCurrentlyActive(assignment, now) &&
      !assignment.roles.includes('service'),
  );
  if (current.length === 0) throw new AccessMembershipRequiredError();
  const allowed = (assignment: AccessAssignmentSummary) =>
    assignment.roles.includes('doctor') &&
    assignment.effectivePermissions.includes(permission) &&
    !assignment.denyPermissions.includes(permission);

  if (selection.accessAssignmentId) {
    const selected = current.find(
      (assignment) => assignment.assignmentId === selection.accessAssignmentId,
    );
    if (!selected || (selection.facilityId && selected.facility.id !== selection.facilityId)) {
      throw new AccessAssignmentNotFoundError();
    }
    if (!allowed(selected)) throw new AccessPermissionRequiredError(permission);
    return selected;
  }
  const candidates = current.filter((assignment) => allowed(assignment) &&
    (!selection.facilityId || assignment.facility.id === selection.facilityId));
  if (candidates.length === 0) throw new AccessPermissionRequiredError(permission);
  if (candidates.length > 1) {
    throw new EncounterAccessSelectionRequiredError(candidates.map(option).sort(
      (left, right) => left.assignmentId.localeCompare(right.assignmentId),
    ));
  }
  return candidates[0];
}
