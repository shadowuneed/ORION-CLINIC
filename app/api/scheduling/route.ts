import { env } from 'cloudflare:workers';
import { resolveFacilityAccess } from '@/lib/auth/facility-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { schedulingListQuerySchema, SYNTHETIC_SCHEDULE_SOURCE_LABEL } from '@/lib/domain/scheduling';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';
import { schedulingApiFailure } from '@/lib/http/scheduling-api-errors';
import { D1SchedulingWorkflowRepository } from '@/lib/repositories/scheduling-workflow';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/scheduling');
  const url = new URL(request.url);
  const parsed = schedulingListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    dateFrom: url.searchParams.get('dateFrom') ?? undefined,
    dateTo: url.searchParams.get('dateTo') ?? undefined,
    specialtyId: url.searchParams.get('specialtyId') ?? undefined,
    providerId: url.searchParams.get('providerId') ?? undefined,
    slotStatus: url.searchParams.get('slotStatus') ?? undefined,
    appointmentStatus: url.searchParams.get('appointmentStatus') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(
      context,
      400,
      'INVALID_SCHEDULING_QUERY',
      'Проверьте фильтры расписания.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Локальное тестовое расписание отключено конфигурацией.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveFacilityAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.facilityId,
    );
    const repository = new D1SchedulingWorkflowRepository(env.DB, access.scope);
    const workspace = await repository.list(parsed.data);
    await repository.recordListRead({
      resultCount:
        workspace.eligibleReferrals.length +
        workspace.appointments.length +
        workspace.queue.length,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      viewer: {
        id: access.user.id,
        displayName: access.user.displayName,
        role: access.membership.role,
      },
      organization: access.organization,
      facility: access.facility,
      facilities: access.facilities,
      sourceLabel: SYNTHETIC_SCHEDULE_SOURCE_LABEL,
      ...workspace,
      persistence: 'd1',
      dataMode: 'synthetic-only',
    });
  } catch (error) {
    return schedulingApiFailure(
      context,
      error,
      'SCHEDULING_LIST_FAILED',
      'Не удалось загрузить расписание.',
    );
  }
}
