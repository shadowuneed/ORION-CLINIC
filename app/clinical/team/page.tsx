import { ClinicalShell } from '../clinical-shell';
import { FirstPaintStyles } from '../../first-paint-styles';
import { ClinicalTeam } from './team-workspace';
import css from './team.module.css?inline';

export const dynamic = 'force-dynamic';
export default function ClinicalTeamPage() {
  return <ClinicalShell returnTo="/clinical/team"><FirstPaintStyles id="clinical-team" css={css} /><ClinicalTeam /></ClinicalShell>;
}
