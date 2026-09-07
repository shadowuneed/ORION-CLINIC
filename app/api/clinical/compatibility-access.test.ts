import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';

const store = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: {} }));
vi.mock('@/lib/repositories/access-governance', () => ({
  D1AccessGovernanceRepository: class {
    listPrincipalAssignments = store.list;
  },
}));

import { POST as analyze } from './analyze/route';
import { POST as research } from './research/route';
import { GET as health } from '../local-speech/health/route';
import { POST as createSession, DELETE as deleteSession } from '../local-speech/session/route';
import { POST as transcribe } from '../local-speech/transcribe/route';

const assignment: AccessAssignmentSummary = {
  assignmentId: 'assignment-a', assignmentVersionId: 'version-a', assignmentVersion: 1,
  status: 'active', source: 'administrator', effectiveFrom: 0, effectiveUntil: null,
  organization: { id: 'org-a', name: 'Clinic A', status: 'active' },
  facility: { id: 'fac-a', name: 'Facility A', status: 'active' },
  department: { id: 'dept-a', code: 'THERAPY', name: 'Therapy', kind: 'clinical', status: 'active' },
  membership: { id: 'member-a', legacyRole: 'clinician', status: 'active' },
  user: { id: 'user-a', displayName: 'Doctor A', status: 'active' },
  roles: ['doctor'], allowPermissions: [], denyPermissions: [], effectivePermissions: ['encounter.manage'],
};

const handlers = [
  { name: 'analysis', path: '/api/clinical/analyze', method: 'POST', run: analyze },
  { name: 'research', path: '/api/clinical/research', method: 'POST', run: research },
  { name: 'speech health', path: '/api/local-speech/health', method: 'GET', run: health },
  { name: 'speech session create', path: '/api/local-speech/session', method: 'POST', run: createSession },
  { name: 'speech session delete', path: '/api/local-speech/session', method: 'DELETE', run: deleteSession },
  { name: 'transcription', path: '/api/local-speech/transcribe', method: 'POST', run: transcribe },
];

function request(path: string, method: string, options: { anonymous?: boolean; crossOrigin?: boolean; query?: string } = {}) {
  return new Request(`https://orion.test${path}${options.query ?? ''}`, {
    method,
    headers: {
      ...(options.anonymous ? {} : { 'oai-authenticated-user-id': 'site-user-a' }),
      origin: options.crossOrigin ? 'https://foreign.test' : 'https://orion.test',
      'content-type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
}

beforeEach(() => {
  store.list.mockReset().mockResolvedValue([assignment]);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ready: true })));
});
afterEach(() => vi.unstubAllGlobals());

describe.each(handlers)('$name assignment boundary', ({ path, method, run }) => {
  it('rejects unauthenticated and cross-origin calls before storage or provider calls', async () => {
    expect((await run(request(path, method, { anonymous: true }))).status).toBe(401);
    expect((await run(request(path, method, { crossOrigin: true }))).status).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not call a provider with an explicitly denied assignment', async () => {
    store.list.mockResolvedValue([
      { ...assignment, denyPermissions: ['encounter.manage'], effectivePermissions: [] },
      { ...assignment, assignmentId: 'assignment-b' },
    ]);
    const response = await run(request(path, method, { query: '?accessAssignmentId=assignment-a' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Рабочее назначение недоступно или недостаточно прав для этого действия.',
      code: 'clinical_tool_forbidden',
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns minimized choices, never first-assignment fallback', async () => {
    store.list.mockResolvedValue([assignment, { ...assignment, assignmentId: 'assignment-b' }]);
    const response = await run(request(path, method));
    expect(response.status).toBe(409);
    const body = await response.json() as { code: string; assignments: Record<string, unknown>[] };
    expect(body.code).toBe('access_assignment_selection_required');
    expect(body.assignments).toHaveLength(2);
    expect(Object.keys(body.assignments[0]).sort()).toEqual([
      'assignmentId', 'departmentName', 'facilityId', 'facilityName', 'organizationName',
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed selection before provider calls', async () => {
    expect((await run(request(path, method, { query: '?accessAssignmentId=' }))).status).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('allows exactly selected speech health and rechecks revocation on the next call', async () => {
  store.list.mockResolvedValue([assignment, { ...assignment, assignmentId: 'assignment-b' }]);
  const path = '/api/local-speech/health';
  const options = { query: '?accessAssignmentId=assignment-a&facilityId=fac-a' };
  expect((await health(request(path, 'GET', options))).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://127.0.0.1:3101/health');
  store.list.mockResolvedValue([{ ...assignment, status: 'revoked' }]);
  expect((await health(request(path, 'GET', options))).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(1);
});
