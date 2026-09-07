import { env } from 'cloudflare:workers';
import { verifyClinicalToolAccess } from '@/lib/auth/clinical-tool-access';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';
import {
  CLINICAL_RESEARCH_MODEL,
  CLINICAL_RESEARCH_PROVIDER,
  type ClinicalResearchRequest,
  type ClinicalResearchResponse,
  type ClinicalResearchSource,
} from '../../../../lib/clinical-research-contract';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 18_000;
const MAX_EVIDENCE = 8;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= maximum ? text : null;
}

function parseRequest(value: unknown): ClinicalResearchRequest | null {
  if (!isRecord(value) || !isRecord(value.suggestion) || !Array.isArray(value.evidence)) {
    return null;
  }
  const title = boundedText(value.suggestion.title, 180);
  const rationale = boundedText(value.suggestion.rationale, 420);
  const clinicianPrompt = boundedText(value.suggestion.clinicianPrompt, 260);
  if (!title || !rationale || !clinicianPrompt) return null;
  if (value.evidence.length === 0 || value.evidence.length > MAX_EVIDENCE) return null;

  const evidence = value.evidence.map((item) => {
    if (!isRecord(item)) return null;
    const id = boundedText(item.id, 96);
    const text = boundedText(item.text, 1_000);
    const role = item.role;
    const language = item.language;
    if (
      !id ||
      !text ||
      (role !== 'doctor' && role !== 'patient' && role !== 'unknown') ||
      (language !== 'ru' &&
        language !== 'kk' &&
        language !== 'mixed' &&
        language !== 'unknown')
    ) {
      return null;
    }
    return { id, text, role, language };
  });
  if (evidence.some((item) => item === null)) return null;

  return {
    suggestion: { title, rationale, clinicianPrompt },
    evidence: evidence as ClinicalResearchRequest['evidence'],
  };
}

function sameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function collectSources(executedTools: unknown): ClinicalResearchSource[] {
  const sources: ClinicalResearchSource[] = [];
  const seen = new Set<string>();
  const visited = new Set<object>();

  const visit = (value: unknown, depth: number) => {
    if (depth > 7 || sources.length >= 6 || !value || typeof value !== 'object') {
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);

    if (isRecord(value)) {
      const title = boundedText(value.title, 240);
      const rawUrl = boundedText(value.url, 2_048);
      if (title && rawUrl && !seen.has(rawUrl)) {
        try {
          const url = new URL(rawUrl);
          if (url.protocol === 'https:' || url.protocol === 'http:') {
            seen.add(rawUrl);
            sources.push({ title, url: url.toString() });
          }
        } catch {
          // Ignore malformed provider URLs.
        }
      }
      for (const child of Object.values(value)) visit(child, depth + 1);
      return;
    }

    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
    }
  };

  visit(executedTools, 0);
  return sources;
}

function boundedAnswer(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return text && text.length <= 12_000 ? text : null;
}

class GroqResearchError extends Error {
  constructor(readonly status: number) {
    super(`groq_compound_${status}`);
  }
}

async function runCompound(apiKey: string, model: string, request: ClinicalResearchRequest) {
  const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Groq-Model-Version': 'latest',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'Ты — модуль проверки источников для врача в демонстрационном прототипе ORION.',
            'Перед ответом обязательно выполни встроенный web_search и используй только реально найденные источники.',
            'Найди актуальные первичные или официальные клинические источники, относящиеся к подсказке.',
            'Проверяй только общий медицинский тезис в suggestion. Исходная расшифровка намеренно не передана в веб-поиск.',
            'Не добавляй сведения о пациенте, отсутствующие в suggestion. Не делай выводов о кашле, одышке, возрасте, диагнозе или лечении, если этого нет в suggestion.',
            'Не ставь диагноз и не назначай лечение. Объясни, что подтверждают источники, ограничения и что остаётся решением врача.',
            'Не выдумывай названия документов, годы, численные пороги или URL. Если надёжный источник не найден, прямо скажи об этом.',
            'Ответь на русском языке без markdown-таблиц, максимум 6 коротких предложений. Используй встроенные ссылки-цитаты Groq.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            suggestion: request.suggestion,
            task: 'Обязательно выполнить web_search, затем проверить общий тезис подсказки по найденным источникам, не реконструируя клинический случай.',
          }),
        },
      ],
      max_completion_tokens: 650,
      compound_custom: {
        tools: { enabled_tools: ['web_search'] },
      },
      search_settings: {
        include_domains: [
          'who.int',
          'cdc.gov',
          'nice.org.uk',
          'nih.gov',
          'ncbi.nlm.nih.gov',
          'gov.kz',
          'adilet.zan.kz',
          'gov.uk',
        ],
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await upstream.json().catch(() => null)) as unknown;
  if (!upstream.ok) throw new GroqResearchError(upstream.status);
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length !== 1) {
    return null;
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const answer = boundedAnswer(choice.message.content);
  const sources = collectSources(choice.message.executed_tools);
  if (!answer || sources.length === 0) return null;
  return { answer, sources };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Запрос из другого источника отклонён.' }, 403);

  const access = await verifyClinicalToolAccess(
    new D1AccessGovernanceRepository(env.DB),
    request,
  );
  if (!access.ok) {
    return json({ error: access.message, code: access.code, assignments: access.assignments }, access.status);
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return json({ error: 'Запрос слишком большой.' }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return json({ error: 'Запрос слишком большой.' }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'Некорректный JSON.' }, 400);
  }
  const clinicalRequest = parseRequest(parsed);
  if (!clinicalRequest) return json({ error: 'Некорректная подсказка или основание.' }, 400);

  const groqEnv = env as unknown as {
    GROQ_COMPOUND_API_KEY?: string;
    GROQ_COMPOUND_MODEL?: string;
    GROQ_API_KEY?: string;
  };
  const apiKey =
    groqEnv.GROQ_COMPOUND_API_KEY ??
    process.env.GROQ_COMPOUND_API_KEY ??
    groqEnv.GROQ_API_KEY ??
    process.env.GROQ_API_KEY;
  const model =
    groqEnv.GROQ_COMPOUND_MODEL?.trim() ||
    process.env.GROQ_COMPOUND_MODEL?.trim() ||
    CLINICAL_RESEARCH_MODEL;
  if (!apiKey?.trim()) {
    return json({ error: 'Контур Compound ещё не настроен: отсутствует ключ Groq.' }, 503);
  }

  try {
    const result = await runCompound(apiKey.trim(), model, clinicalRequest);
    if (!result) {
      return json(
        { error: 'Compound не выполнил проверяемый веб-поиск. Повторите запрос.' },
        502,
      );
    }
    const response: ClinicalResearchResponse = {
      provider: CLINICAL_RESEARCH_PROVIDER,
      model,
      generatedAt: new Date().toISOString(),
      ...result,
    };
    return json(response);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    const status = error instanceof GroqResearchError ? error.status : null;
    if (status === 401 || status === 403) {
      return json({ error: 'Groq отклонил ключ Compound-контура.' }, 503);
    }
    if (status === 429) return json({ error: 'Лимит Compound временно исчерпан.' }, 429);
    return json(
      { error: timedOut ? 'Проверка источников не успела завершиться.' : 'Compound временно недоступен.' },
      timedOut ? 504 : 502,
    );
  }
}
