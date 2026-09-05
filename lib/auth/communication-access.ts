import type {
  ActiveMembership,
  IdentityPrincipal,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';
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
  role: CommunicationRole;
};

export type CommunicationFacilityOption = {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: CommunicationRole;
};

export type CommunicationAccess = {
  principal: IdentityPrincipal;
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  facilities: CommunicationFacilityOption[];
  membership: ActiveMembership & { role: CommunicationRole };
  scope: CommunicationScope;
};

export class CommunicationMembershipRequiredError extends Error {}
export class CommunicationFacilitySelectionRequiredError extends Error {
  constructor(public readonly facilities: CommunicationFacilityOption[]) {
    super('A communications facility must be selected');
  }
}
export class CommunicationFacilityNotFoundError extends Error {}
export class CommunicationPermissionRequiredError extends Error {
  constructor(public readonly permission: CommunicationPermission) {
    super(`The ${permission} communication permission is required`);
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

function isCommunicationMembership(
  membership: ActiveMembership,
): membership is ActiveMembership & { role: CommunicationRole } {
  return (
    membership.role === 'clinician' ||
    membership.role === 'nurse' ||
    membership.role === 'registrar'
  );
}

const roleOrder: Record<CommunicationRole, number> = {
  clinician: 0,
  nurse: 1,
  registrar: 2,
};

export async function resolveCommunicationAccess(
  repository: Pick<WorkspaceAccessRepository, 'listActiveMemberships'>,
  principal: IdentityPrincipal,
  requestedFacilityId?: string,
): Promise<CommunicationAccess> {
  const memberships = (await repository.listActiveMemberships(principal))
    .filter(isCommunicationMembership)
    .sort(
      (left, right) =>
        roleOrder[left.role] - roleOrder[right.role] ||
        left.membershipId.localeCompare(right.membershipId),
    );
  if (memberships.length === 0) throw new CommunicationMembershipRequiredError();

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
    if (!membership) throw new CommunicationFacilityNotFoundError();
  } else {
    if (uniqueScopes.size > 1) {
      throw new CommunicationFacilitySelectionRequiredError(facilities);
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
