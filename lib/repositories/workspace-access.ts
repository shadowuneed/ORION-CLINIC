import { resolveEncounterAssignmentAccess } from '@/lib/auth/encounter-assignment-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import type { WorkspaceAccessSelection } from '@/lib/auth/workspace-request-access';
import { D1AccessGovernanceRepository } from './access-governance';
import type {
  AccessibleEncounter,
  ActiveMembership,
  IdentityPrincipal,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';

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
  constructor(
    private readonly database: D1Database,
    private readonly selection: WorkspaceAccessSelection = { permission: 'encounter.manage' },
  ) {}

  async listActiveMemberships(principal: IdentityPrincipal): Promise<ActiveMembership[]> {
    const selected = await resolveEncounterAssignmentAccess(
      new D1AccessGovernanceRepository(this.database), principal,
      this.selection.permission, this.selection,
    );
    return [{
      userId: selected.user.id,
      userDisplayName: selected.user.displayName,
      membershipId: selected.membership.id,
      organizationId: selected.organization.id,
      organizationName: selected.organization.name,
      facilityId: selected.facility.id,
      facilityName: selected.facility.name,
      role: 'clinician',
      accessAssignmentId: selected.assignmentId,
      accessPermission: this.selection.permission,
    }];
  }

  async listAssignedEncounters(memberships: readonly ActiveMembership[]) {
    if (memberships.length === 0) return [];

    // Never merge memberships or substitute another assignment after selection.
    const selected = memberships[0];
    if (memberships.length !== 1 || !selected.accessAssignmentId ||
      selected.accessPermission !== this.selection.permission ||
      (this.selection.accessAssignmentId && selected.accessAssignmentId !== this.selection.accessAssignmentId) ||
      (this.selection.facilityId && selected.facilityId !== this.selection.facilityId)) {
      throw new AccessPermissionRequiredError(this.selection.permission);
    }
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
          and membership.user_id = ?5
        join encounter_access_assignment_permissions access
          on access.membership_id=membership.id and access.organization_id=membership.organization_id
          and access.facility_id=membership.facility_id and access.assignment_id=?1
          and access.can_read=1 and (?6='encounter.read' or access.can_manage=1)
          and access.effective_from<=?7 and (access.effective_until is null or access.effective_until>?7)
        where encounter.organization_id=?2 and encounter.facility_id=?3
          and encounter.clinician_membership_id=?4
        order by case when encounter.status in ('in_progress', 'review')
          then 0 else 1 end,
          encounter.updated_at desc,
          encounter.id
      `)
      .bind(selected.accessAssignmentId, selected.organizationId, selected.facilityId,
        selected.membershipId, selected.userId, this.selection.permission, Date.now())
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
