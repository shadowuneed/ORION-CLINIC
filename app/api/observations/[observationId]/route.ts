import { env } from 'cloudflare:workers';
import { resolveObservationAccess } from '@/lib/auth/observation-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { correctObservationSchema } from '@/lib/domain/observations';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { observationApiFailure } from '@/lib/http/observation-api-errors';
import { D1PatientObservationRepository } from '@/lib/repositories/patient-observations';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ observationId: string }> },
) {
  const context = createApiRequestContext(
    request,
    '/api/observations/:observationId',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = correctObservationSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_OBSERVATION_CORRECTION',
      'Проверьте значения, причину исправления и текущую версию.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Исправление тестовых показателей отключено.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveObservationAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const { observationId } = await params;
    const observation = await new D1PatientObservationRepository(
      env.DB,
      access.scope,
    ).correct({
      observationId,
      patientId: payload.patientId,
      expectedVersion: payload.expectedVersion,
      measuredAt: payload.measuredAt,
      context: payload.context,
      values: payload.values,
      note: payload.note,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { observation, persistence: 'd1' });
  } catch (error) {
    return observationApiFailure(
      context,
      error,
      'OBSERVATION_CORRECTION_FAILED',
      'Не удалось сохранить исправление.',
    );
  }
}
