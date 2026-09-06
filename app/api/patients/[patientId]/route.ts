import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import {
  MultiplePatientAccessSelectionRequiredError,
  resolvePatientDirectoryAccess,
  type PatientDirectoryPermission,
} from '@/lib/auth/patient-directory-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { updatePatientProfileSchema } from '@/lib/domain/patient';
import {
  D1AccessGovernanceRepository,
} from '@/lib/repositories/access-governance';
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

export const dynamic = 'force-dynamic';

async function accessFor(
  request: Request,
  permission: PatientDirectoryPermission,
  accessAssignmentId?: string,
  facilityId?: string,
) {
  const identity = getSiteIdentity(request);
  if (!identity) return null;
  return resolvePatientDirectoryAccess(
    new D1AccessGovernanceRepository(env.DB),
    toSiteIdentityPrincipal(identity),
    permission,
    accessAssignmentId,
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
    const url = new URL(request.url);
    const access = await accessFor(
      request,
      'patient.directory.read',
      url.searchParams.get('accessAssignmentId') ?? undefined,
      url.searchParams.get('facilityId') ?? undefined,
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
      viewer: { id: access.user.id, displayName: access.user.displayName, role: access.assignment.roles.join(', ') },
      organization: access.organization,
      facility: access.facility,
      accessAssignment: access.assignment,
      assignments: access.assignments,
      patient: {
        ...patient,
        photoUrl: patient.photoUrl
          ? `${patient.photoUrl}&accessAssignmentId=${encodeURIComponent(access.assignment.assignmentId)}`
          : null,
      },
      permissions: {
        canUpdate: access.assignment.effectivePermissions.includes('patient.profile.write'),
        canArchive: access.assignment.effectivePermissions.includes('patient.profile.write'),
        canCreateEncounter:
          access.assignment.effectivePermissions.includes('encounter.manage'),
      },
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof PatientReadAuditUnavailableError) {
      return apiFailure(context, 503, 'PATIENT_AUDIT_UNAVAILABLE', 'Карточка не выдана: аудит чтения временно недоступен.');
    }
    if (error instanceof MultiplePatientAccessSelectionRequiredError) {
      return apiFailure(
        context,
        409,
        'ACCESS_ASSIGNMENT_SELECTION_REQUIRED',
        'Выберите рабочий контур.',
        { assignments: error.assignments },
      );
    }
    if (
      error instanceof AccessMembershipRequiredError ||
      error instanceof AccessAssignmentNotFoundError ||
      error instanceof AccessPermissionRequiredError
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
    const access = await accessFor(
      request,
      'patient.profile.write',
      payload.accessAssignmentId,
      payload.facilityId,
    );
    if (!access) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    }
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
    if (error instanceof MultiplePatientAccessSelectionRequiredError) {
      return apiFailure(context, 409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED', 'Выберите рабочий контур.', {
        assignments: error.assignments,
      });
    }
    if (
      error instanceof AccessMembershipRequiredError ||
      error instanceof AccessAssignmentNotFoundError ||
      error instanceof AccessPermissionRequiredError
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
