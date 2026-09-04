import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { resolveFacilityAccess } from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { diagnosticResultReviewSchema } from '@/lib/domain/orders';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { orderApiFailure } from '@/lib/http/order-api-errors';
import { D1OrderWorkflowRepository } from '@/lib/repositories/order-workflow';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const context = createApiRequestContext(request, '/api/orders/:requestId/result/review');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = diagnosticResultReviewSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_RESULT_REVIEW', 'Проверьте решение врача и комментарий.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Проверка результата отключена.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveFacilityAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const { requestId } = await params;
    const order = await new D1OrderWorkflowRepository(env.DB, access.scope).reviewResult({
      requestIdValue: requestId,
      decision: payload.decision,
      note: payload.note,
      expectedReportVersion: payload.expectedReportVersion,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { order, persistence: 'd1' });
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'RESULT_REVIEW_FAILED',
      'Не удалось сохранить решение по результату.',
    );
  }
}
