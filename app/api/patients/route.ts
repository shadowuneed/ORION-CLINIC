import { env } from 'cloudflare:workers';
import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
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
import { createPatientSchema, patientListQuerySchema } from '@/lib/domain/patient';
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

function patientWithAssignment<T extends { photoUrl: string | null }>(
  patient: T,
  assignmentId: string,
): T {
  return {
    ...patient,
    photoUrl: patient.photoUrl
      ? `${patient.photoUrl}&accessAssignmentId=${encodeURIComponent(assignmentId)}`
      : null,
  };
}

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/patients');
  const url = new URL(request.url);
  const parsed = patientListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    accessAssignmentId:
      url.searchParams.get('accessAssignmentId') ?? undefined,
    query: url.searchParams.get('query') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(context, 400, 'INVALID_QUERY', 'Проверьте параметры поиска.');
  }
  try {
    const access = await accessFor(
      request,
      'patient.directory.read',
      parsed.data.accessAssignmentId,
      parsed.data.facilityId,
    );
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const repository = new D1PatientRegistryRepository(env.DB, access.scope);
    const patients = await repository.list({
      query: parsed.data.query,
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    await repository.recordRead({
      action: 'patient.list',
      actorId: access.user.id,
      requestId: context.requestId,
      resultCount: patients.length,
    });
    return apiSuccess(context, {
      viewer: {
        id: access.user.id,
        displayName: access.user.displayName,
      role: access.assignment.roles.join(', '),
      },
      organization: access.organization,
      facility: access.facility,
      accessAssignment: access.assignment,
      assignments: access.assignments,
      patients: patients.map((patient) =>
        patientWithAssignment(patient, access.assignment.assignmentId),
      ),
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof MultiplePatientAccessSelectionRequiredError) {
      return apiFailure(
        context,
        409,
        'ACCESS_ASSIGNMENT_SELECTION_REQUIRED',
        'Выберите рабочий контур.',
        { assignments: error.assignments },
      );
    }
    if (error instanceof PatientReadAuditUnavailableError) {
      return apiFailure(context, 503, 'PATIENT_AUDIT_UNAVAILABLE', 'Ответ не выдан: аудит чтения временно недоступен.');
    }
    if (
      error instanceof AccessMembershipRequiredError ||
      error instanceof AccessAssignmentNotFoundError ||
      error instanceof AccessPermissionRequiredError
    ) {
      return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к реестру.');
    }
    return apiFailure(context, 500, 'PATIENT_LIST_FAILED', 'Не удалось загрузить пациентов.');
  }
}

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/patients');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = createPatientSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_PATIENT', 'Проверьте данные пациента и подтверждение тестового режима.');
  }
  try {
    const config = parseRuntimeConfig(env);
    if (!config.syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Запись данных отключена конфигурацией.');
    }
    const access = await accessFor(
      request,
      'patient.profile.write',
      payload.accessAssignmentId,
      payload.facilityId,
    );
    if (!access) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const patient = await new D1PatientRegistryRepository(env.DB, access.scope).create({
      displayName: payload.displayName,
      birthDate: payload.birthDate,
      sexAtBirth: payload.sexAtBirth,
      testIin: payload.testIin,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, { patient, persistence: 'd1' }, 201);
  } catch (error) {
    if (error instanceof PatientDuplicateCandidateError) {
      return apiFailure(context, 409, 'PATIENT_DUPLICATE_CANDIDATE', 'Похожая карточка уже существует. Откройте её вместо автоматического объединения.');
    }
    if (error instanceof PatientRegistryConflictError) {
      return apiFailure(context, 409, 'PATIENT_COMMAND_CONFLICT', 'Команда конфликтует с уже сохранённым состоянием. Обновите список.');
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
      return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к реестру.');
    }
    return apiFailure(context, 500, 'PATIENT_CREATE_FAILED', 'Не удалось сохранить пациента.');
  }
}
