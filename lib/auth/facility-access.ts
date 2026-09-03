import type {
  ActiveMembership,
  IdentityPrincipal,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';

export type PatientDirectoryRole = 'clinician' | 'registrar';
export type PatientProfileMutation = 'patient.update' | 'patient.archive';

export type PatientProfilePermissions = {
  canUpdate: boolean;
  canArchive: boolean;
};

export type FacilityAccessScope = {
  organizationId: string;
  facilityId: string;
  userId: string;
  membershipId: string;
  role: PatientDirectoryRole;
};

export type FacilityAccess = {
  principal: IdentityPrincipal;
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  facilities: FacilityAccessOption[];
  membership: ActiveMembership & { role: PatientDirectoryRole };
  scope: FacilityAccessScope;
};

export type FacilityAccessOption = {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: PatientDirectoryRole;
};

export class PatientDirectoryMembershipRequiredError extends Error {
  constructor() {
    super('An active patient-directory membership is required');
    this.name = 'PatientDirectoryMembershipRequiredError';
  }
}

export class MultipleFacilitySelectionRequiredError extends Error {
  constructor(public readonly facilities: FacilityAccessOption[]) {
    super('A facility must be selected');
    this.name = 'MultipleFacilitySelectionRequiredError';
  }
}

export class FacilityAccessNotFoundError extends Error {
  constructor() {
    super('The requested facility is not accessible');
    this.name = 'FacilityAccessNotFoundError';
  }
}

export class PatientProfilePermissionRequiredError extends Error {
  constructor(public readonly permission: PatientProfileMutation) {
    super(`The ${permission} permission is required`);
    this.name = 'PatientProfilePermissionRequiredError';
  }
}

const patientProfilePermissionMatrix: Record<
  PatientDirectoryRole,
  ReadonlySet<PatientProfileMutation>
> = {
  clinician: new Set(['patient.update', 'patient.archive']),
  registrar: new Set(['patient.update', 'patient.archive']),
};

export function patientProfilePermissions(
  role: PatientDirectoryRole,
): PatientProfilePermissions {
  const permissions = patientProfilePermissionMatrix[role];
  return {
    canUpdate: permissions?.has('patient.update') ?? false,
    canArchive: permissions?.has('patient.archive') ?? false,
  };
}

export function requirePatientProfilePermission(
  role: PatientDirectoryRole,
  permission: PatientProfileMutation,
) {
  if (!patientProfilePermissionMatrix[role]?.has(permission)) {
    throw new PatientProfilePermissionRequiredError(permission);
  }
}

function isPatientDirectoryMembership(
  membership: ActiveMembership,
): membership is ActiveMembership & { role: PatientDirectoryRole } {
  return membership.role === 'clinician' || membership.role === 'registrar';
}

export async function resolveFacilityAccess(
  repository: Pick<WorkspaceAccessRepository, 'listActiveMemberships'>,
  principal: IdentityPrincipal,
  requestedFacilityId?: string,
): Promise<FacilityAccess> {
  const memberships = (await repository.listActiveMemberships(principal)).filter(
    isPatientDirectoryMembership,
  );

  if (memberships.length === 0) {
    throw new PatientDirectoryMembershipRequiredError();
  }

  const uniqueScopes = new Map(
    memberships.map((candidate) => [
      `${candidate.organizationId}:${candidate.facilityId}`,
      candidate,
    ]),
  );
  const facilities = [...uniqueScopes.values()]
    .map((candidate) => ({
      organizationId: candidate.organizationId,
      organizationName: candidate.organizationName,
      facilityId: candidate.facilityId,
      facilityName: candidate.facilityName,
      role: candidate.role,
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
    if (!membership) throw new FacilityAccessNotFoundError();
  } else {
    if (uniqueScopes.size > 1) {
      throw new MultipleFacilitySelectionRequiredError(facilities);
    }
    membership = [...memberships].sort((left, right) => {
      if (left.role === right.role) return left.membershipId.localeCompare(right.membershipId);
      return left.role === 'clinician' ? -1 : 1;
    })[0];
  }

  return {
    principal,
    user: {
      id: membership.userId,
      displayName: membership.userDisplayName,
    },
    organization: {
      id: membership.organizationId,
      name: membership.organizationName,
    },
    facility: {
      id: membership.facilityId,
      name: membership.facilityName,
    },
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
