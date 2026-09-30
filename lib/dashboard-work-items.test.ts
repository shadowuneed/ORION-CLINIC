import { describe, expect, it } from 'vitest';
import { dashboardWorkItems, sortDashboardWork } from './dashboard-work-items';

describe('dashboard current work cards', () => {
  it('shows saved unreviewed results, excludes closed orders and links exact request', () => {
    const record = { id: 'order a', patient: { displayName: 'A' }, current: { status: 'active', requestedService: 'Анализ', createdAt: 123 }, report: { current: { reportStatus: 'final', reviewState: 'pending', createdAt: 200 } } };
    const items = dashboardWorkItems('orders', { orders: [record, { ...record, id: 'closed', current: { ...record.current, status: 'completed' }, report: { current: { ...record.report.current, reviewState: 'reviewed' } } }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ attention: true, status: 'Проверить результат', href: '/pathway?view=orders&requestId=order%20a', timestamp: 200, dateKind: 'changed' });
    for (const reportStatus of ['cancelled', 'entered_in_error']) {
      expect(dashboardWorkItems('orders', { orders: [{ ...record, report: { current: { ...record.report.current, reportStatus } } }] })[0].attention).toBe(false);
    }
  });
  it('surfaces amended completed results awaiting review, but not revoked requests', () => {
    const record = { id: 'amended', patient: { displayName: 'A' }, current: { status: 'completed', requestedService: 'Анализ', createdAt: 123 }, report: { current: { reportStatus: 'amended', reviewState: 'needs_reconciliation', createdAt: 300 } } };
    const items = dashboardWorkItems('orders', { orders: [record, { ...record, id: 'revoked', current: { ...record.current, status: 'revoked' } }, { ...record, id: 'invalid', current: { ...record.current, status: 'entered_in_error' } }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ attention: true, status: 'Сверить результат', timestamp: 300 });
    expect(dashboardWorkItems('orders', { orders: [{ ...record, current: { ...record.current, createdAt: 400 } }] })[0].timestamp).toBe(400);
  });
  it('keeps real due dates distinct from activity and excludes completed tasks', () => {
    const record = { id: 'task', title: 'Контроль', patient: { displayName: 'A' }, current: { status: 'pending', dueDate: '2026-10-01', dueState: 'current' } };
    const items = dashboardWorkItems('care', { tasks: [record, { ...record, id: 'old', current: { ...record.current, status: 'completed', dueState: 'overdue' } }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ dateKind: 'due', attention: false, timestamp: Date.UTC(2026, 9, 1) });
  });
  it('does not create placeholder records or turn failed sources into empty results', () => {
    expect(dashboardWorkItems('scheduling', { queue: [] })).toEqual([]);
    expect(() => dashboardWorkItems('orders', { error: 'unavailable' })).toThrow();
  });
  it('puts escalated contacts first without claiming a call was made', () => {
    const items = dashboardWorkItems('communications', { manualTasks: ['open', 'escalated', 'completed'].map((state, i) => ({ id: String(i), channel: 'voice', patient: { displayName: 'A' }, current: { state, dueAt: i + 1 } })) });
    expect(items).toHaveLength(2);
    expect(sortDashboardWork(items)[0]).toMatchObject({ status: 'Требует решения', title: 'Позвонить пациенту' });
  });
});
