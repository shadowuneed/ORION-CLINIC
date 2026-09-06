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
  searchParams: Promise<{
    facilityId?: string | string[];
    accessAssignmentId?: string | string[];
  }>;
}) {
  const { patientId } = await params;
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const accessAssignmentId =
    typeof query.accessAssignmentId === 'string'
      ? query.accessAssignmentId
      : undefined;
  const returnParams = new URLSearchParams();
  if (facilityId) returnParams.set('facilityId', facilityId);
  if (accessAssignmentId) {
    returnParams.set('accessAssignmentId', accessAssignmentId);
  }
  const returnTo = `/patients/${encodeURIComponent(patientId)}${
    returnParams.size ? `?${returnParams}` : ''
  }`;
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="patient-directory">
      <PatientDetailView
        accessAssignmentId={accessAssignmentId}
        facilityId={facilityId}
        patientId={patientId}
      />
    </AuthenticatedClinicPage>
  );
}
