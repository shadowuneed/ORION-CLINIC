import { env } from 'cloudflare:workers';
import { resolveCommunicationAccess } from '@/lib/auth/communication-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { scheduleNotificationSchema } from '@/lib/domain/patient-communications';
import { apiFailure, apiSuccess, createApiRequestContext, hasSameOrigin } from '@/lib/http/api-response';
import { communicationApiFailure } from '@/lib/http/communication-api-errors';
import { D1PatientCommunicationsRepository } from '@/lib/repositories/patient-communications';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/communications/notifications');
  if (!hasSameOrigin(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  let payload;
  try {
    payload = scheduleNotificationSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_NOTIFICATION', 'Проверьте источник, канал, язык и время.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Тестовая очередь отключена.');
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveCommunicationAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const notification = await new D1PatientCommunicationsRepository(
      env.DB,
      access.scope,
    ).scheduleNotification({
      sourceType: payload.sourceType,
      sourceRecordId: payload.sourceRecordId,
      sourceVersionId: payload.sourceVersionId,
      channel: payload.channel,
      language: payload.language,
      scheduledAt: payload.scheduledAt,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { notification, persistence: 'd1' }, 201);
  } catch (error) {
    return communicationApiFailure(context, error, 'NOTIFICATION_SCHEDULE_FAILED', 'Не удалось создать намерение уведомления.');
  }
}
