import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VerifiedLocalPrincipal } from './local-account-auth';
import type { ClinicalCommand, ClinicalSnapshot } from '../lib/clinical/contracts';

type Actor = { issuer: string; subject: string };
type Repository = {
  snapshot(actor: Actor, revalidate?: () => Promise<void>): Promise<ClinicalSnapshot>;
  patient(actor: Actor, patientId: string, revalidate?: () => Promise<void>): Promise<ClinicalSnapshot>;
  command(actor: Actor, command: ClinicalCommand, revalidate?: () => Promise<void>): Promise<unknown>;
};
type SpeechBridge = { handle(options: { request: Request; actor: Actor; revalidate: () => Promise<void> }): Promise<Response | null> };
class Rejected extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const repositoryStatus: Record<string, number> = {
  CLINICAL_ACCESS_DENIED: 403, CLINICAL_RESOURCE_NOT_FOUND: 404, CLINICAL_INVALID_COMMAND: 400,
  CLINICAL_VERSION_CONFLICT: 409, CLINICAL_IDEMPOTENCY_CONFLICT: 409, CLINICAL_INVALID_TRANSITION: 409,
  CLINICAL_REVIEW_REQUIRED: 409, CLINICAL_CONSENT_REQUIRED: 409, CLINICAL_CAPACITY_CONFLICT: 409,
  CLINICAL_QUEUE_ORDER_CONFLICT: 409,
};

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Rejected('BODY_TOO_LARGE', 413);
  const chunks: Buffer[] = [];
  let length = 0;
  const timeout = setTimeout(() => request.destroy(), 15000);
  try {
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) throw new Rejected('BODY_TOO_LARGE', 413);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timeout); }
}

/** One local API boundary. Browser-provided identity/clinic/role is never authoritative. */
export function clinicalLocalMiddleware(options: {
  port: number;
  principal(request: IncomingMessage): VerifiedLocalPrincipal | undefined;
  repository: Repository | null;
  parseCommand(value: unknown): ClinicalCommand;
  speech?: SpeechBridge | null;
}) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); }
    catch { res.statusCode = 400; res.end(); return; }
    if (!url.pathname.startsWith('/api/clinical/')) { next(); return; }
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
      if (!principal) throw new Rejected('AUTHENTICATION_REQUIRED', 401);
      const host = req.headers.host;
      if (![`127.0.0.1:${options.port}`, `localhost:${options.port}`].includes(host ?? '') ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers['x-forwarded-host']) {
        throw new Rejected('LOCAL_ONLY', 403);
      }
      const revalidate = async () => {
        if (req.aborted || res.destroyed || !await principal.revalidate()) throw new Rejected('SESSION_CHANGED', 409);
      };
      await revalidate();
      if (!options.repository) throw new Rejected('CLINICAL_NOT_CONFIGURED', 503);
      const actor = { issuer: principal.issuer, subject: principal.subject };
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method ?? '') && (req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site')) {
        throw new Rejected('ORIGIN_REJECTED', 403);
      }
      if (url.pathname.startsWith('/api/clinical/v1/speech/') || ['/api/clinical/v1/analysis', '/api/clinical/v1/analysis/live'].includes(url.pathname)) {
        if (!options.speech) throw new Rejected('SPEECH_UNAVAILABLE', 503);
        if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) throw new Rejected('METHOD_NOT_ALLOWED', 405);
        // Match the bridge's actual protocol before buffering: one bounded WAV
        // segment, or a small JSON command. No 12 MiB pre-buffer for a 4 KiB form.
        const limit = url.pathname === '/api/clinical/v1/speech/transcribe' ? 800000 : 4096;
        const body = ['POST', 'DELETE'].includes(req.method ?? '') ? await readBody(req, limit) : undefined;
        await revalidate();
        const headers = new Headers({ 'Content-Type': req.headers['content-type'] ?? '' });
        // Speech resource selectors are inputs, never identity. The bridge checks
        // that each session/encounter belongs to the verified principal.
        for (const name of ['x-orion-encounter-id', 'x-orion-speech-session-id', 'x-orion-utterance-index']) {
          const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value);
        }
        const request = new Request(`http://${host}${url.pathname}${url.search}`, {
          method: req.method, headers,
          ...(body ? { body: new Uint8Array(body) } : {}),
        });
        const response = await options.speech.handle({ request, actor, revalidate });
        await revalidate();
        if (!response) throw new Rejected('NOT_FOUND', 404);
        const payload = await response.arrayBuffer();
        await revalidate();
        if (!res.destroyed && !res.writableEnded) {
          res.statusCode = response.status;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'application/json');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          const retryAfter = response.headers.get('Retry-After'); if (retryAfter && /^\d{1,4}$/.test(retryAfter)) res.setHeader('Retry-After', retryAfter);
          res.end(Buffer.from(payload));
        }
        return;
      }
      if (url.pathname === '/api/clinical/v1/snapshot' && req.method === 'GET') {
        const snapshot = await options.repository.snapshot(actor, revalidate);
        await revalidate(); reply(200, snapshot); return;
      }
      const patientMatch = /^\/api\/clinical\/v1\/patients\/([a-zA-Z0-9_-]{1,160})$/.exec(url.pathname);
      if (patientMatch && req.method === 'GET') {
        const patient = await options.repository.patient(actor, patientMatch[1], revalidate);
        await revalidate(); reply(200, patient); return;
      }
      if (url.pathname !== '/api/clinical/v1/commands') throw new Rejected('NOT_FOUND', 404);
      if (req.method !== 'POST') throw new Rejected('METHOD_NOT_ALLOWED', 405);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new Rejected('JSON_REQUIRED', 415);
      const body = await readBody(req, 96 * 1024);
      await revalidate();
      let command: ClinicalCommand;
      try { command = options.parseCommand(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); }
      catch { throw new Rejected('INVALID_COMMAND', 400); }
      const result = await options.repository.command(actor, command, revalidate);
      await revalidate();
      // Return the exact command result, not an inferred ID from a refreshed list.
      reply(200, result);
    } catch (error) {
      const candidate = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      const known = Object.hasOwn(repositoryStatus, candidate);
      const code = error instanceof Rejected ? error.code : known ? candidate : 'CLINICAL_UNAVAILABLE';
      const status = error instanceof Rejected ? error.status : known ? repositoryStatus[candidate] : 503;
      const messages: Record<number, string> = {
        400: 'Проверьте введённые поля.', 401: 'Войдите в аккаунт сотрудника.',
        403: 'Нет действующего доступа к этой записи.', 404: 'Запись не найдена или недоступна.',
        409: 'Запись или сеанс изменились. Обновите данные; перед завершением проверьте запись приёма.',
        413: 'Запрос слишком большой.', 415: 'Неподдерживаемый формат запроса.',
        503: 'Клиническая PostgreSQL-база или речевой сервис недоступны. Данные не подменяются демонстрационными.',
      };
      const conflicts: Record<string, string> = {
        CLINICAL_CAPACITY_CONFLICT: 'Кабинет или врач уже заняты. Завершите текущий приём и повторите открытие.',
        CLINICAL_QUEUE_ORDER_CONFLICT: 'В очереди есть пациент, вызванный раньше. Откройте очередь и завершите или измените его этап.',
        CLINICAL_REVIEW_REQUIRED: 'Проверьте и подтвердите текущую запись приёма перед завершением или направлением.',
        CLINICAL_CONSENT_REQUIRED: 'Перед этим действием нужно сохранить согласие пациента в окне приёма.',
        CLINICAL_VERSION_CONFLICT: 'Запись изменена в другом окне. Обновите данные перед сохранением.',
      };
      reply(status, { error: { code: status === 503 ? 'CLINICAL_UNAVAILABLE' : code, message: conflicts[code] ?? messages[status] ?? 'Запрос отклонён.' } });
    }
  };
}
