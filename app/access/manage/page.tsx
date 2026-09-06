import { env } from 'cloudflare:workers';
import {
  resolveAccessAdministration,
  toAccessAdministrationScope,
} from '@/lib/auth/access-administration';
import {
  AccessAssignmentNotFoundError,
  AccessPermissionRequiredError,
  MultipleAccessSelectionRequiredError,
  type AccessAssignmentSummary,
} from '@/lib/auth/access-governance';
import { toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import {
  D1AccessAdministrationRepository,
  type AccessAdministrationWorkspace as AccessAdministrationWorkspaceData,
} from '@/lib/repositories/access-administration';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../../authenticated-clinic-page';
import {
  AccessAdministrationState,
  AccessAdministrationWorkspace,
  AccessAdministrationSelection,
} from './access-administration-workspace';

export const dynamic = 'force-dynamic';

export default async function AccessAdministrationPage({
  searchParams,
}: {
  searchParams: Promise<{ assignmentId?: string | string[] }>;
}) {
  const query = await searchParams;
  const assignmentId = typeof query.assignmentId === 'string'
    ? query.assignmentId
    : undefined;
  const returnTo = assignmentId
    ? `/access/manage?assignmentId=${encodeURIComponent(assignmentId)}`
    : '/access/manage';
  const context = await getAuthenticatedClinicContext(returnTo);
  const principal = toSiteIdentityPrincipal({
    id: context.user.userId,
    email: context.user.email,
  });

  let result:
    | {
        kind: 'workspace';
        actorAssignmentId: string;
        facility: AccessAssignmentSummary['facility'];
        organization: AccessAssignmentSummary['organization'];
        workspace: AccessAdministrationWorkspaceData;
      }
    | { kind: 'selection'; assignments: readonly AccessAssignmentSummary[] }
    | { kind: 'denied' }
    | { kind: 'unavailable' };
  try {
    const overview = await resolveAccessAdministration(
      new D1AccessGovernanceRepository(env.DB),
      principal,
      assignmentId,
    );
    const workspace = await new D1AccessAdministrationRepository(
      env.DB,
      toAccessAdministrationScope(overview.selected),
    ).getWorkspace();
    result = {
      kind: 'workspace',
      actorAssignmentId: overview.selected.assignmentId,
      facility: overview.selected.facility,
      organization: overview.selected.organization,
      workspace,
    };
  } catch (error) {
    if (error instanceof MultipleAccessSelectionRequiredError) {
      result = { kind: 'selection', assignments: error.assignments };
    } else if (
      error instanceof AccessPermissionRequiredError ||
      error instanceof AccessAssignmentNotFoundError
    ) {
      result = { kind: 'denied' };
    } else {
      result = { kind: 'unavailable' };
    }
  }

  const content =
    result.kind === 'workspace' ? (
      <AccessAdministrationWorkspace
        actorAssignmentId={result.actorAssignmentId}
        facility={result.facility}
        organization={result.organization}
        initialWorkspace={result.workspace}
      />
    ) : result.kind === 'selection' ? (
      <AccessAdministrationSelection assignments={result.assignments} />
    ) : result.kind === 'denied' ? (
      <AccessAdministrationState
        title="Нет полномочия администратора"
        text="Для выбранного рабочего контура не выдано access.manage. ORION не показывает сотрудников и назначения без этого разрешения."
      />
    ) : (
      <AccessAdministrationState
        title="Проверка доступа недоступна"
        text="Административные данные не выданы: D1 не подтвердил текущую версию полномочий."
      />
    );

  return (
    <AuthenticatedClinicPage
      context={context}
      requiredCapability="access-administration"
    >
      {content}
    </AuthenticatedClinicPage>
  );
}
