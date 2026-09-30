import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ClinicalAnalysisProviderError, GroqClinicalAnalysisProvider } from './groq-clinical-analysis';

const segments = [{ id: 'synthetic-1', version: 1, role: 'patient' as const, language: 'ru' as const, text: 'Это искусственный тест. Температура держится два дня. Лекарства не принимал.' }];

it('requests and validates clinical sections together with live hints in one call', async () => {
  let body: Record<string, unknown> = {};
  const provider = new GroqClinicalAnalysisProvider({
    apiKey: 'synthetic-live-mode', model: 'openai/gpt-oss-120b', baseUrl: 'https://provider.invalid',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        summary: 'Искусственный пример.', suggestions: [{ category: 'clarification', riskLevel: 'informational', title: 'Уточнить температуру', content: 'Какая температура?', evidence: [{ sourceId: 'synthetic-1', quote: 'Температура держится два дня.' }] }],
        sections: [{ code: 'complaints', content: 'Температура держится два дня.', evidence: [{ sourceId: 'synthetic-1', quote: 'Температура держится два дня.' }] }],
      }) } }] });
    },
  });
  const result = await provider.analyze({ segments, mode: 'live' });
  expect(body).toMatchObject({ max_completion_tokens: 3000, reasoning_effort: 'low', reasoning_format: 'hidden' });
  expect(body.response_format).toMatchObject({ json_schema: { schema: { required: ['summary', 'suggestions', 'sections'] } } });
  expect(result.output.sections).toMatchObject([{ code: 'complaints', content: 'Температура держится два дня.' }]);
  expect(result.policyVersion).toBe('orion-clinical-drafts-v2');
  expect(result.output.suggestions).toHaveLength(1);
});

it.each(['invented evidence', 'duplicate code'])('rejects unsafe live sections: %s', async (failure) => {
  const section = { code: 'complaints', content: 'Черновик', evidence: [{ sourceId: 'synthetic-1', quote: failure === 'invented evidence' ? 'Такого текста нет' : 'Температура держится два дня.' }] };
  const provider = new GroqClinicalAnalysisProvider({
    apiKey: 'synthetic-live-validation', model: 'synthetic', baseUrl: 'https://provider.invalid',
    fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      summary: 'Тест', suggestions: [{ category: 'clarification', riskLevel: 'informational', title: 'Уточнить', content: 'Какая температура?', evidence: [{ sourceId: 'synthetic-1', quote: 'Температура держится два дня.' }] }],
      sections: failure === 'duplicate code' ? [section, section] : [section],
    }) } }] }),
  });
  await expect(provider.analyze({ segments, mode: 'live' })).rejects.toMatchObject({ code: 'invalid_response' });
});

// Explicit opt-in only. Uses synthetic text above; never reads the clinical database.
it.skipIf(process.env.ORION_LIVE_GROQ_CHECK !== '1')('accepts a real Groq live response for synthetic input', async () => {
  const vars = readFileSync('.dev.vars', 'utf8');
  const setting = (name: string) => {
    const value = vars.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
    return value.replace(/^["']|["']$/g, '');
  };
  const provider = new GroqClinicalAnalysisProvider({ apiKey: setting('GROQ_API_KEY'), model: setting('GROQ_MODEL') || 'openai/gpt-oss-120b', baseUrl: 'https://api.groq.com/openai/v1' });
  try {
    const result = await provider.analyze({ segments, mode: 'live', signal: AbortSignal.timeout(30000) });
    expect(result.output.sections.some((section) => section.code === 'complaints')).toBe(true);
    expect(result.output.suggestions.length).toBeGreaterThan(0);
  } catch (error) {
    throw new Error(error instanceof ClinicalAnalysisProviderError ? `Provider check: ${error.code}; retry seconds: ${error.retryAfterSeconds ?? 'none'}` : 'Provider check failed');
  }
}, 35000);
