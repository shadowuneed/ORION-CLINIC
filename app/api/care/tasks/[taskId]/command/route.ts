import { env } from 'cloudflare:workers';
import { resolveChronicCareAccess } from '@/lib/auth/chronic-care-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { chronicTaskCommandSchema } from '@/lib/domain/chronic-care';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { chronicCareApiFailure } from '@/lib/http/chronic-care-api-errors';
import { D1ChronicCareWorkflowRepository } from '@/lib/repositories/chronic-care-workflow';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const context = createApiRequestContext(request, '/api/care/tasks/:taskId/command');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = chronicTaskCommandSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_CHRONIC_TASK_COMMAND',
      'Проверьте действие, версию, основание и структурированный ответ пациента.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Работа с локальными тестовыми задачами отключена.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveChronicCareAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.accessAssignmentId,
      payload.facilityId,
    );
    const { taskId } = await params;
    const task = await new D1ChronicCareWorkflowRepository(
      env.DB,
      access.scope,
    ).commandTask({
      taskId,
      action: payload.action,
      expectedTaskVersion: payload.expectedTaskVersion,
      reason: payload.reason,
      contactMethod: payload.contactMethod,
      wellbeing: payload.wellbeing,
      responseSummary: payload.responseSummary,
      escalationReason: payload.escalationReason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { task, persistence: 'd1' });
  } catch (error) {
    return chronicCareApiFailure(
      context,
      error,
      'CHRONIC_TASK_COMMAND_FAILED',
      'Не удалось изменить задачу наблюдения.',
    );
  }
}
