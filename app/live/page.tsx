import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { OrionWorkspace } from '../orion-workspace';

export const dynamic = 'force-dynamic';

export default async function LiveConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ encounterId?: string | string[] }>;
}) {
  const query = await searchParams;
  const encounterId =
    typeof query.encounterId === 'string' ? query.encounterId.trim() : '';
  const returnTo = encounterId
    ? `/live?encounterId=${encodeURIComponent(encounterId)}`
    : '/live';
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="clinician">
      <OrionWorkspace
        clinicianName={context.user.displayName}
        requestedEncounterId={encounterId || null}
      />
    </AuthenticatedClinicPage>
  );
}
