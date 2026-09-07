import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import {
  MultipleCommunicationAccessSelectionRequiredError,
  CommunicationPermissionRequiredError,
} from '@/lib/auth/communication-access';
import {
  CommunicationAuditUnavailableError,
  CommunicationConflictError,
  CommunicationConsentRequiredError,
  CommunicationLifecycleError,
  CommunicationNotFoundError,
  CommunicationPolicyUnavailableError,
  CommunicationTemplateUnavailableError,
  CommunicationValidationError,
  CommunicationVersionConflictError,
} from '@/lib/repositories/patient-communications';
import { apiFailure, type ApiRequestContext } from './api-response';

export function communicationApiFailure(
  context: ApiRequestContext,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof MultipleCommunicationAccessSelectionRequiredError) {
    return apiFailure(context, 409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED',
      'Выберите рабочее назначение для связи с пациентом.',
      { assignments: error.assignments.map(({ assignmentId, organizationName, facilityId, facilityName, departmentName, role }) =>
        ({ assignmentId, organizationName, facilityId, facilityName, departmentName, role })) });
  }
  if (error instanceof AccessMembershipRequiredError ||
      error instanceof AccessAssignmentNotFoundError ||
      error instanceof AccessPermissionRequiredError ||
      error instanceof CommunicationPermissionRequiredError) {
    return apiFailure(context, 403, 'COMMUNICATION_FORBIDDEN',
      'Рабочее назначение недоступно или недостаточно прав для этого действия.');
  }
  if (error instanceof CommunicationNotFoundError) {
    return apiFailure(context, 404, 'COMMUNICATION_NOT_FOUND',
      'Запись коммуникации не найдена или недоступна.');
  }
  if (error instanceof CommunicationVersionConflictError) {
    return apiFailure(
      context,
      409,
      'COMMUNICATION_VERSION_CONFLICT',
      'Запись уже изменилась. Обновите данные и повторите действие.',
      { resource: error.resource, currentVersion: error.currentVersion },
    );
  }
  if (error instanceof CommunicationConflictError) {
    return apiFailure(
      context,
      409,
      'COMMUNICATION_CONFLICT',
      'Операция конфликтует с текущим состоянием. Обновите данные.',
    );
  }
  if (error instanceof CommunicationConsentRequiredError) {
    return apiFailure(
      context,
      409,
      'COMMUNICATION_CONSENT_REQUIRED',
      'Нужно действующее согласие пациента для выбранного канала.',
    );
  }
  if (error instanceof CommunicationValidationError) {
    return apiFailure(context, 422, 'COMMUNICATION_INVALID', error.message);
  }
  if (error instanceof CommunicationLifecycleError) {
    return apiFailure(
      context,
      422,
      'COMMUNICATION_LIFECYCLE_INVALID',
      error.message,
    );
  }
  if (error instanceof CommunicationPolicyUnavailableError) {
    return apiFailure(
      context,
      503,
      'COMMUNICATION_POLICY_UNAVAILABLE',
      'Правила коммуникаций временно недоступны.',
    );
  }
  if (error instanceof CommunicationTemplateUnavailableError) {
    return apiFailure(
      context,
      503,
      'COMMUNICATION_TEMPLATE_UNAVAILABLE',
      'Одобренный шаблон сообщения временно недоступен.',
    );
  }
  if (error instanceof CommunicationAuditUnavailableError) {
    return apiFailure(
      context,
      503,
      'COMMUNICATION_AUDIT_UNAVAILABLE',
      'Операция не выполнена: журнал аудита недоступен.',
    );
  }
  return apiFailure(context, 500, fallbackCode, fallbackMessage);
}
