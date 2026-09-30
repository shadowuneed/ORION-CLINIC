import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import { GET } from './route';

describe('latest anthropometry API boundary', () => {
  it('requires a patient identifier', async () => {
    const response = await GET(new Request('https://orion.test/api/observations/latest-anthropometry'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects anonymous reads before D1 access', async () => {
    const response = await GET(new Request('https://orion.test/api/observations/latest-anthropometry?patientId=patient-a&facilityId=fac-a&accessAssignmentId=assignment-a'));
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});
