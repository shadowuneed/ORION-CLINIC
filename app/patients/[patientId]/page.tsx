import { PatientDetailView } from './patient-detail';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../../authenticated-clinic-page';
import Link from 'next/link';
import { cloudObservationPageSelection } from '@/lib/cloud/observation-page-selection';
import styles from '../../authenticated-clinic-page.module.css';

export const dynamic = 'force-dynamic';

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{
    facilityId?: string | string[];
    accessAssignmentId?: string | string[];
  }>;
}) {
  const { patientId } = await params;
  const query = await searchParams;
  const returnParams = new URLSearchParams();
  for (const key of ['facilityId', 'accessAssignmentId'] as const) {
    const value = query[key];
    for (const item of value === undefined ? [] : Array.isArray(value) ? value : [value]) returnParams.append(key, item);
  }
  const returnTo = `/patients/${encodeURIComponent(patientId)}${
    returnParams.size ? `?${returnParams}` : ''
  }`;
  const context = await getAuthenticatedClinicContext(returnTo);
  let selection: ReturnType<typeof cloudObservationPageSelection>;
  try { selection = cloudObservationPageSelection({ ...query, patientId }); }
  catch {
    return <AuthenticatedClinicPage context={context} requiredCapability="patient-directory">
      <main className={styles.state}><small>Данные не открыты</small><h1>Параметры карточки не подтверждены</h1>
        <p>Проверьте пациента и выбранное назначение. Другой контур автоматически не выбирается.</p>
        <Link href="/access">Проверить мой доступ</Link></main>
    </AuthenticatedClinicPage>;
  }

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="patient-directory">
      {/* Migration0005 remains prepared until owner approval and remote catalog verification. */}
      <PatientDetailView
        key={returnTo}
        accessAssignmentId={selection.accessAssignmentId}
        facilityId={selection.facilityId}
        patientId={patientId}
        photoAvailable={false}
        vitalsAvailable={false}
        encounterWorkspaceAvailable={false}
      />
    </AuthenticatedClinicPage>
  );
}
