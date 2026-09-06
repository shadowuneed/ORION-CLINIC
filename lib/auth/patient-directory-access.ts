import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
  type AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import type { ClinicPermission } from '@/lib/domain/access-governance';
import type { FacilityAccessScope } from '@/lib/auth/facility-access';

export type PatientDirectoryPermission = Extract<
  ClinicPermission,
  'patient.directory.read' | 'patient.profile.write' | 'encounter.manage'
>;

export type PatientAccessAssignmentOption = {
  assignmentId: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentId: string;
  departmentName: string;
  roles: AccessAssignmentSummary['roles'];
};

export type PatientDirectoryAccess = {
  principal: IdentityPrincipal;
  assignment: AccessAssignmentSummary;
  assignments: PatientAccessAssignmentOption[];
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  scope: FacilityAccessScope;
};

export class MultiplePatientAccessSelectionRequiredError extends Error {
  constructor(public readonly assignments: PatientAccessAssignmentOption[]) {
    super('A patient-directory access assignment must be selected');
    this.name = 'MultiplePatientAccessSelectionRequiredError';
  }
}

function toOption(
  assignment: AccessAssignmentSummary,
): PatientAccessAssignmentOption {
  return {
    assignmentId: assignment.assignmentId,
    organizationId: assignment.organization.id,
    organizationName: assignment.organization.name,
    facilityId: assignment.facility.id,
    facilityName: assignment.facility.name,
    departmentId: assignment.department.id,
    departmentName: assignment.department.name,
    roles: assignment.roles,
  };
}

/**
 * Resolves exactly one current assignment for the patient registry. Permissions
 * are never combined across departments or facilities. Patient, lifecycle,
 * purpose, consent and audit checks remain the responsibility of their domain
 * repositories after this operating scope is selected.
 */
export async function resolvePatientDirectoryAccess(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  permission: PatientDirectoryPermission,
  requestedAssignmentId?: string,
  requestedFacilityId?: string,
  now = Date.now(),
): Promise<PatientDirectoryAccess> {
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
    if (
      requestedFacilityId &&
      selected.facility.id !== requestedFacilityId
    ) {
      throw new AccessAssignmentNotFoundError();
    }
  } else {
    const candidates = current.filter(
      (assignment) =>
        (!requestedFacilityId ||
          assignment.facility.id === requestedFacilityId) &&
        assignment.effectivePermissions.includes(permission),
    );
    if (candidates.length === 0) {
      throw new AccessPermissionRequiredError(permission);
    }
    if (candidates.length > 1) {
      throw new MultiplePatientAccessSelectionRequiredError(
        candidates.map(toOption),
      );
    }
    [selected] = candidates;
  }

  if (!selected.effectivePermissions.includes(permission)) {
    throw new AccessPermissionRequiredError(permission);
  }

  const assignments = current
    .filter((assignment) =>
      assignment.effectivePermissions.some((candidate) =>
        [
          'patient.directory.read',
          'patient.profile.write',
          'encounter.manage',
        ].includes(candidate),
      ),
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
      role: selected.effectivePermissions.includes('encounter.manage')
        ? 'clinician'
        : 'registrar',
    },
  };
}
