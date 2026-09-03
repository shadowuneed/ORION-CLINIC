import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import type {
  ActiveMembership,
  WorkspaceAccessRepository,
} from '@/lib/auth/workspace-access';

export type ClinicalToolAccessResult =
  | {
      ok: true;
      identityId: string;
      membership: ActiveMembership & { role: 'clinician' };
    }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code:
        | 'unauthenticated'
        | 'membership_required'
        | 'clinician_role_required'
        | 'authorization_unavailable';
      message: string;
    };

export async function verifyClinicalToolAccess(
  repository: Pick<WorkspaceAccessRepository, 'listActiveMemberships'>,
  request: Request,
): Promise<ClinicalToolAccessResult> {
  const identity = getSiteIdentity(request);
  if (!identity) {
    return {
      ok: false,
      status: 401,
      code: 'unauthenticated',
      message: 'Требуется вход врача.',
    };
  }

  let memberships: ActiveMembership[];
  try {
    memberships = await repository.listActiveMemberships(
      toSiteIdentityPrincipal(identity),
    );
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'authorization_unavailable',
      message: 'Не удалось проверить клинический доступ.',
    };
  }

  if (memberships.length === 0) {
    return {
      ok: false,
      status: 403,
      code: 'membership_required',
      message: 'Нет активного доступа к клинике.',
    };
  }

  const membership = memberships
    .filter(
      (candidate): candidate is ActiveMembership & { role: 'clinician' } =>
        candidate.role === 'clinician',
    )
    .sort((left, right) => left.membershipId.localeCompare(right.membershipId))[0];

  if (!membership) {
    return {
      ok: false,
      status: 403,
      code: 'clinician_role_required',
      message: 'Нужна активная роль врача.',
    };
  }

  return { ok: true, identityId: identity.id, membership };
}
