import { workspaceNavigationUrl, workspacePageUrl, type WorkspacePageQuery } from './workspace-access-url';

type LandingAccess = { clinician: boolean; pathway: boolean; scheduling: boolean; patientDirectory: boolean };

/** Entry navigation only; each destination still resolves its own exact access. */
export function homeLandingPath(access: LandingAccess, query: WorkspacePageQuery): string | null {
  // An explicit encounter URL must keep its own allow/deny result, including
  // malformed or empty selectors, rather than silently opening another tool.
  if (query.encounterId !== undefined || access.clinician) return null;
  const target = access.pathway ? '/pathway' : access.scheduling ? '/scheduling' : access.patientDirectory ? '/patients' : '/access';
  const source = workspacePageUrl('/', query);
  const search = source.includes('?') ? source.slice(source.indexOf('?')) : '';
  return workspaceNavigationUrl(target, '/', search);
}
