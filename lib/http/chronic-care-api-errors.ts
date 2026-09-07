import {
  ChronicCarePermissionRequiredError,
  MultipleChronicCareAccessSelectionRequiredError,
} from '@/lib/auth/chronic-care-access';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import {
  ChronicCareAuditUnavailableError,
  ChronicCareConflictError,
  ChronicCareLifecycleError,
  ChronicCareNotFoundError,
  ChronicCareValidationError,
  ChronicCareVersionConflictError,
} from '@/lib/repositories/chronic-care-workflow';
import { apiFailure, type ApiRequestContext } from './api-response';

export function chronicCareApiFailure(
  context: ApiRequestContext,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof MultipleChronicCareAccessSelectionRequiredError) {
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
    error instanceof ChronicCarePermissionRequiredError
  ) {
    return apiFailure(
      context,
      403,
      'CHRONIC_CARE_FORBIDDEN',
      'Нет доступа к наблюдению в выбранном рабочем контуре.',
    );
  }
  if (error instanceof ChronicCareNotFoundError) {
    return apiFailure(
      context,
      404,
      'CHRONIC_CARE_NOT_FOUND',
      'Запись наблюдения не найдена или недоступна.',
    );
  }
  if (error instanceof ChronicCareVersionConflictError) {
    return apiFailure(
      context,
      409,
      'CHRONIC_CARE_VERSION_CONFLICT',
      'Запись уже изменилась. Обновите страницу и повторите действие.',
      { resource: error.resource, currentVersion: error.currentVersion },
    );
  }
  if (error instanceof ChronicCareConflictError) {
    return apiFailure(
      context,
      409,
      'CHRONIC_CARE_CONFLICT',
      'Операция конфликтует с текущим состоянием.',
    );
  }
  if (error instanceof ChronicCareValidationError) {
    return apiFailure(context, 422, 'CHRONIC_CARE_INVALID', error.message);
  }
  if (error instanceof ChronicCareLifecycleError) {
    return apiFailure(context, 422, 'CHRONIC_CARE_LIFECYCLE_INVALID', error.message);
  }
  if (error instanceof ChronicCareAuditUnavailableError) {
    return apiFailure(
      context,
      503,
      'CHRONIC_CARE_AUDIT_UNAVAILABLE',
      'Операция не выполнена: журнал аудита недоступен.',
    );
  }
  return apiFailure(context, 500, fallbackCode, fallbackMessage);
}
