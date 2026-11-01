import { getAuthenticatedClinicContext } from '../authenticated-clinic-page';
import { ClinicShell } from '../clinic-shell';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
import { CrmWorkspace } from './crm-workspace';
import './crm.module.css';
import crmFirstPaintCss from './crm.module.css?inline';
import operationsFirstPaintCss from './crm-operations.module.css?inline';
import motionFirstPaintCss from './crm-motion.module.css?inline';
import schedulingFirstPaintCss from './crm-scheduling.module.css?inline';
import consoleFirstPaintCss from './crm-map-console.module.css?inline';
import { FirstPaintStyles } from '../first-paint-styles';
import { ClinicalShell } from '../clinical/clinical-shell';
import { RegionalWorkspace } from './region/regional-workspace';
import regionalFirstPaintCss from './region/regional-workspace.module.css?inline';
import regionalMapFirstPaintCss from './region/regional-map.module.css?inline';
import regionalKpiFirstPaintCss from './region/regional-kpi-panel.module.css?inline';
import { RegionalDirectivesPanel } from './region/regional-directives-panel';
import directivesFirstPaintCss from './region/regional-directives-panel.module.css?inline';

export const dynamic = 'force-dynamic';

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ view?: string; area?: string; facility?: string }> }) {
  if (localAccountModeEnabled()) {
    const query = await searchParams;
    if (query.view === 'directives') {
      return <ClinicalShell returnTo="/crm?view=directives"><FirstPaintStyles id="regional-directives" css={directivesFirstPaintCss} /><RegionalDirectivesPanel /></ClinicalShell>;
    }
    if (query.view !== 'schedule' && query.view !== 'clinic') {
      const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value) ? value : null;
      const area = id(query.area); const facility = id(query.facility);
      const params = new URLSearchParams(); if (area) params.set('area', area); if (facility) params.set('facility', facility);
      return <ClinicalShell returnTo={`/crm${params.size ? `?${params}` : ''}`}><FirstPaintStyles id="regional-crm" css={`${regionalFirstPaintCss}\n${regionalMapFirstPaintCss}\n${regionalKpiFirstPaintCss}\n${crmFirstPaintCss}\n${motionFirstPaintCss}`} /><RegionalWorkspace initialDistrictId={area} initialFacilityId={facility} /></ClinicalShell>;
    }
    return <ClinicalShell returnTo={query.view === 'schedule' ? '/crm?view=schedule' : '/crm'}><FirstPaintStyles id="crm" css={`${crmFirstPaintCss}\n${operationsFirstPaintCss}\n${motionFirstPaintCss}\n${schedulingFirstPaintCss}\n${consoleFirstPaintCss}`} /><CrmWorkspace initialView={query.view === 'schedule' ? 'schedule' : 'clinic'} /></ClinicalShell>;
  }
  const context = await getAuthenticatedClinicContext('/crm');
  return (
    <ClinicShell capabilities={context.capabilities} user={context.user} profile={context.profile}>
      {localAccountModeEnabled() ? <><FirstPaintStyles id="crm" css={`${crmFirstPaintCss}\n${operationsFirstPaintCss}\n${motionFirstPaintCss}\n${schedulingFirstPaintCss}\n${consoleFirstPaintCss}`} /><CrmWorkspace /></> : <main><h1>CRM — локальная версия</h1><p>Новая PostgreSQL CRM запускается отдельно на ПК. Облачный перенос ещё не выполнен.</p></main>}
    </ClinicShell>
  );
}
