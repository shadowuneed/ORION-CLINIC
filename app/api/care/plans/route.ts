import { env } from 'cloudflare:workers';
import { resolveChronicCareAccess } from '@/lib/auth/chronic-care-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { saveSignedCarePlanSchema } from '@/lib/domain/chronic-care';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { chronicCareApiFailure } from '@/lib/http/chronic-care-api-errors';
import { D1ChronicCareWorkflowRepository } from '@/lib/repositories/chronic-care-workflow';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/care/plans');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = saveSignedCarePlanSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_CHRONIC_CARE_PLAN',
      'Проверьте период, цели, мероприятия, лекарства, задачи и подтверждения врача.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Подписание локального тестового плана отключено.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveChronicCareAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const plan = await new D1ChronicCareWorkflowRepository(
      env.DB,
      access.scope,
    ).saveSignedPlan({
      enrollmentId: payload.enrollmentId,
      expectedEnrollmentVersion: payload.expectedEnrollmentVersion,
      expectedPlanVersion: payload.expectedPlanVersion,
      content: payload.content,
      doctorConfirmed: payload.doctorConfirmed,
      localSourceAcknowledged: payload.localSourceAcknowledged,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { plan, persistence: 'd1' }, 201);
  } catch (error) {
    return chronicCareApiFailure(
      context,
      error,
      'CHRONIC_PLAN_FAILED',
      'Не удалось сохранить подписанную версию плана.',
    );
  }
}
