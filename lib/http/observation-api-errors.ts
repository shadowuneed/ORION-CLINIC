import {
  MultipleObservationAccessSelectionRequiredError,
  ObservationPermissionRequiredError,
} from '@/lib/auth/observation-access';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
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
  if (error instanceof MultipleObservationAccessSelectionRequiredError) {
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
    error instanceof AccessPermissionRequiredError ||
    error instanceof ObservationPermissionRequiredError ||
    error instanceof ObservationCorrectionForbiddenError
  ) {
    return apiFailure(
      context,
      403,
      'OBSERVATION_FORBIDDEN',
      'Нет доступа к показателям в выбранном рабочем контуре.',
    );
  }
  if (error instanceof ObservationNotFoundError) {
    return apiFailure(
      context,
      404,
      'OBSERVATION_NOT_FOUND',
      'Запись или пациент не найдены либо недоступны.',
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
