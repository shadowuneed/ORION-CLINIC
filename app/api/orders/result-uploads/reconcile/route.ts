import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { resolveOrderWorkflowAccess } from '@/lib/auth/order-workflow-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
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

const reconciliationSchema = z.object({
  facilityId: z.string().min(1).optional(),
  accessAssignmentId: z.string().trim().min(1).max(160).optional(),
  olderThanMinutes: z.number().int().min(15).max(10_080).default(60),
  limit: z.number().int().min(1).max(100).default(25),
});

async function accessFor(
  request: Request,
  accessAssignmentId?: string,
  facilityId?: string,
) {
  const identity = getSiteIdentity(request);
  if (!identity) return null;
  return resolveOrderWorkflowAccess(
    new D1AccessGovernanceRepository(env.DB),
    toSiteIdentityPrincipal(identity),
    accessAssignmentId,
    facilityId,
  );
}

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/orders/result-uploads/reconcile',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }

  let payload: z.infer<typeof reconciliationSchema>;
  try {
    payload = reconciliationSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_UPLOAD_RECONCILIATION',
      'Проверьте филиал, срок ожидания и размер пакета.',
    );
  }

  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Очистка незавершённых тестовых загрузок отключена.',
      );
    }
    const access = await accessFor(
      request,
      payload.accessAssignmentId,
      payload.facilityId,
    );
    if (!access) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    const repository = new D1OrderWorkflowRepository(env.DB, access.scope);
    const before = Date.now() - payload.olderThanMinutes * 60_000;
    const intents = await repository.listExpiredResultUploads({
      before,
      limit: payload.limit,
    });
    let cleaned = 0;
    let deferred = 0;
    const pending: string[] = [];

    for (const intent of intents) {
      try {
        const cleanup =
          intent.status === 'cleanup_pending'
            ? intent
            : await repository.beginResultUploadCleanup({
                commandId: intent.commandId,
                failureCode: 'UPLOAD_RESERVATION_EXPIRED',
                requestId: context.requestId,
              });
        if (!cleanup) continue;

        // A merely reserved upload receives a second grace period. This closes
        // the race where an already-running request writes R2 after cleanup began.
        if (intent.status === 'reserved') {
          deferred += 1;
          continue;
        }

        await env.FILES.delete(cleanup.objectKey);
        await repository.completeResultUploadCleanup({
          commandId: cleanup.commandId,
          requestId: context.requestId,
        });
        cleaned += 1;
      } catch {
        pending.push(intent.commandId);
      }
    }

    return apiSuccess(context, {
      scanned: intents.length,
      cleaned,
      deferred,
      pending,
      retention: 'synthetic-local-upload-intents',
    });
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'UPLOAD_RECONCILIATION_FAILED',
      'Не удалось согласовать незавершённые загрузки.',
    );
  }
}
