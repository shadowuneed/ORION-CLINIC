import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  InteractiveServiceAccessForbiddenError,
  MultipleAccessSelectionRequiredError,
  resolveAccessOverview,
} from '@/lib/auth/access-governance';
import { toSelfAccessResponse } from '@/lib/access/self-access-response';
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
