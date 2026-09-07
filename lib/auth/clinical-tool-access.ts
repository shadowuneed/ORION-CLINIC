import { getSiteIdentity, toSiteIdentityPrincipal } from './site-identity';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  AccessPermissionRequiredError,
  type AccessGovernanceRepository,
} from './access-governance';
import {
  EncounterAccessSelectionRequiredError,
  resolveEncounterAssignmentAccess,
  type EncounterAccessAssignmentOption,
} from './encounter-assignment-access';

export type ClinicalToolAccessResult =
  | {
      ok: true;
      identityId: string;
      accessAssignmentId: string;
      accessAssignmentVersion: number;
      membershipId: string;
      organizationId: string;
      facilityId: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 409 | 503;
      code: 'invalid_access_selection' | 'unauthenticated' | 'clinical_tool_forbidden' |
        'access_assignment_selection_required' | 'authorization_unavailable';
      message: string;
      assignments?: EncounterAccessAssignmentOption[];
    };

function readSelection(request: Request) {
  const query = new URL(request.url).searchParams;
  const selection: { accessAssignmentId?: string; facilityId?: string } = {};
  for (const key of ['accessAssignmentId', 'facilityId'] as const) {
    const values = query.getAll(key);
    if (values.length > 1) return null;
    if (values.length === 0) continue;
    const value = values[0].trim();
    // An explicit empty/invalid selector must not become an implicit fallback.
    if (!value || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
    selection[key] = value;
  }
  return selection;
}

export async function verifyClinicalToolAccess(
  repository: AccessGovernanceRepository,
  request: Request,
): Promise<ClinicalToolAccessResult> {
  const identity = getSiteIdentity(request);
  if (!identity) {
    return { ok: false, status: 401, code: 'unauthenticated', message: 'Требуется вход врача.' };
  }
  const selection = readSelection(request);
  if (!selection) {
    return { ok: false, status: 400, code: 'invalid_access_selection', message: 'Некорректный выбор рабочего назначения.' };
  }
  try {
    const assignment = await resolveEncounterAssignmentAccess(
      repository, toSiteIdentityPrincipal(identity), 'encounter.manage', selection,
    );
    return {
      ok: true,
      identityId: identity.id,
      accessAssignmentId: assignment.assignmentId,
      accessAssignmentVersion: assignment.assignmentVersion,
      membershipId: assignment.membership.id,
      organizationId: assignment.organization.id,
      facilityId: assignment.facility.id,
    };
  } catch (error) {
    if (error instanceof EncounterAccessSelectionRequiredError) {
      return {
        ok: false, status: 409, code: 'access_assignment_selection_required',
        message: 'Выберите рабочее назначение врача для анализа и распознавания.',
        assignments: error.assignments,
      };
    }
    if (error instanceof AccessMembershipRequiredError ||
        error instanceof AccessAssignmentNotFoundError ||
        error instanceof AccessPermissionRequiredError) {
      return {
        ok: false, status: 403, code: 'clinical_tool_forbidden',
        message: 'Рабочее назначение недоступно или недостаточно прав для этого действия.',
      };
    }
    return {
      ok: false, status: 503, code: 'authorization_unavailable',
      message: 'Не удалось проверить клинический доступ.',
    };
  }
}
