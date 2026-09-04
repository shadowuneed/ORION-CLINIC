import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { SchedulingWorkspace } from './scheduling-workspace';

export const dynamic = 'force-dynamic';

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string | string[] }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const returnTo = facilityId
    ? `/scheduling?facilityId=${encodeURIComponent(facilityId)}`
    : '/scheduling';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="scheduling">
      <SchedulingWorkspace />
    </AuthenticatedClinicPage>
  );
}
