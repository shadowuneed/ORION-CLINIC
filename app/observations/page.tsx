import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { ObservationWorkspaceView } from './observation-workspace';
import { careObservationPageUrl } from '@/lib/care-observation-navigation';

export const dynamic = 'force-dynamic';

export default async function ObservationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    facilityId?: string | string[];
    accessAssignmentId?: string | string[];
    patientId?: string | string[];
    careTaskId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const returnTo = careObservationPageUrl('observations', query);
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="observations">
      <ObservationWorkspaceView />
    </AuthenticatedClinicPage>
  );
}
