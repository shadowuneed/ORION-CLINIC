import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { resolveClinicianWorkspaceAccess, AccessibleEncounterNotFoundError, MembershipRequiredError,
  ClinicianRoleRequiredError } from '@/lib/auth/workspace-access';
import { workspaceRequestSelection, workspaceAssignmentFailure } from '@/lib/auth/workspace-request-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { reconcileExportAttempt } from '@/lib/documents/export-reconciliation';
import { apiFailure, apiSuccess, createApiRequestContext, hasSameOrigin } from '@/lib/http/api-response';
import { D1DocumentExportRepository, DocumentExportConflictError } from '@/lib/repositories/document-export';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';
const schema = z.object({ encounterId: z.string().min(1).max(100), protocolId: z.string().min(1).max(100),
  expectedProtocolVersion: z.number().int().positive(), idempotencyKey: z.string().uuid(),
  attemptId: z.string().uuid(), acknowledgeSyntheticCleanup: z.literal(true) }).strict();

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/workspace/exports/reconcile');
  if (!hasSameOrigin(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  const identity = getSiteIdentity(request);
  if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  let payload: z.infer<typeof schema>;
  try { payload = schema.parse(await request.json()); }
  catch { return apiFailure(context, 400, 'INVALID_EXPORT_RECONCILIATION', 'Укажите точную незавершённую выгрузку.'); }
  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity), payload.encounterId);
    const repository = new D1DocumentExportRepository(env.DB, access.scope, access.user.id);
    const intent = { protocolId: payload.protocolId, protocolVersion: payload.expectedProtocolVersion,
      actorId: access.user.id, idempotencyKey: payload.idempotencyKey };
    const result = await reconcileExportAttempt({ bucket: env.FILES, repository, scope: access.scope, intent,
      attemptId: payload.attemptId, requestId: context.requestId });
    await repository.assertGenerationAuthorized(intent.protocolId, intent.protocolVersion, intent.actorId);
    return apiSuccess(context, result);
  } catch (error) {
    const denied = workspaceAssignmentFailure(context, error);
    if (denied) return denied;
    if (error instanceof AccessibleEncounterNotFoundError || error instanceof MembershipRequiredError ||
      error instanceof ClinicianRoleRequiredError) return apiFailure(context, 403, 'EXPORT_ACCESS_DENIED', 'Выгрузка недоступна.');
    if (error instanceof DocumentExportConflictError) return apiFailure(context, 409, 'EXPORT_SOURCE_CHANGED', 'Обновите приём перед повтором.');
    return apiFailure(context, 503, 'EXPORT_RECONCILIATION_INCOMPLETE', 'Проверка не завершена. Файлы без подтверждения безопасности не удаляются.');
  }
}
