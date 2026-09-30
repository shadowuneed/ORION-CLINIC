import type { StaffCredentialRepository } from '../repositories/staff-credentials';
import { handleStaffLogin } from './staff-login';
import { resolveStaffServerPrincipal } from './server-principal';
import { handleStaffLogout, type StaffSessionRepository } from './staff-session';

if (typeof window !== 'undefined') throw new Error('Staff runtime requires server execution');

type Dependencies = {
  sessions: StaffSessionRepository;
  credentials: Pick<StaffCredentialRepository, 'reserveAttempt' | 'finishAttempt'>;
};

const privateHeaders = {
  'Cache-Control': 'no-store', Pragma: 'no-cache', Vary: 'Cookie, Origin',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const methods = new Map([
  ['/api/staff/login', 'POST'], ['/api/staff/logout', 'POST'],
  ['/api/staff/session', 'GET'], ['/staff', 'GET'], ['/sign-in', 'GET'],
]);

function json(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function html(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ORION — проверка персонального входа</title></head><body>${body}</body></html>`, {
    status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/**
 * Verification-only, unmounted transport for ONLINE-1B. It deliberately exposes
 * no clinical data, staff administration, Sites adapter or password setup form.
 * This is not the main application login and must not be used as its shortcut.
 * Deployment config is injected by the server, never inferred from request Host.
 */
export function createStaffVerificationRuntime(dependencies: Dependencies, options: { origin: string }) {
  const configured = new URL(options.origin);
  if (configured.protocol !== 'https:' || configured.origin !== options.origin || configured.username || configured.password) {
    throw new TypeError('Staff runtime requires an exact HTTPS origin');
  }
  // Copy the configuration: mutating the caller's options later cannot change it.
  const origin = configured.origin;
  const { sessions, credentials } = dependencies;
  return async (request: Request): Promise<Response> => {
    try {
      const target = new URL(request.url);
      if (target.origin !== origin || target.username || target.password) return json(403, 'ACCESS_DENIED');
      const method = methods.get(target.pathname);
      if (!method) return json(404, 'NOT_FOUND');
      if (request.method !== method) {
        const denied = json(405, 'METHOD_NOT_ALLOWED');
        denied.headers.set('Allow', method);
        return denied;
      }
      // Do not accept caller-controlled redirects, identity selectors or tokens in
      // the URL, even though the shared resolver would not use them.
      if (target.search || target.hash) return json(400, 'INVALID_REQUEST');
      const fetchSite = request.headers.get('sec-fetch-site');
      const sourceOrigin = request.headers.get('origin');
      if ((sourceOrigin !== null && sourceOrigin !== origin) ||
        (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
        return json(403, 'ACCESS_DENIED');
      }
      if (target.pathname === '/api/staff/login' || target.pathname === '/api/staff/logout') {
        const result = target.pathname === '/api/staff/login'
          ? await handleStaffLogin(request, { sessions, credentials }, { origin })
          : await handleStaffLogout(request, sessions, { origin });
        for (const [name, value] of Object.entries(privateHeaders)) result.headers.set(name, value);
        return result;
      }
      if (target.pathname === '/sign-in') {
        return html('<main><h1>Проверка персонального входа ORION</h1><p>Изолированный технический контур. Вход в основную клинику здесь не подключён. Форма входа и клинические данные недоступны.</p></main>');
      }
      const resolved = await resolveStaffServerPrincipal(request.headers, sessions);
      if (resolved.status === 'unavailable') return target.pathname === '/staff'
        ? html('<main><h1>Вход временно недоступен</h1><p>Не удалось проверить сеанс. Повторите позже.</p></main>', 503)
        : json(503, 'AUTHENTICATION_UNAVAILABLE');
      if (resolved.status === 'unauthenticated') {
        if (target.pathname !== '/staff') return json(401, 'AUTHENTICATION_REQUIRED');
        return new Response(null, { status: 303, headers: { ...privateHeaders, Location: '/sign-in' } });
      }
      const { identity } = resolved;
      if (target.pathname === '/api/staff/session') return new Response(JSON.stringify(identity), {
        status: 200, headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
      return html(`<main data-staff-user-id="${escape(identity.user.id)}" data-staff-issuer="${escape(identity.principal.issuer)}" data-staff-subject="${escape(identity.principal.subject)}"><h1>Сеанс сотрудника подтверждён</h1><p>${escape(identity.user.displayName)}</p><p>Это проверка идентичности, не предоставление клинических прав. Рабочий доступ проверяется отдельно.</p></main>`);
    } catch {
      // Never reflect credentials, raw sessions, SQL/provider errors or request URLs.
      return json(503, 'AUTHENTICATION_UNAVAILABLE');
    }
  };
}
