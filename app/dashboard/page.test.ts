import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';

const control = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn() }));
vi.mock('../authenticated-clinic-page', () => ({
  getAuthenticatedClinicContext: control.context,
  AuthenticatedClinicPage: ({ requiredCapability, children }: { requiredCapability: string; children: ReactNode }) =>
    createElement('div', { 'data-capability': requiredCapability }, children),
}));
vi.mock('@/lib/cloud/access-repository.server', () => ({ cloudAccessRepositoryForPage: async () => ({ listPrincipalAssignments: control.list }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('./cloud-dashboard', () => ({ CloudDashboard: ({ facilityId, accessAssignmentId }: { facilityId: string; accessAssignmentId: string }) =>
  createElement('section', { 'data-facility': facilityId, 'data-assignment': accessAssignmentId }, 'Scoped cards') }));
import DashboardPage from './page';

function assignment(overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary {
  return { assignmentId: 'assignment-a', assignmentVersionId: 'version-a', assignmentVersion: 1,
    status: 'active', source: 'administrator', effectiveFrom: 1, effectiveUntil: null,
    organization: { id: 'org-a', name: 'Clinic A', status: 'active' }, facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
    department: { id: 'dep-a', name: 'Registry', code: 'registry', kind: 'administrative', status: 'active' },
    membership: { id: 'membership-a', legacyRole: 'registrar', status: 'active' },
    user: { id: 'staff-a', displayName: 'Employee A', status: 'active' }, roles: ['registrar'],
    allowPermissions: [], denyPermissions: [], effectivePermissions: ['clinic.dashboard.read', 'patient.directory.read'], ...overrides };
}
const render = async (query: Parameters<typeof DashboardPage>[0]['searchParams'] extends Promise<infer T> ? T : never) =>
  renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve(query) }));

beforeEach(() => {
  control.context.mockReset().mockResolvedValue({ accessCheck: 'ready', capabilities: { dashboard: true },
    user: { userId: 'staff-a', displayName: 'Employee A', email: null, issuer: 'https://project.supabase.co/auth/v1' } });
  control.list.mockReset().mockResolvedValue([assignment()]);
});

describe('scoped cloud dashboard server page', () => {
  it('uses dashboard capability and resolves the exact selected assignment before exposing its client component', async () => {
    const html = await render({ accessAssignmentId: 'assignment-a', facilityId: 'fac-a' });
    expect(html).toContain('data-capability="dashboard"');
    expect(html).toContain('data-facility="fac-a" data-assignment="assignment-a"');
    expect(html).toContain('Scoped cards');
    expect(control.context).toHaveBeenCalledWith('/dashboard?accessAssignmentId=assignment-a&facilityId=fac-a');
    expect(control.list).toHaveBeenCalledOnce();
  });
  it('shows only explicit links for multiple eligible scopes, never auto-selecting one', async () => {
    control.list.mockResolvedValue([assignment(), assignment({ assignmentId: 'assignment-b', facility: { ...assignment().facility, id: 'fac-b' } })]);
    const html = await render({});
    expect(html).toContain('Выберите рабочий контур');
    expect(html).toContain('href="/dashboard?accessAssignmentId=assignment-a&amp;facilityId=fac-a"');
    expect(html).toContain('href="/dashboard?accessAssignmentId=assignment-b&amp;facilityId=fac-b"');
    expect(html).not.toContain('Scoped cards');
  });
  it.each([{ facilityId: 'fac-wrong', accessAssignmentId: 'assignment-a' }, { accessAssignmentId: 'assignment-wrong' },
    { facilityId: ['fac-a', 'fac-b'] }, { accessAssignmentId: ['assignment-a'] }])('fails closed for explicit wrong/ambiguous scope %j', async query => {
      const html = await render(query);
      expect(html).toContain('Рабочий контур не подтверждён');
      expect(html).not.toContain('Scoped cards');
      if (Array.isArray(query.facilityId) || Array.isArray(query.accessAssignmentId)) expect(control.list).not.toHaveBeenCalled();
    });
  it('retains all duplicate selectors across authentication instead of replacing them', async () => {
    await render({ accessAssignmentId: ['assignment-a', 'assignment-b'], facilityId: ['fac-a', 'fac-b'] });
    expect(control.context).toHaveBeenCalledWith('/dashboard?accessAssignmentId=assignment-a&accessAssignmentId=assignment-b&facilityId=fac-a&facilityId=fac-b');
  });
  it('hides records when exact selected scope lacks one permission despite another eligible assignment', async () => {
    control.list.mockResolvedValue([assignment({ effectivePermissions: ['patient.directory.read'] }), assignment({ assignmentId: 'assignment-b' })]);
    expect(await render({ accessAssignmentId: 'assignment-a' })).not.toContain('Scoped cards');
  });
  it('does not repeat failed access discovery or query assignments when dashboard capability is absent', async () => {
    control.context.mockResolvedValueOnce({ accessCheck: 'unavailable', capabilities: { dashboard: true }, user: {} });
    expect(await render({})).not.toContain('Scoped cards');
    control.context.mockResolvedValueOnce({ accessCheck: 'ready', capabilities: { clinician: true }, user: {} });
    expect(await render({})).not.toContain('Scoped cards');
    expect(control.list).not.toHaveBeenCalled();
  });
  it('represents authority outage distinctly from a successful empty patient result', async () => {
    control.list.mockRejectedValue(new Error('RPC unavailable'));
    const html = await render({});
    expect(html).toContain('Проверка доступа недоступна');
    expect(html).not.toContain('Scoped cards');
    expect(html).not.toContain('пока нет карт');
  });
});
