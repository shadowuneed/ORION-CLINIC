import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import { MultipleOrderAccessSelectionRequiredError } from '@/lib/auth/order-workflow-access';
import { createApiRequestContext } from './api-response';
import { orderApiFailure } from './order-api-errors';

function context() {
  const request = new Request('https://orion.test/api/orders');
  return createApiRequestContext(request, '/api/orders');
}

describe('order API error boundary', () => {
  it('returns only the fields needed to select one assignment', async () => {
    const response = orderApiFailure(
      context(),
      new MultipleOrderAccessSelectionRequiredError([
        {
          assignmentId: 'assignment-a',
          organizationName: 'ORION Clinic',
          facilityId: 'facility-a',
          facilityName: 'Главный филиал',
          departmentName: 'Общая медицина',
        },
      ]),
      'ORDER_LIST_FAILED',
      'Не удалось загрузить направления.',
    );
    const body = (await response.json()) as {
      error: { code: string; details?: Record<string, unknown> };
    };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('ACCESS_ASSIGNMENT_SELECTION_REQUIRED');
    expect(body.error.details).toEqual({
      assignments: [
        {
          assignmentId: 'assignment-a',
          organizationName: 'ORION Clinic',
          facilityId: 'facility-a',
          facilityName: 'Главный филиал',
          departmentName: 'Общая медицина',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('membership');
    expect(JSON.stringify(body)).not.toContain('allowPermissions');
    expect(JSON.stringify(body)).not.toContain('roles');
  });

  it.each([
    new AccessAssignmentNotFoundError(),
    new AccessPermissionRequiredError('orders.manage'),
  ])('uses the same neutral 403 for unavailable access', async (error) => {
    const response = orderApiFailure(
      context(),
      error,
      'ORDER_LIST_FAILED',
      'Не удалось загрузить направления.',
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'ORDER_WORKFLOW_FORBIDDEN',
      message: 'Нет доступа к направлениям в выбранном рабочем контуре.',
    });
    expect(body.error.details).toBeUndefined();
  });
});
