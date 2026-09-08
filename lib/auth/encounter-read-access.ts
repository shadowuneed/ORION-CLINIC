import { AccessPermissionRequiredError } from './access-governance';
import type { WorkspaceScope } from './workspace-access';

/** Revalidate a server-resolved scope; never choose another assignment implicitly. */
export async function assertCurrentEncounterReadAccess(
  database: D1Database, scope: WorkspaceScope, actorId?: string,
) {
  if (!scope.accessAssignmentId || !['encounter.read', 'encounter.manage'].includes(scope.accessPermission ?? '')) {
    throw new AccessPermissionRequiredError('encounter.read');
  }
  const row = await database.prepare(`
    select access.assignment_id
    from encounter_access_assignment_permissions access
    join memberships member on member.id=access.membership_id
      and member.organization_id=access.organization_id and member.facility_id=access.facility_id
    join encounters encounter on encounter.organization_id=access.organization_id
      and encounter.facility_id=access.facility_id and encounter.clinician_membership_id=access.membership_id
    join patients patient on patient.id=encounter.patient_id
      and patient.organization_id=encounter.organization_id and patient.facility_id=encounter.facility_id
      and patient.status='active'
    where access.assignment_id=?1 and access.organization_id=?2 and access.facility_id=?3
      and access.membership_id=?4 and encounter.id=?5 and (?6 is null or member.user_id=?6)
      and access.can_read=1 and access.effective_from<=?7
      and (access.effective_until is null or access.effective_until>?7)
  `).bind(scope.accessAssignmentId, scope.organizationId, scope.facilityId,
    scope.reviewerMembershipId, scope.encounterId, actorId ?? null, Date.now()).first();
  if (!row) throw new AccessPermissionRequiredError('encounter.read');
}
