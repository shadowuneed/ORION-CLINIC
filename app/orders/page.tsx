import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { OrdersWorkspace } from './orders-workspace';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
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
  const returnParams = new URLSearchParams();
  if (facilityId) returnParams.set('facilityId', facilityId);
  if (accessAssignmentId) {
    returnParams.set('accessAssignmentId', accessAssignmentId);
  }
  const returnQuery = returnParams.toString();
  const returnTo = returnQuery ? `/orders?${returnQuery}` : '/orders';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="orders">
      <OrdersWorkspace />
    </AuthenticatedClinicPage>
  );
}
