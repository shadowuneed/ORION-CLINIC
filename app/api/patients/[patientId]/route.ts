import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  FacilityAccessNotFoundError,
  MultipleFacilitySelectionRequiredError,
  PatientDirectoryMembershipRequiredError,
  PatientProfilePermissionRequiredError,
  patientProfilePermissions,
  requirePatientProfilePermission,
  resolveFacilityAccess,
} from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { updatePatientProfileSchema } from '@/lib/domain/patient';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1PatientRegistryRepository,
  PatientDuplicateCandidateError,
  PatientNotFoundError,
  PatientProfileStateError,
  PatientProfileUnavailableError,
  PatientProfileUnchangedError,
  PatientProfileVersionConflictError,
  PatientReadAuditUnavailableError,
  PatientRegistryConflictError,
} from '@/lib/repositories/patient-registry';
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const context = createApiRequestContext(request, '/api/patients/:patientId');
  const { patientId } = await params;
  try {
    const access = await accessFor(
      request,
      new URL(request.url).searchParams.get('facilityId') ?? undefined,
    );
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const repository = new D1PatientRegistryRepository(env.DB, access.scope);
    const patient = await repository.get(patientId);
    if (!patient) return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка не найдена.');
    await repository.recordRead({
      action: 'patient.read',
      actorId: access.user.id,
      patientId,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      viewer: { id: access.user.id, displayName: access.user.displayName, role: access.membership.role },
      organization: access.organization,
      facility: access.facility,
      patient,
      permissions: patientProfilePermissions(access.membership.role),
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof PatientReadAuditUnavailableError) {
      return apiFailure(context, 503, 'PATIENT_AUDIT_UNAVAILABLE', 'Карточка не выдана: аудит чтения временно недоступен.');
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
      return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к карточке.');
    }
    return apiFailure(context, 500, 'PATIENT_READ_FAILED', 'Не удалось открыть карточку.');
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const context = createApiRequestContext(request, '/api/patients/:patientId');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
  }
  let payload;
  try {
    payload = updatePatientProfileSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_PATIENT_UPDATE',
      'Проверьте данные, причину изменения и текущую версию карточки.',
    );
  }
  const { patientId } = await params;
  try {
    const config = parseRuntimeConfig(env);
    if (!config.syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Изменение данных отключено конфигурацией.',
      );
    }
    const access = await accessFor(request, payload.facilityId);
    if (!access) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
    requirePatientProfilePermission(access.membership.role, 'patient.update');
    const patient = await new D1PatientRegistryRepository(
      env.DB,
      access.scope,
    ).updateProfile({
      patientId,
      displayName: payload.displayName,
      birthDate: payload.birthDate,
      sexAtBirth: payload.sexAtBirth,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      changeReason: payload.changeReason,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      patient,
      mutation: { operation: 'patient.update', version: patient.version },
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof PatientNotFoundError) {
      return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка не найдена.');
    }
    if (error instanceof PatientDuplicateCandidateError) {
      return apiFailure(
        context,
        409,
        'PATIENT_DUPLICATE_CANDIDATE',
        'Похожая активная карточка уже существует. Автоматическое объединение отключено.',
      );
    }
    if (error instanceof PatientProfileVersionConflictError) {
      return apiFailure(
        context,
        409,
        'PATIENT_VERSION_CONFLICT',
        'Карточка уже изменена в другой вкладке. Ваши данные сохранены в форме.',
        {
          currentVersion: error.currentVersion,
          currentStatus: error.currentStatus,
        },
      );
    }
    if (error instanceof PatientProfileUnchangedError) {
      return apiFailure(
        context,
        422,
        'PATIENT_PROFILE_UNCHANGED',
        'Измените хотя бы одно поле карточки.',
      );
    }
    if (error instanceof PatientProfileStateError) {
      return apiFailure(
        context,
        409,
        'PATIENT_PROFILE_NOT_ACTIVE',
        'Архивную карточку нельзя редактировать.',
      );
    }
    if (error instanceof PatientProfileUnavailableError) {
      return apiFailure(
        context,
        409,
        'PATIENT_PROFILE_NOT_VERSIONED',
        'Для этой старой тестовой карточки ещё не создана версионная основа.',
      );
    }
    if (error instanceof PatientRegistryConflictError) {
      return apiFailure(
        context,
        409,
        'PATIENT_COMMAND_CONFLICT',
        'Команда конфликтует с уже сохранённым состоянием. Обновите карточку.',
      );
    }
    if (error instanceof MultipleFacilitySelectionRequiredError) {
      return apiFailure(context, 409, 'FACILITY_SELECTION_REQUIRED', 'Выберите филиал.', {
        facilities: error.facilities,
      });
    }
    if (
      error instanceof PatientDirectoryMembershipRequiredError ||
      error instanceof FacilityAccessNotFoundError ||
      error instanceof PatientProfilePermissionRequiredError
    ) {
      return apiFailure(
        context,
        403,
        'PATIENT_UPDATE_FORBIDDEN',
        'Нет права изменять карточку.',
      );
    }
    return apiFailure(
      context,
      500,
      'PATIENT_UPDATE_FAILED',
      'Не удалось сохранить изменения.',
    );
  }
}
