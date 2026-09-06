import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import { GET, toSelfAccessResponse } from './route';

function assignment(): AccessAssignmentSummary {
  return {
    assignmentId: 'assignment-a',
    assignmentVersionId: 'internal-version-row',
    assignmentVersion: 2,
    status: 'active',
    source: 'administrator',
    effectiveFrom: 1_704_067_200_000,
    effectiveUntil: null,
    organization: { id: 'org-a', name: 'ORION Clinic', status: 'active' },
    facility: { id: 'fac-a', name: 'Главный филиал', status: 'active' },
    department: {
      id: 'department-a',
      code: 'GENERAL',
      name: 'Общая медицина',
      kind: 'clinical',
      status: 'active',
    },
    membership: {
      id: 'internal-membership',
      legacyRole: 'clinician',
      status: 'active',
    },
    user: {
      id: 'internal-user',
      displayName: 'Врач ORION',
      status: 'active',
    },
    roles: ['doctor'],
    allowPermissions: ['audit.read'],
    denyPermissions: ['patient.profile.write'],
    effectivePermissions: ['clinic.dashboard.read', 'access.self.read'],
  };
}

describe('access overview route boundary', () => {
  it('returns 401 before repository access when Sites identity is missing', async () => {
    const response = await GET(
      new Request('https://orion.test/api/access?assignmentId=assignment-a'),
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(body.error.requestId);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('exposes only the minimal self-access contract', () => {
    const response = toSelfAccessResponse(assignment());
    const serialized = JSON.stringify(response);

    expect(response.assignmentId).toBe('assignment-a');
    expect(response.effectivePermissions).toEqual([
      'clinic.dashboard.read',
      'access.self.read',
    ]);
    expect(serialized).not.toContain('internal-version-row');
    expect(serialized).not.toContain('internal-membership');
    expect(serialized).not.toContain('internal-user');
    expect(serialized).not.toContain('legacyRole');
    expect(serialized).not.toContain('allowPermissions');
    expect(serialized).not.toContain('denyPermissions');
  });
});
