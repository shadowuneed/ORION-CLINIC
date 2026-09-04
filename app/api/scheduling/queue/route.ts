import { env } from 'cloudflare:workers';
import { resolveFacilityAccess } from '@/lib/auth/facility-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { issueSchedulingQueueTicketSchema } from '@/lib/domain/scheduling';
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

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/scheduling/queue');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = issueSchedulingQueueTicketSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_QUEUE_ISSUE',
      'Проверьте подтверждённую запись и её текущую версию.',
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
    const ticket = await new D1SchedulingWorkflowRepository(
      env.DB,
      access.scope,
    ).issueQueueTicket({
      appointmentId: payload.appointmentId,
      expectedAppointmentVersion: payload.expectedAppointmentVersion,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { ticket, persistence: 'd1' }, 201);
  } catch (error) {
    return schedulingApiFailure(
      context,
      error,
      'QUEUE_ISSUE_FAILED',
      'Не удалось создать электронный талон.',
    );
  }
}
