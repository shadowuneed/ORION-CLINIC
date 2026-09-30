import { isAccessAssignmentCurrentlyActive, type AccessAssignmentSummary } from './access-governance';
import type { OrganizationRole } from '@/lib/domain/access-governance';

const roleLabels: Record<OrganizationRole, string> = {
  doctor: 'Врач',
  nurse: 'Медсестра',
  registrar: 'Регистратор',
  administrator: 'Администратор',
  medical_lead: 'Медицинский руководитель',
  auditor: 'Аудитор',
  service: 'Служебный доступ',
};

/** Display only. Every clinical action still resolves exact current authority on the server. */
export function staffProfileFromAssignments(assignments: AccessAssignmentSummary[], identityName: string, now = Date.now()) {
  // Never pass the predicate directly to Array.find/filter: the array index
  // would become its optional `now` argument and hide valid assignments.
  const active = assignments.filter((assignment) => isAccessAssignmentCurrentlyActive(assignment, now));
  const roles = active.flatMap((assignment) => assignment.roles.map((role) => roleLabels[role]));
  return {
    staffName: active[0]?.user.displayName || identityName,
    roles: Array.from(new Set(roles)),
    workplace: active[0]?.department.name ?? null,
  };
}
