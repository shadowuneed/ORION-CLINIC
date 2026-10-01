import Link from 'next/link';
import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError,
  type AccessAssignmentSummary } from '@/lib/auth/access-governance';
import { toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { cloudAccessRepositoryForPage } from '@/lib/cloud/access-repository.server';
import { cloudDashboardReturnTo, cloudDashboardSelection, InvalidCloudDashboardSelectionError,
  MultipleCloudDashboardSelectionRequiredError, resolveCloudDashboardAccess,
  type CloudDashboardSelection } from '@/lib/cloud/dashboard-access.server';
import { AuthenticatedClinicPage, getAuthenticatedClinicContext } from '../authenticated-clinic-page';
import styles from '../authenticated-clinic-page.module.css';
import { CloudDashboard } from './cloud-dashboard';
// Server boundary owns first-paint styles, including the loading/empty screen.
import './cloud-dashboard.module.css';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<CloudDashboardSelection> }) {
  const query = await searchParams;
  const returnTo = cloudDashboardReturnTo(query);
  const context = await getAuthenticatedClinicContext(returnTo);
  let view: { kind: 'resolved'; selected: AccessAssignmentSummary } |
    { kind: 'selection'; assignments: ReadonlyArray<AccessAssignmentSummary> } |
    { kind: 'missing' | 'unavailable' | 'hidden' } = { kind: 'hidden' };
  try {
    // Check selectors even when capability discovery failed. Never convert a
    // malformed explicit scope into another implicitly selected department.
    cloudDashboardSelection(query);
    if (context.accessCheck === 'ready' && context.capabilities.dashboard === true) {
      const selected = await resolveCloudDashboardAccess(await cloudAccessRepositoryForPage(),
        toSiteIdentityPrincipal({ id: context.user.userId, email: context.user.email, issuer: context.user.issuer }), query);
      view = { kind: 'resolved', selected };
    }
  } catch (error) {
    if (error instanceof MultipleCloudDashboardSelectionRequiredError) {
      view = { kind: 'selection', assignments: error.assignments };
    } else if (error instanceof InvalidCloudDashboardSelectionError || error instanceof AccessAssignmentNotFoundError ||
      error instanceof AccessPermissionRequiredError || error instanceof AccessMembershipRequiredError) {
      view = { kind: 'missing' };
    } else {
      view = { kind: 'unavailable' };
    }
  }

  const content = view.kind === 'resolved' ? <CloudDashboard key={`${view.selected.facility.id}:${view.selected.assignmentId}`}
    facilityId={view.selected.facility.id} accessAssignmentId={view.selected.assignmentId} />
    : view.kind === 'selection' ? <main className={styles.state}><small>Рабочий центр</small><h1>Выберите рабочий контур</h1>
        <p>У вас несколько действующих назначений. Карты и права разных подразделений не объединяются.</p>
        <ul>{view.assignments.map(assignment => <li key={assignment.assignmentId}>
          <Link href={cloudDashboardReturnTo({ facilityId: assignment.facility.id, accessAssignmentId: assignment.assignmentId })}>
            {assignment.organization.name} · {assignment.facility.name} · {assignment.department.name}
          </Link>
        </li>)}</ul>
      </main>
    : view.kind === 'missing' ? <main className={styles.state}><small>Данные не открыты</small><h1>Рабочий контур не подтверждён</h1>
        <p>Выбранное назначение или параметры ссылки не подходят для этого центра. Автоматического перехода в другую клинику нет.</p>
        <Link href="/access">Проверить мой доступ</Link>
      </main>
    : view.kind === 'unavailable' ? <main className={styles.state}><small>Данные не открыты</small><h1>Проверка доступа недоступна</h1>
        <p>Не удалось подтвердить выбранный рабочий контур. Повторите загрузку после восстановления соединения.</p>
      </main> : null;
  return <AuthenticatedClinicPage context={context} requiredCapability="dashboard">{content}</AuthenticatedClinicPage>;
}
