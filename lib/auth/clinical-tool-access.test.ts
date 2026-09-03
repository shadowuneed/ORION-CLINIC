import { describe, expect, it } from 'vitest';
import type { ActiveMembership } from '@/lib/auth/workspace-access';
import { verifyClinicalToolAccess } from './clinical-tool-access';

const clinician: ActiveMembership = {
  userId: 'user-a',
  userDisplayName: 'Врач А.',
  membershipId: 'membership-a',
  organizationId: 'org-a',
  organizationName: 'Synthetic Clinic',
  facilityId: 'fac-a',
  facilityName: 'Synthetic Facility',
  role: 'clinician',
};

function request(authenticated = true) {
  return new Request('https://orion.test/api/clinical/analyze', {
    headers: authenticated
      ? { 'oai-authenticated-user-id': 'local-user' }
      : undefined,
  });
}

describe('compatibility clinical-tool access', () => {
  it('requires a Sites identity', async () => {
    const result = await verifyClinicalToolAccess(
      { listActiveMemberships: async () => [clinician] },
      request(false),
    );

    expect(result).toMatchObject({ ok: false, status: 401, code: 'unauthenticated' });
  });

  it('requires an active clinic membership', async () => {
    const result = await verifyClinicalToolAccess(
      { listActiveMemberships: async () => [] },
      request(),
    );

    expect(result).toMatchObject({ ok: false, status: 403, code: 'membership_required' });
  });

  it('does not allow a registrar to use clinical speech or analysis tools', async () => {
    const result = await verifyClinicalToolAccess(
      {
        listActiveMemberships: async () => [
          { ...clinician, membershipId: 'membership-r', role: 'registrar' },
        ],
      },
      request(),
    );

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: 'clinician_role_required',
    });
  });

  it('returns the active clinician membership and fails closed on D1 errors', async () => {
    await expect(
      verifyClinicalToolAccess(
        { listActiveMemberships: async () => [clinician] },
        request(),
      ),
    ).resolves.toMatchObject({
      ok: true,
      identityId: 'local-user',
      membership: { membershipId: 'membership-a', role: 'clinician' },
    });

    await expect(
      verifyClinicalToolAccess(
        { listActiveMemberships: async () => Promise.reject(new Error('D1 unavailable')) },
        request(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: 'authorization_unavailable',
    });
  });
});
