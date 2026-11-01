import type { CrmTaskAction, CrmTaskStatus, CrmVisitAction, CrmVisitStatus } from './contracts';

const visitTransitions: Record<CrmVisitStatus, Partial<Record<CrmVisitAction, CrmVisitStatus>>> = {
  scheduled: { arrive: 'arrived', cancel: 'cancelled', mark_no_show: 'no_show' },
  arrived: { queue: 'queued', cancel: 'cancelled' },
  queued: { call: 'called', cancel: 'cancelled' },
  called: { requeue: 'queued', start: 'in_service', cancel: 'cancelled' },
  in_service: { complete: 'completed' }, completed: {}, cancelled: {}, no_show: {},
};
const taskTransitions: Record<CrmTaskStatus, Partial<Record<CrmTaskAction, CrmTaskStatus>>> = {
  pending: { start: 'in_progress', escalate: 'escalated' },
  in_progress: { complete: 'completed', escalate: 'escalated' }, completed: {}, escalated: { start: 'in_progress' },
};
export function nextCrmVisitStatus(status: CrmVisitStatus, action: CrmVisitAction): CrmVisitStatus | null {
  return visitTransitions[status]?.[action] ?? null;
}
export function nextCrmTaskStatus(status: CrmTaskStatus, action: CrmTaskAction): CrmTaskStatus | null {
  return taskTransitions[status]?.[action] ?? null;
}
export function allowedCrmVisitActions(status: CrmVisitStatus): CrmVisitAction[] {
  return Object.keys(visitTransitions[status] ?? {}) as CrmVisitAction[];
}
export function allowedCrmTaskActions(status: CrmTaskStatus): CrmTaskAction[] {
  return Object.keys(taskTransitions[status] ?? {}) as CrmTaskAction[];
}
export function canRescheduleCrmVisit(status: CrmVisitStatus): boolean { return status === 'scheduled'; }
