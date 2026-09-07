import { ClinicalWorkspace } from './clinical-workspace';
import { WorkspaceAssignmentBoundary } from './workspace-assignment-boundary';
import { workspacePageUrl, type WorkspacePageQuery } from '@/lib/workspace-access-url';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from './authenticated-clinic-page';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<WorkspacePageQuery>;
}) {
  const query = await searchParams;
  const returnTo = workspacePageUrl('/', query);
  const context = await getAuthenticatedClinicContext(returnTo);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="clinician">
      <WorkspaceAssignmentBoundary user={context.user} returnTo={returnTo}>
        <ClinicalWorkspace />
      </WorkspaceAssignmentBoundary>
    </AuthenticatedClinicPage>
  );
}
