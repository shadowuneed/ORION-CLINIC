import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { CommunicationsWorkspace } from './communications-workspace';

export const dynamic = 'force-dynamic';

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string | string[]; accessAssignmentId?: string | string[] }>;
}) {
  const query = await searchParams;
  const facilityId =
    typeof query.facilityId === 'string' ? query.facilityId : undefined;
  const params = new URLSearchParams();
  if (facilityId) params.set('facilityId', facilityId);
  if (typeof query.accessAssignmentId === 'string') params.set('accessAssignmentId', query.accessAssignmentId);
  const returnTo = params.size ? `/communications?${params}` : '/communications';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="communications">
      <CommunicationsWorkspace key={returnTo} />
    </AuthenticatedClinicPage>
  );
}
