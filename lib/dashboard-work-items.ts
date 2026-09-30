import { z } from 'zod';
import type { DashboardSource } from './dashboard-summary';

const person = z.object({ displayName: z.string() });
export type DashboardWorkItem = {
  id: string; source: DashboardSource; title: string; patient: string;
  status: string; href: string; timestamp: number | null;
  dateKind: 'changed' | 'due' | 'day'; attention: boolean;
};

/** Current server records only. Dates retain their meaning; a due date is not an event. */
export function dashboardWorkItems(source: DashboardSource, raw: unknown): DashboardWorkItem[] {
  if (source === 'orders') {
    const data = z.object({ orders: z.array(z.object({
      id: z.string(), patient: person,
      current: z.object({ status: z.string(), requestedService: z.string(), createdAt: z.number().finite() }),
      report: z.object({ current: z.object({ reportStatus: z.string(), reviewState: z.string(), createdAt: z.number().finite() }) }).nullable().optional(),
    })) }).parse(raw);
    const labels: Record<string, string> = { draft: 'Черновик', active: 'В работе', on_hold: 'Приостановлено' };
    return data.orders.flatMap((item) => {
      const report = item.report?.current;
      const validReport = report && !['cancelled', 'entered_in_error'].includes(report.reportStatus);
      const attention = Boolean(['active', 'on_hold', 'completed'].includes(item.current.status) &&
        validReport && ['pending', 'needs_reconciliation'].includes(report.reviewState));
      // A corrected result can require review after its request was completed.
      if (!['draft', 'active', 'on_hold'].includes(item.current.status) && !attention) return [];
      return [{ id: item.id, source, title: item.current.requestedService, patient: item.patient.displayName,
        status: attention ? report?.reviewState === 'needs_reconciliation' ? 'Сверить результат' : 'Проверить результат' : labels[item.current.status],
        timestamp: Math.max(item.current.createdAt, report?.createdAt ?? item.current.createdAt), dateKind: 'changed' as const, attention,
        href: `/pathway?view=orders&requestId=${encodeURIComponent(item.id)}` }];
    });
  }
  if (source === 'care') {
    const data = z.object({ tasks: z.array(z.object({ id: z.string(), title: z.string(), patient: person,
      current: z.object({ status: z.string(), dueDate: z.string(), dueState: z.string() }),
    })) }).parse(raw);
    const labels: Record<string, string> = { overdue: 'Срок прошёл', due_soon: 'Скоро срок', current: 'По плану' };
    return data.tasks.filter((item) => ['pending', 'in_progress', 'escalated'].includes(item.current.status)).map((item) => ({
      id: item.id, source, title: item.title, patient: item.patient.displayName,
      status: item.current.status === 'escalated' ? 'Требует решения' : labels[item.current.dueState] ?? 'Открыта',
      timestamp: Date.parse(`${item.current.dueDate}T00:00:00Z`), dateKind: 'due',
      attention: item.current.dueState === 'overdue' || item.current.status === 'escalated', href: '/pathway?view=care',
    }));
  }
  if (source === 'communications') {
    const data = z.object({ manualTasks: z.array(z.object({ id: z.string(), channel: z.string(), patient: person,
      current: z.object({ state: z.string(), dueAt: z.number().finite() }),
    })) }).parse(raw);
    const labels: Record<string, string> = { open: 'Ожидает связи', in_progress: 'В работе', escalated: 'Требует решения' };
    return data.manualTasks.filter((item) => item.current.state in labels).map((item) => ({
      id: item.id, source, title: item.channel === 'voice' ? 'Позвонить пациенту' : 'Связаться с пациентом',
      patient: item.patient.displayName, status: labels[item.current.state], timestamp: item.current.dueAt,
      dateKind: 'due', attention: item.current.state === 'escalated', href: '/pathway?view=communications',
    }));
  }
  const data = z.object({ queue: z.array(z.object({ id: z.string(), displayNumber: z.string(), serviceDate: z.string(), patient: person,
    current: z.object({ status: z.string(), roomLabel: z.string().nullable().optional() }),
  })) }).parse(raw);
  const labels: Record<string, string> = { arrived: 'Ожидает', called: 'Вызван', in_service: 'На приёме', exception: 'Нужно разобраться' };
  return data.queue.filter((item) => item.current.status in labels).map((item) => ({
    id: item.id, source, title: `Талон ${item.displayNumber}${item.current.roomLabel ? ` · ${item.current.roomLabel}` : ''}`,
    patient: item.patient.displayName, status: labels[item.current.status],
    timestamp: Date.parse(`${item.serviceDate}T00:00:00Z`), dateKind: 'day',
    attention: item.current.status === 'exception', href: '/scheduling',
  }));
}

export function sortDashboardWork(items: readonly DashboardWorkItem[]) {
  return [...items].sort((a, b) => Number(b.attention) - Number(a.attention) ||
    (a.dateKind === 'changed' ? (b.timestamp ?? 0) - (a.timestamp ?? 0) : (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity)));
}
