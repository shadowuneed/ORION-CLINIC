import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';

/**
 * Public self-access contract. Internal user, membership and version-row IDs,
 * legacy roles and raw allow/deny inputs stay on the server.
 */
export function toSelfAccessResponse(assignment: AccessAssignmentSummary) {
  return {
    assignmentId: assignment.assignmentId,
    assignmentVersion: assignment.assignmentVersion,
    status: assignment.status,
    source: assignment.source,
    effectiveFrom: assignment.effectiveFrom,
    effectiveUntil: assignment.effectiveUntil,
    organization: {
      id: assignment.organization.id,
      name: assignment.organization.name,
    },
    facility: {
      id: assignment.facility.id,
      name: assignment.facility.name,
    },
    department: {
      id: assignment.department.id,
      code: assignment.department.code,
      name: assignment.department.name,
      kind: assignment.department.kind,
    },
    roles: assignment.roles,
    effectivePermissions: assignment.effectivePermissions,
  };
}
