import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { resolveFacilityAccess } from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  detectDiagnosticArtifactMime,
  diagnosticArtifactObjectKey,
  diagnosticResultMetadataSchema,
  MAX_DIAGNOSTIC_ARTIFACT_BYTES,
  sanitizeDiagnosticFileName,
} from '@/lib/domain/orders';
import {
  apiBinarySuccess,
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { orderApiFailure } from '@/lib/http/order-api-errors';
import {
  D1OrderWorkflowRepository,
  OrderWorkflowConflictError,
  sha256DiagnosticBytes,
} from '@/lib/repositories/order-workflow';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const extensionByMime = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;

async function stableUploadHash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function accessFor(request: Request) {
  const identity = getSiteIdentity(request);
  if (!identity) return null;
  return resolveFacilityAccess(
    new D1WorkspaceAccessRepository(env.DB),
    toSiteIdentityPrincipal(identity),
    new URL(request.url).searchParams.get('facilityId') ?? undefined,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const context = createApiRequestContext(request, '/api/orders/:requestId/result');
  try {
    const access = await accessFor(request);
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const { requestId } = await params;
    const repository = new D1OrderWorkflowRepository(env.DB, access.scope);
    const artifact = await repository.getCurrentArtifact(requestId);
    if (!artifact) {
      return apiFailure(context, 404, 'RESULT_ARTIFACT_NOT_FOUND', 'Файл результата не найден.');
    }
    const object = await env.FILES.get(artifact.objectKey);
    if (!object) {
      return apiFailure(context, 503, 'RESULT_OBJECT_MISSING', 'Файл результата временно недоступен.');
    }
    const bytes = await object.arrayBuffer();
    if (
      bytes.byteLength !== artifact.byteSize ||
      (await sha256DiagnosticBytes(bytes)) !== artifact.sha256
    ) {
      return apiFailure(context, 503, 'RESULT_INTEGRITY_FAILED', 'Проверка целостности файла не пройдена.');
    }
    await repository.recordArtifactRead({
      requestIdValue: requestId,
      artifactId: artifact.id,
      requestId: context.requestId,
    });
    const encodedName = encodeURIComponent(artifact.fileName).replaceAll("'", '%27');
    return apiBinarySuccess(
      context,
      bytes,
      {
        'Content-Type': artifact.mimeType,
        'Content-Length': String(artifact.byteSize),
        'Content-Disposition': `attachment; filename="result.${extensionByMime[artifact.mimeType]}"; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
      },
      200,
    );
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'RESULT_DOWNLOAD_FAILED',
      'Не удалось скачать результат.',
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const context = createApiRequestContext(request, '/api/orders/:requestId/result');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_DIAGNOSTIC_ARTIFACT_BYTES + 256 * 1024) {
    return apiFailure(context, 413, 'RESULT_TOO_LARGE', 'Файл должен быть не больше 10 МБ.');
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Загрузка результатов отключена.');
    }
    const access = await accessFor(request);
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const form = await request.formData();
    const parsed = diagnosticResultMetadataSchema.safeParse({
      facilityId: new URL(request.url).searchParams.get('facilityId') ?? undefined,
      reportStatus: form.get('reportStatus'),
      conclusion: form.get('conclusion') || null,
      changeReason: form.get('changeReason'),
      expectedReportVersion: Number(form.get('expectedReportVersion')),
      testDataAcknowledged: form.get('testDataAcknowledged') === 'true',
      idempotencyKey: form.get('idempotencyKey'),
    });
    const file = form.get('file');
    if (!parsed.success || !(file instanceof File)) {
      return apiFailure(
        context,
        400,
        'INVALID_RESULT_UPLOAD',
        'Проверьте файл, статус результата и основание загрузки.',
      );
    }
    if (file.size === 0 || file.size > MAX_DIAGNOSTIC_ARTIFACT_BYTES) {
      return apiFailure(context, 413, 'RESULT_TOO_LARGE', 'Файл должен быть от 1 байта до 10 МБ.');
    }
    const bytes = await file.arrayBuffer();
    const detectedMime = detectDiagnosticArtifactMime(new Uint8Array(bytes));
    if (!detectedMime || detectedMime !== file.type) {
      return apiFailure(
        context,
        415,
        'INVALID_RESULT_CONTENT',
        'Разрешены только настоящие PDF, JPEG и PNG.',
      );
    }
    const { requestId } = await params;
    const sha256 = await sha256DiagnosticBytes(bytes);
    const uploadHash = await stableUploadHash(
      `${access.scope.organizationId}\u0000${access.scope.facilityId}\u0000${requestId}\u0000${parsed.data.idempotencyKey}`,
    );
    const objectKey = diagnosticArtifactObjectKey({
      organizationId: access.scope.organizationId,
      facilityId: access.scope.facilityId,
      sha256,
      uploadIdentityHash: uploadHash,
      mimeType: detectedMime,
    });
    const artifactId = `diagnostic-artifact-${uploadHash.slice(0, 48)}`;
    const repository = new D1OrderWorkflowRepository(env.DB, access.scope);
    const command = {
      requestIdValue: requestId,
      reportStatus: parsed.data.reportStatus,
      conclusion: parsed.data.conclusion,
      changeReason: parsed.data.changeReason,
      expectedReportVersion: parsed.data.expectedReportVersion,
      artifact: {
        id: artifactId,
        objectKey,
        fileName: sanitizeDiagnosticFileName(file.name),
        mimeType: detectedMime,
        sha256,
        byteSize: bytes.byteLength,
      },
      idempotencyKey: parsed.data.idempotencyKey,
      requestId: context.requestId,
    } as const;
    const reservation = await repository.reserveResultUpload(command);
    if (reservation.kind === 'replayed') {
      return apiSuccess(context, {
        order: reservation.record,
        persistence: 'd1+r2',
        replayed: true,
      });
    }
    const existingObject = await env.FILES.head(objectKey);
    if (existingObject) {
      if (
        existingObject.size !== bytes.byteLength ||
        existingObject.customMetadata?.sha256 !== sha256
      ) {
        throw new OrderWorkflowConflictError(
          'Reserved diagnostic object does not match the uploaded bytes',
        );
      }
    } else {
      await env.FILES.put(objectKey, bytes, {
        httpMetadata: { contentType: detectedMime },
        customMetadata: { sha256, serviceRequestId: requestId },
      });
    }
    await repository.markResultUploadObjectStored(reservation.commandId);
    const order = await repository.commitReservedResult(
      command,
      reservation.commandId,
    );
    return apiSuccess(context, { order, persistence: 'd1+r2', replayed: false });
  } catch (error) {
    return orderApiFailure(
      context,
      error,
      'RESULT_UPLOAD_FAILED',
      'Не удалось сохранить файл результата.',
    );
  }
}
