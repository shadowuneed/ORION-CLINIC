import type { ReactNode } from 'react';
import { requireChatGPTUser } from '../chatgpt-auth';
import { ClinicShell } from '../clinic-shell';
import { localAccountModeEnabled } from '@/lib/local-account-mode';
import { FirstPaintStyles } from '../first-paint-styles';
import shellCss from '../clinic-shell.module.css?inline';

/** Navigation is not authorization. PostgreSQL checks every read and command. */
export async function ClinicalShell({ children, returnTo = '/clinical' }: { children: ReactNode; returnTo?: string }) {
  const user = await requireChatGPTUser(returnTo);
  if (!localAccountModeEnabled()) return <main><h1>Локальная клиническая база</h1><p>Этот рабочий контур пока доступен только на компьютере ORION.</p></main>;
  return <ClinicShell user={user} profile={{ staffName: user.displayName, roles: ['Личный рабочий доступ'], workplace: 'ORION · PostgreSQL' }} capabilities={{
    clinician: true, patientDirectory: true, orders: false, scheduling: true,
    chronicCare: false, observations: false, communications: false, pathway: true,
    accessOverview: true, accessAdministration: false,
  }}><FirstPaintStyles id="clinical-shell" css={shellCss} />{children}</ClinicShell>;
}
