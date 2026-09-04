import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { ChronicCareWorkspace } from './care-workspace';

export const dynamic = 'force-dynamic';

export default async function ChronicCarePage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string | string[] }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const returnTo = facilityId
    ? `/care?facilityId=${encodeURIComponent(facilityId)}`
    : '/care';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="chronic-care">
      <ChronicCareWorkspace />
    </AuthenticatedClinicPage>
  );
}
