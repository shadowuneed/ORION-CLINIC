import { ClinicalShell } from '../clinical/clinical-shell';
import { ClinicalRegistry } from '../clinical/registry';
import { FirstPaintStyles } from '../first-paint-styles';
import clinicalRegistryCss from '../clinical/registry.module.css?inline';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
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
  if (localAccountModeEnabled()) return <ClinicalShell returnTo="/pathway"><FirstPaintStyles id="clinical-registry" css={clinicalRegistryCss} /><ClinicalRegistry mode="referrals" /></ClinicalShell>;
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
