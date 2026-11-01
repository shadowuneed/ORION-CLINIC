import { ClinicalShell } from './clinical-shell';
import { ClinicalEncounterWorkspace } from './encounter-workspace';
import { FirstPaintStyles } from '../first-paint-styles';
import css from './encounter-workspace.module.css?inline';

export const dynamic = 'force-dynamic';

export default async function ClinicalEncounterPage({ searchParams }: { searchParams: Promise<{ encounterId?: string }> }) {
  const { encounterId } = await searchParams;
  const selected = typeof encounterId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(encounterId) ? encounterId : null;
  return <ClinicalShell returnTo={selected ? `/clinical?encounterId=${encodeURIComponent(selected)}` : '/clinical'}>
    <FirstPaintStyles id="clinical-encounter" css={css} />
    <ClinicalEncounterWorkspace key={selected ?? 'choose-patient'} encounterId={selected} />
  </ClinicalShell>;
}
