import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VerifiedLocalPrincipal } from './local-account-auth';
import type { DirectoryPostgresRepository } from './directory-postgres-repository';
import { directoryCommandSchema } from '../lib/clinical/directory-contracts';

class Rejected extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const repositoryStatus: Record<string, number> = {
  DIRECTORY_ACCESS_DENIED: 403, DIRECTORY_RESOURCE_NOT_FOUND: 404, DIRECTORY_INVALID_COMMAND: 400,
  DIRECTORY_VERSION_CONFLICT: 409, DIRECTORY_IDEMPOTENCY_CONFLICT: 409, DIRECTORY_INVALID_TRANSITION: 409,
  DIRECTORY_STAFF_MAPPING_REQUIRED: 409, DIRECTORY_MAPPING_CONFLICT: 409, DIRECTORY_LAST_ADMIN_REQUIRED: 409,
};
async function readCommand(request: IncomingMessage): Promise<unknown> {
  const maxBytes = 16 * 1024; const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Rejected('BODY_TOO_LARGE', 413);
  const chunks: Buffer[] = []; let length = 0;
  const timeout = setTimeout(() => request.destroy(), 15000);
  try {
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); length += bytes.length;
      if (length > maxBytes) throw new Rejected('BODY_TOO_LARGE', 413);
      chunks.push(bytes);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Rejected('INVALID_COMMAND', 400); }
  } finally { clearTimeout(timeout); }
}

/** Administrative requests use only the authenticated WeakMap principal.
 * Clinic ID is a resource selector, never a role or a source of authority.
 */
export function directoryLocalMiddleware(options: {
  port: number;
  principal(request: IncomingMessage): VerifiedLocalPrincipal | undefined;
  repository: Pick<DirectoryPostgresRepository, 'snapshot' | 'command'> | null;
}) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); }
    catch { res.statusCode = 400; res.end(); return; }
    if (!url.pathname.startsWith('/api/directory/')) { next(); return; }
    const reply = (status: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(body));
    };
    try {
      const principal = options.principal(req);
      if (!principal) throw new Rejected('AUTHENTICATION_REQUIRED', 401);
      const host = req.headers.host;
      if (![`127.0.0.1:${options.port}`, `localhost:${options.port}`].includes(host ?? '') ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers['x-forwarded-host']) throw new Rejected('LOCAL_ONLY', 403);
      const revalidate = async () => { if (req.aborted || res.destroyed || !await principal.revalidate()) throw new Rejected('SESSION_CHANGED', 409); };
      await revalidate();
      if (!options.repository) throw new Rejected('DIRECTORY_UNAVAILABLE', 503);
      const actor = { issuer: principal.issuer, subject: principal.subject };
      if (url.pathname === '/api/directory/v1/snapshot') {
        if (req.method !== 'GET') throw new Rejected('METHOD_NOT_ALLOWED', 405);
        const clinicIds = url.searchParams.getAll('clinicId');
        if (clinicIds.length !== 1 || !/^[a-zA-Z0-9_-]{1,160}$/.test(clinicIds[0]) || [...url.searchParams.keys()].some(key => key !== 'clinicId')) throw new Rejected('INVALID_REQUEST', 400);
        const result = await options.repository.snapshot(actor, clinicIds[0], revalidate); await revalidate(); reply(200, result); return;
      }
      if (url.pathname !== '/api/directory/v1/commands') throw new Rejected('NOT_FOUND', 404);
      if (req.method !== 'POST') throw new Rejected('METHOD_NOT_ALLOWED', 405);
      if (req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') throw new Rejected('ORIGIN_REJECTED', 403);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new Rejected('JSON_REQUIRED', 415);
      if (url.search) throw new Rejected('INVALID_REQUEST', 400);
      const body = await readCommand(req); await revalidate();
      const parsed = directoryCommandSchema.safeParse(body);
      if (!parsed.success) throw new Rejected('INVALID_COMMAND', 400);
      const result = await options.repository.command(actor, parsed.data, revalidate); await revalidate(); reply(200, result);
    } catch (error) {
      const known = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      const approved = Object.hasOwn(repositoryStatus, known);
      const status = error instanceof Rejected ? error.status : approved ? repositoryStatus[known] : 503;
      const code = error instanceof Rejected ? error.code : approved ? known : 'DIRECTORY_UNAVAILABLE';
      const message: Record<number, string> = { 400: 'Проверьте поля запроса.', 401: 'Войдите в аккаунт сотрудника.',
        403: 'Нет действующих прав управления сотрудниками этой клиники.', 404: 'Запись не найдена или недоступна.',
        405: 'Метод запроса не поддерживается.', 409: 'Права или запись изменились. Обновите данные и проверьте назначение; последний администратор должен оставаться активным.',
        413: 'Запрос слишком большой.', 415: 'Требуется JSON.', 503: 'Справочник сотрудников PostgreSQL недоступен. Права из старой базы не подставляются.' };
      reply(status, { error: { code, message: message[status] ?? 'Запрос отклонён.' } });
    }
  };
}
