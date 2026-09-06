import { env } from 'cloudflare:workers';
import { resolveSchedulingAccess } from '@/lib/auth/scheduling-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { schedulingAppointmentCommandSchema } from '@/lib/domain/scheduling';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { schedulingApiFailure } from '@/lib/http/scheduling-api-errors';
import { D1SchedulingWorkflowRepository } from '@/lib/repositories/scheduling-workflow';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  const context = createApiRequestContext(
    request,
    '/api/scheduling/appointments/:appointmentId/command',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = schedulingAppointmentCommandSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_APPOINTMENT_COMMAND',
      'Проверьте действие, версии и обязательную причину.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Запись отключена.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveSchedulingAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.accessAssignmentId,
      payload.facilityId,
    );
    const { appointmentId } = await params;
    const appointment = await new D1SchedulingWorkflowRepository(
      env.DB,
      access.scope,
    ).commandAppointment({
      appointmentId,
      action: payload.action,
      expectedAppointmentVersion: payload.expectedAppointmentVersion,
      expectedSlotVersion: payload.expectedSlotVersion,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { appointment, persistence: 'd1' });
  } catch (error) {
    return schedulingApiFailure(
      context,
      error,
      'APPOINTMENT_COMMAND_FAILED',
      'Не удалось изменить запись.',
    );
  }
}
