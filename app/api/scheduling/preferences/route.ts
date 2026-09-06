import { env } from 'cloudflare:workers';
import { resolveSchedulingAccess } from '@/lib/auth/scheduling-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { createSchedulingPreferenceSchema } from '@/lib/domain/scheduling';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { schedulingApiFailure } from '@/lib/http/scheduling-api-errors';
import { D1SchedulingWorkflowRepository } from '@/lib/repositories/scheduling-workflow';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/scheduling/preferences');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = createSchedulingPreferenceSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_SCHEDULING_PREFERENCE',
      'Проверьте направление, даты, время и подтверждение тестового режима.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Сохранение предпочтений отключено конфигурацией.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveSchedulingAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.accessAssignmentId,
      payload.facilityId,
    );
    const preference = await new D1SchedulingWorkflowRepository(
      env.DB,
      access.scope,
    ).createPreference({
      serviceRequestId: payload.serviceRequestId,
      serviceRequestVersionId: payload.serviceRequestVersionId,
      preferredDateFrom: payload.preferredDateFrom,
      preferredDateTo: payload.preferredDateTo,
      earliestLocalTime: payload.earliestLocalTime,
      latestLocalTime: payload.latestLocalTime,
      preferredProviderId: payload.preferredProviderId,
      notes: payload.notes,
      noticeLanguage: payload.noticeLanguage,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { preference, persistence: 'd1' }, 201);
  } catch (error) {
    return schedulingApiFailure(
      context,
      error,
      'SCHEDULING_PREFERENCE_FAILED',
      'Не удалось сохранить предпочтения пациента.',
    );
  }
}
