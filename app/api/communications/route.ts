import { env } from 'cloudflare:workers';
import { resolveCommunicationAccess } from '@/lib/auth/communication-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { communicationListQuerySchema } from '@/lib/domain/patient-communications';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { communicationApiFailure } from '@/lib/http/communication-api-errors';
import { D1PatientCommunicationsRepository } from '@/lib/repositories/patient-communications';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/communications');
  const url = new URL(request.url);
  const parsed = communicationListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    patientId: url.searchParams.get('patientId') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(
      context,
      400,
      'INVALID_COMMUNICATION_QUERY',
      'Проверьте фильтры рабочего места связи.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Локальный тестовый контур связи отключён.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveCommunicationAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.facilityId,
    );
    const repository = new D1PatientCommunicationsRepository(env.DB, access.scope);
    const workspace = await repository.list(parsed.data);
    await repository.recordListRead(context.requestId, {
      patientId: parsed.data.patientId,
      state: parsed.data.state,
      resultCount: workspace.notifications.length + workspace.manualTasks.length,
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
    return communicationApiFailure(
      context,
      error,
      'COMMUNICATION_LIST_FAILED',
      'Не удалось загрузить рабочее место связи.',
    );
  }
}
