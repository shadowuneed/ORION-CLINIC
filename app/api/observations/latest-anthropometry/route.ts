import { env } from 'cloudflare:workers';
import { resolveObservationAccess } from '@/lib/auth/observation-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { observationListQuerySchema } from '@/lib/domain/observations';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { observationApiFailure } from '@/lib/http/observation-api-errors';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import { D1PatientObservationRepository } from '@/lib/repositories/patient-observations';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/observations/latest-anthropometry');
  const url = new URL(request.url);
  const parsed = observationListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    accessAssignmentId: url.searchParams.get('accessAssignmentId') ?? undefined,
    patientId: url.searchParams.get('patientId') ?? undefined,
    limit: 1,
  });
  if (!parsed.success || !parsed.data.patientId) {
    return apiFailure(context, 400, 'INVALID_OBSERVATION_QUERY', 'Проверьте пациента и рабочий доступ.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Локальный контур показателей отключён.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveObservationAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.accessAssignmentId,
      parsed.data.facilityId,
    );
    const repository = new D1PatientObservationRepository(env.DB, access.scope);
    const measurement = await repository.latestAnthropometry(parsed.data.patientId);
    await repository.recordListRead({
      patientId: parsed.data.patientId,
      resultCount: measurement ? 1 : 0,
      requestId: context.requestId,
    });
    return apiSuccess(context, { measurement, persistence: 'd1' });
  } catch (error) {
    return observationApiFailure(context, error, 'LATEST_ANTHROPOMETRY_UNAVAILABLE', 'Не удалось загрузить измерение.');
  }
}
