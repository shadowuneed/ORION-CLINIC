import {
  AccessPermissionRequiredError,
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  InteractiveServiceAccessForbiddenError,
  MultipleAccessSelectionRequiredError,
} from '@/lib/auth/access-governance';
import {
  resolveAccessAdministration,
  toAccessAdministrationScope,
} from '@/lib/auth/access-administration';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  AccessAdministrationConflictError,
  AccessAdministrationForbiddenError,
  AccessAdministrationNotFoundError,
  AccessAdministrationUnchangedError,
  D1AccessAdministrationRepository,
} from '@/lib/repositories/access-administration';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import { apiFailure, type ApiRequestContext } from './api-response';

export async function resolveAccessAdministrationRequest(input: {
  request: Request;
  database: D1Database;
  actorAssignmentId?: string;
  facilityId?: string;
}) {
  const identity = getSiteIdentity(input.request);
  if (!identity) return null;
  const overview = await resolveAccessAdministration(
    new D1AccessGovernanceRepository(input.database),
    toSiteIdentityPrincipal(identity),
    input.actorAssignmentId,
  );
  if (input.facilityId && overview.selected.facility.id !== input.facilityId) {
    throw new AccessAssignmentNotFoundError();
  }
  const scope = toAccessAdministrationScope(overview.selected);
  return {
    identity,
    overview,
    scope,
    repository: new D1AccessAdministrationRepository(input.database, scope),
  };
}

export function accessAdministrationFailure(
  context: ApiRequestContext,
  error: unknown,
) {
  if (error instanceof MultipleAccessSelectionRequiredError) {
    return apiFailure(
      context,
      409,
      'ACCESS_SELECTION_REQUIRED',
      'Выберите рабочий контур администратора.',
      {
        assignments: error.assignments.map((assignment) => ({
          assignmentId: assignment.assignmentId,
          organization: assignment.organization,
          facility: assignment.facility,
          department: assignment.department,
        })),
      },
    );
  }
  if (
    error instanceof AccessMembershipRequiredError ||
    error instanceof AccessAssignmentNotFoundError ||
    error instanceof InteractiveServiceAccessForbiddenError ||
    error instanceof AccessPermissionRequiredError ||
    error instanceof AccessAdministrationForbiddenError
  ) {
    return apiFailure(
      context,
      403,
      'ACCESS_ADMINISTRATION_FORBIDDEN',
      'Нет полномочия управлять доступом в выбранном контуре.',
    );
  }
  if (error instanceof AccessAdministrationNotFoundError) {
    return apiFailure(
      context,
      404,
      'ACCESS_RESOURCE_NOT_FOUND',
      'Запись не найдена в выбранном контуре.',
    );
  }
  if (error instanceof AccessAdministrationUnchangedError) {
    return apiFailure(
      context,
      409,
      'ACCESS_COMMAND_UNCHANGED',
      'Новая версия не отличается от текущей.',
    );
  }
  if (error instanceof AccessAdministrationConflictError) {
    return apiFailure(
      context,
      409,
      'ACCESS_COMMAND_CONFLICT',
      'Данные уже изменились. Обновите экран и повторите команду.',
    );
  }
  return apiFailure(
    context,
    500,
    'ACCESS_ADMINISTRATION_FAILED',
    'Не удалось выполнить команду управления доступом.',
  );
}
