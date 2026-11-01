import { env } from 'cloudflare:workers';
import {
  AccessAssignmentNotFoundError,
  AccessMembershipRequiredError,
  InteractiveServiceAccessForbiddenError,
  MultipleAccessSelectionRequiredError,
  resolveAccessOverview,
} from '@/lib/auth/access-governance';
import { toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { AccessWorkspace, AccessWorkspaceState } from './access-workspace';
import Link from 'next/link';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
import { ClinicalShell } from '../clinical/clinical-shell';
import { FirstPaintStyles } from '../first-paint-styles';
import clinicalCss from '../clinical/registry.module.css?inline';
import clinicalStyles from '../clinical/registry.module.css';

export const dynamic = 'force-dynamic';

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ assignmentId?: string | string[] }>;
}) {
  if (localAccountModeEnabled()) return <ClinicalShell returnTo="/access"><FirstPaintStyles id="clinical-access" css={clinicalCss} /><main className={clinicalStyles.page}><header className={clinicalStyles.header}><div><span className={clinicalStyles.eyebrow}>ORION · PostgreSQL</span><h1>Моё рабочее место</h1><p>Вход подтверждает личность. Доступ к пациентам сервер проверяет отдельно при каждом запросе.</p></div></header><section className={clinicalStyles.panel}><h2>Рабочие разделы</h2><div className={clinicalStyles.actions}><Link className={clinicalStyles.primary} href="/">Рабочий день</Link><Link className={clinicalStyles.button} href="/patients">Мои пациенты</Link><Link className={clinicalStyles.button} href="/crm">CRM и очередь</Link><Link className={clinicalStyles.button} href="/clinical/team">Сотрудники и права</Link></div><p className={clinicalStyles.hint}>Управление сотрудниками доступно только администратору с действующим назначением. Права врача не выдаются автоматически вместе с входом.</p></section></main></ClinicalShell>;
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
    const overview = await resolveAccessOverview(
      new D1AccessGovernanceRepository(env.DB),
      principal,
      assignmentId,
    );
    view = { kind: 'resolved', overview };
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
        text="ORION не выдаёт полномочия без подтверждения текущей версии назначения в D1. Повторите после восстановления базы."
      />
    );

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="access">
      {content}
    </AuthenticatedClinicPage>
  );
}
