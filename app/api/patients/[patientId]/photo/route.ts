import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  FacilityAccessNotFoundError,
  MultipleFacilitySelectionRequiredError,
  PatientDirectoryMembershipRequiredError,
  resolveFacilityAccess,
} from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { detectPatientPhotoMime } from '@/lib/domain/patient-photo';
import {
  apiBinarySuccess,
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1PatientRegistryRepository,
  PatientNotFoundError,
  PatientReadAuditUnavailableError,
  sha256Bytes,
} from '@/lib/repositories/patient-registry';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const supportedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const maxPhotoBytes = 4 * 1024 * 1024;

async function resolveAccess(request: Request) {
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
  { params }: { params: Promise<{ patientId: string }> },
) {
  const context = createApiRequestContext(request, '/api/patients/:patientId/photo');
  try {
    const access = await resolveAccess(request);
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const { patientId } = await params;
    const repository = new D1PatientRegistryRepository(env.DB, access.scope);
    const metadata = await repository.getPhoto(patientId);
    if (!metadata) return apiFailure(context, 404, 'PATIENT_PHOTO_NOT_FOUND', 'Фотография не найдена.');
    const object = await env.FILES.get(metadata.objectKey);
    if (!object) return apiFailure(context, 503, 'PATIENT_PHOTO_OBJECT_MISSING', 'Файл фотографии временно недоступен.');
    const bytes = await object.arrayBuffer();
    if ((await sha256Bytes(bytes)) !== metadata.sha256) {
      return apiFailure(context, 503, 'PATIENT_PHOTO_INTEGRITY_FAILED', 'Проверка файла не пройдена.');
    }
    await repository.recordRead({
      action: 'patient.photo.read',
      actorId: access.user.id,
      patientId,
      requestId: context.requestId,
    });
    return apiBinarySuccess(
      context,
      bytes,
      {
        'Content-Type': metadata.mimeType,
        'Content-Length': String(metadata.byteSize),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
      200,
    );
  } catch (error) {
    if (error instanceof PatientReadAuditUnavailableError) {
      return apiFailure(context, 503, 'PATIENT_AUDIT_UNAVAILABLE', 'Фотография не выдана: аудит чтения временно недоступен.');
    }
    if (error instanceof MultipleFacilitySelectionRequiredError) {
      return apiFailure(
        context,
        409,
        'FACILITY_SELECTION_REQUIRED',
        'Выберите филиал.',
        { facilities: error.facilities },
      );
    }
    if (
      error instanceof PatientDirectoryMembershipRequiredError ||
      error instanceof FacilityAccessNotFoundError
    ) {
      return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к фотографии.');
    }
    return apiFailure(context, 500, 'PATIENT_PHOTO_READ_FAILED', 'Не удалось загрузить фотографию.');
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const context = createApiRequestContext(request, '/api/patients/:patientId/photo');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const mimeType = request.headers.get('content-type')?.split(';', 1)[0] ?? '';
  const extension = supportedTypes.get(mimeType);
  if (!extension) {
    return apiFailure(context, 415, 'UNSUPPORTED_PHOTO_TYPE', 'Разрешены JPEG, PNG и WebP.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxPhotoBytes) {
    return apiFailure(context, 413, 'PATIENT_PHOTO_TOO_LARGE', 'Фотография должна быть не больше 4 МБ.');
  }
  try {
    const config = parseRuntimeConfig(env);
    if (!config.syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Загрузка фотографии отключена конфигурацией.');
    }
    const access = await resolveAccess(request);
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const { patientId } = await params;
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxPhotoBytes) {
      return apiFailure(context, 413, 'PATIENT_PHOTO_TOO_LARGE', 'Фотография должна быть от 1 байта до 4 МБ.');
    }
    const detectedType = detectPatientPhotoMime(bytes);
    if (!detectedType || detectedType !== mimeType) {
      return apiFailure(context, 415, 'INVALID_PHOTO_CONTENT', 'Содержимое файла не соответствует JPEG, PNG или WebP.');
    }
    const sha256 = await sha256Bytes(bytes);
    const objectKey = `patient-media/${access.scope.organizationId}/${access.scope.facilityId}/${patientId}/${sha256}.${extension}`;
    const existingObject = await env.FILES.head(objectKey);
    await env.FILES.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { sha256 },
    });
    const repository = new D1PatientRegistryRepository(env.DB, access.scope);
    try {
      const photo = await repository.registerPhoto({
        patientId,
        objectKey,
        mimeType,
        sha256,
        byteSize: bytes.byteLength,
        actorId: access.user.id,
        requestId: context.requestId,
      });
      return apiSuccess(context, {
        photo: {
          id: photo.id,
          url: `/api/patients/${encodeURIComponent(patientId)}/photo?facilityId=${encodeURIComponent(access.scope.facilityId)}`,
          mimeType: photo.mimeType,
          byteSize: photo.byteSize,
          sha256: photo.sha256,
        },
        persistence: 'd1+r2',
      });
    } catch (error) {
      if (!existingObject) {
        await env.FILES.delete(objectKey);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof PatientNotFoundError) {
      return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка не найдена.');
    }
    if (
      error instanceof PatientDirectoryMembershipRequiredError ||
      error instanceof FacilityAccessNotFoundError
    ) {
      return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к фотографии.');
    }
    if (error instanceof MultipleFacilitySelectionRequiredError) {
      return apiFailure(
        context,
        409,
        'FACILITY_SELECTION_REQUIRED',
        'Выберите филиал.',
        { facilities: error.facilities },
      );
    }
    return apiFailure(context, 500, 'PATIENT_PHOTO_SAVE_FAILED', 'Не удалось сохранить фотографию.');
  }
}
