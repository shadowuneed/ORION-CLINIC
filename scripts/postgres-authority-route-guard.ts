import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LocalAccountAuthority } from './local-account-store';

const publicLocalApis = new Set(['/api/local-account/session', '/api/health/live']);
const postgresApi = /^\/api\/(?:clinical|crm|directory|regional)\/v1\/[a-zA-Z0-9/_-]+$/;
const pages = new Set(['/', '/patients', '/clinical', '/clinical/team', '/crm', '/live', '/pathway', '/scheduling', '/access']);
const authPages = new Set(['/sign-in', '/signin-with-chatgpt', '/signed-out', '/login', '/logout', '/signout-with-chatgpt', '/account/password']);
function asset(path: string) {
  // Not /_next/data or *.rsc: those can execute page loaders. Private file
  // access remains denied by the earlier privateHttpFiles + Vite FS guards.
  return /^\/(?:@vite|@id|@fs|node_modules|\.orion-runtime\/vite-cache)\//.test(path) ||
    /^\/maps\/turkestan-(?:districts|region)\.geojson$/.test(path) ||
    path === '/@react-refresh' || path === '/__vite_ping' ||
    /\.(?:js|mjs|cjs|ts|tsx|jsx|css|map|svg|png|jpg|jpeg|webp|avif|ico|woff2?|ttf|wasm)$/.test(path);
}

/** After the one-way authority cutover, old D1 clinical/administrative routes
 * must not become a second source of permissions or data. Run after personal
 * login middleware and before ALL API handlers. Never affects new STT routes.
 */
export function postgresAuthorityRouteGuard(authority: () => LocalAccountAuthority) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const raw = req.url ?? '/'; let path = raw.split(/[?#]/, 1)[0]; let malformed = false;
    try {
      for (let n = 0; path.includes('%') && n < 8; n += 1) path = decodeURIComponent(path);
      if (path.includes('%') || /[\u0000-\u001f\u007f\\]/.test(path) || !path.startsWith('/') || path.startsWith('//')) malformed = true;
      path = new URL(path, 'http://127.0.0.1').pathname;
    } catch { malformed = true; }
    const api = /^\/api(?:\/|$)/i.test(path);
    if (!malformed && !api && asset(path)) { next(); return; }
    let source: LocalAccountAuthority;
    try { source = authority(); }
    catch {
      res.statusCode = 503; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { code: 'AUTHORITY_UNAVAILABLE', message: 'Источник прав недоступен. Доступ к старой базе закрыт.' } })); return;
    }
    if (source === 'legacy_d1') { next(); return; }
    // No alternative spelling may skip an earlier, namespace-specific handler.
    const canonical = !malformed && raw.split(/[?#]/, 1)[0] === path;
    if (canonical && api && (postgresApi.test(path) || publicLocalApis.has(path))) { next(); return; }
    if (canonical && !api) {
      const page = (path.endsWith('.rsc') ? path.slice(0, -4) || '/' : path).replace(/\/$/, '') || '/';
      if (authPages.has(page)) { next(); return; }
      if (['GET', 'HEAD'].includes(req.method ?? 'GET') && (pages.has(page) || /^\/patients\/[a-zA-Z0-9_-]{1,160}$/.test(page))) { next(); return; }
      // Only fixed local redirects, and only safe navigation methods. POSTs to
      // old pages cannot trigger a legacy action by following a redirect.
      if (['GET', 'HEAD'].includes(req.method ?? 'GET')) {
        res.statusCode = 303; res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Location', /^\/access\/(?:manage|admin)(?:\/|$)/.test(page) ? '/clinical/team' : '/clinical'); res.end(); return;
      }
    }
    res.statusCode = 409;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify({ error: { code: 'LEGACY_API_DISABLED', message: 'Рабочее место перенесено на PostgreSQL. Откройте новый клинический раздел или CRM.', href: '/clinical' } }));
  };
}
