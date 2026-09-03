import { describe, expect, it } from 'vitest';
import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from './site-identity';

describe('Sites identity headers', () => {
  it('rejects requests without a trusted user id header', () => {
    expect(getSiteIdentity(new Request('https://orion.test/api/workspace'))).toBeNull();
  });

  it('returns the stable Sites identity without depending on email', () => {
    const request = new Request('https://orion.test/api/workspace', {
      headers: {
        'oai-authenticated-user-id': 'site-user-1',
        'oai-authenticated-user-email': 'doctor@example.test',
      },
    });

    expect(getSiteIdentity(request)).toEqual({
      id: 'site-user-1',
      email: 'doctor@example.test',
    });
  });

  it('adapts Sites headers to a provider-neutral principal', () => {
    expect(
      toSiteIdentityPrincipal({
        id: 'user-123',
        email: 'doctor@example.test',
      }),
    ).toEqual({
      issuer: 'openai:sites',
      subject: 'user-123',
      email: 'doctor@example.test',
    });
  });
});
