import { describe, expect, it, vi } from 'vitest';
import type { AccessAssignmentSummary } from './access-governance';
import { verifyClinicalToolAccess } from './clinical-tool-access';
import { resolveEncounterAssignmentAccess } from './encounter-assignment-access';

function assignment(overrides: Partial<AccessAssignmentSummary> = {}): AccessAssignmentSummary {
  return {
    assignmentId: 'assignment-a', assignmentVersionId: 'version-a', assignmentVersion: 2,
    status: 'active', source: 'administrator', effectiveFrom: 0, effectiveUntil: null,
    organization: { id: 'org-a', name: 'Clinic A', status: 'active' },
    facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
    department: { id: 'dept-a', code: 'THERAPY', name: 'Therapy', kind: 'clinical', status: 'active' },
    membership: { id: 'member-a', legacyRole: 'clinician', status: 'active' },
    user: { id: 'user-a', displayName: 'Doctor A', status: 'active' },
    roles: ['doctor'], allowPermissions: [], denyPermissions: [],
    effectivePermissions: ['encounter.read', 'encounter.manage'], ...overrides,
  };
}

function request(query = '', authenticated = true) {
  return new Request(`https://orion.test/api/clinical/analyze${query}`, {
    headers: authenticated ? { 'oai-authenticated-user-id': 'local-user' } : undefined,
  });
}

function repository(assignments = [assignment()]) {
  return { listPrincipalAssignments: vi.fn(async () => assignments) };
}

describe('compatibility clinical-tool exact assignment', () => {
  it('rejects anonymous requests before reading D1', async () => {
    const repo = repository();
    expect(await verifyClinicalToolAccess(repo, request('', false))).toMatchObject({ status: 401 });
    expect(repo.listPrincipalAssignments).not.toHaveBeenCalled();
  });

  it('returns the exact current assignment and stable identity for rate limiting', async () => {
    const repo = repository();
    expect(await verifyClinicalToolAccess(repo, request('?accessAssignmentId=assignment-a&facilityId=fac-a'))).toEqual({
      ok: true, identityId: 'local-user', accessAssignmentId: 'assignment-a',
      accessAssignmentVersion: 2, membershipId: 'member-a', organizationId: 'org-a', facilityId: 'fac-a',
    });
    expect(repo.listPrincipalAssignments).toHaveBeenCalledWith({ issuer: 'openai:sites', subject: 'local-user', email: null });
  });

  it('uses doctor role on the assignment rather than legacy membership', async () => {
    expect(await verifyClinicalToolAccess(repository([assignment({
      membership: { id: 'member-a', legacyRole: 'administrator', status: 'active' },
    })]), request())).toMatchObject({ ok: true });
  });

  it.each(['nurse', 'registrar', 'medical_lead', 'administrator', 'auditor', 'service'] as const)(
    'does not promote %s to a doctor even with encounter.manage', async (role) => {
      expect(await verifyClinicalToolAccess(repository([assignment({ roles: [role] })]), request()))
        .toMatchObject({ ok: false, status: 403, code: 'clinical_tool_forbidden' });
    },
  );

  it.each([
    { status: 'revoked' }, { effectiveUntil: 1 }, { effectiveFrom: Number.MAX_SAFE_INTEGER },
    { organization: { id: 'org-a', name: 'Clinic A', status: 'suspended' } },
    { facility: { id: 'fac-a', name: 'Facility A', status: 'suspended' } },
    { department: { ...assignment().department, status: 'disabled' } },
    { membership: { ...assignment().membership, status: 'disabled' } },
    { user: { ...assignment().user, status: 'disabled' } },
    { roles: ['doctor', 'service'] },
    { effectivePermissions: ['encounter.read'] },
    { denyPermissions: ['encounter.manage'] },
  ] satisfies Partial<AccessAssignmentSummary>[])(
    'denies inactive or ineffective selection without falling back: %j', async (override) => {
      const repo = repository([assignment(override), assignment({ assignmentId: 'assignment-b' })]);
      expect(await verifyClinicalToolAccess(repo, request('?accessAssignmentId=assignment-a')))
        .toMatchObject({ ok: false, status: 403, code: 'clinical_tool_forbidden' });
    },
  );

  it('uses one neutral denial for missing, foreign and mismatched scopes', async () => {
    const missing = await verifyClinicalToolAccess(repository([]), request());
    expect(missing).toEqual(await verifyClinicalToolAccess(repository(), request('?accessAssignmentId=foreign')));
    expect(missing).toEqual(await verifyClinicalToolAccess(repository(), request('?accessAssignmentId=assignment-a&facilityId=foreign')));
    expect(missing).toEqual(await verifyClinicalToolAccess(repository(), request('?facilityId=foreign')));
  });

  it('requires a selection even for two assignments in the same facility', async () => {
    const result = await verifyClinicalToolAccess(repository([
      assignment({ assignmentId: 'assignment-b' }), assignment(),
      assignment({ assignmentId: 'denied', effectivePermissions: [] }),
    ]), request('?facilityId=fac-a'));
    expect(result).toMatchObject({ ok: false, status: 409, code: 'access_assignment_selection_required' });
    if (result.ok) throw new Error('Expected selection');
    expect(result.assignments?.map((item) => item.assignmentId)).toEqual(['assignment-a', 'assignment-b']);
    expect(Object.keys(result.assignments![0]).sort()).toEqual([
      'assignmentId', 'departmentName', 'facilityId', 'facilityName', 'organizationName',
    ]);
  });

  it.each([
    '?accessAssignmentId=', '?facilityId=%20', '?accessAssignmentId=a&accessAssignmentId=b',
    '?facilityId=a&facilityId=a', '?accessAssignmentId=%00', `?accessAssignmentId=${'a'.repeat(101)}`,
  ])('rejects malformed explicit selectors without implicit fallback: %s', async (query) => {
    const repo = repository();
    expect(await verifyClinicalToolAccess(repo, request(query))).toMatchObject({ status: 400, code: 'invalid_access_selection' });
    expect(repo.listPrincipalAssignments).not.toHaveBeenCalled();
  });

  it('rechecks current permissions on each call, including after revocation', async () => {
    const repo = repository();
    expect(await verifyClinicalToolAccess(repo, request())).toMatchObject({ ok: true });
    repo.listPrincipalAssignments.mockResolvedValue([assignment({ status: 'revoked', assignmentVersion: 3 })]);
    expect(await verifyClinicalToolAccess(repo, request())).toMatchObject({ ok: false, status: 403 });
  });

  it('fails closed on storage errors without disclosing exception details', async () => {
    const repo = repository();
    repo.listPrincipalAssignments.mockRejectedValue(new Error('private database detail'));
    expect(await verifyClinicalToolAccess(repo, request())).toEqual({
      ok: false, status: 503, code: 'authorization_unavailable', message: 'Не удалось проверить клинический доступ.',
    });
  });

  it('keeps read and manage permissions distinct in the reusable boundary', async () => {
    const repo = repository([assignment({ effectivePermissions: ['encounter.read'] })]);
    const principal = { issuer: 'openai:sites', subject: 'local-user', email: null };
    await expect(resolveEncounterAssignmentAccess(repo, principal, 'encounter.read')).resolves.toMatchObject({ assignmentId: 'assignment-a' });
    await expect(resolveEncounterAssignmentAccess(repo, principal, 'encounter.manage')).rejects.toThrow();
  });
});
