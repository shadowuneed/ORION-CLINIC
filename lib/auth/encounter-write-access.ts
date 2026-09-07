import { AccessPermissionRequiredError } from './access-governance';
import type { WorkspaceScope } from './workspace-access';

/** Reusable repository boundary; never infer a missing assignment from membership. */
export async function assertCurrentEncounterWriteAccess(
  database: D1Database, scope: WorkspaceScope, actorId: string,
) {
  if (!scope.accessAssignmentId || scope.accessPermission !== 'encounter.manage') {
    throw new AccessPermissionRequiredError('encounter.manage');
  }
  const allowed = await database.prepare(`
    select access.assignment_id
    from encounter_access_assignment_permissions access
    join memberships member on member.id = access.membership_id
      and member.organization_id = access.organization_id and member.facility_id = access.facility_id
    join encounters encounter on encounter.organization_id = access.organization_id
      and encounter.facility_id = access.facility_id
      and encounter.clinician_membership_id = access.membership_id
    join patients patient on patient.id = encounter.patient_id
      and patient.organization_id = encounter.organization_id and patient.facility_id = encounter.facility_id
      and patient.status = 'active'
    where access.assignment_id = ?1 and access.organization_id = ?2
      and access.facility_id = ?3 and access.membership_id = ?4
      and encounter.id = ?5 and member.user_id = ?6 and access.can_manage = 1
      and access.effective_from <= ?7
      and (access.effective_until is null or access.effective_until > ?7)
  `).bind(scope.accessAssignmentId, scope.organizationId, scope.facilityId,
    scope.reviewerMembershipId, scope.encounterId, actorId, Date.now()).first();
  if (!allowed) throw new AccessPermissionRequiredError('encounter.manage');
}
