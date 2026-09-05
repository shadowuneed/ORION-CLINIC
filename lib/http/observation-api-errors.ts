import {
  ObservationFacilityNotFoundError,
  ObservationFacilitySelectionRequiredError,
  ObservationMembershipRequiredError,
  ObservationPermissionRequiredError,
} from '@/lib/auth/observation-access';
import {
  ObservationAuditUnavailableError,
  ObservationConflictError,
  ObservationCorrectionForbiddenError,
  ObservationNotFoundError,
  ObservationValidationError,
  ObservationVersionConflictError,
} from '@/lib/repositories/patient-observations';
import { apiFailure, type ApiRequestContext } from './api-response';

export function observationApiFailure(
  context: ApiRequestContext,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof ObservationMembershipRequiredError) {
    return apiFailure(
      context,
      403,
      'OBSERVATION_ACCESS_REQUIRED',
      'Нужна активная роль врача или медсестры.',
    );
  }
  if (error instanceof ObservationFacilitySelectionRequiredError) {
    return apiFailure(
      context,
      409,
      'FACILITY_SELECTION_REQUIRED',
      'Выберите клинику для работы с показателями.',
      { facilities: error.facilities },
    );
  }
  if (
    error instanceof ObservationFacilityNotFoundError ||
    error instanceof ObservationNotFoundError
  ) {
    return apiFailure(
      context,
      404,
      'OBSERVATION_NOT_FOUND',
      'Запись или пациент не найдены либо недоступны.',
    );
  }
  if (
    error instanceof ObservationPermissionRequiredError ||
    error instanceof ObservationCorrectionForbiddenError
  ) {
    return apiFailure(
      context,
      403,
      'OBSERVATION_PERMISSION_REQUIRED',
      error instanceof ObservationCorrectionForbiddenError
        ? 'Медсестра может исправить только собственное измерение.'
        : 'Недостаточно прав для этого действия.',
    );
  }
  if (error instanceof ObservationVersionConflictError) {
    return apiFailure(
      context,
      409,
      'OBSERVATION_VERSION_CONFLICT',
      'Запись уже изменилась. Обновите данные; введённые значения сохраните для сверки.',
      { currentVersion: error.currentVersion },
    );
  }
  if (error instanceof ObservationConflictError) {
    return apiFailure(
      context,
      409,
      'OBSERVATION_CONFLICT',
      'Команда конфликтует с сохранённым состоянием. Обновите данные.',
    );
  }
  if (error instanceof ObservationValidationError) {
    return apiFailure(context, 422, 'OBSERVATION_INVALID', error.message);
  }
  if (error instanceof ObservationAuditUnavailableError) {
    return apiFailure(
      context,
      503,
      'OBSERVATION_AUDIT_UNAVAILABLE',
      'Операция не выполнена: журнал аудита недоступен.',
    );
  }
  return apiFailure(context, 500, fallbackCode, fallbackMessage);
}
