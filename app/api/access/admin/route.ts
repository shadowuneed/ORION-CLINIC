import { env } from 'cloudflare:workers';
import { accessAdministrationQuerySchema } from '@/lib/domain/access-administration';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';
import {
  accessAdministrationFailure,
  resolveAccessAdministrationRequest,
} from '@/lib/http/access-administration-api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/access/admin');
  const url = new URL(request.url);
  const parsed = accessAdministrationQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    actorAssignmentId: url.searchParams.get('actorAssignmentId') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(context, 400, 'INVALID_ACCESS_QUERY', 'Проверьте выбранный рабочий контур.');
  }
  try {
    const access = await resolveAccessAdministrationRequest({
      request,
      database: env.DB,
      ...parsed.data,
    });
    if (!access) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const workspace = await access.repository.getWorkspace();
    return apiSuccess(context, {
      actorAssignmentId: access.overview.selected.assignmentId,
      organization: access.overview.selected.organization,
      facility: access.overview.selected.facility,
      workspace,
      persistence: 'd1',
    });
  } catch (error) {
    return accessAdministrationFailure(context, error);
  }
}
