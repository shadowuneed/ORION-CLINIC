import type { IncomingMessage, ServerResponse } from 'node:http';
import { regionalCommandSchema, regionalIdSchema } from '../lib/regional/contracts';
import { regionalKpiQuerySchema, regionalKpiEvidenceQuerySchema } from '../lib/regional/kpi';
import { regionalDirectivesQuerySchema, regionalDirectiveCommandSchema } from '../lib/regional/directives';
import { DirectiveBoundaryError, readDirectiveJson, validateDirectiveFiles, directiveFileBytes, directiveAttachmentDisposition } from './directive-file-boundary';
import type { VerifiedLocalPrincipal } from './local-account-auth';
import type { RegionalPostgresRepository } from './regional-postgres-repository';

class Rejected extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
export function regionalLocalMiddleware(options: {
  port: number; principal: (request: IncomingMessage) => VerifiedLocalPrincipal | undefined;
  repository: Pick<RegionalPostgresRepository, 'scope' | 'overview' | 'facility' | 'command' | 'kpi' | 'kpiEvidence' | 'directives' | 'directiveCommand' | 'directiveAttachment'> | null;
}) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); } catch { res.statusCode = 400; res.end(); return; }
    if (!url.pathname.startsWith('/api/regional/')) { next(); return; }
    const reply = (status: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify(body));
    };
    try {
      const principal = options.principal(req);
      if (!principal) throw new Rejected('AUTHENTICATION_REQUIRED', 401);
      const host = req.headers.host;
      if (![`127.0.0.1:${options.port}`, `localhost:${options.port}`].includes(host ?? '') || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || req.headers.forwarded ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) throw new Rejected('LOCAL_ONLY', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`)) throw new Rejected('ORIGIN_REJECTED', 403);
      const current = async () => {
        if (req.aborted || res.destroyed || !await principal.revalidate() || req.aborted || res.destroyed) throw new Rejected('SESSION_CHANGED', 409);
      };
      await current();
      if (!options.repository) throw new Rejected('REGIONAL_UNAVAILABLE', 503);
      const actor = { issuer: principal.issuer, subject: principal.subject };
      if (url.pathname === '/api/regional/v1/directives') {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const entries = [...url.searchParams.entries()];
        if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Rejected('INVALID_QUERY', 400);
        const parsed = regionalDirectivesQuerySchema.safeParse(Object.fromEntries(entries));
        if (!parsed.success) throw new Rejected('INVALID_QUERY', 400);
        const data = await options.repository.directives(actor, parsed.data, current);
        await current(); reply(200, data); return;
      }
      if (url.pathname === '/api/regional/v1/directives/commands') {
        if (req.method !== 'POST') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        if (url.search) throw new Rejected('INVALID_QUERY', 400);
        if (req.headers.origin !== `http://${host}`) throw new Rejected('ORIGIN_REJECTED', 403);
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new Rejected('JSON_REQUIRED', 415);
        const parsed = regionalDirectiveCommandSchema.safeParse(await readDirectiveJson(req));
        if (!parsed.success) throw new Rejected('DIRECTIVE_INVALID_COMMAND', 400);
        if ('attachments' in parsed.data) validateDirectiveFiles(parsed.data.attachments);
        await current();
        // This is a stale-session expectation, never an authorization source.
        // A different account signing in in another tab must not execute this
        // tab's retained upload/retry under the new account's authority.
        const expectedActor = regionalIdSchema.safeParse(req.headers['x-orion-directive-actor']);
        if (!expectedActor.success) throw new Rejected('SESSION_CHANGED', 409);
        const before = await options.repository.directives(actor, {}, current);
        await current();
        if (before.actorId !== expectedActor.data) throw new Rejected('SESSION_CHANGED', 409);
        const result = await options.repository.directiveCommand(actor, parsed.data, current);
        await current();
        const snapshot = await options.repository.directives(actor, {}, current);
        await current(); reply(200, { result, snapshot }); return;
      }
      const attachmentMatch = /^\/api\/regional\/v1\/directive-attachments\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (attachmentMatch) {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        if (url.search) throw new Rejected('INVALID_QUERY', 400);
        const parsed = regionalIdSchema.safeParse(attachmentMatch[1]);
        if (!parsed.success) throw new Rejected('INVALID_QUERY', 400);
        const data = await options.repository.directiveAttachment(actor, parsed.data, current);
        const file = directiveFileBytes({ ...data.attachment, contentBase64: data.contentBase64 });
        if (file.byteLength !== data.attachment.byteLength || file.sha256 !== data.attachment.sha256) throw new Rejected('REGIONAL_UNAVAILABLE', 503);
        await current();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', directiveAttachmentDisposition(data.attachment.fileName));
        res.setHeader('Content-Length', file.byteLength);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        res.end(file.bytes); return;
      }
      if (url.pathname === '/api/regional/v1/kpi/evidence') {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const entries = [...url.searchParams.entries()];
        if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Rejected('INVALID_QUERY', 400);
        const values: Record<string, unknown> = Object.fromEntries(entries);
        if ('offset' in values) {
          if (typeof values.offset !== 'string' || !/^(0|[1-9]\d{0,4})$/.test(values.offset)) throw new Rejected('INVALID_QUERY', 400);
          values.offset = Number(values.offset);
        }
        const parsed = regionalKpiEvidenceQuerySchema.safeParse(values);
        if (!parsed.success) throw new Rejected('INVALID_QUERY', 400);
        const data = await options.repository.kpiEvidence(actor, parsed.data, current);
        await current(); reply(200, data); return;
      }
      if (url.pathname === '/api/regional/v1/kpi') {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const entries = [...url.searchParams.entries()];
        // Reject unknown and repeated selectors: no identity or permission may be
        // supplied by the browser, and proxies must not disagree on the period.
        if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Rejected('INVALID_QUERY', 400);
        const parsed = regionalKpiQuerySchema.safeParse(Object.fromEntries(entries));
        if (!parsed.success) throw new Rejected('INVALID_QUERY', 400);
        const data = await options.repository.kpi(actor, parsed.data, current);
        await current(); reply(200, data); return;
      }
      if (url.search) throw new Rejected('INVALID_QUERY', 400);
      if (url.pathname === '/api/regional/v1/scope') {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const data = await options.repository.scope(actor, current); await current(); reply(200, data); return;
      }
      if (url.pathname === '/api/regional/v1/overview') {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const data = await options.repository.overview(actor, current); await current(); reply(200, data); return;
      }
      const match = /^\/api\/regional\/v1\/facilities\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (match) {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const parsed = regionalIdSchema.safeParse(match[1]); if (!parsed.success) throw new Rejected('INVALID_QUERY', 400);
        const data = await options.repository.facility(actor, parsed.data, current); await current(); reply(200, data); return;
      }
      if (url.pathname !== '/api/regional/v1/commands') throw new Rejected('NOT_FOUND', 404);
      if (req.method !== 'POST') throw new Rejected('METHOD_NOT_ALLOWED', 405);
      if (req.headers.origin !== `http://${host}`) throw new Rejected('ORIGIN_REJECTED', 403);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new Rejected('JSON_REQUIRED', 415);
      if (Number(req.headers['content-length'] ?? 0) > 8192) throw new Rejected('BODY_TOO_LARGE', 413);
      let bytes = 0; const chunks: Buffer[] = []; const timer = setTimeout(() => req.destroy(), 5000);
      try {
        for await (const chunk of req) { const b = Buffer.from(chunk); bytes += b.length; if (bytes > 8192) throw new Rejected('BODY_TOO_LARGE', 413); chunks.push(b); }
      } finally { clearTimeout(timer); }
      let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Rejected('REGIONAL_INVALID_COMMAND', 400); }
      const parsed = regionalCommandSchema.safeParse(value); if (!parsed.success) throw new Rejected('REGIONAL_INVALID_COMMAND', 400);
      await current();
      const result = await options.repository.command(actor, parsed.data, current); await current();
      const snapshot = await options.repository.facility(actor, parsed.data.facilityId, current); await current();
      reply(200, { result, snapshot });
    } catch (error) {
      const known: Record<string, number> = { REGIONAL_ACCESS_DENIED: 403, REGIONAL_NOT_FOUND: 404, REGIONAL_INVALID_COMMAND: 400, REGIONAL_KPI_INVALID_QUERY: 400,
        REGIONAL_VERSION_CONFLICT: 409, REGIONAL_IDEMPOTENCY_CONFLICT: 409, REGIONAL_INVALID_TRANSITION: 409, REGIONAL_STOCK_UNAVAILABLE: 409,
        REGIONAL_CAPACITY_CONFLICT: 409, REGIONAL_QUEUE_CONFLICT: 409,
        DIRECTIVE_ACCESS_DENIED: 403, DIRECTIVE_NOT_FOUND: 404, DIRECTIVE_INVALID_QUERY: 400,
        DIRECTIVE_INVALID_COMMAND: 400, DIRECTIVE_INVALID_ATTACHMENT: 400, DIRECTIVE_VERSION_CONFLICT: 409,
        DIRECTIVE_IDEMPOTENCY_CONFLICT: 409, DIRECTIVE_INVALID_TRANSITION: 409, DIRECTIVE_EXPLANATION_REQUIRED: 409,
        DIRECTIVE_FILE_INVALID: 400, DIRECTIVE_COMPLETION_DATE_LOCKED: 409, DIRECTIVE_REWORK_DATE_REQUIRED: 409,
        DIRECTIVE_LIMIT: 503 };
      const candidate = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const rejected = error instanceof Rejected || error instanceof DirectiveBoundaryError;
      const code = rejected ? error.code : typeof candidate === 'string' && known[candidate] ? candidate : 'REGIONAL_UNAVAILABLE';
      const status = rejected ? error.status : known[code] ?? 503;
      const message = code === 'REGIONAL_CAPACITY_CONFLICT' ? 'Кабинет или сотрудник уже занят. Дождитесь завершения текущего приёма.' :
        code === 'REGIONAL_QUEUE_CONFLICT' ? 'Сначала вызовите пациента, который стоит раньше в очереди.' :
        code === 'REGIONAL_STOCK_UNAVAILABLE' ? 'Недостаточно доступного остатка или срок годности истёк. Проверьте склад.' :
        code === 'DIRECTIVE_EXPLANATION_REQUIRED' ? 'Перед принятием нужна объяснительная о нарушении срока.' :
        ['DIRECTIVE_INVALID_ATTACHMENT', 'DIRECTIVE_FILE_INVALID'].includes(code) ? 'Проверьте формат, имя и размер документов: до 3 файлов по 2 МБ.' :
        code === 'DIRECTIVE_COMPLETION_DATE_LOCKED' ? 'При исправлении документов дата выполненной работы остаётся прежней.' :
        code === 'DIRECTIVE_REWORK_DATE_REQUIRED' ? 'Дата завершения доработки не может быть раньше возврата незавершённой работы.' :
        code === 'BODY_TOO_LARGE' ? 'Размер загружаемых документов превышает ограничение.' :
        code === 'SESSION_CHANGED' ? 'Сеанс изменился. Войдите заново.' : status === 401 ? 'Войдите в аккаунт сотрудника.' :
        status === 403 ? 'Доступ к региональному учебному контуру не назначен.' : status === 404 ? 'Запись не найдена.' :
        status === 409 ? 'Запись изменилась или действие недоступно. Обновите данные перед повтором.' :
        status === 400 ? 'Проверьте введённые данные.' : 'Региональная база временно недоступна.';
      reply(status, { error: { code, message } });
    }
  };
}
