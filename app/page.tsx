import { ClinicalWorkspace } from './clinical-workspace';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from './authenticated-clinic-page';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ encounterId?: string | string[] }>;
}) {
  const query = await searchParams;
  const encounterId =
    typeof query.encounterId === 'string' ? query.encounterId : undefined;
  const returnTo = encounterId
    ? `/?encounterId=${encodeURIComponent(encounterId)}`
    : '/';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="clinician">
      <ClinicalWorkspace />
    </AuthenticatedClinicPage>
  );
}
