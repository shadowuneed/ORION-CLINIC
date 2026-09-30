import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { PathwayWorkspace, type PathwayView } from './pathway-workspace';

export const dynamic = 'force-dynamic';

export default async function PathwayPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    facilityId?: string | string[];
    accessAssignmentId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['view', 'facilityId', 'accessAssignmentId'] as const) {
    const value = query[key];
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  const returnTo = `/pathway${params.size ? `?${params}` : ''}`;
  const context = await getAuthenticatedClinicContext(returnTo);
  const view = typeof query.view === 'string' ? query.view : undefined;

  return <AuthenticatedClinicPage context={context} requiredCapability="pathway">
    <PathwayWorkspace initialView={view as PathwayView | undefined} capabilities={context.capabilities} />
  </AuthenticatedClinicPage>;
}
