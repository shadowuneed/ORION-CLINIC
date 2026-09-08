import { workspaceRequestSelection, workspaceAssignmentFailure } from '@/lib/auth/workspace-request-access';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import {
  AccessibleEncounterNotFoundError,
  ClinicianRoleRequiredError,
  MembershipRequiredError,
  resolveClinicianWorkspaceAccess,
} from '@/lib/auth/workspace-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  exportArtifactKinds,
  sha256Bytes,
} from '@/lib/documents/protocol-artifacts';
import {
  apiBinarySuccess,
  apiFailure,
  createApiRequestContext,
} from '@/lib/http/api-response';
import {
  AccessAuditRequestConflictError,
  AccessAuditUnavailableError,
  D1AccessAuditRepository,
} from '@/lib/repositories/access-audit';
import {
  D1DocumentExportRepository,
  DocumentExportConflictError,
} from '@/lib/repositories/document-export';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  encounterId: z.string().min(1).max(100),
  kind: z.enum(exportArtifactKinds),
});

export async function GET(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/exports/download',
  );
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(
      context,
      401,
      'UNAUTHENTICATED',
      'Требуется вход врача.',
    );
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    encounterId: url.searchParams.get('encounterId'),
    kind: url.searchParams.get('kind'),
  });
  if (!parsed.success) {
    return apiFailure(
      context,
      400,
      'INVALID_DOWNLOAD_REQUEST',
      'Проверьте тип документа и повторите.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      parsed.data.encounterId,
    );
    const repository = new D1DocumentExportRepository(env.DB, access.scope, access.user.id);
    const artifact = await repository.getDownload(parsed.data.kind);
    if (!artifact) {
      return apiFailure(
        context,
        404,
        'EXPORT_NOT_FOUND',
        'Сначала подготовьте комплект документов.',
      );
    }
    const object = await env.FILES.get(artifact.objectKey);
    if (!object) {
      return apiFailure(
        context,
        503,
        'EXPORT_OBJECT_MISSING',
        'Файл временно недоступен. Подготовьте комплект повторно.',
      );
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (
      bytes.byteLength !== artifact.byteSize ||
      (await sha256Bytes(bytes)) !== artifact.sha256
    ) {
      return apiFailure(
        context,
        503,
        'EXPORT_INTEGRITY_FAILED',
        'Проверка целостности файла не пройдена.',
      );
    }
    await repository.assertDownloadAuthorized(artifact, access.user.id);
    await new D1AccessAuditRepository(
      env.DB,
      access.scope,
    ).recordDocumentDownload(artifact, {
      actorId: access.user.id,
      requestId: context.requestId,
    });
    await repository.assertDownloadAuthorized(artifact, access.user.id);
    return apiBinarySuccess(
      context,
      Uint8Array.from(bytes).buffer,
      {
        'Content-Type': artifact.mimeType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
        'X-Content-Type-Options': 'nosniff',
        'X-ORION-SHA256': artifact.sha256,
      },
    );
  } catch (error) {
    const assignmentFailure = workspaceAssignmentFailure(context, error);
    if (assignmentFailure) return assignmentFailure;
    if (error instanceof DocumentExportConflictError) {
      return apiFailure(context, 409, 'EXPORT_SOURCE_CHANGED', 'Документ изменился. Обновите приём и повторите скачивание.');
    }
    if (error instanceof MembershipRequiredError) {
      return apiFailure(
        context,
        403,
        'MEMBERSHIP_REQUIRED',
        'Для пользователя не найден активный доступ к клинике.',
      );
    }
    if (error instanceof ClinicianRoleRequiredError) {
      return apiFailure(
        context,
        403,
        'CLINICIAN_ROLE_REQUIRED',
        'Документы может скачать только назначенный врач.',
      );
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(
        context,
        404,
        'ENCOUNTER_NOT_FOUND',
        'Приём не найден или недоступен.',
      );
    }
    if (
      error instanceof AccessAuditUnavailableError ||
      error instanceof AccessAuditRequestConflictError
    ) {
      return apiFailure(
        context,
        503,
        'ACCESS_AUDIT_UNAVAILABLE',
        'Не удалось зафиксировать выдачу файла. Файл не отправлен.',
      );
    }
    return apiFailure(
      context,
      500,
      'EXPORT_DOWNLOAD_FAILED',
      'Не удалось скачать документ.',
    );
  }
}
