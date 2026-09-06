import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import { GET, POST } from './route';

describe('orders API boundary', () => {
  it('requires identity before reading orders or touching D1', async () => {
    const response = await GET(
      new Request(
        'https://orion.test/api/orders?facilityId=fac-a&accessAssignmentId=assignment-a',
      ),
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(body.error.requestId);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a cross-origin order mutation before parsing or database access', async () => {
    const response = await POST(
      new Request('https://orion.test/api/orders', {
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
