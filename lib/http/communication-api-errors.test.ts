import { AccessAssignmentNotFoundError, AccessMembershipRequiredError } from '@/lib/auth/access-governance';
import { describe, expect, it } from 'vitest';
import {
  MultipleCommunicationAccessSelectionRequiredError,
  CommunicationPermissionRequiredError,
  type CommunicationAccessAssignmentOption,
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
import type { ApiRequestContext } from './api-response';
import { communicationApiFailure } from './communication-api-errors';

const context: ApiRequestContext = {
  requestId: 'request-communication-errors',
  route: '/api/communications',
  method: 'POST',
  startedAt: 0,
};

const assignments: CommunicationAccessAssignmentOption[] = [
  {
    assignmentId: 'assignment-a',
    departmentName: 'Терапия',
    organizationName: 'ORION Clinic',
    facilityId: 'facility-a',
    facilityName: 'Филиал A',
    role: 'clinician',
  },
];

const cases: Array<{
  name: string;
  error: Error;
  status: number;
  code: string;
  details?: Record<string, unknown>;
}> = [
  {
    name: 'нет активной роли',
    error: new AccessMembershipRequiredError(),
    status: 403,
    code: 'COMMUNICATION_FORBIDDEN',
  },
  {
    name: 'нужен выбор клиники',
    error: new MultipleCommunicationAccessSelectionRequiredError(assignments),
    status: 409,
    code: 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED',
    details: { assignments },
  },
  {
    name: 'клиника недоступна',
    error: new AccessAssignmentNotFoundError(),
    status: 403,
    code: 'COMMUNICATION_FORBIDDEN',
  },
  {
    name: 'нет права на действие',
    error: new CommunicationPermissionRequiredError('notification.schedule'),
    status: 403,
    code: 'COMMUNICATION_FORBIDDEN',
  },
  {
    name: 'запись не найдена',
    error: new CommunicationNotFoundError(),
    status: 404,
    code: 'COMMUNICATION_NOT_FOUND',
  },
  {
    name: 'конфликт версии',
    error: new CommunicationVersionConflictError(7, 'notification'),
    status: 409,
    code: 'COMMUNICATION_VERSION_CONFLICT',
    details: { resource: 'notification', currentVersion: 7 },
  },
  {
    name: 'конфликт состояния',
    error: new CommunicationConflictError(),
    status: 409,
    code: 'COMMUNICATION_CONFLICT',
  },
  {
    name: 'нет согласия на канал',
    error: new CommunicationConsentRequiredError(),
    status: 409,
    code: 'COMMUNICATION_CONSENT_REQUIRED',
  },
  {
    name: 'ошибка валидации',
    error: new CommunicationValidationError('Неверное значение'),
    status: 422,
    code: 'COMMUNICATION_INVALID',
  },
  {
    name: 'недопустимый переход',
    error: new CommunicationLifecycleError('Недопустимый переход'),
    status: 422,
    code: 'COMMUNICATION_LIFECYCLE_INVALID',
  },
  {
    name: 'нет политики',
    error: new CommunicationPolicyUnavailableError(),
    status: 503,
    code: 'COMMUNICATION_POLICY_UNAVAILABLE',
  },
  {
    name: 'нет одобренного шаблона',
    error: new CommunicationTemplateUnavailableError(),
    status: 503,
    code: 'COMMUNICATION_TEMPLATE_UNAVAILABLE',
  },
  {
    name: 'недоступен аудит',
    error: new CommunicationAuditUnavailableError(),
    status: 503,
    code: 'COMMUNICATION_AUDIT_UNAVAILABLE',
  },
];

describe('communicationApiFailure', () => {
  it.each(cases)('$name -> $status $code', async ({ error, status, code, details }) => {
    const response = communicationApiFailure(
      context,
      error,
      'COMMUNICATION_FAILED',
      'Не удалось выполнить операцию.',
    );
    const body = (await response.json()) as {
      error: {
        code: string;
        message: string;
        requestId: string;
        details?: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(context.requestId);
    expect(body.error.code).toBe(code);
    expect(body.error.requestId).toBe(context.requestId);
    expect(body.error.message).not.toBe('');
    expect(body.error.details).toEqual(details);
  });

  it('preserves validation and lifecycle messages', async () => {
    const validation = communicationApiFailure(
      context,
      new CommunicationValidationError('Поле не заполнено'),
      'FALLBACK',
      'Ошибка',
    );
    const lifecycle = communicationApiFailure(
      context,
      new CommunicationLifecycleError('Сначала начните задачу'),
      'FALLBACK',
      'Ошибка',
    );

    await expect(validation.json()).resolves.toMatchObject({
      error: { message: 'Поле не заполнено' },
    });
    await expect(lifecycle.json()).resolves.toMatchObject({
      error: { message: 'Сначала начните задачу' },
    });
  });

  it('uses caller-provided fallback for an unknown error', async () => {
    const response = communicationApiFailure(
      context,
      new Error('internal detail'),
      'COMMUNICATION_FAILED',
      'Коммуникации временно недоступны.',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'COMMUNICATION_FAILED',
        message: 'Коммуникации временно недоступны.',
        requestId: context.requestId,
      },
    });
  });
});
