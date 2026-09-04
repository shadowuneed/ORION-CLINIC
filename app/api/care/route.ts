import { env } from 'cloudflare:workers';
import { resolveChronicCareAccess } from '@/lib/auth/chronic-care-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { chronicCareListQuerySchema } from '@/lib/domain/chronic-care';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { chronicCareApiFailure } from '@/lib/http/chronic-care-api-errors';
import { D1ChronicCareWorkflowRepository } from '@/lib/repositories/chronic-care-workflow';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/care');
  const url = new URL(request.url);
  const parsed = chronicCareListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    dueState: url.searchParams.get('dueState') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(
      context,
      400,
      'INVALID_CHRONIC_CARE_QUERY',
      'Проверьте фильтры наблюдения.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Локальный тестовый контур наблюдения отключён.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveChronicCareAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.facilityId,
    );
    const repository = new D1ChronicCareWorkflowRepository(env.DB, access.scope);
    const workspace = await repository.list(parsed.data);
    await repository.recordListRead({
      resultCount: workspace.enrollments.length + workspace.tasks.length,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      viewer: {
        id: access.user.id,
        displayName: access.user.displayName,
        role: access.scope.role,
      },
      organization: access.organization,
      facility: access.facility,
      facilities: access.facilities,
      ...workspace,
      persistence: 'd1',
    });
  } catch (error) {
    return chronicCareApiFailure(
      context,
      error,
      'CHRONIC_CARE_LIST_FAILED',
      'Не удалось загрузить рабочее место наблюдения.',
    );
  }
}
