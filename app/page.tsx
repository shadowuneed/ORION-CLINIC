import { ClinicalWorkspace } from './clinical-workspace';
import { ClinicDashboard } from './clinic-dashboard';
// Keep the initial dashboard styled before client hydration and CSS handoff.
import './clinic-dashboard.module.css';
import { WorkspaceAssignmentBoundary } from './workspace-assignment-boundary';
import { workspacePageUrl, type WorkspacePageQuery } from '@/lib/workspace-access-url';
import { homeLandingPath } from '@/lib/home-landing';
import { redirect } from 'next/navigation';
import { ClinicalShell } from './clinical/clinical-shell';
import { ClinicalRegistry } from './clinical/registry';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
import { FirstPaintStyles } from './first-paint-styles';
import clinicalRegistryCss from './clinical/registry.module.css?inline';
import {
  AuthenticatedClinicPage,
  getAuthenticatedClinicContext,
} from './authenticated-clinic-page';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<WorkspacePageQuery>;
}) {
  if (localAccountModeEnabled()) return <ClinicalShell returnTo="/"><FirstPaintStyles id="clinical-registry" css={clinicalRegistryCss} /><ClinicalRegistry /></ClinicalShell>;
  const query = await searchParams;
  const returnTo = workspacePageUrl('/', query);
  const context = await getAuthenticatedClinicContext(returnTo);
  const landing = context.accessCheck === 'ready' ? homeLandingPath(context.capabilities, query) : null;
  if (landing) redirect(landing);

  return (
    <AuthenticatedClinicPage context={context} requiredCapability="clinician">
      <WorkspaceAssignmentBoundary user={context.user} returnTo={returnTo}>
        {query.encounterId ? <ClinicalWorkspace /> : <ClinicDashboard capabilities={context.capabilities} />}
      </WorkspaceAssignmentBoundary>
    </AuthenticatedClinicPage>
  );
}
