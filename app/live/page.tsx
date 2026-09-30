import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from '../authenticated-clinic-page';
import { OrionWorkspace } from '../orion-workspace';
import { EncounterStart } from './encounter-start';
import './clinical-live.css';
import { WorkspaceAssignmentBoundary } from '../workspace-assignment-boundary';
import { workspacePageUrl, type WorkspacePageQuery } from '@/lib/workspace-access-url';

export const dynamic = 'force-dynamic';

export default async function LiveConsultationPage({
  searchParams,
}: {
  searchParams: Promise<WorkspacePageQuery>;
}) {
  const query = await searchParams;
  const encounterId =
    typeof query.encounterId === 'string' ? query.encounterId.trim() : '';
  const returnTo = workspacePageUrl('/live', query);
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="clinician">
      <WorkspaceAssignmentBoundary user={context.user} returnTo={returnTo}>
        {encounterId ? <OrionWorkspace
          clinicianName={context.user.displayName}
          requestedEncounterId={encounterId || null}
        /> : <EncounterStart />}
      </WorkspaceAssignmentBoundary>
    </AuthenticatedClinicPage>
  );
}
