import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import {
  ChronicCarePermissionRequiredError,
  MultipleChronicCareAccessSelectionRequiredError,
} from '@/lib/auth/chronic-care-access';
import { createApiRequestContext } from './api-response';
import { chronicCareApiFailure } from './chronic-care-api-errors';

function context() {
  return createApiRequestContext(
    new Request('https://orion.test/api/care'),
    '/api/care',
  );
}

describe('chronic-care API error boundary', () => {
  it('returns only minimized assignment options for exact-scope selection', async () => {
    const response = chronicCareApiFailure(
      context(),
      new MultipleChronicCareAccessSelectionRequiredError([
        {
          assignmentId: 'assignment-a',
          organizationName: 'ORION Clinic',
          facilityId: 'fac-a',
          facilityName: 'Главный филиал',
          departmentName: 'Эндокринология',
          role: 'clinician',
        },
      ]),
      'CHRONIC_CARE_LIST_FAILED',
      'Не удалось загрузить наблюдение.',
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
          departmentName: 'Эндокринология',
          role: 'clinician',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('membership');
    expect(JSON.stringify(body)).not.toContain('denyPermissions');
  });

  it.each([
    new AccessAssignmentNotFoundError(),
    new AccessPermissionRequiredError('care.manage'),
    new ChronicCarePermissionRequiredError('plan.sign'),
  ])('uses one neutral 403 for unavailable assignment access', async (error) => {
    const response = chronicCareApiFailure(
      context(),
      error,
      'CHRONIC_CARE_LIST_FAILED',
      'Не удалось загрузить наблюдение.',
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'CHRONIC_CARE_FORBIDDEN',
      message: 'Нет доступа к наблюдению в выбранном рабочем контуре.',
    });
    expect(body.error.details).toBeUndefined();
  });
});
