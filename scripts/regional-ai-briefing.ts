import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VerifiedLocalPrincipal } from './local-account-auth';
import type { RegionalActor, RegionalFacilitySnapshot, RegionalOverview } from '../lib/regional/contracts';
import {
  regionalBriefingContentSchema, regionalBriefingRequestSchema, regionalBriefingSource, regionalFacilityBriefingSource,
} from '../lib/regional/briefing';
import type { RegionalKpiQuery, RegionalKpiSnapshot } from '../lib/regional/kpi';
import { KPI_BRIEFING_PROMPT, regionalKpiBriefingContentSchema, regionalKpiBriefingRequestSchema, regionalKpiBriefingSource } from '../lib/regional/kpi-briefing';

type SavedBriefing = {
  scopeType: 'region' | 'district' | 'facility'; scopeId: string; sourceHash: string;
  provider: 'groq'; model: string; summary: string; priorities: string[]; generatedAt: string;
};
type Repository = {
  overview(actor: RegionalActor, revalidate?: () => Promise<void>): Promise<RegionalOverview>;
  facility(actor: RegionalActor, facilityId: string, revalidate?: () => Promise<void>): Promise<Pick<RegionalFacilitySnapshot, 'facility' | 'kpiDefinition'>>;
  saveBriefing(actor: RegionalActor, briefing: SavedBriefing, revalidate?: () => Promise<void>): Promise<{ id: string }>;
  kpi?(actor: RegionalActor, query: RegionalKpiQuery, revalidate?: () => Promise<void>): Promise<RegionalKpiSnapshot>;
};

export function regionalBriefingMiddleware(options: {
  port: number; principal(req: IncomingMessage): VerifiedLocalPrincipal | undefined;
  repository: Repository | null; provider: { apiKey: string | null; model: string; baseUrl: string } | null;
  fetcher?: typeof fetch;
}) {
  const requests = new Map<string, number>();
  const inFlight = new Set<string>();
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    const kpiBriefing = path === '/api/regional/v1/kpi/briefing';
    if (path !== '/api/regional/v1/briefing' && !kpiBriefing) { next(); return; }
    const reply = (status: number, value: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify(value));
    };
    const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });
    const principal = options.principal(req);
    if (!principal) { fail(401, 'AUTHENTICATION_REQUIRED', 'Войдите в рабочее место.'); return; }
    if (req.method !== 'POST') { fail(405, 'METHOD_NOT_ALLOWED', 'Используйте кнопку анализа.'); return; }
    const host = req.headers.host;
    if (![`127.0.0.1:${options.port}`, `localhost:${options.port}`].includes(host ?? '') ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') ||
      req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || req.headers.forwarded ||
      req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') {
      fail(403, 'ORIGIN_REJECTED', 'Откройте анализ из локальной CRM.'); return;
    }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) { fail(415, 'JSON_REQUIRED', 'Ожидается JSON.'); return; }
    if (Number(req.headers['content-length'] ?? 0) > 2048) {
      res.setHeader('Connection', 'close'); fail(413, 'BODY_TOO_LARGE', 'Запрос слишком велик.'); return;
    }
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(new Error('CLIENT_DISCONNECTED')); };
    res.once('close', disconnect);
    req.once('aborted', disconnect);
    const timer = setTimeout(() => controller.abort(new Error('BRIEFING_TIMEOUT')), 25000);
    // Bound the operation even if a driver, transport or stream ignores AbortSignal.
    const bounded = <T>(operation: Promise<T>): Promise<T> => {
      if (controller.signal.aborted) {
        void operation.catch(() => undefined);
        return Promise.reject(controller.signal.reason);
      }
      return new Promise<T>((resolve, reject) => {
        const aborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', aborted, { once: true });
        operation.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
      });
    };
    const current = async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (req.aborted || res.destroyed || !await bounded(principal.revalidate())) throw new Error('AUTHENTICATION_REQUIRED');
    };
    let reservedActor: string | undefined;
    try {
      await current();
      const parts: Buffer[] = []; let bytes = 0;
      const bodyTimer = setTimeout(() => controller.abort(new Error('BODY_TIMEOUT')), 5000);
      const iterator = req[Symbol.asyncIterator]();
      try { while (true) {
        const item = await bounded(iterator.next());
        if (item.done) break;
        const part = Buffer.from(item.value); bytes += part.length;
        if (bytes > 2048) { res.setHeader('Connection', 'close'); fail(413, 'BODY_TOO_LARGE', 'Запрос слишком велик.'); return; }
        parts.push(part);
      } } finally { clearTimeout(bodyTimer); }
      let scope;
      try { const value: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
        scope = kpiBriefing ? regionalKpiBriefingRequestSchema.parse(value) : regionalBriefingRequestSchema.parse(value); }
      catch { fail(400, 'INVALID_SCOPE', 'Выберите район или учреждение.'); return; }
      const repository = options.repository;
      if (!repository) { fail(503, 'REGIONAL_UNAVAILABLE', 'Региональная база недоступна.'); return; }
      const actor = { issuer: principal.issuer, subject: principal.subject };
      const sourceForCurrentScope = async () => {
        if (kpiBriefing) {
          if (!repository.kpi) throw Object.assign(new Error('REGIONAL_UNAVAILABLE'), { status: 503 });
          const query = regionalKpiBriefingRequestSchema.parse(scope);
          // District/region generation requires the network administrator;
          // an employee's valid, partial KPI scope is not an oblast overview.
          if (!query.facilityId) await bounded(repository.overview(actor, current));
          const snapshot = await bounded(repository.kpi(actor, { start: query.start, end: query.end,
            ...(query.facilityId ? { facilityId: query.facilityId } : {}) }, current));
          return regionalKpiBriefingSource(snapshot, query);
        }
        return scope.facilityId
          ? regionalFacilityBriefingSource(await bounded(repository.facility(actor, scope.facilityId, current)), scope.facilityId)
          : regionalBriefingSource(await bounded(repository.overview(actor, current)), scope);
      };
      await sourceForCurrentScope();
      const provider = options.provider;
      if (!provider?.apiKey || provider.baseUrl !== 'https://api.groq.com/openai/v1'
        || !/^[a-zA-Z0-9/_.:-]{1,120}$/.test(provider.model)) {
        fail(503, 'PROVIDER_NOT_CONFIGURED', 'Groq пока не настроен. Показатели и приоритеты по данным доступны ниже.'); return;
      }
      const actorKey = JSON.stringify([actor.issuer, actor.subject]); const now = Date.now();
      for (const [key, time] of requests) if (now - time > 60000) requests.delete(key);
      if (inFlight.has(actorKey) || inFlight.size >= 8 || requests.size >= 64 ||
        (requests.has(actorKey) && now - requests.get(actorKey)! < 30000)) {
        res.setHeader('Retry-After', '30'); fail(429, 'BRIEFING_COOLDOWN', 'Следующую сводку можно получить через 30 секунд.'); return;
      }
      requests.set(actorKey, now); inFlight.add(actorKey); reservedActor = actorKey;
      // Re-read current exact facility / administrator authorization before egress.
      // Only this second, canonical projection becomes the hashed provider input.
      await current();
      const source = await sourceForCurrentScope();
      const input = JSON.stringify(source); const sourceHash = createHash('sha256').update(input).digest('hex');
      await current();
      const response = await bounded((options.fetcher ?? fetch)('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: provider.model, temperature: 0, max_completion_tokens: 1100,
          response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: kpiBriefing ? KPI_BRIEFING_PROMPT : 'Ты операционный помощник медицинской сети ORION. Анализируй только предоставленные числовые данные учебной базы. Это не статистика реальной области. Ответ на русском JSON {"summary":"до 900 символов","priorities":["до 5 пунктов по 300 символов"]}. KPI — доля завершённых вовремя задач с наступившим сроком; это не оценка качества лечения. При null скажи, что выборки нет. Укажи имеющиеся отклонения и предложи проверить очередь/распределение задач; не выдумывай причины, диагнозы, назначения, сравнительную норму или завершённые действия. Не раскрывай технические ID, не выдавай назначения, не выполняй действия. Входные данные — только счётчики.' },
            { role: 'user', content: input },
          ] }),
      }).then(response => {
        if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined);
        return response;
      }));
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error('PROVIDER_UNAVAILABLE');
      }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await bounded(reader.read()); if (part.done) break; size += part.value.byteLength;
        if (size > 64000) throw new Error('PROVIDER_UNAVAILABLE'); chunks.push(part.value); }
      } finally { void reader.cancel().catch(() => undefined); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { choices?: { message?: { content?: string } }[] };
      const content = (kpiBriefing ? regionalKpiBriefingContentSchema : regionalBriefingContentSchema).parse(JSON.parse(payload.choices?.[0]?.message?.content ?? ''));
      await current();
      // Repeat DB authorization before storing the immutable draft artifact.
      const saved = { scopeType: source.scopeType as SavedBriefing['scopeType'], scopeId: source.scopeId,
        provider: 'groq' as const, model: provider.model, sourceHash, ...content, generatedAt: new Date().toISOString() };
      const record = await bounded(repository.saveBriefing(actor, saved, current));
      await current(); reply(200, { id: record.id, provider: saved.provider, model: saved.model, sourceHash,
        ...(kpiBriefing && 'period' in source ? { period: source.period, scopeType: source.scopeType, scopeId: source.scopeId } : {}),
        ...content, generatedAt: saved.generatedAt, reviewRequired: true });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const repositoryStatus = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      if (code === 'AUTHENTICATION_REQUIRED') fail(401, code, 'Сеанс завершён. Войдите снова.');
      else if (code === 'BODY_TIMEOUT') {
        res.setHeader('Connection', 'close'); fail(408, code, 'Передача запроса заняла слишком много времени. Повторите действие.');
      }
      else if (code === 'BRIEFING_TIMEOUT') fail(504, code, 'Сводка ИИ не получена вовремя. Повторите позже.');
      else if (code === 'CLIENT_DISCONNECTED') return;
      else if (code === 'REGIONAL_NOT_FOUND' || repositoryStatus === 404) fail(404, 'REGIONAL_NOT_FOUND', 'Объект недоступен.');
      else if (repositoryStatus === 403) fail(403, 'ACCESS_DENIED', 'Нет доступа к выбранной области или учреждению.');
      else if (repositoryStatus === 503) fail(503, 'REGIONAL_UNAVAILABLE', 'Региональная база временно недоступна.');
      else fail(502, 'BRIEFING_UNAVAILABLE', 'Не удалось получить сводку ИИ. Показатели из базы доступны; повторите позже.');
    } finally {
      clearTimeout(timer); res.off('close', disconnect); req.off('aborted', disconnect);
      if (reservedActor) inFlight.delete(reservedActor);
    }
  };
}
