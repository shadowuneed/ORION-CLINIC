import { describe, expect, it, vi } from 'vitest';
import {
  ClinicalAnalysisProviderError,
  GroqClinicalAnalysisProvider,
} from './groq-clinical-analysis';

const segments = [
  {
    id: 'segment-1',
    version: 1,
    role: 'patient' as const,
    language: 'ru' as const,
    text: 'Температура держится два дня.',
  },
];

const output = {
  summary: 'Черновик.',
  suggestions: [
    {
      category: 'clarification',
      riskLevel: 'informational',
      title: 'Уточнить',
      content: 'Какая максимальная температура?',
      evidence: [{ sourceId: 'segment-1', quote: 'Температура' }],
    },
  ],
  sections: [
    {
      code: 'complaints',
      content: 'Температура два дня.',
      evidence: [{ sourceId: 'segment-1', quote: 'два дня' }],
    },
  ],
};

describe('Groq clinical analysis provider', () => {
  it('uses server authorization and structured output mode', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const provider = new GroqClinicalAnalysisProvider({
      apiKey: 'test-key',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1',
      fetchImpl,
    });

    const result = await provider.analyze({ segments });
    expect(result.output).toEqual(output);
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe('Bearer test-key');
    const body = JSON.parse(String(capturedInit?.body)) as {
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'rate_limited'],
    [503, 'upstream_failed'],
  ] as const)('maps upstream %i to %s', async (status, code) => {
    const provider = new GroqClinicalAnalysisProvider({
      apiKey: 'test-key',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1',
      fetchImpl: async () => new Response('{}', { status }),
    });
    await expect(provider.analyze({ segments })).rejects.toMatchObject({ code });
  });

  it('rejects malformed or invented evidence', async () => {
    const invalid = structuredClone(output);
    invalid.suggestions[0].evidence[0].quote = 'Придуманная цитата';
    const provider = new GroqClinicalAnalysisProvider({
      apiKey: 'test-key',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(invalid) } }],
          }),
          { status: 200 },
        ),
    });
    await expect(provider.analyze({ segments })).rejects.toBeInstanceOf(
      ClinicalAnalysisProviderError,
    );
  });
});
