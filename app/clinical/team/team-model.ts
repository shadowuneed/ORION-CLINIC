import { deriveEffectivePermissions, type ClinicPermission, type OrganizationRole } from '@/lib/domain/access-governance';
import { directoryCommandSchema, type DirectoryCommand, type DirectorySnapshot } from '@/lib/clinical/directory-contracts';

export const teamRoles: Record<OrganizationRole, string> = {
  doctor: 'Врач', nurse: 'Медсестра / медбрат', registrar: 'Регистратор', administrator: 'Администратор доступа',
  medical_lead: 'Медицинский руководитель', auditor: 'Аудитор', service: 'Техническая интеграция',
};
export const teamPermissions: Record<ClinicPermission, string> = {
  'clinic.dashboard.read': 'Рабочий обзор', 'patient.directory.read': 'Просмотр реестра пациентов', 'patient.profile.write': 'Изменение карточки пациента',
  'encounter.read': 'Просмотр приёмов', 'encounter.manage': 'Ведение приёмов', 'orders.manage': 'Назначения и направления',
  'scheduling.manage': 'Расписание и очередь', 'care.manage': 'План наблюдения', 'observations.manage': 'Показатели пациента',
  'communications.manage': 'Связь с пациентами', 'access.self.read': 'Просмотр своего доступа', 'access.manage': 'Управление сотрудниками и правами',
  'audit.read': 'Просмотр аудита', 'clinical_policy.review': 'Проверка клинических правил', 'service.integration.execute': 'Выполнение технической интеграции',
};
export type TeamGrant = {
  membershipId: string; assignmentId: string | null; expectedVersion: number | null;
  roles: OrganizationRole[]; allowPermissions: ClinicPermission[]; denyPermissions: ClinicPermission[];
  staffId: string; specialty: string; reason: string; confirmed: boolean;
};
export type TeamRestriction = { type: 'assignment.revoke' | 'membership.disable'; membershipId: string; resourceId: string; expectedVersion: number; name: string; reason: string; confirmed: boolean };
export const emptyTeamGrant = (): TeamGrant => ({ membershipId: '', assignmentId: null, expectedVersion: null,
  roles: [], allowPermissions: [], denyPermissions: [], staffId: '', specialty: '', reason: '', confirmed: false });
export function permissionChoice(form: TeamGrant, permission: ClinicPermission, choice: 'default' | 'allow' | 'deny'): TeamGrant {
  return { ...form, allowPermissions: [...form.allowPermissions.filter(item => item !== permission), ...(choice === 'allow' ? [permission] : [])],
    denyPermissions: [...form.denyPermissions.filter(item => item !== permission), ...(choice === 'deny' ? [permission] : [])], confirmed: false };
}
export function effectiveTeamPermissions(form: TeamGrant) { return deriveEffectivePermissions(form.roles, form.allowPermissions, form.denyPermissions); }
export function buildTeamGrant(snapshot: DirectorySnapshot, form: TeamGrant, idempotencyKey: string): DirectoryCommand {
  if (!form.confirmed) throw new Error('Подтвердите выбранные роли и разрешения.');
  const membership = snapshot.memberships.find(item => item.id === form.membershipId && item.status === 'active');
  const account = snapshot.accounts.find(item => item.id === membership?.userId && item.status === 'active');
  if (!membership || !account) throw new Error('Выберите действующего сотрудника этой клиники.');
  if (!membership.interactive) throw new Error('Для этого участия интерактивный доступ закрыт. Назначение не включает вход.');
  const doctor = form.roles.includes('doctor') && effectiveTeamPermissions(form).includes('encounter.manage');
  if (doctor && (!snapshot.staff.some(item => item.id === form.staffId && item.role === 'doctor') || !form.specialty.trim())) {
    throw new Error('Для ведения приёмов явно выберите существующего врача в штатном справочнике и его специальность.');
  }
  const fields = { clinicId: snapshot.clinic.id, idempotencyKey, roles: form.roles, allowPermissions: form.allowPermissions,
    denyPermissions: form.denyPermissions, staffId: form.staffId || null, specialty: form.specialty.trim() || null, reason: form.reason.trim() };
  const input = form.assignmentId ? { ...fields, type: 'assignment.replace', assignmentId: form.assignmentId, expectedVersion: form.expectedVersion } :
    { ...fields, type: 'assignment.create', membershipId: membership.id };
  if (form.assignmentId) {
    const assignment = snapshot.assignments.find(item => item.id === form.assignmentId && item.membershipId === membership.id && item.status === 'active');
    if (!assignment || assignment.version !== form.expectedVersion) throw new Error('Назначение уже изменилось. Откройте его заново — старые права не будут отправлены поверх новой версии.');
  }
  const parsed = directoryCommandSchema.safeParse(input);
  if (!parsed.success) throw new Error('Выберите хотя бы одну роль и укажите причину. Техническая роль несовместима с другими; запрет и разрешение не могут совпадать.');
  return parsed.data;
}
export function teamAccountName(snapshot: DirectorySnapshot, membershipId: string) {
  const membership = snapshot.memberships.find(item => item.id === membershipId);
  return snapshot.accounts.find(item => item.id === membership?.userId)?.name ?? 'Недоступный сотрудник';
}
export function buildTeamRestriction(snapshot: DirectorySnapshot, selection: TeamRestriction, idempotencyKey: string): DirectoryCommand {
  if (!selection.confirmed || !selection.reason.trim()) throw new Error('Укажите причину и подтвердите выбранного сотрудника.');
  const membership = snapshot.memberships.find(item => item.id === selection.membershipId && item.status === 'active');
  if (!membership) throw new Error('Участие сотрудника уже изменилось. Обновите список.');
  if (selection.type === 'assignment.revoke') {
    const assignment = snapshot.assignments.find(item => item.id === selection.resourceId && item.membershipId === membership.id && item.status === 'active');
    if (!assignment || assignment.version !== selection.expectedVersion) throw new Error('Назначение уже изменилось. Откройте подтверждение заново.');
  } else if (selection.resourceId !== membership.id || membership.version !== selection.expectedVersion) {
    throw new Error('Доступ сотрудника уже изменился. Откройте подтверждение заново.');
  }
  const base = { clinicId: snapshot.clinic.id, reason: selection.reason.trim(), expectedVersion: selection.expectedVersion, idempotencyKey };
  return directoryCommandSchema.parse(selection.type === 'assignment.revoke' ? { ...base, type: selection.type, assignmentId: selection.resourceId } :
    { ...base, type: selection.type, membershipId: selection.resourceId });
}
