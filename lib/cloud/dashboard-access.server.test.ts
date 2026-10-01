import { describe, expect, it, vi } from 'vitest';
import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError,
  type AccessAssignmentSummary } from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import { cloudDashboardReturnTo, cloudDashboardSelection, hasCloudDashboardAccess,
  InvalidCloudDashboardSelectionError, MultipleCloudDashboardSelectionRequiredError,
  resolveCloudDashboardAccess } from './dashboard-access.server';

const NOW = Date.UTC(2026, 8, 30);
const principal: IdentityPrincipal = { issuer: 'https://project.supabase.co/auth/v1', subject: 'staff-a', email: null };
function assignment(overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary {
  return { assignmentId: 'assignment-a', assignmentVersionId: 'assignment-a-v1', assignmentVersion: 1,
    status: 'active', source: 'administrator', effectiveFrom: NOW - 1, effectiveUntil: null,
    organization: { id: 'org-a', name: 'Clinic A', status: 'active' }, facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
    department: { id: 'department-a', name: 'Therapy', code: 'therapy', kind: 'clinical', status: 'active' },
    membership: { id: 'membership-a', legacyRole: 'registrar', status: 'active' },
    user: { id: 'staff-a', displayName: 'Employee A', status: 'active' }, roles: ['registrar'],
    allowPermissions: [], denyPermissions: [], effectivePermissions: ['clinic.dashboard.read', 'patient.directory.read'], ...overrides };
}
function repository(rows: AccessAssignmentSummary[]) {
  return { listPrincipalAssignments: vi.fn(async (received: IdentityPrincipal) => { expect(received).toEqual(principal); return rows; }) };
}

describe('narrow cloud dashboard assignment selection', () => {
  it.each(['registrar', 'nurse', 'doctor'] as const)('permits a %s with both rights in one current scope', async role => {
    const selected = assignment({ roles: [role] });
    expect(hasCloudDashboardAccess(selected, NOW)).toBe(true);
    await expect(resolveCloudDashboardAccess(repository([selected]), principal, {}, NOW)).resolves.toBe(selected);
  });
  it('does not combine grants from separate assignments', async () => {
    const rows = [assignment({ effectivePermissions: ['clinic.dashboard.read'] }),
      assignment({ assignmentId: 'assignment-b', effectivePermissions: ['patient.directory.read'] })];
    expect(rows.some(row => hasCloudDashboardAccess(row, NOW))).toBe(false);
    await expect(resolveCloudDashboardAccess(repository(rows), principal, {}, NOW)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });
  it('requires explicit choice between multiple current scopes, including departments in one facility', async () => {
    const rows = [assignment(), assignment({ assignmentId: 'assignment-b', department: { ...assignment().department, id: 'department-b' } })];
    await expect(resolveCloudDashboardAccess(repository(rows), principal, { facilityId: 'fac-a' }, NOW))
      .rejects.toMatchObject({ assignments: rows });
    await expect(resolveCloudDashboardAccess(repository(rows), principal, {}, NOW))
      .rejects.toBeInstanceOf(MultipleCloudDashboardSelectionRequiredError);
    await expect(resolveCloudDashboardAccess(repository(rows), principal, { accessAssignmentId: 'assignment-b', facilityId: 'fac-a' }, NOW))
      .resolves.toBe(rows[1]);
  });
  it('can select an unambiguous explicitly requested facility without merging it with others', async () => {
    const second = assignment({ assignmentId: 'assignment-b', facility: { ...assignment().facility, id: 'fac-b' } });
    await expect(resolveCloudDashboardAccess(repository([assignment(), second]), principal, { facilityId: 'fac-b' }, NOW)).resolves.toBe(second);
    await expect(resolveCloudDashboardAccess(repository([assignment(), second]), principal, { facilityId: 'fac-wrong' }, NOW))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });
  it.each([{ accessAssignmentId: 'assignment-wrong' }, { accessAssignmentId: 'assignment-a', facilityId: 'fac-wrong' }])
    ('does not fall back after an explicit wrong assignment/facility %j', async query => {
      await expect(resolveCloudDashboardAccess(repository([assignment()]), principal, query, NOW)).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
    });
  it.each(['clinic.dashboard.read', 'patient.directory.read'] as const)('honors explicit deny of %s even in an inconsistent fixture', async permission => {
    const denied = assignment({ denyPermissions: [permission] });
    expect(hasCloudDashboardAccess(denied, NOW)).toBe(false);
    await expect(resolveCloudDashboardAccess(repository([denied, assignment({ assignmentId: 'assignment-b' })]), principal,
      { accessAssignmentId: denied.assignmentId }, NOW)).rejects.toMatchObject({ permission });
  });
  it.each<Partial<AccessAssignmentSummary>>([
    { status: 'revoked' }, { effectiveFrom: NOW + 1 }, { effectiveUntil: NOW }, { roles: ['service', 'doctor'] },
    { organization: { ...assignment().organization, status: 'suspended' } },
    { facility: { ...assignment().facility, status: 'suspended' } },
    { department: { ...assignment().department, status: 'disabled' } },
    { membership: { ...assignment().membership, status: 'disabled' } },
    { user: { ...assignment().user, status: 'disabled' } },
  ])('fails closed for inactive or service scope %j', async overrides => {
    const value = assignment(overrides);
    expect(hasCloudDashboardAccess(value, NOW)).toBe(false);
    await expect(resolveCloudDashboardAccess(repository([value]), principal, {}, NOW)).rejects.toBeInstanceOf(AccessMembershipRequiredError);
  });
  it.each([{ accessAssignmentId: ['assignment-a'] }, { facilityId: ['fac-a', 'fac-b'] }, { facilityId: '' },
    { accessAssignmentId: ' assignment-a' }, { facilityId: 'fac-a,fac-b' }, { facilityId: 'x'.repeat(101) },
    { accessAssignmentId: 'x'.repeat(161) }, { accessAssignmentId: 'assignment\n-a' }, { facilityId: '../fac-a' }])
    ('rejects malformed and array selectors before repository read %j', async query => {
      const repo = repository([assignment()]);
      expect(() => cloudDashboardSelection(query)).toThrow(InvalidCloudDashboardSelectionError);
      await expect(resolveCloudDashboardAccess(repo, principal, query, NOW)).rejects.toBeInstanceOf(InvalidCloudDashboardSelectionError);
      expect(repo.listPrincipalAssignments).not.toHaveBeenCalled();
    });
  it('preserves all explicit selector duplicates in the return URL instead of converting to implicit scope', () => {
    const url = new URL(cloudDashboardReturnTo({ facilityId: ['fac-a', 'fac-b'], accessAssignmentId: ['assignment-a', 'assignment-b'] }), 'https://orion.invalid');
    expect(url.pathname).toBe('/dashboard');
    expect(url.searchParams.getAll('facilityId')).toEqual(['fac-a', 'fac-b']);
    expect(url.searchParams.getAll('accessAssignmentId')).toEqual(['assignment-a', 'assignment-b']);
  });
});
