import { AccessPermissionRequiredError } from './access-governance';
import type { WorkspaceScope } from './workspace-access';

/** Creation is authorized by a current doctor assignment, never by an old encounter. */
export type EncounterCreationScope = Omit<WorkspaceScope, 'encounterId'>;

export async function assertEncounterCreationAccess(database: D1Database, scope: EncounterCreationScope, actorId: string) {
  if (!scope.accessAssignmentId || scope.accessPermission !== 'encounter.manage') {
    throw new AccessPermissionRequiredError('encounter.manage');
  }
  const access = await database.prepare(`
    select permission.assignment_id from encounter_access_assignment_permissions permission
    join memberships member on member.id=permission.membership_id
      and member.organization_id=permission.organization_id and member.facility_id=permission.facility_id
    where permission.assignment_id=?1 and permission.organization_id=?2 and permission.facility_id=?3
      and permission.membership_id=?4 and member.user_id=?5 and permission.can_manage=1
      and permission.effective_from<=?6 and (permission.effective_until is null or permission.effective_until>?6)
  `).bind(scope.accessAssignmentId, scope.organizationId, scope.facilityId,
    scope.reviewerMembershipId, actorId, Date.now()).first();
  if (!access) throw new AccessPermissionRequiredError('encounter.manage');
}
