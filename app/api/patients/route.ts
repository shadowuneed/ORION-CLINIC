import { env } from 'cloudflare:workers';
import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import {
  FacilityAccessNotFoundError,
  MultipleFacilitySelectionRequiredError,
  PatientDirectoryMembershipRequiredError,
  resolveFacilityAccess,
} from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { createPatientSchema, patientListQuerySchema } from '@/lib/domain/patient';
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

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/patients');
  const url = new URL(request.url);
  const parsed = patientListQuerySchema.safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    query: url.searchParams.get('query') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return apiFailure(context, 400, 'INVALID_QUERY', 'Проверьте параметры поиска.');
  }
  try {
    const access = await accessFor(request, parsed.data.facilityId);
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
        role: access.membership.role,
      },
      organization: access.organization,
      facility: access.facility,
      facilities: access.facilities,
      patients,
      persistence: 'd1',
    });
  } catch (error) {
    if (error instanceof MultipleFacilitySelectionRequiredError) {
      return apiFailure(
        context,
        409,
        'FACILITY_SELECTION_REQUIRED',
        'Выберите филиал.',
        { facilities: error.facilities },
      );
    }
    if (error instanceof PatientReadAuditUnavailableError) {
      return apiFailure(context, 503, 'PATIENT_AUDIT_UNAVAILABLE', 'Ответ не выдан: аудит чтения временно недоступен.');
    }
    if (
      error instanceof PatientDirectoryMembershipRequiredError ||
      error instanceof FacilityAccessNotFoundError
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
    const access = await accessFor(request, payload.facilityId);
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
      return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к реестру.');
    }
    return apiFailure(context, 500, 'PATIENT_CREATE_FAILED', 'Не удалось сохранить пациента.');
  }
}
