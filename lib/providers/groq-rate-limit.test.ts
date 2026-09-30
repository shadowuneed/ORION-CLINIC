import { expect, it, vi } from 'vitest';
import { GroqClinicalAnalysisProvider, groqRetrySeconds } from './groq-clinical-analysis';

it('honors numeric and HTTP-date Retry-After with a conservative fallback', () => {
  expect(groqRetrySeconds('120')).toBe(120);
  expect(groqRetrySeconds('1.5')).toBe(2);
  expect(groqRetrySeconds(null)).toBe(60);
  expect(groqRetrySeconds('invalid')).toBe(60);
  expect(groqRetrySeconds('Thu, 01 Jan 1970 00:02:00 GMT', 0)).toBe(120);
});

it('shares cooldown across instances and does not call upstream before it expires', async () => {
  vi.useFakeTimers();
  try {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }));
    const options = { apiKey: 'synthetic-rate-limit-test', model: 'synthetic', baseUrl: 'https://provider.invalid', fetchImpl: upstream };
    const first = new GroqClinicalAnalysisProvider(options);
    await expect(first.analyze({ segments: [] })).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 90 });
    const second = new GroqClinicalAnalysisProvider(options);
    await expect(second.analyze({ segments: [] })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(91000);
    await expect(second.analyze({ segments: [] })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(upstream).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
