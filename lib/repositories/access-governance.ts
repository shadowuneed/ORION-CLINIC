import type {
  AccessAssignmentStatus,
  AccessAssignmentSummary,
  AccessGovernanceRepository,
} from '@/lib/auth/access-governance';
import type {
  IdentityPrincipal,
  MembershipRole,
} from '@/lib/auth/workspace-access';
import { parseAccessAssignment } from '@/lib/domain/access-governance';

type AccessAssignmentRow = {
  assignmentId: string;
  assignmentVersionId: string;
  assignmentVersion: number;
  assignmentStatus: 'active' | 'revoked';
  sourceType: 'bootstrap' | 'administrator';
  rolesJson: string;
  allowPermissionsJson: string;
  denyPermissionsJson: string;
  effectiveFrom: number;
  effectiveUntil: number | null;
  organizationId: string;
  organizationName: string;
  organizationStatus: 'active' | 'suspended';
  facilityId: string;
  facilityName: string;
  facilityStatus: 'active' | 'suspended';
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  departmentKind: 'clinical' | 'diagnostic' | 'administrative' | 'support';
  departmentStatus: 'active' | 'disabled';
  membershipId: string;
  membershipLegacyRole: MembershipRole;
  membershipStatus: 'active' | 'disabled';
  userId: string;
  userDisplayName: string;
  userStatus: 'invited' | 'active' | 'disabled';
};

export class D1AccessGovernanceRepository
  implements AccessGovernanceRepository
{
  constructor(private readonly database: D1Database) {}

  async listPrincipalAssignments(
    principal: IdentityPrincipal,
  ): Promise<AccessAssignmentSummary[]> {
    const result = await this.database
      .prepare(`
        select
          assignment.id as assignmentId,
          assignment_version.id as assignmentVersionId,
          assignment_version.version as assignmentVersion,
          assignment_version.status as assignmentStatus,
          assignment_version.source_type as sourceType,
          assignment_version.roles_json as rolesJson,
          assignment_version.allow_permissions_json as allowPermissionsJson,
          assignment_version.deny_permissions_json as denyPermissionsJson,
          assignment_version.effective_from as effectiveFrom,
          assignment_version.effective_until as effectiveUntil,
          organization.id as organizationId,
          organization.name as organizationName,
          organization.status as organizationStatus,
          facility.id as facilityId,
          facility.name as facilityName,
          facility.status as facilityStatus,
          department.id as departmentId,
          department.code as departmentCode,
          coalesce(department_version.name, department.name) as departmentName,
          coalesce(department_version.kind, department.kind) as departmentKind,
          coalesce(department_version.status, department.status) as departmentStatus,
          membership.id as membershipId,
          membership.role as membershipLegacyRole,
          membership.status as membershipStatus,
          user.id as userId,
          user.display_name as userDisplayName,
          user.status as userStatus
        from users user
        join memberships membership on membership.user_id = user.id
        join organizations organization
          on organization.id = membership.organization_id
        join facilities facility
          on facility.organization_id = membership.organization_id
          and facility.id = membership.facility_id
        join department_access_assignments assignment
          on assignment.organization_id = membership.organization_id
          and assignment.facility_id = membership.facility_id
          and assignment.membership_id = membership.id
        join department_access_assignment_heads assignment_head
          on assignment_head.organization_id = assignment.organization_id
          and assignment_head.facility_id = assignment.facility_id
          and assignment_head.assignment_id = assignment.id
          and assignment_head.department_id = assignment.department_id
          and assignment_head.membership_id = assignment.membership_id
        join department_access_assignment_versions assignment_version
          on assignment_version.organization_id = assignment_head.organization_id
          and assignment_version.facility_id = assignment_head.facility_id
          and assignment_version.assignment_id = assignment_head.assignment_id
          and assignment_version.department_id = assignment_head.department_id
          and assignment_version.membership_id = assignment_head.membership_id
          and assignment_version.id = assignment_head.current_version_id
        join departments department
          on department.organization_id = assignment.organization_id
          and department.facility_id = assignment.facility_id
          and department.id = assignment.department_id
        left join department_heads department_head
          on department_head.organization_id = department.organization_id
          and department_head.facility_id = department.facility_id
          and department_head.department_id = department.id
        left join department_versions department_version
          on department_version.organization_id = department_head.organization_id
          and department_version.facility_id = department_head.facility_id
          and department_version.department_id = department_head.department_id
          and department_version.id = department_head.current_version_id
        where user.external_issuer = ?1
          and user.external_subject = ?2
        order by organization.name, facility.name, department.name,
          assignment.id
      `)
      .bind(principal.issuer, principal.subject)
      .all<AccessAssignmentRow>();

    const now = Date.now();
    return result.results.map((row) => this.toSummary(row, now));
  }

  private toSummary(
    row: AccessAssignmentRow,
    now: number,
  ): AccessAssignmentSummary {
    const parsed = parseAccessAssignment({
      rolesJson: row.rolesJson,
      allowPermissionsJson: row.allowPermissionsJson,
      denyPermissionsJson: row.denyPermissionsJson,
    });
    const status: AccessAssignmentStatus =
      row.assignmentStatus === 'revoked'
        ? 'revoked'
        : row.effectiveUntil !== null && row.effectiveUntil <= now
          ? 'expired'
          : 'active';

    return {
      assignmentId: row.assignmentId,
      assignmentVersionId: row.assignmentVersionId,
      assignmentVersion: row.assignmentVersion,
      status,
      source: row.sourceType,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      organization: {
        id: row.organizationId,
        name: row.organizationName,
        status: row.organizationStatus,
      },
      facility: {
        id: row.facilityId,
        name: row.facilityName,
        status: row.facilityStatus,
      },
      department: {
        id: row.departmentId,
        code: row.departmentCode,
        name: row.departmentName,
        kind: row.departmentKind,
        status: row.departmentStatus,
      },
      membership: {
        id: row.membershipId,
        legacyRole: row.membershipLegacyRole,
        status: row.membershipStatus,
      },
      user: {
        id: row.userId,
        displayName: row.userDisplayName,
        status: row.userStatus,
      },
      roles: parsed.roles,
      allowPermissions: parsed.allowPermissions,
      denyPermissions: parsed.denyPermissions,
      effectivePermissions: parsed.effectivePermissions,
    };
  }
}
