import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  InteractiveServiceAccessForbiddenError,
  MultipleAccessSelectionRequiredError,
  resolveAccessOverview,
  type AccessAssignmentSummary,
} from '@/lib/auth/access-governance';
import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  assignmentId: z.string().trim().min(1).max(160).optional(),
});

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

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/access');
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    assignmentId: url.searchParams.get('assignmentId') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(
      context,
      400,
      'INVALID_ACCESS_QUERY',
      'Проверьте выбранный контур доступа.',
    );
  }

  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
  }

  try {
    const overview = await resolveAccessOverview(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.assignmentId,
    );
    return apiSuccess(context, {
      selected: toSelfAccessResponse(overview.selected),
      assignments: overview.assignments.map(toSelfAccessResponse),
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof MultipleAccessSelectionRequiredError) {
      return apiFailure(
        context,
        409,
        'ACCESS_SELECTION_REQUIRED',
        'Выберите рабочий контур.',
        {
          assignments: error.assignments.map((assignment) => ({
            id: assignment.assignmentId,
            organizationName: assignment.organization.name,
            facilityName: assignment.facility.name,
            departmentName: assignment.department.name,
            roles: assignment.roles,
          })),
        },
      );
    }
    if (
      error instanceof AccessMembershipRequiredError ||
      error instanceof AccessAssignmentNotFoundError ||
      error instanceof InteractiveServiceAccessForbiddenError
    ) {
      return apiFailure(
        context,
        403,
        'ACCESS_FORBIDDEN',
        'Нет активного пользовательского назначения для этого контура.',
      );
    }
    return apiFailure(
      context,
      503,
      'ACCESS_CHECK_UNAVAILABLE',
      'Проверка доступа временно недоступна.',
    );
  }
}
