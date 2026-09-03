import { env } from 'cloudflare:workers';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  FacilityAccessNotFoundError,
  MultipleFacilitySelectionRequiredError,
  PatientDirectoryMembershipRequiredError,
  resolveFacilityAccess,
} from '@/lib/auth/facility-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { createPatientEncounterSchema } from '@/lib/domain/patient';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1PatientRegistryRepository,
  PatientEncounterRoleRequiredError,
  PatientNotFoundError,
  PatientRegistryConflictError,
} from '@/lib/repositories/patient-registry';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const context = createApiRequestContext(request, '/api/patients/:patientId/encounters');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = createPatientEncounterSchema.parse(await request.json());
  } catch {
    return apiFailure(context, 400, 'INVALID_ENCOUNTER', 'Укажите причину обращения.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
  const { patientId } = await params;
  try {
    const config = parseRuntimeConfig(env);
    if (!config.syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Запись данных отключена конфигурацией.');
    }
    const access = await resolveFacilityAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const encounter = await new D1PatientRegistryRepository(env.DB, access.scope).createEncounter({
      patientId,
      reasonForVisit: payload.reasonForVisit,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, { encounter, persistence: 'd1' }, 201);
  } catch (error) {
    if (error instanceof PatientNotFoundError) {
      return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка не найдена.');
    }
    if (error instanceof PatientEncounterRoleRequiredError) {
      return apiFailure(context, 403, 'CLINICIAN_ROLE_REQUIRED', 'Создать приём может только врач.');
    }
    if (error instanceof PatientRegistryConflictError) {
      return apiFailure(context, 409, 'ENCOUNTER_COMMAND_CONFLICT', 'Команда конфликтует с уже сохранённым состоянием. Обновите карточку.');
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
    return apiFailure(context, 500, 'ENCOUNTER_CREATE_FAILED', 'Не удалось создать приём.');
  }
}
