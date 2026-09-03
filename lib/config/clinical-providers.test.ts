import { describe, expect, it } from 'vitest';
import {
  ClinicalProviderConfigError,
  parseClinicalProviderConfig,
} from './clinical-providers';

describe('clinical provider configuration', () => {
  it('uses local STT and GPT OSS safe defaults without requiring a secret', () => {
    expect(parseClinicalProviderConfig({})).toMatchObject({
      localSpeech: {
        baseUrl: 'http://127.0.0.1:3101',
        model: 'gigaam-multilingual-local',
      },
      groq: {
        apiKey: null,
        model: 'openai/gpt-oss-120b',
        baseUrl: 'https://api.groq.com/openai/v1',
      },
    });
  });

  it.each([
    { ORION_STT_BASE_URL: 'https://speech.example.test' },
    { ORION_STT_BASE_URL: 'http://192.168.1.20:3101' },
    { GROQ_API_BASE_URL: 'not-a-url' },
    { GROQ_MODEL: '' },
  ])('fails closed for invalid provider configuration: %o', (source) => {
    expect(() => parseClinicalProviderConfig(source)).toThrow(
      ClinicalProviderConfigError,
    );
  });
});
