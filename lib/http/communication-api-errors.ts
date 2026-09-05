import {
  CommunicationFacilityNotFoundError,
  CommunicationFacilitySelectionRequiredError,
  CommunicationMembershipRequiredError,
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
  if (error instanceof CommunicationMembershipRequiredError) {
    return apiFailure(
      context,
      403,
      'COMMUNICATION_ACCESS_REQUIRED',
      'Нужна активная роль врача, медсестры или регистратора.',
    );
  }
  if (error instanceof CommunicationFacilitySelectionRequiredError) {
    return apiFailure(
      context,
      409,
      'FACILITY_SELECTION_REQUIRED',
      'Выберите клинику для работы с коммуникациями.',
      { facilities: error.facilities },
    );
  }
  if (
    error instanceof CommunicationFacilityNotFoundError ||
    error instanceof CommunicationNotFoundError
  ) {
    return apiFailure(
      context,
      404,
      'COMMUNICATION_NOT_FOUND',
      'Запись коммуникации не найдена или недоступна.',
    );
  }
  if (error instanceof CommunicationPermissionRequiredError) {
    return apiFailure(
      context,
      403,
      'COMMUNICATION_PERMISSION_REQUIRED',
      'Недостаточно прав для этого действия.',
    );
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
