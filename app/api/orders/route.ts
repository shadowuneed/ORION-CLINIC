import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { resolveFacilityAccess } from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  createServiceRequestSchema,
  orderListQuerySchema,
} from '@/lib/domain/orders';
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

async function accessFor(request: Request, facilityId?: string) {
  const identity = getSiteIdentity(request);
  if (!identity) return null;
  return resolveFacilityAccess(
    new D1WorkspaceAccessRepository(env.DB),
    toSiteIdentityPrincipal(identity),
    facilityId,
  );
}

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/orders');
  const url = new URL(request.url);
  const parsed = orderListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    kind: url.searchParams.get('kind') ?? undefined,
    query: url.searchParams.get('query') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(context, 400, 'INVALID_ORDER_QUERY', 'Проверьте параметры списка.');
  }
  try {
    const access = await accessFor(request, parsed.data.facilityId);
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const repository = new D1OrderWorkflowRepository(env.DB, access.scope);
    const [orders, encounters] = await Promise.all([
      repository.list({
        status: parsed.data.status,
        kind: parsed.data.kind,
        query: parsed.data.query,
        limit: parsed.data.limit,
      }),
      repository.listEncounterOptions(),
    ]);
    await repository.recordListRead({
      resultCount: orders.length,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      viewer: {
        id: access.user.id,
        displayName: access.user.displayName,
        role: access.membership.role,
      },
      organization: access.organization,
      facility: access.facility,
      facilities: access.facilities,
      orders,
      encounters,
      persistence: 'd1+r2',
      dataMode: 'synthetic-only',
    });
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'ORDER_LIST_FAILED',
      'Не удалось загрузить направления.',
    );
  }
}

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/orders');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = createServiceRequestSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_SERVICE_REQUEST',
      'Проверьте приём, назначение, обоснование и подтверждение тестового режима.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Создание направлений отключено конфигурацией.',
      );
    }
    const access = await accessFor(request, payload.facilityId);
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const order = await new D1OrderWorkflowRepository(env.DB, access.scope).createDraft({
      encounterId: payload.encounterId,
      kind: payload.kind,
      priority: payload.priority,
      requestedService: payload.requestedService,
      targetSpecialty: payload.targetSpecialty,
      medicalJustification: payload.medicalJustification,
      clinicianNote: payload.clinicianNote,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { order, persistence: 'd1' }, 201);
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'ORDER_CREATE_FAILED',
      'Не удалось сохранить черновик направления.',
    );
  }
}
