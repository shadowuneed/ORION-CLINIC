import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError } from './access-governance';
import { EncounterAccessSelectionRequiredError, type EncounterAccessPermission } from './encounter-assignment-access';
import { apiFailure, type ApiRequestContext } from '@/lib/http/api-response';

export type WorkspaceAccessSelection = {
  accessAssignmentId?: string;
  facilityId?: string;
  permission: EncounterAccessPermission;
};
export class InvalidWorkspaceAccessSelectionError extends Error {}

export function workspaceRequestSelection(request: Request): WorkspaceAccessSelection {
  const query = new URL(request.url).searchParams;
  const encounterIds = query.getAll('encounterId');
  if (encounterIds.length > 1 || (encounterIds.length === 1 &&
      (!encounterIds[0] || encounterIds[0].length > 100 || encounterIds[0] !== encounterIds[0].trim()))) {
    throw new InvalidWorkspaceAccessSelectionError();
  }
  const selection: WorkspaceAccessSelection = {
    permission: request.method === 'GET' ? 'encounter.read' : 'encounter.manage',
  };
  for (const [key, header] of [
    ['accessAssignmentId', 'x-orion-access-assignment-id'],
    ['facilityId', 'x-orion-facility-id'],
  ] as const) {
    const values = query.getAll(key);
    const headerValue = request.headers.get(header);
    if (values.length > 1 || (values.length && headerValue !== null && values[0] !== headerValue)) {
      throw new InvalidWorkspaceAccessSelectionError();
    }
    const raw = values[0] ?? headerValue;
    if (raw === undefined || raw === null) continue;
    if (!raw || raw.length > 100 || raw !== raw.trim() || /[\u0000-\u001f\u007f,]/u.test(raw)) {
      throw new InvalidWorkspaceAccessSelectionError();
    }
    selection[key] = raw;
  }
  return selection;
}

export function workspaceAssignmentFailure(context: ApiRequestContext, error: unknown) {
  if (error instanceof InvalidWorkspaceAccessSelectionError) {
    return apiFailure(context, 400, 'INVALID_ACCESS_SELECTION', 'Некорректный выбор рабочего назначения.');
  }
  if (error instanceof EncounterAccessSelectionRequiredError) {
    return apiFailure(context, 409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED',
      'Выберите рабочее назначение врача.', { assignments: error.assignments });
  }
  if (error instanceof AccessAssignmentNotFoundError || error instanceof AccessMembershipRequiredError ||
      error instanceof AccessPermissionRequiredError) {
    return apiFailure(context, 403, 'WORKSPACE_FORBIDDEN', 'Рабочее назначение недоступно или недостаточно прав.');
  }
  return null;
}
