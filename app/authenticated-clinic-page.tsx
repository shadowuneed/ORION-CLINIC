import { env } from 'cloudflare:workers';
import type { ReactNode } from 'react';
import {
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import type { ActiveMembership } from '@/lib/auth/workspace-access';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';
import { requireChatGPTUser, type ChatGPTUser } from './chatgpt-auth';
import { ClinicShell } from './clinic-shell';
import styles from './authenticated-clinic-page.module.css';

export type ClinicCapability =
  | 'clinician'
  | 'patient-directory'
  | 'scheduling'
  | 'chronic-care'
  | 'observations'
  | 'communications';

export type AuthenticatedClinicContext = {
  user: ChatGPTUser;
  capabilities: {
    clinician: boolean;
    patientDirectory: boolean;
    scheduling: boolean;
    chronicCare: boolean;
    observations: boolean;
    communications: boolean;
  };
  accessCheck: 'ready' | 'unavailable';
};

export async function getAuthenticatedClinicContext(
  returnTo: string,
): Promise<AuthenticatedClinicContext> {
  const user = await requireChatGPTUser(returnTo);
  let memberships: ActiveMembership[] = [];
  let accessCheck: AuthenticatedClinicContext['accessCheck'] = 'ready';

  try {
    memberships = await new D1WorkspaceAccessRepository(
      env.DB,
    ).listActiveMemberships(
      toSiteIdentityPrincipal({ id: user.userId, email: user.email }),
    );
  } catch {
    accessCheck = 'unavailable';
  }

  return {
    user,
    accessCheck,
    capabilities: {
      clinician: memberships.some((membership) => membership.role === 'clinician'),
      patientDirectory: memberships.some(
        (membership) =>
          membership.role === 'clinician' || membership.role === 'registrar',
      ),
      scheduling: memberships.some(
        (membership) =>
          membership.role === 'clinician' || membership.role === 'registrar',
      ),
      chronicCare: memberships.some(
        (membership) =>
          membership.role === 'clinician' || membership.role === 'nurse',
      ),
      observations: memberships.some(
        (membership) =>
          membership.role === 'clinician' || membership.role === 'nurse',
      ),
      communications: memberships.some(
        (membership) =>
          membership.role === 'clinician' ||
          membership.role === 'nurse' ||
          membership.role === 'registrar',
      ),
    },
  };
}

export function AuthenticatedClinicPage({
  children,
  context,
  requiredCapability,
}: {
  children: ReactNode;
  context: AuthenticatedClinicContext;
  requiredCapability: ClinicCapability;
}) {
  const allowed = {
    clinician: context.capabilities.clinician,
    'patient-directory': context.capabilities.patientDirectory,
    scheduling: context.capabilities.scheduling,
    'chronic-care': context.capabilities.chronicCare,
    observations: context.capabilities.observations,
    communications: context.capabilities.communications,
  }[requiredCapability];

  return (
    <ClinicShell capabilities={context.capabilities} user={context.user}>
      {context.accessCheck === 'unavailable' ? (
        <AccessState
          title="Проверка доступа недоступна"
          text="ORION не смог подтвердить роль в D1. Клинические данные и инструменты не открыты. Повторите после восстановления локальной базы."
        />
      ) : allowed ? (
        children
      ) : (
        <AccessState
          title="Нет доступа к разделу"
          text={
            requiredCapability === 'clinician'
              ? 'Этот раздел доступен только пользователю с активной ролью врача.'
              : requiredCapability === 'chronic-care'
                ? 'Нужна активная роль врача или медсестры в выбранной клинике.'
                : requiredCapability === 'observations'
                  ? 'Нужна активная роль врача или медсестры для работы с показателями.'
                : requiredCapability === 'communications'
                  ? 'Нужна активная роль врача, медсестры или регистратора в выбранной клинике.'
                : 'Нужна активная роль врача или регистратора в выбранной клинике.'
          }
        />
      )}
    </ClinicShell>
  );
}

function AccessState({ title, text }: { title: string; text: string }) {
  return (
    <main className={styles.state}>
      <small>Доступ закрыт безопасно</small>
      <h1>{title}</h1>
      <p>{text}</p>
    </main>
  );
}
