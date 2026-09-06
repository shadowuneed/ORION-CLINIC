import { env } from 'cloudflare:workers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { grantAccessAssignmentSchema } from '@/lib/domain/access-administration';
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

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/access/admin/assignments');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = grantAccessAssignmentSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_ACCESS_GRANT', 'Проверьте сотрудника, роли, сроки и основание выдачи.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Выдача доступа отключена конфигурацией.');
    }
    const access = await resolveAccessAdministrationRequest({
      request,
      database: env.DB,
      facilityId: payload.facilityId,
      actorAssignmentId: payload.actorAssignmentId,
    });
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const result = await access.repository.grantAssignment({
      ...payload,
      actorId: access.scope.actorUserId,
      requestId: context.requestId,
    });
    return apiSuccess(context, { result, persistence: 'd1' }, 201);
  } catch (error) {
    return accessAdministrationFailure(context, error);
  }
}
