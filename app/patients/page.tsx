import { PatientDirectory } from './patient-directory';
import { ClinicalShell } from '../clinical/clinical-shell';
import { ClinicalRegistry } from '../clinical/registry';
import { FirstPaintStyles } from '../first-paint-styles';
import clinicalRegistryCss from '../clinical/registry.module.css?inline';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';

export const dynamic = 'force-dynamic';

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    facilityId?: string | string[];
    accessAssignmentId?: string | string[];
  }>;
}) {
  if (localAccountModeEnabled()) return <ClinicalShell returnTo="/patients"><FirstPaintStyles id="clinical-registry" css={clinicalRegistryCss} /><ClinicalRegistry mode="patients" /></ClinicalShell>;
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
  const returnTo = `/patients${returnParams.size ? `?${returnParams}` : ''}`;
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="patient-directory">
      <PatientDirectory />
    </AuthenticatedClinicPage>
  );
}
