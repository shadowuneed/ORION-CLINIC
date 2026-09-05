import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { ObservationWorkspaceView } from './observation-workspace';

export const dynamic = 'force-dynamic';

export default async function ObservationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    facilityId?: string | string[];
    patientId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const patientId =
    typeof query.patientId === 'string' ? query.patientId : undefined;
  const params = new URLSearchParams();
  if (facilityId) params.set('facilityId', facilityId);
  if (patientId) params.set('patientId', patientId);
  const returnTo = params.size > 0 ? `/observations?${params}` : '/observations';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="observations">
      <ObservationWorkspaceView />
    </AuthenticatedClinicPage>
  );
}
