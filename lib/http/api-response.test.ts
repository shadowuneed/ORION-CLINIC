import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFailure,
  createApiRequestContext,
  hasSameOrigin,
} from './api-response';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API request context', () => {
  it('always generates a server request id', () => {
    const request = new Request('https://example.test/api/workspace', {
      headers: { 'x-request-id': 'request-12345678' },
    });

    const requestId = createApiRequestContext(request, '/api/workspace').requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe('request-12345678');
  });

  it('does not trust an identifier-shaped caller value', () => {
    const request = new Request('https://example.test/api/workspace', {
      headers: { 'x-request-id': '990101123456' },
    });

    expect(createApiRequestContext(request, '/api/workspace').requestId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it('returns a correlation id without logging response content', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('https://example.test/api/workspace');
    const context = createApiRequestContext(request, '/api/workspace');
    const response = apiFailure(
      context,
      503,
      'WORKSPACE_UNAVAILABLE',
      'Серверное состояние временно недоступно.',
    );

    expect(response.headers.get('x-request-id')).toBe(context.requestId);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'WORKSPACE_UNAVAILABLE',
        message: 'Серверное состояние временно недоступно.',
        requestId: context.requestId,
      },
    });
    expect(consoleSpy.mock.calls.flat().join(' ')).not.toContain(
      'Серверное состояние',
    );
  });

  it('requires an exact same-origin mutation', () => {
    expect(
      hasSameOrigin(
        new Request('https://example.test/api/workspace', {
          headers: { origin: 'https://example.test' },
        }),
      ),
    ).toBe(true);
    expect(
      hasSameOrigin(
        new Request('https://example.test/api/workspace', {
          headers: { origin: 'https://attacker.test' },
        }),
      ),
    ).toBe(false);
  });
});
