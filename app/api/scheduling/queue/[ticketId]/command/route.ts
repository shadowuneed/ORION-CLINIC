import { env } from 'cloudflare:workers';
import { resolveFacilityAccess } from '@/lib/auth/facility-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { schedulingQueueCommandSchema } from '@/lib/domain/scheduling';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { schedulingApiFailure } from '@/lib/http/scheduling-api-errors';
import { D1SchedulingWorkflowRepository } from '@/lib/repositories/scheduling-workflow';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const context = createApiRequestContext(
    request,
    '/api/scheduling/queue/:ticketId/command',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = schedulingQueueCommandSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_QUEUE_COMMAND',
      'Проверьте действие очереди, версии, кабинет и основание.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Очередь отключена.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveFacilityAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const { ticketId } = await params;
    const ticket = await new D1SchedulingWorkflowRepository(
      env.DB,
      access.scope,
    ).commandQueue({
      ticketId,
      action: payload.action,
      expectedQueueVersion: payload.expectedQueueVersion,
      expectedAppointmentVersion: payload.expectedAppointmentVersion,
      reason: payload.reason,
      roomLabel: payload.roomLabel,
      exceptionCode: payload.exceptionCode,
      exceptionNote: payload.exceptionNote,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { ticket, persistence: 'd1' });
  } catch (error) {
    return schedulingApiFailure(
      context,
      error,
      'QUEUE_COMMAND_FAILED',
      'Не удалось изменить состояние очереди.',
    );
  }
}
