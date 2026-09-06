import type {
  ClinicPermission,
  OrganizationRole,
} from '@/lib/domain/access-governance';
import type { IdentityPrincipal, MembershipRole } from './workspace-access';

export type AccessAssignmentStatus = 'active' | 'revoked' | 'expired';

export type AccessAssignmentSummary = {
  assignmentId: string;
  assignmentVersionId: string;
  assignmentVersion: number;
  status: AccessAssignmentStatus;
  source: 'bootstrap' | 'administrator';
  effectiveFrom: number;
  effectiveUntil: number | null;
  organization: {
    id: string;
    name: string;
    status: 'active' | 'suspended';
  };
  facility: {
    id: string;
    name: string;
    status: 'active' | 'suspended';
  };
  department: {
    id: string;
    code: string;
    name: string;
    kind: 'clinical' | 'diagnostic' | 'administrative' | 'support';
    status: 'active' | 'disabled';
  };
  membership: {
    id: string;
    legacyRole: MembershipRole;
    status: 'active' | 'disabled';
  };
  user: {
    id: string;
    displayName: string;
    status: 'invited' | 'active' | 'disabled';
  };
  roles: OrganizationRole[];
  allowPermissions: ClinicPermission[];
  denyPermissions: ClinicPermission[];
  effectivePermissions: ClinicPermission[];
};

export type AccessOverview = {
  principal: IdentityPrincipal;
  assignments: AccessAssignmentSummary[];
  selected: AccessAssignmentSummary;
};

export interface AccessGovernanceRepository {
  listPrincipalAssignments(
    principal: IdentityPrincipal,
  ): Promise<AccessAssignmentSummary[]>;
}

export class AccessMembershipRequiredError extends Error {
  constructor() {
    super('An active department access assignment is required');
    this.name = 'AccessMembershipRequiredError';
  }
}

export class MultipleAccessSelectionRequiredError extends Error {
  constructor(
    public readonly assignments: ReadonlyArray<AccessAssignmentSummary>,
  ) {
    super('An access assignment must be selected');
    this.name = 'MultipleAccessSelectionRequiredError';
  }
}

export class AccessAssignmentNotFoundError extends Error {
  constructor() {
    super('The requested access assignment was not found');
    this.name = 'AccessAssignmentNotFoundError';
  }
}

export class InteractiveServiceAccessForbiddenError extends Error {
  constructor() {
    super('A service assignment cannot open an interactive workspace');
    this.name = 'InteractiveServiceAccessForbiddenError';
  }
}

function isCurrentlyActive(assignment: AccessAssignmentSummary, now: number) {
  return (
    assignment.status === 'active' &&
    assignment.organization.status === 'active' &&
    assignment.facility.status === 'active' &&
    assignment.department.status === 'active' &&
    assignment.membership.status === 'active' &&
    assignment.user.status === 'active' &&
    assignment.effectiveFrom <= now &&
    (assignment.effectiveUntil === null || assignment.effectiveUntil > now)
  );
}

/**
 * Resolves one explicit operating scope. The overview intentionally refuses to
 * merge permissions from different facilities or departments.
 */
export async function resolveAccessOverview(
  repository: AccessGovernanceRepository,
  principal: IdentityPrincipal,
  requestedAssignmentId?: string,
  now = Date.now(),
): Promise<AccessOverview> {
  const currentAssignments = (await repository.listPrincipalAssignments(principal))
    .filter((assignment) => isCurrentlyActive(assignment, now))
    .sort((left, right) =>
      `${left.organization.name}:${left.facility.name}:${left.department.name}:${left.assignmentId}`
        .localeCompare(
          `${right.organization.name}:${right.facility.name}:${right.department.name}:${right.assignmentId}`,
        ),
    );

  if (currentAssignments.length === 0) {
    throw new AccessMembershipRequiredError();
  }

  const interactiveAssignments = currentAssignments.filter(
    (assignment) => !assignment.roles.includes('service'),
  );
  if (interactiveAssignments.length === 0) {
    throw new InteractiveServiceAccessForbiddenError();
  }

  // The route is itself a governed resource. Keeping an assignment current is
  // not enough when an explicit deny removed its self-access permission.
  const assignments = interactiveAssignments.filter((assignment) =>
    assignment.effectivePermissions.includes('access.self.read'),
  );
  if (assignments.length === 0) {
    throw new AccessMembershipRequiredError();
  }

  let selected: AccessAssignmentSummary | undefined;
  if (requestedAssignmentId) {
    selected = assignments.find(
      (assignment) => assignment.assignmentId === requestedAssignmentId,
    );
    if (!selected) throw new AccessAssignmentNotFoundError();
  } else if (assignments.length === 1) {
    [selected] = assignments;
  } else {
    throw new MultipleAccessSelectionRequiredError(assignments);
  }

  return { principal, assignments, selected };
}
