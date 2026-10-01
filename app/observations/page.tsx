import Link from 'next/link';
import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { MultipleObservationAccessSelectionRequiredError, resolveObservationAccess,
  type ObservationAccess } from '@/lib/auth/observation-access';
import { toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { cloudAccessRepositoryForPage } from '@/lib/cloud/access-repository.server';
import { cloudObservationPageReturnTo, cloudObservationPageSelection, InvalidCloudObservationPageSelectionError,
  type CloudObservationPageQuery } from '@/lib/cloud/observation-page-selection';
import { AuthenticatedClinicPage, getAuthenticatedClinicContext } from '../authenticated-clinic-page';
import styles from '../authenticated-clinic-page.module.css';
import { CloudObservationsView } from './cloud-observations';
// Server ownership prevents a first paint without the selected-patient layout.
import './cloud-observations.module.css';

export const dynamic = 'force-dynamic';

export default async function ObservationsPage({ searchParams }: { searchParams: Promise<CloudObservationPageQuery> }) {
  const query = await searchParams;
  const context = await getAuthenticatedClinicContext(cloudObservationPageReturnTo(query));
  let selected: ObservationAccess | null = null;
  let patientId: string | undefined;
  let state: 'hidden' | 'resolved' | 'selection' | 'invalid' | 'unavailable' = 'hidden';
  let choices: MultipleObservationAccessSelectionRequiredError['assignments'] = [];
  try {
    const scope = cloudObservationPageSelection(query);
    patientId = scope.patientId;
    if (context.accessCheck === 'ready' && context.capabilities.observations) {
      selected = await resolveObservationAccess(await cloudAccessRepositoryForPage(),
        toSiteIdentityPrincipal({ id: context.user.userId, email: context.user.email, issuer: context.user.issuer }),
        scope.accessAssignmentId, scope.facilityId);
      state = 'resolved';
    }
  } catch (error) {
    if (error instanceof MultipleObservationAccessSelectionRequiredError) { choices = error.assignments; state = 'selection'; }
    else if (error instanceof InvalidCloudObservationPageSelectionError || error instanceof AccessAssignmentNotFoundError ||
      error instanceof AccessPermissionRequiredError || error instanceof AccessMembershipRequiredError) state = 'invalid';
    else state = 'unavailable';
  }

  const content = state === 'resolved' && selected && patientId
    ? <CloudObservationsView key={`${selected.scope.facilityId}:${selected.scope.accessAssignmentId}:${patientId}`}
      selection={{ organizationId: selected.scope.organizationId, patientId, facilityId: selected.scope.facilityId,
        accessAssignmentId: selected.scope.accessAssignmentId }} />
    : state === 'resolved' ? <main className={styles.state}><small>Показатели</small><h1>Откройте карточку пациента</h1>
      <p>Измерения загружаются только для выбранного пациента, без чтения всего реестра.</p>
      <Link href={`/patients?${new URLSearchParams({ facilityId: selected!.scope.facilityId, accessAssignmentId: selected!.scope.accessAssignmentId })}`}>Выбрать пациента</Link>
    </main>
    : state === 'selection' ? <main className={styles.state}><small>Показатели</small><h1>Выберите рабочий контур</h1>
      <p>Права разных назначений не объединяются.</p><ul>{choices.map(choice => <li key={choice.assignmentId}>
        <Link href={cloudObservationPageReturnTo({ facilityId: choice.facilityId, accessAssignmentId: choice.assignmentId, patientId })}>
          {choice.organizationName} · {choice.facilityName} · {choice.departmentName}
        </Link></li>)}</ul></main>
    : state === 'invalid' ? <main className={styles.state}><small>Данные не открыты</small><h1>Параметры доступа не подтверждены</h1>
      <p>Проверьте назначение и пациента. Связанные задачи наблюдения ещё не подключены; другое назначение автоматически не выбирается.</p>
      <Link href="/access">Проверить мой доступ</Link></main>
    : state === 'unavailable' ? <main className={styles.state}><small>Данные не открыты</small><h1>Проверка доступа недоступна</h1>
      <p>Повторите загрузку после восстановления соединения.</p></main> : null;
  return <AuthenticatedClinicPage context={context} requiredCapability="observations">{content}</AuthenticatedClinicPage>;
}
