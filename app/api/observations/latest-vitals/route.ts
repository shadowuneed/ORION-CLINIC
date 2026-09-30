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
  const context = createApiRequestContext(request, '/api/observations/latest-vitals');
  const params = new URL(request.url).searchParams;
  const parsed = observationListQuerySchema.safeParse({
    facilityId: params.get('facilityId') ?? undefined,
    accessAssignmentId: params.get('accessAssignmentId') ?? undefined,
    patientId: params.get('patientId') ?? undefined,
    limit: 1,
  });
  if (!parsed.success || !parsed.data.patientId ||
    ['facilityId', 'accessAssignmentId', 'patientId'].some((key) => params.getAll(key).length > 1)) {
    return apiFailure(context, 400, 'INVALID_OBSERVATION_QUERY', 'Проверьте пациента и рабочий доступ.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Контур показателей отключён.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const accessRepository = new D1AccessGovernanceRepository(env.DB);
    const principal = toSiteIdentityPrincipal(identity);
    const access = await resolveObservationAccess(accessRepository, principal,
      parsed.data.accessAssignmentId, parsed.data.facilityId);
    const repository = new D1PatientObservationRepository(env.DB, access.scope);
    const vitals = await repository.latestVitals(parsed.data.patientId);
    await repository.recordListRead({
      patientId: parsed.data.patientId,
      resultCount: new Set(Object.values(vitals).filter((entry) => entry !== null).map((entry) => entry.observationId)).size,
      requestId: context.requestId,
    });
    // A slow read/audit must not release data after the selected access is revoked.
    await resolveObservationAccess(accessRepository, principal,
      access.scope.accessAssignmentId, access.scope.facilityId);
    return apiSuccess(context, { vitals });
  } catch (error) {
    return observationApiFailure(context, error, 'LATEST_VITALS_UNAVAILABLE', 'Не удалось загрузить показатели.');
  }
}
