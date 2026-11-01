import { describe, expect, it } from 'vitest';
import { localSpeechEndpoints } from './speech-endpoints';

describe('local speech persistence destination', () => {
  it('retains the legacy D1 destination by default', () => {
    expect(localSpeechEndpoints('encounter-a').session).toBe('/api/workspace/transcript/speech/session');
    expect(localSpeechEndpoints(null).session).toBe('/api/local-speech/session');
  });
  it('routes every PostgreSQL recording request exclusively to PostgreSQL', () => {
    expect(localSpeechEndpoints('encounter a', '/api/clinical/v1/speech')).toEqual({
      health: '/api/clinical/v1/speech/health?encounterId=encounter%20a',
      session: '/api/clinical/v1/speech/session', transcribe: '/api/clinical/v1/speech/transcribe',
    });
  });
  it('cannot silently become an unowned recording without an encounter', () => {
    expect(() => localSpeechEndpoints(null, '/api/clinical/v1/speech')).toThrow();
  });
});
