import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import { GET } from './route';
import { POST } from './departments/route';

describe('access administration API boundary', () => {
  it('requires identity before returning the administrative workspace', async () => {
    const response = await GET(
      new Request('https://orion.test/api/access/admin'),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a cross-origin mutation before parsing or database access', async () => {
    const response = await POST(
      new Request('https://orion.test/api/access/admin/departments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://outside.example',
        },
        body: JSON.stringify({}),
      }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('INVALID_ORIGIN');
  });
});
