import type {
  ActiveMembership,
  IdentityPrincipal,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';

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
  role: ChronicCareRole;
};

export type ChronicCareFacilityOption = {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: ChronicCareRole;
};

export type ChronicCareAccess = {
  principal: IdentityPrincipal;
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  facilities: ChronicCareFacilityOption[];
  membership: ActiveMembership & { role: ChronicCareRole };
  scope: ChronicCareScope;
};

export class ChronicCareMembershipRequiredError extends Error {
  constructor() {
    super('An active clinician or nurse membership is required');
    this.name = 'ChronicCareMembershipRequiredError';
  }
}

export class ChronicCareFacilitySelectionRequiredError extends Error {
  constructor(public readonly facilities: ChronicCareFacilityOption[]) {
    super('A chronic-care facility must be selected');
    this.name = 'ChronicCareFacilitySelectionRequiredError';
  }
}

export class ChronicCareFacilityNotFoundError extends Error {
  constructor() {
    super('The requested chronic-care facility is not accessible');
    this.name = 'ChronicCareFacilityNotFoundError';
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

function isChronicCareMembership(
  membership: ActiveMembership,
): membership is ActiveMembership & { role: ChronicCareRole } {
  return membership.role === 'clinician' || membership.role === 'nurse';
}

function sortByRole(left: { role: ChronicCareRole; membershipId: string }, right: { role: ChronicCareRole; membershipId: string }) {
  if (left.role === right.role) return left.membershipId.localeCompare(right.membershipId);
  return left.role === 'clinician' ? -1 : 1;
}

export async function resolveChronicCareAccess(
  repository: Pick<WorkspaceAccessRepository, 'listActiveMemberships'>,
  principal: IdentityPrincipal,
  requestedFacilityId?: string,
): Promise<ChronicCareAccess> {
  const memberships = (await repository.listActiveMemberships(principal))
    .filter(isChronicCareMembership)
    .sort(sortByRole);
  if (memberships.length === 0) throw new ChronicCareMembershipRequiredError();

  const uniqueScopes = new Map<string, (typeof memberships)[number]>();
  for (const membership of memberships) {
    const key = `${membership.organizationId}:${membership.facilityId}`;
    if (!uniqueScopes.has(key)) uniqueScopes.set(key, membership);
  }
  const facilities = [...uniqueScopes.values()]
    .map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      facilityId: membership.facilityId,
      facilityName: membership.facilityName,
      role: membership.role,
    }))
    .sort((left, right) =>
      `${left.organizationName}:${left.facilityName}`.localeCompare(
        `${right.organizationName}:${right.facilityName}`,
      ),
    );

  let membership: (typeof memberships)[number] | undefined;
  if (requestedFacilityId) {
    membership = memberships.find(
      (candidate) => candidate.facilityId === requestedFacilityId,
    );
    if (!membership) throw new ChronicCareFacilityNotFoundError();
  } else {
    if (uniqueScopes.size > 1) {
      throw new ChronicCareFacilitySelectionRequiredError(facilities);
    }
    membership = memberships[0];
  }

  return {
    principal,
    user: { id: membership.userId, displayName: membership.userDisplayName },
    organization: { id: membership.organizationId, name: membership.organizationName },
    facility: { id: membership.facilityId, name: membership.facilityName },
    facilities,
    membership,
    scope: {
      organizationId: membership.organizationId,
      facilityId: membership.facilityId,
      userId: membership.userId,
      membershipId: membership.membershipId,
      role: membership.role,
    },
  };
}
