import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import { MultipleOrderAccessSelectionRequiredError } from '@/lib/auth/order-workflow-access';
import {
  OrderWorkflowClinicianRequiredError,
  OrderWorkflowAuditUnavailableError,
  OrderWorkflowConflictError,
  OrderWorkflowConsentRequiredError,
  OrderWorkflowLifecycleError,
  OrderWorkflowNotFoundError,
  OrderWorkflowVersionConflictError,
} from '@/lib/repositories/order-workflow';
import { apiFailure, type ApiRequestContext } from './api-response';

export function orderApiFailure(
  context: ApiRequestContext,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof MultipleOrderAccessSelectionRequiredError) {
    return apiFailure(context, 409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED', 'Выберите рабочий контур.', {
      assignments: error.assignments,
    });
  }
  if (
    error instanceof AccessMembershipRequiredError ||
    error instanceof AccessAssignmentNotFoundError ||
    error instanceof AccessPermissionRequiredError ||
    error instanceof OrderWorkflowClinicianRequiredError
  ) {
    return apiFailure(
      context,
      403,
      'ORDER_WORKFLOW_FORBIDDEN',
      'Нет доступа к направлениям в выбранном рабочем контуре.',
    );
  }
  if (error instanceof OrderWorkflowNotFoundError) {
    return apiFailure(context, 404, 'ORDER_NOT_FOUND', 'Направление не найдено.');
  }
  if (error instanceof OrderWorkflowAuditUnavailableError) {
    return apiFailure(
      context,
      503,
      'ORDER_AUDIT_UNAVAILABLE',
      'Данные не выданы: журнал доступа временно недоступен.',
    );
  }
  if (error instanceof OrderWorkflowVersionConflictError) {
    return apiFailure(
      context,
      409,
      'ORDER_VERSION_CONFLICT',
      'Запись уже изменилась. Обновите данные и повторите действие.',
      { currentVersion: error.currentVersion, resource: error.resource },
    );
  }
  if (error instanceof OrderWorkflowConsentRequiredError) {
    return apiFailure(
      context,
      409,
      'CARE_CONSENT_REQUIRED',
      'Нужно действующее согласие пациента на оказание помощи.',
    );
  }
  if (error instanceof OrderWorkflowLifecycleError) {
    return apiFailure(context, 422, 'ORDER_LIFECYCLE_INVALID', error.message);
  }
  if (error instanceof OrderWorkflowConflictError) {
    return apiFailure(
      context,
      409,
      'ORDER_COMMAND_CONFLICT',
      'Команда конфликтует с сохранённым состоянием. Обновите данные.',
    );
  }
  return apiFailure(context, 500, fallbackCode, fallbackMessage);
}
