import { env } from 'cloudflare:workers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { updateAccessAssignmentSchema } from '@/lib/domain/access-administration';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  accessAdministrationFailure,
  resolveAccessAdministrationRequest,
} from '@/lib/http/access-administration-api';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const context = createApiRequestContext(request, '/api/access/admin/assignments/:assignmentId');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = updateAccessAssignmentSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_ACCESS_CHANGE', 'Проверьте текущую версию, роли, сроки и основание изменения.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Изменение доступа отключено конфигурацией.');
    }
    const access = await resolveAccessAdministrationRequest({
      request,
      database: env.DB,
      facilityId: payload.facilityId,
      actorAssignmentId: payload.actorAssignmentId,
    });
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const { assignmentId } = await params;
    const result = await access.repository.updateAssignment({
      ...payload,
      assignmentId,
      actorId: access.scope.actorUserId,
      requestId: context.requestId,
    });
    return apiSuccess(context, { result, persistence: 'd1' });
  } catch (error) {
    return accessAdministrationFailure(context, error);
  }
}
