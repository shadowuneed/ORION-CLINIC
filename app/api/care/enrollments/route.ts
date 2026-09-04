import { env } from 'cloudflare:workers';
import { resolveChronicCareAccess } from '@/lib/auth/chronic-care-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { createChronicEnrollmentSchema } from '@/lib/domain/chronic-care';
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
  const context = createApiRequestContext(request, '/api/care/enrollments');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = createChronicEnrollmentSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_CHRONIC_ENROLLMENT',
      'Проверьте пациента, подписанный протокол, диагноз и подтверждения врача.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Включение в локальное тестовое наблюдение отключено.',
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
    const enrollment = await new D1ChronicCareWorkflowRepository(
      env.DB,
      access.scope,
    ).createEnrollment({
      patientId: payload.patientId,
      basisEncounterId: payload.basisEncounterId,
      basisProtocolVersionId: payload.basisProtocolVersionId,
      registryCode: payload.registryCode,
      diagnosisDisplay: payload.diagnosisDisplay,
      diagnosisCode: payload.diagnosisCode,
      diagnosisBasis: payload.diagnosisBasis,
      doctorConfirmed: payload.doctorConfirmed,
      localSourceAcknowledged: payload.localSourceAcknowledged,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { enrollment, persistence: 'd1' }, 201);
  } catch (error) {
    return chronicCareApiFailure(
      context,
      error,
      'CHRONIC_ENROLLMENT_FAILED',
      'Не удалось сохранить решение врача о наблюдении.',
    );
  }
}
