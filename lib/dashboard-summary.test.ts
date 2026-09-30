import { describe, expect, it } from 'vitest';
import { dashboardSummaryUrl, summarizeDashboardSource } from './dashboard-summary';

describe('dashboard operational summary', () => {
  it('counts only active queue states and confirmed appointments', () => {
    expect(summarizeDashboardSource('scheduling', {
      queue: ['issued', 'arrived', 'called', 'completed', 'exception'].map(status => ({ current: { status } })),
      appointments: ['held', 'confirmed', 'cancelled'].map(status => ({ current: { status } })),
    })).toEqual({ state: 'ready', primary: 3, secondary: 1, limited: false });
  });
  it('keeps drafts separate from approved orders and due tasks', () => {
    expect(summarizeDashboardSource('orders', { orders: ['draft', 'active', 'on_hold', 'completed'].map(status => ({ current: { status } })) }))
      .toEqual({ state: 'ready', primary: 1, secondary: 2, limited: false });
    expect(summarizeDashboardSource('care', { tasks: ['overdue', 'due_soon', 'current', 'closed'].map(dueState => ({ current: { dueState } })) }))
      .toEqual({ state: 'ready', primary: 2, secondary: 1, limited: false });
  });
  it('labels manual contact work without treating it as a completed call', () => {
    expect(summarizeDashboardSource('communications', {
      manualTasks: ['open', 'in_progress', 'escalated', 'completed'].map(state => ({ current: { state } })),
    })).toEqual({ state: 'ready', primary: 3, secondary: 1, limited: false });
  });
  it('preserves explicit scope, including duplicate selectors, for server validation', () => {
    const url = dashboardSummaryUrl('orders', new URLSearchParams('facilityId=fac-a&facilityId=fac-b&accessAssignmentId=one'));
    expect(url).toContain('facilityId=fac-a&facilityId=fac-b');
    expect(url).toContain('accessAssignmentId=one');
  });
  it('does not turn a malformed response into zero', () => {
    expect(() => summarizeDashboardSource('care', { tasks: null })).toThrow();
  });
});
