import { Children, isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
vi.mock('@/lib/repositories/access-governance', () => ({ D1AccessGovernanceRepository: class {} }));
vi.mock('@/lib/auth/encounter-assignment-access', async (original) => ({
  ...await original<object>(), resolveEncounterAssignmentAccess: resolve,
}));
import { WorkspaceAssignmentBoundary } from './workspace-assignment-boundary';
import { EncounterAccessSelectionRequiredError } from '@/lib/auth/encounter-assignment-access';
import { AccessAssignmentNotFoundError } from '@/lib/auth/access-governance';

const user = { userId: 'synthetic-user', displayName: 'Test', email: null, fullName: null };
function nodes(root: ReactElement): ReactElement<Record<string, unknown>>[] {
  const element = root as ReactElement<Record<string, unknown>>;
  return [element, ...Children.toArray(element.props.children as never).filter(isValidElement).flatMap(nodes)];
}
const render = (returnTo = '/live?encounterId=enc-a&accessAssignmentId=a') =>
  WorkspaceAssignmentBoundary({ user, returnTo, children: 'protected-workspace' });

describe('workspace assignment page boundary', () => {
  beforeEach(() => {
    resolve.mockReset();
    resolve.mockResolvedValue({ assignmentId: 'a', facility: { id: 'fac-a' },
      effectivePermissions: ['encounter.read', 'encounter.manage'], denyPermissions: [] });
  });
  it('passes exact scope and uses a distinct tree identity for changed selection', async () => {
    const first = await render();
    expect(first.props.selection).toEqual({ accessAssignmentId: 'a', facilityId: 'fac-a', canManage: true });
    resolve.mockResolvedValue({ assignmentId: 'b', facility: { id: 'fac-b' }, effectivePermissions: ['encounter.read'], denyPermissions: [] });
    const second = await render('/live?encounterId=enc-a&accessAssignmentId=b');
    expect(first.key).not.toBe(second.key);
    expect(second.props.selection.canManage).toBe(false);
    expect(nodes(second).some((node) => node.props.role === 'status')).toBe(true);
  });
  it('honors an explicit manage deny in the read-only presentation', async () => {
    resolve.mockResolvedValue({ assignmentId: 'a', facility: { id: 'fac-a' },
      effectivePermissions: ['encounter.read', 'encounter.manage'], denyPermissions: ['encounter.manage'] });
    expect((await render()).props.selection.canManage).toBe(false);
  });
  it('renders a required picker without selecting the first assignment', async () => {
    resolve.mockRejectedValue(new EncounterAccessSelectionRequiredError([
      { assignmentId: 'a', organizationName: 'Clinic', facilityId: 'f', facilityName: 'Branch', departmentName: 'Department' },
    ]));
    const elements = nodes(await render('/live?encounterId=enc-a'));
    const select = elements.find((node) => node.type === 'select')!;
    expect(select.props).toMatchObject({ required: true, defaultValue: '', name: 'accessAssignmentId' });
    expect(elements.find((node) => node.type === 'input')?.props).toMatchObject({ name: 'encounterId', value: 'enc-a' });
    expect(elements.some((node) => node.props.selection)).toBe(false);
  });
  it('does not expose the workspace after denial; retry keeps the requested encounter', async () => {
    resolve.mockRejectedValue(new AccessAssignmentNotFoundError());
    const elements = nodes(await render());
    expect(elements.some((node) => node.props.selection)).toBe(false);
    expect(elements.find((node) => node.type === 'a')?.props.href).toBe('/live?encounterId=enc-a');
  });
  it('rejects ambiguous encounter IDs before authorization lookup', async () => {
    const elements = nodes(await render('/live?encounterId=a&encounterId=b'));
    expect(resolve).not.toHaveBeenCalled();
    expect(elements.some((node) => node.props.selection)).toBe(false);
  });
});
