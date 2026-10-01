import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';

const control = vi.hoisted(() => ({ requireUser: vi.fn(), list: vi.fn() }));
vi.mock('./chatgpt-auth', () => ({ requireChatGPTUser: control.requireUser }));
vi.mock('@/lib/cloud/access-repository.server', () => ({ cloudAccessRepositoryForPage: async () => ({ listPrincipalAssignments: control.list }) }));
vi.mock('./clinic-shell', () => ({ ClinicShell: ({ children }: { children: React.ReactNode }) => children }));
import { AuthenticatedClinicPage, getAuthenticatedClinicContext } from './authenticated-clinic-page';

const NOW = Date.UTC(2026, 8, 30);
function assignment(overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary {
  return { assignmentId: 'assignment-a', assignmentVersionId: 'version-a', assignmentVersion: 1,
    status: 'active', source: 'administrator', effectiveFrom: NOW - 1, effectiveUntil: null,
    organization: { id: 'org-a', name: 'Clinic A', status: 'active' }, facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
    department: { id: 'dep-a', name: 'Registry', code: 'registry', kind: 'administrative', status: 'active' },
    membership: { id: 'membership-a', legacyRole: 'registrar', status: 'active' },
    user: { id: 'staff-a', displayName: 'Employee A', status: 'active' }, roles: ['registrar'],
    allowPermissions: [], denyPermissions: [], effectivePermissions: ['clinic.dashboard.read', 'patient.directory.read'], ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  control.requireUser.mockReset().mockResolvedValue({ userId: 'staff-a', displayName: 'Employee A', email: null,
    fullName: null, issuer: 'https://project.supabase.co/auth/v1' });
  control.list.mockReset().mockResolvedValue([assignment()]);
});

describe('authenticated cloud dashboard capability', () => {
  it('supports registrar dashboard independently of clinician role and requests verified identity', async () => {
    const context = await getAuthenticatedClinicContext('/dashboard?facilityId=fac-a');
    expect(control.requireUser).toHaveBeenCalledWith('/dashboard?facilityId=fac-a');
    expect(context.capabilities.dashboard).toBe(true);
    expect(context.capabilities.clinician).toBe(false);
    expect(renderToStaticMarkup(AuthenticatedClinicPage({ context, requiredCapability: 'dashboard', children: 'Real cards' }))).toContain('Real cards');
  });
  it('does not grant dashboard by combining permissions across assignments', async () => {
    control.list.mockResolvedValue([assignment({ effectivePermissions: ['clinic.dashboard.read'] }),
      assignment({ assignmentId: 'assignment-b', effectivePermissions: ['patient.directory.read'] })]);
    const context = await getAuthenticatedClinicContext('/dashboard');
    expect(context.capabilities.dashboard).toBe(false);
    const html = renderToStaticMarkup(AuthenticatedClinicPage({ context, requiredCapability: 'dashboard', children: 'Private cards' }));
    expect(html).not.toContain('Private cards');
    expect(html).toContain('одно действующее рабочее назначение');
  });
  it('keeps optional dashboard fixture compatibility closed rather than falling back to clinician', async () => {
    const context = await getAuthenticatedClinicContext('/dashboard');
    delete context.capabilities.dashboard;
    context.capabilities.clinician = true;
    expect(renderToStaticMarkup(AuthenticatedClinicPage({ context, requiredCapability: 'dashboard', children: 'Private cards' })))
      .not.toContain('Private cards');
  });
  it.each<Partial<AccessAssignmentSummary>>([{ roles: ['service', 'doctor'] }, { denyPermissions: ['clinic.dashboard.read'] },
    { effectiveUntil: NOW }, { status: 'revoked' }])('does not expose dashboard for denied/noncurrent scope %j', async overrides => {
      control.list.mockResolvedValue([assignment(overrides)]);
      expect((await getAuthenticatedClinicContext('/dashboard')).capabilities.dashboard).toBe(false);
    });
  it('hides private children on authority failure instead of treating it as empty records', async () => {
    control.list.mockRejectedValue(new Error('RPC unavailable'));
    const context = await getAuthenticatedClinicContext('/dashboard');
    expect(context.accessCheck).toBe('unavailable');
    expect(context.capabilities.dashboard).toBe(false);
    const html = renderToStaticMarkup(AuthenticatedClinicPage({ context, requiredCapability: 'dashboard', children: 'Private cards' }));
    expect(html).toContain('Проверка доступа недоступна');
    expect(html).not.toContain('Private cards');
  });
});
