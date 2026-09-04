import {
  ChronicCareFacilityNotFoundError,
  ChronicCareFacilitySelectionRequiredError,
  ChronicCareMembershipRequiredError,
  ChronicCarePermissionRequiredError,
} from '@/lib/auth/chronic-care-access';
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
  if (error instanceof ChronicCareMembershipRequiredError) {
    return apiFailure(
      context,
      403,
      'CHRONIC_CARE_ACCESS_REQUIRED',
      'Нужна активная роль врача или медсестры.',
    );
  }
  if (error instanceof ChronicCareFacilitySelectionRequiredError) {
    return apiFailure(
      context,
      409,
      'FACILITY_SELECTION_REQUIRED',
      'Выберите клинику для работы с наблюдением.',
      { facilities: error.facilities },
    );
  }
  if (
    error instanceof ChronicCareFacilityNotFoundError ||
    error instanceof ChronicCareNotFoundError
  ) {
    return apiFailure(
      context,
      404,
      'CHRONIC_CARE_NOT_FOUND',
      'Запись наблюдения не найдена или недоступна.',
    );
  }
  if (error instanceof ChronicCarePermissionRequiredError) {
    return apiFailure(
      context,
      403,
      'CHRONIC_CARE_PERMISSION_REQUIRED',
      'Недостаточно прав для этого действия.',
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
