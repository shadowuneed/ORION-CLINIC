import type { ApiRequestContext } from '@/lib/http/api-response';
import { apiFailure } from '@/lib/http/api-response';
import {
  MultipleFacilitySelectionRequiredError,
  FacilityAccessNotFoundError,
  PatientDirectoryMembershipRequiredError,
} from '@/lib/auth/facility-access';
import { SchedulingPermissionRequiredError } from '@/lib/auth/scheduling-access';
import {
  SchedulingAuditUnavailableError,
  SchedulingConflictError,
  SchedulingConsentRequiredError,
  SchedulingLifecycleError,
  SchedulingNotFoundError,
  SchedulingVersionConflictError,
} from '@/lib/repositories/scheduling-workflow';

export function schedulingApiFailure(
  context: ApiRequestContext,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof PatientDirectoryMembershipRequiredError) {
    return apiFailure(context, 403, 'SCHEDULING_ACCESS_REQUIRED', 'Нет доступа к расписанию.');
  }
  if (error instanceof MultipleFacilitySelectionRequiredError) {
    return apiFailure(
      context,
      409,
      'FACILITY_SELECTION_REQUIRED',
      'Выберите клинику для работы с расписанием.',
      { facilities: error.facilities },
    );
  }
  if (error instanceof FacilityAccessNotFoundError) {
    return apiFailure(context, 404, 'SCHEDULING_NOT_FOUND', 'Запись не найдена.');
  }
  if (error instanceof SchedulingPermissionRequiredError) {
    return apiFailure(context, 403, 'SCHEDULING_PERMISSION_REQUIRED', 'Недостаточно прав для этого действия.');
  }
  if (error instanceof SchedulingNotFoundError) {
    return apiFailure(context, 404, 'SCHEDULING_NOT_FOUND', 'Запись не найдена.');
  }
  if (error instanceof SchedulingVersionConflictError) {
    return apiFailure(
      context,
      409,
      'SCHEDULING_VERSION_CONFLICT',
      'Состояние изменилось. Обновите расписание и повторите решение.',
      { resource: error.resource, currentVersion: error.currentVersion },
    );
  }
  if (error instanceof SchedulingConflictError) {
    return apiFailure(context, 409, 'SCHEDULING_CONFLICT', 'Операция конфликтует с текущим состоянием. Обновите данные.');
  }
  if (error instanceof SchedulingConsentRequiredError) {
    return apiFailure(context, 409, 'CARE_CONSENT_REQUIRED', 'Нужно действующее согласие пациента на ведение приёма.');
  }
  if (error instanceof SchedulingLifecycleError) {
    return apiFailure(context, 422, 'SCHEDULING_LIFECYCLE_INVALID', error.message);
  }
  if (error instanceof SchedulingAuditUnavailableError) {
    return apiFailure(context, 503, 'SCHEDULING_AUDIT_UNAVAILABLE', 'Операция не выполнена: журнал аудита недоступен.');
  }
  return apiFailure(context, 500, fallbackCode, fallbackMessage);
}
