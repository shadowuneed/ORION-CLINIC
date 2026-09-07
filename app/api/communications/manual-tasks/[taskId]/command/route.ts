import { env } from 'cloudflare:workers';
import { resolveCommunicationAccess } from '@/lib/auth/communication-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { manualContactCommandSchema } from '@/lib/domain/patient-communications';
import { apiFailure, apiSuccess, createApiRequestContext, hasSameOrigin } from '@/lib/http/api-response';
import { communicationApiFailure } from '@/lib/http/communication-api-errors';
import { D1PatientCommunicationsRepository } from '@/lib/repositories/patient-communications';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const context = createApiRequestContext(request, '/api/communications/manual-tasks/:taskId/command');
  if (!hasSameOrigin(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  let payload;
  try {
    payload = manualContactCommandSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_MANUAL_TASK_COMMAND', 'Проверьте действие, версию и ответ пациента.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Ручные тестовые задачи отключены.');
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveCommunicationAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.accessAssignmentId,
      payload.facilityId,
    );
    const { taskId } = await params;
    const task = await new D1PatientCommunicationsRepository(
      env.DB,
      access.scope,
    ).commandManualTask({
      taskId,
      action: payload.action,
      expectedVersion: payload.expectedVersion,
      reason: payload.reason,
      responseKind: payload.responseKind,
      responseLanguage: payload.responseLanguage,
      responseSummary: payload.responseSummary,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { task, persistence: 'd1' });
  } catch (error) {
    return communicationApiFailure(context, error, 'MANUAL_TASK_COMMAND_FAILED', 'Не удалось изменить задачу ручного контакта.');
  }
}
