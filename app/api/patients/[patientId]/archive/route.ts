import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  FacilityAccessNotFoundError,
  MultipleFacilitySelectionRequiredError,
  PatientDirectoryMembershipRequiredError,
  PatientProfilePermissionRequiredError,
  requirePatientProfilePermission,
  resolveFacilityAccess,
} from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { archivePatientProfileSchema } from '@/lib/domain/patient';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1PatientRegistryRepository,
  PatientAlreadyArchivedError,
  PatientNotFoundError,
  PatientProfileStateError,
  PatientProfileUnavailableError,
  PatientProfileVersionConflictError,
  PatientRegistryConflictError,
} from '@/lib/repositories/patient-registry';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const context = createApiRequestContext(
    request,
    '/api/patients/:patientId/archive',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
  }
  let payload;
  try {
    payload = archivePatientProfileSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_PATIENT_ARCHIVE',
      'Укажите причину архивирования и текущую версию карточки.',
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
        'Архивирование отключено конфигурацией.',
      );
    }
    const access = await resolveFacilityAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    requirePatientProfilePermission(access.membership.role, 'patient.archive');
    const patient = await new D1PatientRegistryRepository(
      env.DB,
      access.scope,
    ).archiveProfile({
      patientId,
      changeReason: payload.changeReason,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      patient,
      mutation: { operation: 'patient.archive', version: patient.version },
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof PatientNotFoundError) {
      return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка не найдена.');
    }
    if (error instanceof PatientProfileVersionConflictError) {
      return apiFailure(
        context,
        409,
        'PATIENT_VERSION_CONFLICT',
        'Карточка уже изменена в другой вкладке. Обновите данные перед архивированием.',
        {
          currentVersion: error.currentVersion,
          currentStatus: error.currentStatus,
        },
      );
    }
    if (error instanceof PatientAlreadyArchivedError) {
      return apiFailure(
        context,
        422,
        'PATIENT_ALREADY_ARCHIVED',
        'Карточка уже находится в архиве.',
      );
    }
    if (error instanceof PatientProfileStateError) {
      return apiFailure(
        context,
        409,
        'PATIENT_PROFILE_NOT_ACTIVE',
        'Текущий статус карточки не допускает архивирование.',
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
        'PATIENT_ARCHIVE_FORBIDDEN',
        'Нет права архивировать карточку.',
      );
    }
    return apiFailure(
      context,
      500,
      'PATIENT_ARCHIVE_FAILED',
      'Не удалось архивировать карточку.',
    );
  }
}
