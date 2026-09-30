import { env } from 'cloudflare:workers';
import { verifyClinicalToolAccess } from '@/lib/auth/clinical-tool-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { dashboardBriefingCountsSchema, dashboardBriefingResponseSchema } from '@/lib/dashboard-briefing';
import { apiFailure, apiSuccess, createApiRequestContext, hasSameOrigin } from '@/lib/http/api-response';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

const requests = new Map<string, number>();

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/dashboard/briefing');
  if (!hasSameOrigin(request)) return apiFailure(context, 403, 'CROSS_ORIGIN', 'Запрос должен исходить из ORION Clinic.');
  if (!parseRuntimeConfig(env).syntheticDataOnly) return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Анализ доступен только в разрешённом контуре.');
  const access = await verifyClinicalToolAccess(new D1AccessGovernanceRepository(env.DB), request);
  if (!access.ok) return apiFailure(context, access.status, access.code, access.message);
  if ((Number(request.headers.get('content-length')) || 0) > 2048) return apiFailure(context, 413, 'REQUEST_TOO_LARGE', 'Сводка слишком велика.');

  let counts;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 2048) throw new Error('too large');
    counts = dashboardBriefingCountsSchema.parse(JSON.parse(raw));
  } catch {
    return apiFailure(context, 400, 'INVALID_COUNTS', 'Допустимы только суммарные числовые показатели.');
  }
  const secretEnv = env as unknown as { GROQ_LLM_API_KEY?: string; GROQ_API_KEY?: string; GROQ_LLM_MODEL?: string; GROQ_MODEL?: string };
  const key = secretEnv.GROQ_LLM_API_KEY ?? process.env.GROQ_LLM_API_KEY ?? secretEnv.GROQ_API_KEY ?? process.env.GROQ_API_KEY;
  const model = secretEnv.GROQ_LLM_MODEL ?? process.env.GROQ_LLM_MODEL ?? secretEnv.GROQ_MODEL ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
  if (!key?.trim()) return apiFailure(context, 503, 'PROVIDER_NOT_CONFIGURED', 'Groq не настроен для этого рабочего контура.');
  const throttleKey = `${access.identityId}:${access.accessAssignmentId}`;
  const now = Date.now();
  if (requests.size > 1000) {
    for (const [identity, timestamp] of requests) if (now - timestamp >= 60_000) requests.delete(identity);
  }
  if (now - (requests.get(throttleKey) ?? 0) < 60_000) return apiFailure(context, 429, 'BRIEFING_COOLDOWN', 'Повторите запрос через минуту.');
  requests.set(throttleKey, now);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0, max_completion_tokens: 350,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Ты помощник диспетчера клиники. Получаешь только агрегированные счётчики синтетического рабочего контура. Верни JSON {"summary":"...","priorities":["..."]} на русском: краткая сводка и максимум 3 конкретных рабочих приоритета, основанных только на ненулевых счётчиках. Не придумывай события, пациентов, диагнозы, звонки, выполненные действия или медицинские рекомендации. При всех нулях напиши, что по счётчикам срочных действий нет. Не утверждай, что проверил медицинские записи.' },
          { role: 'user', content: JSON.stringify(counts) },
        ],
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) return apiFailure(context, 502, 'PROVIDER_UNAVAILABLE', 'Groq не сформировал сводку.');
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const briefing = dashboardBriefingResponseSchema.parse(JSON.parse(payload.choices?.[0]?.message?.content ?? ''));
    return apiSuccess(context, { briefing, scope: 'aggregate_counts_only', generatedAt: Date.now() });
  } catch {
    return apiFailure(context, 502, 'PROVIDER_UNAVAILABLE', 'Groq не сформировал сводку.');
  }
}
