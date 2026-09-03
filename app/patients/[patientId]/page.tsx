import { PatientDetailView } from './patient-detail';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../../authenticated-clinic-page';

export const dynamic = 'force-dynamic';

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ facilityId?: string | string[] }>;
}) {
  const { patientId } = await params;
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const returnTo = `/patients/${encodeURIComponent(patientId)}${
    facilityId ? `?facilityId=${encodeURIComponent(facilityId)}` : ''
  }`;
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="patient-directory">
      <PatientDetailView facilityId={facilityId} patientId={patientId} />
    </AuthenticatedClinicPage>
  );
}
