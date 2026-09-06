import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { resolveOrderWorkflowAccess } from '@/lib/auth/order-workflow-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { serviceRequestCommandSchema } from '@/lib/domain/orders';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { orderApiFailure } from '@/lib/http/order-api-errors';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import { D1OrderWorkflowRepository } from '@/lib/repositories/order-workflow';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const context = createApiRequestContext(request, '/api/orders/:requestId/command');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = serviceRequestCommandSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_ORDER_COMMAND', 'Проверьте действие и его основание.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Изменение направления отключено.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveOrderWorkflowAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.accessAssignmentId,
      payload.facilityId,
    );
    const { requestId } = await params;
    const order = await new D1OrderWorkflowRepository(env.DB, access.scope).transition({
      requestIdValue: requestId,
      action: payload.action,
      reason: payload.reason,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { order, persistence: 'd1' });
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'ORDER_COMMAND_FAILED',
      'Не удалось изменить направление.',
    );
  }
}
