import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { ChronicCareWorkspace } from './care-workspace';

export const dynamic = 'force-dynamic';

export default async function ChronicCarePage({
  searchParams,
}: {
  searchParams: Promise<{
    facilityId?: string | string[];
    accessAssignmentId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const accessAssignmentId =
    typeof query.accessAssignmentId === 'string'
      ? query.accessAssignmentId
      : undefined;
  const returnToParams = new URLSearchParams();
  if (facilityId) returnToParams.set('facilityId', facilityId);
  if (accessAssignmentId) {
    returnToParams.set('accessAssignmentId', accessAssignmentId);
  }
  const returnToQuery = returnToParams.toString();
  const returnTo = returnToQuery ? `/care?${returnToQuery}` : '/care';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="chronic-care">
      <ChronicCareWorkspace />
    </AuthenticatedClinicPage>
  );
}
