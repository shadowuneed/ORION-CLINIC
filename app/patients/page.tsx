import { PatientDirectory } from './patient-directory';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';

export const dynamic = 'force-dynamic';

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string | string[] }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const returnTo = facilityId
    ? `/patients?facilityId=${encodeURIComponent(facilityId)}`
    : '/patients';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="patient-directory">
      <PatientDirectory />
    </AuthenticatedClinicPage>
  );
}
