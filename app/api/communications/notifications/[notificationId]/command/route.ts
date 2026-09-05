import { env } from 'cloudflare:workers';
import { resolveCommunicationAccess } from '@/lib/auth/communication-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { processNotificationSchema } from '@/lib/domain/patient-communications';
import { apiFailure, apiSuccess, createApiRequestContext, hasSameOrigin } from '@/lib/http/api-response';
import { communicationApiFailure } from '@/lib/http/communication-api-errors';
import { D1PatientCommunicationsRepository } from '@/lib/repositories/patient-communications';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  const context = createApiRequestContext(request, '/api/communications/notifications/:notificationId/command');
  if (!hasSameOrigin(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  let payload;
  try {
    payload = processNotificationSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_NOTIFICATION_COMMAND', 'Проверьте действие, версию и основание.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Обработка тестовой очереди отключена.');
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveCommunicationAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const { notificationId } = await params;
    const notification = await new D1PatientCommunicationsRepository(
      env.DB,
      access.scope,
    ).processNotification({
      notificationId,
      action: payload.action,
      expectedVersion: payload.expectedVersion,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { notification, persistence: 'd1' });
  } catch (error) {
    return communicationApiFailure(context, error, 'NOTIFICATION_COMMAND_FAILED', 'Не удалось изменить состояние уведомления.');
  }
}
