import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { CommunicationsWorkspace } from './communications-workspace';

export const dynamic = 'force-dynamic';

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string | string[] }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const returnTo = facilityId
    ? `/communications?facilityId=${encodeURIComponent(facilityId)}`
    : '/communications';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="communications">
      <CommunicationsWorkspace />
    </AuthenticatedClinicPage>
  );
}
