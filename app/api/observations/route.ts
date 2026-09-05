import { env } from 'cloudflare:workers';
import { resolveObservationAccess } from '@/lib/auth/observation-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  createObservationSchema,
  observationListQuerySchema,
} from '@/lib/domain/observations';
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

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/observations');
  const url = new URL(request.url);
  const parsed = observationListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    patientId: url.searchParams.get('patientId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(
      context,
      400,
      'INVALID_OBSERVATION_QUERY',
      'Проверьте пациента и параметры списка.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Локальный тестовый контур показателей отключён.',
      );
    }
    const identity = getSiteIdentity(request);
    if (!identity) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const access = await resolveObservationAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      parsed.data.facilityId,
    );
    const repository = new D1PatientObservationRepository(env.DB, access.scope);
    const workspace = await repository.list({
      patientId: parsed.data.patientId,
      limit: parsed.data.limit,
    });
    await repository.recordListRead({
      patientId: parsed.data.patientId ?? null,
      resultCount: workspace.observations.length,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      viewer: {
        id: access.user.id,
        displayName: access.user.displayName,
        membershipId: access.scope.membershipId,
        role: access.scope.role,
      },
      organization: access.organization,
      facility: access.facility,
      facilities: access.facilities,
      ...workspace,
      persistence: 'd1',
    });
  } catch (error) {
    return observationApiFailure(
      context,
      error,
      'OBSERVATION_LIST_FAILED',
      'Не удалось загрузить показатели.',
    );
  }
}

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/observations');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = createObservationSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_OBSERVATION',
      'Проверьте пациента, время и заполненные группы показателей.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Сохранение тестовых показателей отключено.',
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
    const observation = await new D1PatientObservationRepository(
      env.DB,
      access.scope,
    ).create({
      patientId: payload.patientId,
      measuredAt: payload.measuredAt,
      context: payload.context,
      values: payload.values,
      note: payload.note,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { observation, persistence: 'd1' }, 201);
  } catch (error) {
    return observationApiFailure(
      context,
      error,
      'OBSERVATION_CREATE_FAILED',
      'Не удалось сохранить показатели.',
    );
  }
}
