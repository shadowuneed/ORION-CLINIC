import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import { POST as createEnrollment } from './enrollments/route';
import { GET } from './route';

describe('chronic-care API boundary', () => {
  it('requires identity before resolving an exact care assignment', async () => {
    const response = await GET(
      new Request(
        'https://orion.test/api/care?facilityId=fac-a&accessAssignmentId=assignment-a',
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

  it('rejects a cross-origin enrollment command before body or D1 access', async () => {
    const response = await createEnrollment(
      new Request('https://orion.test/api/care/enrollments', {
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
