import { AuthenticatedClinicPage, getAuthenticatedClinicContext } from '../../authenticated-clinic-page';
import { WorkspaceAssignmentBoundary } from '../../workspace-assignment-boundary';
import { workspacePageUrl, type WorkspacePageQuery } from '@/lib/workspace-access-url';
import { EncounterCreationForm } from './creation-form';

export default async function NewEncounter({ searchParams }: { searchParams: Promise<WorkspacePageQuery> }) {
  const returnTo = workspacePageUrl('/encounters/new', await searchParams);
  const context = await getAuthenticatedClinicContext(returnTo);
  return <AuthenticatedClinicPage context={context} requiredCapability="clinician">
    <WorkspaceAssignmentBoundary user={context.user} returnTo={returnTo}>
      <EncounterCreationForm />
    </WorkspaceAssignmentBoundary>
  </AuthenticatedClinicPage>;
}
