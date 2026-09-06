import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import { MultipleSchedulingAccessSelectionRequiredError } from '@/lib/auth/scheduling-access';
import { createApiRequestContext } from './api-response';
import { schedulingApiFailure } from './scheduling-api-errors';

function context() {
  return createApiRequestContext(
    new Request('https://orion.test/api/scheduling'),
    '/api/scheduling',
  );
}

describe('scheduling API error boundary', () => {
  it('returns only minimized assignment options for exact-scope selection', async () => {
    const response = schedulingApiFailure(
      context(),
      new MultipleSchedulingAccessSelectionRequiredError([
        {
          assignmentId: 'assignment-a',
          organizationName: 'ORION Clinic',
          facilityId: 'fac-a',
          facilityName: 'Главный филиал',
          departmentName: 'Общая медицина',
          role: 'clinician',
        },
      ]),
      'SCHEDULING_LIST_FAILED',
      'Не удалось загрузить расписание.',
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
          facilityId: 'fac-a',
          facilityName: 'Главный филиал',
          departmentName: 'Общая медицина',
          role: 'clinician',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('membership');
    expect(JSON.stringify(body)).not.toContain('denyPermissions');
  });

  it.each([
    new AccessAssignmentNotFoundError(),
    new AccessPermissionRequiredError('scheduling.manage'),
  ])('uses the same neutral 403 for unavailable access', async (error) => {
    const response = schedulingApiFailure(
      context(),
      error,
      'SCHEDULING_LIST_FAILED',
      'Не удалось загрузить расписание.',
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'SCHEDULING_FORBIDDEN',
      message: 'Нет доступа к расписанию.',
    });
    expect(body.error.details).toBeUndefined();
  });
});
