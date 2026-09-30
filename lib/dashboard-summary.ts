import { z } from 'zod';

export type DashboardSource = 'scheduling' | 'orders' | 'care' | 'communications';
export type DashboardModule =
  | { state: 'ready'; primary: number; secondary: number; limited: boolean }
  | { state: 'unavailable' };

const schedulingSchema = z.object({
  appointments: z.array(z.object({ current: z.object({ status: z.string() }) })),
  queue: z.array(z.object({ current: z.object({ status: z.string() }) })),
});
const ordersSchema = z.object({ orders: z.array(z.object({ current: z.object({ status: z.string() }) })) });
const careSchema = z.object({ tasks: z.array(z.object({ current: z.object({ dueState: z.string() }) })) });
const communicationsSchema = z.object({ manualTasks: z.array(z.object({ current: z.object({ state: z.string() }) })) });

export function summarizeDashboardSource(source: DashboardSource, value: unknown): DashboardModule {
  if (source === 'scheduling') {
    const data = schedulingSchema.parse(value);
    return {
      state: 'ready',
      primary: data.queue.filter((ticket) => ['arrived', 'called', 'in_service', 'exception'].includes(ticket.current.status)).length,
      secondary: data.appointments.filter((appointment) => appointment.current.status === 'confirmed').length,
      limited: data.queue.length >= 100 || data.appointments.length >= 100,
    };
  }
  if (source === 'orders') {
    const data = ordersSchema.parse(value);
    return {
      state: 'ready',
      primary: data.orders.filter((order) => order.current.status === 'draft').length,
      secondary: data.orders.filter((order) => ['active', 'on_hold'].includes(order.current.status)).length,
      limited: data.orders.length >= 100,
    };
  }
  if (source === 'communications') {
    const data = communicationsSchema.parse(value);
    return {
      state: 'ready',
      primary: data.manualTasks.filter((task) => ['open', 'in_progress', 'escalated'].includes(task.current.state)).length,
      secondary: data.manualTasks.filter((task) => task.current.state === 'escalated').length,
      limited: data.manualTasks.length >= 100,
    };
  }
  const data = careSchema.parse(value);
  return {
    state: 'ready',
    primary: data.tasks.filter((task) => ['overdue', 'due_soon'].includes(task.current.dueState)).length,
    secondary: data.tasks.filter((task) => task.current.dueState === 'current').length,
    limited: data.tasks.length >= 100,
  };
}

export function dashboardSummaryUrl(source: DashboardSource, selection: URLSearchParams): string {
  const url = new URL(`/api/${source}`, 'https://orion.invalid');
  url.searchParams.set('limit', '100');
  for (const key of ['accessAssignmentId', 'facilityId']) {
    for (const value of selection.getAll(key)) url.searchParams.append(key, value);
  }
  return `${url.pathname}${url.search}`;
}
