import { env } from 'cloudflare:workers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { updateDepartmentSchema } from '@/lib/domain/access-administration';
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
  { params }: { params: Promise<{ departmentId: string }> },
) {
  const context = createApiRequestContext(request, '/api/access/admin/departments/:departmentId');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = updateDepartmentSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_DEPARTMENT_CHANGE', 'Проверьте новую версию и основание изменения.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Управление отделениями отключено конфигурацией.');
    }
    const access = await resolveAccessAdministrationRequest({
      request,
      database: env.DB,
      facilityId: payload.facilityId,
      actorAssignmentId: payload.actorAssignmentId,
    });
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const { departmentId } = await params;
    const result = await access.repository.updateDepartment({
      ...payload,
      departmentId,
      actorId: access.scope.actorUserId,
      requestId: context.requestId,
    });
    return apiSuccess(context, { result, persistence: 'd1' });
  } catch (error) {
    return accessAdministrationFailure(context, error);
  }
}
