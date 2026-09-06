import { describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  AccessPermissionRequiredError,
} from '@/lib/auth/access-governance';
import { MultipleObservationAccessSelectionRequiredError } from '@/lib/auth/observation-access';
import { ObservationCorrectionForbiddenError } from '@/lib/repositories/patient-observations';
import { createApiRequestContext } from './api-response';
import { observationApiFailure } from './observation-api-errors';

function context() {
  return createApiRequestContext(
    new Request('https://orion.test/api/observations'),
    '/api/observations',
  );
}

describe('observation API error boundary', () => {
  it('returns only minimized assignment options for an exact-scope choice', async () => {
    const response = observationApiFailure(
      context(),
      new MultipleObservationAccessSelectionRequiredError([
        {
          assignmentId: 'assignment-a',
          organizationName: 'ORION Clinic',
          facilityId: 'fac-a',
          facilityName: 'Главный филиал',
          departmentName: 'Общая медицина',
          role: 'clinician',
        },
      ]),
      'OBSERVATION_LIST_FAILED',
      'Не удалось загрузить показатели.',
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
    new AccessPermissionRequiredError('observations.manage'),
    new ObservationCorrectionForbiddenError(),
  ])('uses the same neutral 403 for unavailable access', async (error) => {
    const response = observationApiFailure(
      context(),
      error,
      'OBSERVATION_LIST_FAILED',
      'Не удалось загрузить показатели.',
    );
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'OBSERVATION_FORBIDDEN',
      message: 'Нет доступа к показателям в выбранном рабочем контуре.',
    });
    expect(body.error.details).toBeUndefined();
  });
});
