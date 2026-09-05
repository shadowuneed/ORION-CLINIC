import type {
  ActiveMembership,
  IdentityPrincipal,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';

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
  role: ObservationRole;
};

export type ObservationFacilityOption = {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: ObservationRole;
};

export type ObservationAccess = {
  principal: IdentityPrincipal;
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  facilities: ObservationFacilityOption[];
  membership: ActiveMembership & { role: ObservationRole };
  scope: ObservationScope;
};

export class ObservationMembershipRequiredError extends Error {
  constructor() {
    super('An active clinician or nurse membership is required');
    this.name = 'ObservationMembershipRequiredError';
  }
}

export class ObservationFacilitySelectionRequiredError extends Error {
  constructor(public readonly facilities: ObservationFacilityOption[]) {
    super('An observation facility must be selected');
    this.name = 'ObservationFacilitySelectionRequiredError';
  }
}

export class ObservationFacilityNotFoundError extends Error {
  constructor() {
    super('The requested observation facility is not accessible');
    this.name = 'ObservationFacilityNotFoundError';
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

function isObservationMembership(
  membership: ActiveMembership,
): membership is ActiveMembership & { role: ObservationRole } {
  return membership.role === 'clinician' || membership.role === 'nurse';
}

function sortByRole(
  left: { role: ObservationRole; membershipId: string },
  right: { role: ObservationRole; membershipId: string },
) {
  if (left.role === right.role) {
    return left.membershipId.localeCompare(right.membershipId);
  }
  return left.role === 'clinician' ? -1 : 1;
}

export async function resolveObservationAccess(
  repository: Pick<WorkspaceAccessRepository, 'listActiveMemberships'>,
  principal: IdentityPrincipal,
  requestedFacilityId?: string,
): Promise<ObservationAccess> {
  const memberships = (await repository.listActiveMemberships(principal))
    .filter(isObservationMembership)
    .sort(sortByRole);
  if (memberships.length === 0) throw new ObservationMembershipRequiredError();

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
    if (!membership) throw new ObservationFacilityNotFoundError();
  } else {
    if (uniqueScopes.size > 1) {
      throw new ObservationFacilitySelectionRequiredError(facilities);
    }
    membership = memberships[0];
  }

  return {
    principal,
    user: { id: membership.userId, displayName: membership.userDisplayName },
    organization: {
      id: membership.organizationId,
      name: membership.organizationName,
    },
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
