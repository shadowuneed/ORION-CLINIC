import { isEncounterResumable } from '@/lib/domain/encounter';

export type IdentityPrincipal = {
  issuer: string;
  subject: string;
  email: string | null;
};

export type MembershipRole =
  | 'clinician'
  | 'nurse'
  | 'registrar'
  | 'administrator'
  | 'auditor';

export type ActiveMembership = {
  userId: string;
  userDisplayName: string;
  membershipId: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: MembershipRole;
};

export type AccessibleEncounter = {
  id: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  clinicianMembershipId: string;
  status:
    | 'draft'
    | 'ready'
    | 'in_progress'
    | 'review'
    | 'finalized'
    | 'amended'
    | 'cancelled';
  reasonForVisit: string | null;
  startedAt: number | null;
  updatedAt: number;
  version: number;
  patient: {
    id: string;
    medicalRecordNumber: string;
    displayName: string;
    birthDate: string | null;
    sexAtBirth: 'female' | 'male' | 'unknown' | 'not_recorded';
  };
};

export type WorkspaceScope = {
  organizationId: string;
  facilityId: string;
  encounterId: string;
  reviewerMembershipId: string;
};

export type ClinicianWorkspaceAccess = {
  principal: IdentityPrincipal;
  user: {
    id: string;
    displayName: string;
  };
  membership: ActiveMembership;
  scope: WorkspaceScope;
  encounter: AccessibleEncounter;
  encounters: AccessibleEncounter[];
};

export interface WorkspaceAccessRepository {
  listActiveMemberships(
    principal: IdentityPrincipal,
  ): Promise<ActiveMembership[]>;
  listAssignedEncounters(
    memberships: readonly ActiveMembership[],
  ): Promise<AccessibleEncounter[]>;
}

export class MembershipRequiredError extends Error {
  constructor() {
    super('An active clinic membership is required');
    this.name = 'MembershipRequiredError';
  }
}

export class ClinicianRoleRequiredError extends Error {
  constructor() {
    super('A clinician membership is required');
    this.name = 'ClinicianRoleRequiredError';
  }
}

export class AccessibleEncounterNotFoundError extends Error {
  constructor() {
    super('An assigned encounter was not found');
    this.name = 'AccessibleEncounterNotFoundError';
  }
}

export async function resolveClinicianWorkspaceAccess(
  repository: WorkspaceAccessRepository,
  principal: IdentityPrincipal,
  requestedEncounterId?: string,
): Promise<ClinicianWorkspaceAccess> {
  const memberships = await repository.listActiveMemberships(principal);

  if (memberships.length === 0) {
    throw new MembershipRequiredError();
  }

  const clinicianMemberships = memberships.filter(
    (membership) => membership.role === 'clinician',
  );

  if (clinicianMemberships.length === 0) {
    throw new ClinicianRoleRequiredError();
  }

  const assignedEncounters = await repository.listAssignedEncounters(
    clinicianMemberships,
  );
  const encounters = [...assignedEncounters].sort((left, right) => {
    const recoveryPriority =
      Number(isEncounterResumable(right.status)) -
      Number(isEncounterResumable(left.status));
    if (recoveryPriority !== 0) return recoveryPriority;
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.id.localeCompare(right.id);
  });
  const encounter = requestedEncounterId
    ? encounters.find((candidate) => candidate.id === requestedEncounterId)
    : encounters[0];

  if (!encounter) {
    throw new AccessibleEncounterNotFoundError();
  }

  const membership = clinicianMemberships.find(
    (candidate) =>
      candidate.membershipId === encounter.clinicianMembershipId &&
      candidate.organizationId === encounter.organizationId &&
      candidate.facilityId === encounter.facilityId,
  );

  if (!membership) {
    throw new AccessibleEncounterNotFoundError();
  }

  return {
    principal,
    user: {
      id: membership.userId,
      displayName: membership.userDisplayName,
    },
    membership,
    scope: {
      organizationId: membership.organizationId,
      facilityId: membership.facilityId,
      encounterId: encounter.id,
      reviewerMembershipId: membership.membershipId,
    },
    encounter,
    encounters,
  };
}
