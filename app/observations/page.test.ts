import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
const control = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn() }));
vi.mock('../authenticated-clinic-page', () => ({ getAuthenticatedClinicContext: control.context,
  AuthenticatedClinicPage: ({ children, requiredCapability }: { children: ReactNode; requiredCapability: string }) =>
    createElement('div', { 'data-capability': requiredCapability }, children) }));
vi.mock('@/lib/cloud/access-repository.server', () => ({ cloudAccessRepositoryForPage: async () => ({ listPrincipalAssignments: control.list }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('./cloud-observations', () => ({ CloudObservationsView: ({ selection }: { selection: Record<string, string> }) =>
  createElement('section', { 'data-scope': JSON.stringify(selection) }, 'Selected patient only') }));
import ObservationsPage from './page';
const assignment = (overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary => ({
  assignmentId: 'assignment-a', assignmentVersionId: 'version-a', assignmentVersion: 1,
  status: 'active', source: 'administrator', effectiveFrom: 1, effectiveUntil: null,
  organization: { id: 'org-a', name: 'Clinic A', status: 'active' }, facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
  department: { id: 'dep-a', name: 'General', code: 'general', kind: 'clinical', status: 'active' },
  membership: { id: 'member-a', legacyRole: 'clinician', status: 'active' }, user: { id: 'staff-a', displayName: 'Employee A', status: 'active' },
  roles: ['doctor'], allowPermissions: [], denyPermissions: [], effectivePermissions: ['observations.manage'], ...overrides,
});
const render = async (query: Parameters<typeof ObservationsPage>[0]['searchParams'] extends Promise<infer T> ? T : never) =>
  renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve(query) }));
beforeEach(() => {
  control.context.mockReset().mockResolvedValue({ accessCheck: 'ready', capabilities: { observations: true },
    user: { userId: 'staff-a', displayName: 'Employee A', email: null, issuer: 'https://project.supabase.co/auth/v1' } });
  control.list.mockReset().mockResolvedValue([assignment()]);
});
describe('cloud selected-patient observations server page', () => {
  it('resolves one exact clinical assignment before exposing scoped props', async () => {
    const html = await render({ patientId: 'patient-a', facilityId: 'fac-a', accessAssignmentId: 'assignment-a' });
    expect(html).toContain('Selected patient only');
    expect(html).toContain('data-capability="observations"');
    expect(html).toContain('&quot;organizationId&quot;:&quot;org-a&quot;');
    expect(html).toContain('&quot;patientId&quot;:&quot;patient-a&quot;');
  });
  it('asks for a patient without reading the registry or choosing its first row', async () => {
    const html = await render({});
    expect(html).toContain('Откройте карточку пациента');
    expect(html).toContain('/patients?facilityId=fac-a&amp;accessAssignmentId=assignment-a');
    expect(html).not.toContain('Selected patient only');
  });
  it.each([{ patientId: ['patient-a'] }, { patientId: 'patient-a', facilityId: ['fac-a', 'fac-b'] },
    { patientId: 'patient-a', accessAssignmentId: '' }, { patientId: 'patient-a', careTaskId: 'task-a' }])(
    'rejects malformed or unported explicit selection before access lookup %j', async query => {
      expect(await render(query)).toContain('Параметры доступа не подтверждены');
      expect(control.list).not.toHaveBeenCalled();
    });
  it('retains duplicate patient selectors across authentication', async () => {
    await render({ patientId: ['patient-a', 'patient-b'] });
    expect(control.context).toHaveBeenCalledWith('/observations?patientId=patient-a&patientId=patient-b');
  });
  it.each([{ accessAssignmentId: 'wrong' }, { accessAssignmentId: 'assignment-a', facilityId: 'wrong' }])(
    'does not replace a wrong explicit assignment %j', async query => {
      const html = await render({ ...query, patientId: 'patient-a' });
      expect(html).toContain('Параметры доступа не подтверждены');
      expect(html).not.toContain('Selected patient only');
    });
  it('lists distinct eligible scopes for explicit selection without merging them', async () => {
    control.list.mockResolvedValue([assignment(), assignment({ assignmentId: 'assignment-b' })]);
    const html = await render({ patientId: 'patient-a' });
    expect(html).toContain('Выберите рабочий контур');
    expect(html).toContain('accessAssignmentId=assignment-b&amp;patientId=patient-a');
    expect(html).not.toContain('Selected patient only');
  });
  it('does not lend a doctor role from a second assignment', async () => {
    control.list.mockResolvedValue([assignment({ roles: ['administrator'] }), assignment({ assignmentId: 'assignment-b' })]);
    expect(await render({ patientId: 'patient-a', accessAssignmentId: 'assignment-a' })).not.toContain('Selected patient only');
  });
  it('keeps a failed access check distinct from an empty measurement list', async () => {
    control.list.mockRejectedValue(new Error('Unavailable'));
    const html = await render({ patientId: 'patient-a' });
    expect(html).toContain('Проверка доступа недоступна');
    expect(html).not.toContain('Selected patient only');
  });
  it('does not repeat an unavailable context discovery', async () => {
    control.context.mockResolvedValue({ accessCheck: 'unavailable', capabilities: { observations: true }, user: {} });
    expect(await render({ patientId: 'patient-a' })).not.toContain('Selected patient only');
    expect(control.list).not.toHaveBeenCalled();
  });
});
