import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VerifiedLocalPrincipal } from './local-account-auth';
import type { CrmCommand, CrmSnapshot } from '../lib/crm/contracts';

type Actor = { issuer: string; subject: string };
type Repository = {
  snapshot: (actor: Actor, revalidate?: () => Promise<void>) => Promise<CrmSnapshot>;
  command: (actor: Actor, command: CrmCommand, revalidate?: () => Promise<void>) => Promise<unknown>;
};
class SessionChanged extends Error { code = 'SESSION_CHANGED'; }
class RequestRejected extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }

export function crmLocalMiddleware(options: {
  port: number;
  principal: (request: IncomingMessage) => VerifiedLocalPrincipal | undefined;
  repository: Repository | null;
  parseCommand: (value: unknown) => CrmCommand;
}) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let path: string;
    try { path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname; }
    catch { res.statusCode = 400; res.end(); return; }
    if (!path.startsWith('/api/crm/')) { next(); return; }
    const reply = (status: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify(body));
    };
    try {
      const principal = options.principal(req);
      if (!principal) throw new RequestRejected('AUTHENTICATION_REQUIRED', 401);
      const host = req.headers.host;
      if (![`127.0.0.1:${options.port}`, `localhost:${options.port}`].includes(host ?? '') ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers['x-forwarded-host']) {
        throw new RequestRejected('LOCAL_ONLY', 403);
      }
      const assertCurrent = async () => {
        if (req.aborted || res.destroyed) throw new SessionChanged();
        const valid = await principal.revalidate();
        if (!valid || req.aborted || res.destroyed) throw new SessionChanged();
      };
      await assertCurrent();
      if (!options.repository) throw new RequestRejected('CRM_NOT_CONFIGURED', 503);
      const actor = { issuer: principal.issuer, subject: principal.subject };
      if (path === '/api/crm/v1/snapshot' && req.method === 'GET') {
        const snapshot = await options.repository.snapshot(actor, assertCurrent);
        await assertCurrent();
        reply(200, snapshot);
        return;
      }
      if (path !== '/api/crm/v1/commands') throw new RequestRejected('NOT_FOUND', 404);
      if (req.method !== 'POST') throw new RequestRejected('METHOD_NOT_ALLOWED', 405);
      if (req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') throw new RequestRejected('ORIGIN_REJECTED', 403);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new RequestRejected('JSON_REQUIRED', 415);
      if (Number(req.headers['content-length'] ?? 0) > 8192) throw new RequestRejected('BODY_TOO_LARGE', 413);
      let bytes = 0;
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => req.destroy(), 5000);
      try {
        for await (const chunk of req) {
          const data = Buffer.from(chunk);
          bytes += data.length;
          if (bytes > 8192) throw new RequestRejected('BODY_TOO_LARGE', 413);
          chunks.push(data);
        }
      } finally { clearTimeout(timer); }
      await assertCurrent();
      let command: CrmCommand;
      try { command = options.parseCommand(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { throw new RequestRejected('INVALID_COMMAND', 400); }
      await options.repository.command(actor, command, assertCurrent);
      await assertCurrent();
      const snapshot = await options.repository.snapshot(actor, assertCurrent);
      await assertCurrent();
      reply(200, snapshot);
    } catch (error) {
      let driverCode = 'CRM_UNAVAILABLE';
      try {
        if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') driverCode = error.code;
      } catch { /* A hostile error object must not break error handling. */ }
      const code = error instanceof SessionChanged ? 'SESSION_CHANGED' : error instanceof RequestRejected ? error.code : driverCode;
      const status = error instanceof RequestRejected ? error.status : code === 'SESSION_CHANGED' ? 409 :
        ['ACCESS_DENIED', 'CRM_ACCESS_DENIED'].includes(code) ? 403 :
        code === 'CRM_RESOURCE_NOT_FOUND' ? 404 : code === 'CRM_INVALID_COMMAND' ? 400 :
        ['CONFLICT', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_TRANSITION', 'ROOM_BUSY', 'STAFF_BUSY',
          'CRM_VERSION_CONFLICT', 'CRM_IDEMPOTENCY_CONFLICT', 'CRM_INVALID_TRANSITION', 'CRM_CAPACITY_CONFLICT'].includes(code) ? 409 : 503;
      const schedulingMessages: Record<string, string> = {
        CRM_SCHEDULE_CONFLICT: 'В выбранный интервал уже занят кабинет, сотрудник или пациент. Выберите другое время и обновите расписание.',
        CRM_OUTSIDE_HOURS: 'Визит целиком должен помещаться в учебный рабочий график клиники. Выберите другой день или время.',
        CRM_PAST_SLOT: 'Новая запись или перенос должны быть в будущем. Выберите более позднее время.',
        CRM_QUEUE_ORDER_CONFLICT: 'Очередь изменилась или этот пациент не первый у кабинета и сотрудника. Обновите очередь.',
        CRM_NO_SHOW_TOO_EARLY: 'Неявку можно отметить только после наступления времени записи.',
        CRM_CLINICAL_WORKFLOW_REQUIRED: 'Откройте приём пациента. Завершение визита выполняется вместе с проверкой и сохранением записи врача.',
      };
      const effectiveStatus = schedulingMessages[code] ? 409 : status;
      const message = schedulingMessages[code] ?? (code === 'SESSION_CHANGED' ? 'Сеанс изменился. Откройте рабочее место заново.' :
        status === 401 ? 'Войдите в локальный аккаунт сотрудника.' : status === 403 ? 'Для этого аккаунта доступ к CRM не назначен.' :
        status === 409 ? 'Запись уже изменилась или действие сейчас недоступно. Обновите данные.' :
        status === 400 ? 'Проверьте поля команды.' : status === 404 ? 'Запись не найдена или выбранные кабинет, сотрудник и услуга несовместимы. Обновите данные.' :
        'Локальная PostgreSQL CRM недоступна. Запустите её через pnpm crm:start.');
      // Never echo driver errors: connection strings and SQL can contain secrets.
      reply(effectiveStatus, { error: { code: effectiveStatus === 503 ? (code === 'CRM_NOT_CONFIGURED' ? code : 'CRM_UNAVAILABLE') : code, message } });
    }
  };
}
