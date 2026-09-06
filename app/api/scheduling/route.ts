import { env } from 'cloudflare:workers';
import { resolveSchedulingAccess } from '@/lib/auth/scheduling-access';
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
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/scheduling');
  const url = new URL(request.url);
  const parsed = schedulingListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    accessAssignmentId: url.searchParams.get('accessAssignmentId') ?? undefined,
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
    const access = await resolveSchedulingAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.accessAssignmentId,
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
        role: access.scope.role,
        accessAssignmentId: access.scope.accessAssignmentId,
      },
      organization: access.organization,
      facility: access.facility,
      accessAssignment: {
        assignmentId: access.assignment.assignmentId,
        departmentName: access.assignment.department.name,
        role: access.scope.role,
      },
      assignments: access.assignments,
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
