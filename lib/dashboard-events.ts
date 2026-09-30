import { z } from 'zod';
import type { DashboardSource } from './dashboard-summary';

const person = z.object({ displayName: z.string() });
const ordersSchema = z.object({ orders: z.array(z.object({
  id: z.string(), patient: person,
  current: z.object({ status: z.string(), priority: z.string(), requestedService: z.string(), createdAt: z.number().finite() }),
  report: z.object({ current: z.object({ reportStatus: z.string(), reviewState: z.string(), createdAt: z.number().finite() }) }).nullable().optional(),
})) });
const careSchema = z.object({ tasks: z.array(z.object({
  id: z.string(), title: z.string(), patient: person,
  current: z.object({ status: z.string(), dueState: z.string(), dueDate: z.string() }),
})) });
const communicationsSchema = z.object({ manualTasks: z.array(z.object({
  id: z.string(), channel: z.string(), patient: person,
  current: z.object({ state: z.string(), dueAt: z.number() }),
})) });
const schedulingSchema = z.object({ queue: z.array(z.object({
  id: z.string(), displayNumber: z.string(), serviceDate: z.string(), patient: person,
  current: z.object({ status: z.string() }),
})) });

export type DashboardSignal = {
  id: string;
  category: string;
  title: string;
  patient: string;
  timestamp: number;
  urgency: 'critical' | 'soon' | 'normal';
  href: string;
  kind: 'attention' | 'event';
};

/** Project only recorded work. Manual contact tasks are not completed calls. */
export function dashboardSignals(source: DashboardSource, raw: unknown): DashboardSignal[] {
  if (source === 'orders') {
    return ordersSchema.parse(raw).orders.flatMap((order) => {
      const report = order.report?.current;
      const reportIsLatest = Boolean(report && report.createdAt > order.current.createdAt);
      const resultNeedsReview = Boolean(['active', 'on_hold', 'completed'].includes(order.current.status) &&
        report && !['cancelled', 'entered_in_error'].includes(report.reportStatus) &&
        ['pending', 'needs_reconciliation'].includes(report.reviewState));
      const event: DashboardSignal = {
        id: `order-${order.id}`, category: reportIsLatest ? 'Результат исследования' : 'Назначение', title: order.current.requestedService,
        patient: order.patient.displayName, timestamp: Math.max(order.current.createdAt, report?.createdAt ?? order.current.createdAt),
        urgency: 'normal', href: `/pathway?view=orders&requestId=${encodeURIComponent(order.id)}`, kind: 'event',
      };
      const urgent = ['urgent', 'asap', 'stat'].includes(order.current.priority) &&
        ['draft', 'active', 'on_hold'].includes(order.current.status);
      const reviewLabel = report?.reviewState === 'needs_reconciliation' ? 'Сверить результат' : 'Проверить результат';
      // One actionable card per request; urgent + unreviewed must not double-count.
      return urgent || resultNeedsReview ? [event, {
        ...event, id: `${urgent ? 'order-attention' : 'result-attention'}-${order.id}`,
        category: resultNeedsReview ? `${urgent ? 'Срочно · ' : ''}${reviewLabel}` : 'Срочное назначение',
        urgency: urgent ? 'critical' as const : 'soon' as const, kind: 'attention' as const,
      }] : [event];
    });
  }
  if (source === 'care') {
    return careSchema.parse(raw).tasks.filter((task) =>
      ['pending', 'in_progress', 'escalated'].includes(task.current.status) &&
      (task.current.status === 'escalated' || ['overdue', 'due_soon'].includes(task.current.dueState)))
      .map((task) => ({
        id: `care-${task.id}`, category: task.current.dueState === 'overdue' ? 'Просроченная задача' : task.current.status === 'escalated' ? 'Эскалация наблюдения' : 'Скоро срок',
        title: task.title, patient: task.patient.displayName,
        timestamp: Date.parse(`${task.current.dueDate}T00:00:00Z`),
        urgency: task.current.dueState === 'overdue' || task.current.status === 'escalated' ? 'critical' as const : 'soon' as const,
        href: '/pathway?view=care', kind: 'attention' as const,
      }));
  }
  if (source === 'communications') {
    return communicationsSchema.parse(raw).manualTasks.filter((task) => ['open', 'in_progress', 'escalated'].includes(task.current.state))
      .map((task) => ({
        id: `contact-${task.id}`,
        category: task.current.state === 'escalated' ? 'Эскалация связи' : task.channel === 'voice' ? 'Ручной звонок ожидает' : 'Ручная связь ожидает',
        title: task.channel === 'voice' ? 'Связаться по телефону' : 'Связаться с пациентом',
        patient: task.patient.displayName, timestamp: task.current.dueAt,
        urgency: task.current.state === 'escalated' ? 'critical' as const : 'soon' as const,
        href: '/pathway?view=communications', kind: 'attention' as const,
      }));
  }
  return schedulingSchema.parse(raw).queue.filter((ticket) => ticket.current.status === 'exception')
    .map((ticket) => ({
      id: `queue-${ticket.id}`, category: 'Исключение в очереди', title: `Талон ${ticket.displayNumber}`,
      patient: ticket.patient.displayName, timestamp: Date.parse(`${ticket.serviceDate}T00:00:00Z`),
      urgency: 'critical' as const, href: '/scheduling', kind: 'attention' as const,
    }));
}

export function prioritizedSignals(signals: readonly DashboardSignal[], kind: DashboardSignal['kind'], limit: number) {
  const rank = { critical: 0, soon: 1, normal: 2 };
  return signals.filter((signal) => signal.kind === kind && Number.isFinite(signal.timestamp))
    .sort((left, right) => kind === 'attention'
      ? rank[left.urgency] - rank[right.urgency] || left.timestamp - right.timestamp
      : right.timestamp - left.timestamp)
    .slice(0, limit);
}
