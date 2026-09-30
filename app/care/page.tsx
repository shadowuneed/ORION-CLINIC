import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { ChronicCareWorkspace } from './care-workspace';
import { careObservationPageUrl } from '@/lib/care-observation-navigation';

export const dynamic = 'force-dynamic';

export default async function ChronicCarePage({
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
  const returnTo = careObservationPageUrl('care', query);
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="chronic-care">
      <ChronicCareWorkspace />
    </AuthenticatedClinicPage>
  );
}
