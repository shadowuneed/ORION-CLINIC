import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  InteractiveServiceAccessForbiddenError,
  MultipleAccessSelectionRequiredError,
  resolveAccessOverview,
} from '@/lib/auth/access-governance';
import { toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { cloudAccessRepositoryForPage } from '@/lib/cloud/access-repository.server';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { AccessWorkspace, AccessWorkspaceState } from './access-workspace';

export const dynamic = 'force-dynamic';

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ assignmentId?: string | string[] }>;
}) {
  const query = await searchParams;
  const assignmentId =
    typeof query.assignmentId === 'string' ? query.assignmentId : undefined;
  const returnTo = assignmentId
    ? `/access?assignmentId=${encodeURIComponent(assignmentId)}`
    : '/access';
  const context = await getAuthenticatedClinicContext(returnTo);
  const principal = toSiteIdentityPrincipal({
    id: context.user.userId,
    email: context.user.email,
    issuer: context.user.issuer,
  });

  let view:
    | { kind: 'resolved'; overview: Awaited<ReturnType<typeof resolveAccessOverview>> }
    | { kind: 'selection'; assignments: MultipleAccessSelectionRequiredError['assignments'] }
    | { kind: 'service-forbidden' }
    | { kind: 'missing' }
    | { kind: 'unavailable' };
  try {
    if (context.accessCheck === 'unavailable') {
      // The shell already failed its request-scoped access check. Do not repeat
      // the RPC or accidentally render a second, conflicting authority result.
      view = { kind: 'unavailable' };
    } else {
      const overview = await resolveAccessOverview(
        await cloudAccessRepositoryForPage(),
        principal,
        assignmentId,
      );
      view = { kind: 'resolved', overview };
    }
  } catch (error) {
    if (error instanceof MultipleAccessSelectionRequiredError) {
      view = { kind: 'selection', assignments: error.assignments };
    } else if (error instanceof InteractiveServiceAccessForbiddenError) {
      view = { kind: 'service-forbidden' };
    } else if (
      error instanceof AccessMembershipRequiredError ||
      error instanceof AccessAssignmentNotFoundError
    ) {
      view = { kind: 'missing' };
    } else {
      view = { kind: 'unavailable' };
    }
  }

  const content =
    view.kind === 'resolved' ? (
      <AccessWorkspace
        assignments={view.overview.assignments}
        selected={view.overview.selected}
      />
    ) : view.kind === 'selection' ? (
      <AccessWorkspace assignments={view.assignments} selected={null} />
    ) : view.kind === 'service-forbidden' ? (
      <AccessWorkspaceState
        title="Интерактивный вход запрещён"
        text="Сервисное назначение предназначено только для серверной интеграции и не открывает рабочее место сотрудника."
      />
    ) : view.kind === 'missing' ? (
      <AccessWorkspaceState
        title="Активного назначения нет"
        text="Ваш вход подтверждён, но действующее назначение в подразделение не найдено. Обратитесь к администратору клиники."
      />
    ) : (
      <AccessWorkspaceState
        title="Проверка доступа недоступна"
        text="ORION не выдаёт полномочия без подтверждения текущей версии назначения в облачной базе. Повторите после восстановления соединения."
      />
    );

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="access">
      {content}
    </AuthenticatedClinicPage>
  );
}
