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
import { generateProtocolArtifacts } from '@/lib/documents/protocol-artifacts';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1DocumentExportRepository,
  DocumentExportConflictError,
  DocumentExportLifecycleError,
  DocumentExportNotFoundError,
  DocumentExportSourceChangedError,
} from '@/lib/repositories/document-export';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  protocolId: z.string().min(1).max(100),
  expectedProtocolVersion: z.number().int().positive(),
  acknowledgeSyntheticExport: z.literal(true),
  idempotencyKey: z.string().uuid(),
});

function safeKeyPart(value: string) {
  return encodeURIComponent(value).replaceAll('%', '_');
}

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/exports/generate',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(
      context,
      401,
      'UNAUTHENTICATED',
      'Требуется вход врача.',
    );
  }

  let payload: z.infer<typeof commandSchema>;
  try {
    payload = commandSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_EXPORT_REQUEST',
      'Подтвердите создание синтетического комплекта документов.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const repository = new D1DocumentExportRepository(env.DB, access.scope);
    const source = await repository.getSignedSource();
    if (
      source.protocol.id !== payload.protocolId ||
      source.protocol.version !== payload.expectedProtocolVersion
    ) {
      throw new DocumentExportConflictError('Signed protocol changed');
    }
    const generated = await generateProtocolArtifacts(source);
    const prefix = [
      'synthetic-exports',
      safeKeyPart(access.scope.organizationId),
      safeKeyPart(access.scope.facilityId),
      safeKeyPart(access.scope.encounterId),
      safeKeyPart(source.protocol.id),
      `v${source.protocol.version}`,
    ].join('/');
    await Promise.all(
      generated.map((artifact) =>
        env.FILES.put(`${prefix}/${artifact.filename}`, artifact.bytes, {
          httpMetadata: { contentType: artifact.mimeType },
          customMetadata: {
            sha256: artifact.sha256,
            sourceHash: source.protocol.sourceHash,
            kind: artifact.kind,
            dataMode: 'synthetic-only',
          },
        }),
      ),
    );
    const result = await repository.recordGenerated({
      protocolId: source.protocol.id,
      protocolVersion: source.protocol.version,
      artifacts: generated.map((artifact) => ({
        kind: artifact.kind,
        filename: artifact.filename,
        objectKey: `${prefix}/${artifact.filename}`,
        mimeType: artifact.mimeType,
        sha256: artifact.sha256,
        byteSize: artifact.bytes.byteLength,
      })),
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    const encounterId = encodeURIComponent(access.scope.encounterId);
    return apiSuccess(
      context,
      {
        ...result,
        artifacts: result.artifacts.map((artifact) => ({
          ...artifact,
          downloadUrl: `/api/workspace/exports/download?encounterId=${encounterId}&kind=${artifact.kind}`,
        })),
        persistence: 'local-d1-r2',
      },
      201,
    );
  } catch (error) {
    const assignmentFailure = workspaceAssignmentFailure(context, error);
    if (assignmentFailure) return assignmentFailure;
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
        'Документы может выгрузить только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof DocumentExportNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'SIGNED_PROTOCOL_NOT_FOUND',
        'Подписанный протокол не найден или недоступен.',
      );
    }
    if (error instanceof DocumentExportLifecycleError) {
      return apiFailure(
        context,
        422,
        'ENCOUNTER_NOT_FINALIZED',
        'Комплект доступен только после подписания протокола.',
      );
    }
    if (
      error instanceof DocumentExportConflictError ||
      error instanceof DocumentExportSourceChangedError
    ) {
      return apiFailure(
        context,
        409,
        'EXPORT_SOURCE_CHANGED',
        'Подписанный источник изменился. Обновите приём и повторите.',
      );
    }
    return apiFailure(
      context,
      500,
      'EXPORT_GENERATION_FAILED',
      'Не удалось подготовить комплект документов.',
    );
  }
}
