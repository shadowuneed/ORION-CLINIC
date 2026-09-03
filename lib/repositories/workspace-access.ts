import type {
  AccessibleEncounter,
  ActiveMembership,
  IdentityPrincipal,
  MembershipRole,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';

type MembershipRow = {
  userId: string;
  userDisplayName: string;
  membershipId: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: MembershipRole;
};

type EncounterRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  clinicianMembershipId: string;
  status: AccessibleEncounter['status'];
  reasonForVisit: string | null;
  startedAt: number | null;
  updatedAt: number;
  version: number;
  patientId: string;
  medicalRecordNumber: string;
  patientDisplayName: string;
  birthDate: string | null;
  sexAtBirth: AccessibleEncounter['patient']['sexAtBirth'];
};

export class D1WorkspaceAccessRepository
  implements WorkspaceAccessRepository
{
  constructor(private readonly database: D1Database) {}

  async listActiveMemberships(principal: IdentityPrincipal) {
    const result = await this.database
      .prepare(`
        select
          user.id as userId,
          user.display_name as userDisplayName,
          membership.id as membershipId,
          organization.id as organizationId,
          organization.name as organizationName,
          facility.id as facilityId,
          facility.name as facilityName,
          membership.role
        from users user
        join memberships membership on membership.user_id = user.id
        join organizations organization
          on organization.id = membership.organization_id
        join facilities facility
          on facility.organization_id = membership.organization_id
          and facility.id = membership.facility_id
        where user.external_issuer = ?1
          and user.external_subject = ?2
          and user.status = 'active'
          and membership.status = 'active'
          and organization.status = 'active'
          and facility.status = 'active'
        order by organization.name, facility.name, membership.id
      `)
      .bind(principal.issuer, principal.subject)
      .all<MembershipRow>();

    return result.results;
  }

  async listAssignedEncounters(memberships: readonly ActiveMembership[]) {
    if (memberships.length === 0) return [];

    const placeholders = memberships.map((_, index) => `?${index + 1}`);
    const result = await this.database
      .prepare(`
        select
          encounter.id,
          encounter.organization_id as organizationId,
          organization.name as organizationName,
          encounter.facility_id as facilityId,
          facility.name as facilityName,
          encounter.clinician_membership_id as clinicianMembershipId,
          encounter.status,
          encounter.reason_for_visit as reasonForVisit,
          encounter.started_at as startedAt,
          encounter.updated_at as updatedAt,
          encounter.version,
          patient.id as patientId,
          patient.medical_record_number as medicalRecordNumber,
          patient.display_name as patientDisplayName,
          patient.birth_date as birthDate,
          patient.sex_at_birth as sexAtBirth
        from encounters encounter
        join organizations organization
          on organization.id = encounter.organization_id
          and organization.status = 'active'
        join facilities facility
          on facility.organization_id = encounter.organization_id
          and facility.id = encounter.facility_id
          and facility.status = 'active'
        join patients patient
          on patient.organization_id = encounter.organization_id
          and patient.facility_id = encounter.facility_id
          and patient.id = encounter.patient_id
          and patient.status = 'active'
        join memberships membership
          on membership.organization_id = encounter.organization_id
          and membership.facility_id = encounter.facility_id
          and membership.id = encounter.clinician_membership_id
          and membership.status = 'active'
          and membership.role = 'clinician'
        where encounter.clinician_membership_id in (${placeholders.join(', ')})
        order by case when encounter.status in ('in_progress', 'review')
          then 0 else 1 end,
          encounter.updated_at desc,
          encounter.id
      `)
      .bind(...memberships.map((membership) => membership.membershipId))
      .all<EncounterRow>();

    return result.results.map(
      (row): AccessibleEncounter => ({
        id: row.id,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        facilityId: row.facilityId,
        facilityName: row.facilityName,
        clinicianMembershipId: row.clinicianMembershipId,
        status: row.status,
        reasonForVisit: row.reasonForVisit,
        startedAt: row.startedAt,
        updatedAt: row.updatedAt,
        version: row.version,
        patient: {
          id: row.patientId,
          medicalRecordNumber: row.medicalRecordNumber,
          displayName: row.patientDisplayName,
          birthDate: row.birthDate,
          sexAtBirth: row.sexAtBirth,
        },
      }),
    );
  }
}
