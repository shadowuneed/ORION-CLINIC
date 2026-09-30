import { describe, expect, it } from 'vitest';
import { dashboardSignals, prioritizedSignals } from './dashboard-events';

describe('dashboard event projection', () => {
  it('does not represent a manual voice task as a completed call', () => {
    const [signal] = dashboardSignals('communications', { manualTasks: [{
      id: 'one', channel: 'voice', patient: { displayName: 'Тестовый пациент' },
      current: { state: 'open', dueAt: 1000 },
    }] });
    expect(signal.category).toBe('Ручной звонок ожидает');
    expect(signal.kind).toBe('attention');
    expect(signal.title).toBe('Связаться по телефону');
  });

  it('surfaces urgent pending orders, but not completed orders', () => {
    const orders = [
      { id: 'a', patient: { displayName: 'А' }, current: { status: 'draft', priority: 'urgent', requestedService: 'Анализ', createdAt: 20 } },
      { id: 'b', patient: { displayName: 'Б' }, current: { status: 'completed', priority: 'stat', requestedService: 'ЭКГ', createdAt: 30 } },
    ];
    const signals = dashboardSignals('orders', { orders });
    expect(signals.filter((signal) => signal.kind === 'attention')).toHaveLength(1);
    expect(prioritizedSignals(signals, 'event', 5).map((signal) => signal.title)).toEqual(['ЭКГ', 'Анализ']);
  });

  it('surfaces actual unreviewed results once, using the latest report version date', () => {
    const record = {
      id: 'a b', patient: { displayName: 'А' }, current: { status: 'active', priority: 'routine', requestedService: 'Анализ', createdAt: 20 },
      report: { current: { reportStatus: 'final', reviewState: 'pending', createdAt: 80 } },
    };
    const signals = dashboardSignals('orders', { orders: [record] });
    expect(signals).toHaveLength(2);
    expect(signals.find((signal) => signal.kind === 'attention')).toMatchObject({ category: 'Проверить результат', timestamp: 80, href: '/pathway?view=orders&requestId=a%20b', urgency: 'soon' });
    expect(signals.find((signal) => signal.kind === 'event')).toMatchObject({ category: 'Результат исследования', timestamp: 80 });
    const urgentSignals = dashboardSignals('orders', { orders: [{ ...record, current: { ...record.current, priority: 'urgent' } }] });
    expect(urgentSignals.filter((signal) => signal.kind === 'attention')).toEqual([expect.objectContaining({ id: 'order-attention-a b', category: 'Срочно · Проверить результат', urgency: 'critical' })]);
  });

  it('does not flag reviewed, cancelled or erroneous results and preserves later order changes', () => {
    const record = {
      id: 'a', patient: { displayName: 'А' }, current: { status: 'active', priority: 'routine', requestedService: 'Анализ', createdAt: 90 },
      report: { current: { reportStatus: 'final', reviewState: 'reviewed', createdAt: 80 } },
    };
    for (const report of [record.report, { current: { ...record.report.current, reportStatus: 'cancelled', reviewState: 'pending' } }, { current: { ...record.report.current, reportStatus: 'entered_in_error', reviewState: 'needs_reconciliation' } }]) {
      const signals = dashboardSignals('orders', { orders: [{ ...record, report }] });
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({ kind: 'event', category: 'Назначение', timestamp: 90 });
    }
  });

  it('includes a corrected completed result requiring reconciliation without reviving revoked requests', () => {
    const record = {
      id: 'corrected', patient: { displayName: 'А' }, current: { status: 'completed', priority: 'stat', requestedService: 'Анализ', createdAt: 90 },
      report: { current: { reportStatus: 'corrected', reviewState: 'needs_reconciliation', createdAt: 100 } },
    };
    const signals = dashboardSignals('orders', { orders: [record, { ...record, id: 'revoked', current: { ...record.current, status: 'revoked' } }] });
    expect(signals.filter((signal) => signal.kind === 'attention')).toEqual([expect.objectContaining({ id: 'result-attention-corrected', category: 'Сверить результат', timestamp: 100 })]);
  });

  it('excludes closed care tasks even with stale due states and surfaces future escalations', () => {
    const task = { id: 'open', title: 'Контроль', patient: { displayName: 'А' }, current: { status: 'pending', dueState: 'overdue', dueDate: '2026-09-01' } };
    const signals = dashboardSignals('care', { tasks: [
      task,
      ...['completed', 'cancelled', 'entered_in_error'].map((status) => ({ ...task, id: status, current: { ...task.current, status } })),
      { ...task, id: 'escalated', current: { status: 'escalated', dueState: 'current', dueDate: '2026-12-01' } },
      { ...task, id: 'future', current: { status: 'pending', dueState: 'current', dueDate: '2026-12-01' } },
    ] });
    expect(signals).toHaveLength(2);
    expect(signals.find((signal) => signal.id === 'care-escalated')).toMatchObject({ category: 'Эскалация наблюдения', urgency: 'critical', timestamp: Date.UTC(2026, 11, 1) });
  });
});
