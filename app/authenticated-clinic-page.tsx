import type { ReactNode } from 'react';
import {
  isAccessAssignmentCurrentlyActive,
  type AccessAssignmentSummary,
} from '@/lib/auth/access-governance';
import {
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import { cloudAccessRepositoryForPage } from '@/lib/cloud/access-repository.server';
import { staffProfileFromAssignments } from '@/lib/auth/staff-profile-summary';
import { requireChatGPTUser, type ChatGPTUser } from './chatgpt-auth';
import { ClinicShell } from './clinic-shell';
// The server boundary owns first-paint shell styles, not only the client module.
import './clinic-shell.module.css';
import styles from './authenticated-clinic-page.module.css';

export type ClinicCapability =
  | 'clinician'
  | 'patient-directory'
  | 'orders'
  | 'scheduling'
  | 'chronic-care'
  | 'observations'
  | 'communications'
  | 'pathway'
  | 'access'
  | 'access-administration';

export type AuthenticatedClinicContext = {
  user: ChatGPTUser;
  profile: { staffName: string; roles: string[]; workplace: string | null };
  capabilities: {
    clinician: boolean;
    patientDirectory: boolean;
    orders: boolean;
    scheduling: boolean;
    chronicCare: boolean;
    observations: boolean;
    communications: boolean;
    pathway: boolean;
    accessOverview: boolean;
    accessAdministration: boolean;
  };
  accessCheck: 'ready' | 'unavailable';
};

export async function getAuthenticatedClinicContext(
  returnTo: string,
): Promise<AuthenticatedClinicContext> {
  const user = await requireChatGPTUser(returnTo);
  let accessAssignments: AccessAssignmentSummary[] = [];
  let accessCheck: AuthenticatedClinicContext['accessCheck'] = 'ready';

  try {
    accessAssignments = await (await cloudAccessRepositoryForPage()).listPrincipalAssignments(
      toSiteIdentityPrincipal({ id: user.userId, email: user.email, issuer: user.issuer }),
    );
  } catch {
    accessCheck = 'unavailable';
  }

  const capabilities = {
      clinician: accessAssignments.some((assignment) =>
        isAccessAssignmentCurrentlyActive(assignment) &&
        assignment.roles.includes('doctor') && !assignment.roles.includes('service') &&
        assignment.effectivePermissions.includes('encounter.read')),
      patientDirectory: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          !assignment.roles.includes('service') &&
          assignment.effectivePermissions.includes('patient.directory.read'),
      ),
      orders: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          assignment.roles.includes('doctor') &&
          !assignment.roles.includes('service') &&
          assignment.effectivePermissions.includes('orders.manage'),
      ),
      scheduling: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          !assignment.roles.includes('service') &&
          (assignment.roles.includes('doctor') ||
            assignment.roles.includes('registrar')) &&
          assignment.effectivePermissions.includes('scheduling.manage'),
      ),
      chronicCare: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          !assignment.roles.includes('service') &&
          (assignment.roles.includes('doctor') ||
            assignment.roles.includes('nurse')) &&
          assignment.effectivePermissions.includes('care.manage'),
      ),
      observations: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          !assignment.roles.includes('service') &&
          (assignment.roles.includes('doctor') ||
            assignment.roles.includes('nurse')) &&
          assignment.effectivePermissions.includes('observations.manage'),
      ),
      communications: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          !assignment.roles.includes('service') &&
          ['doctor', 'nurse', 'registrar'].some((role) => assignment.roles.includes(role as 'doctor' | 'nurse' | 'registrar')) &&
          assignment.effectivePermissions.includes('communications.manage'),
      ),
      accessOverview: true,
      accessAdministration: accessAssignments.some(
        (assignment) =>
          isAccessAssignmentCurrentlyActive(assignment) &&
          !assignment.roles.includes('service') &&
          assignment.effectivePermissions.includes('access.manage'),
      ),
    };
  return {
    user,
    profile: staffProfileFromAssignments(accessAssignments, user.displayName),
    accessCheck,
    capabilities: { ...capabilities, pathway: capabilities.orders || capabilities.chronicCare || capabilities.observations || capabilities.communications },
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
    orders: context.capabilities.orders,
    scheduling: context.capabilities.scheduling,
    'chronic-care': context.capabilities.chronicCare,
    observations: context.capabilities.observations,
    communications: context.capabilities.communications,
    pathway: context.capabilities.pathway,
    access: context.capabilities.accessOverview,
    'access-administration': context.capabilities.accessAdministration,
  }[requiredCapability];

  return (
    <ClinicShell cloudMode capabilities={context.capabilities} user={context.user} profile={context.profile}>
      {context.accessCheck === 'unavailable' ? (
        <AccessState
          title="Проверка доступа недоступна"
          text="ORION не смог подтвердить рабочее назначение в облачной базе. Данные не открыты. Повторите загрузку после восстановления соединения."
        />
      ) : allowed ? (
        children
      ) : (
        <AccessState
          title="Нет доступа к разделу"
          text={capabilityDenialMessage(requiredCapability)}
        />
      )}
    </ClinicShell>
  );
}

function capabilityDenialMessage(capability: ClinicCapability) {
  switch (capability) {
    case 'clinician':
      return 'Этот раздел доступен только пользователю с активной ролью врача.';
    case 'chronic-care':
      return 'Нужно действующее назначение врача или медсестры с правом работы с наблюдением.';
    case 'observations':
      return 'Нужно действующее назначение врача или медсестры с правом работы с показателями.';
    case 'communications':
      return 'Нужна активная роль врача, медсестры или регистратора в выбранной клинике.';
    case 'pathway':
      return 'Нужен доступ хотя бы к одному разделу маршрута пациента.';
    case 'access':
      return 'Для этого пользователя нет доступного рабочего контура.';
    case 'access-administration':
      return 'Нужно действующее полномочие управления доступом в выбранной клинике.';
    case 'patient-directory':
      return 'Нужно действующее назначение отдела с правом доступа к реестру пациентов.';
    case 'orders':
      return 'Нужно действующее назначение врача с правом работы с направлениями.';
    case 'scheduling':
      return 'Нужно действующее назначение врача или регистратора с правом работы с расписанием.';
  }
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
