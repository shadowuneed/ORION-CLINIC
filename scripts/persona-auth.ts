/** Test-runtime only. Imported exclusively by vite.personas.config.ts. */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const personas = ['doctor', 'nurse', 'administrator', 'registrar'] as const;
type Persona = typeof personas[number];
const cookieName = '__orion_persona_test';

export function personaAuth(port: number) {
  const sessions = new Map<string, { persona: Persona; expires: number }>();
  const origin = `http://127.0.0.1:${port}`;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Never trust caller-supplied identity, including on rejected requests.
    for (const key of Object.keys(req.headers)) {
      if (key.startsWith('oai-authenticated-user-')) delete req.headers[key];
    }
    for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
      if (req.rawHeaders[i].toLowerCase().startsWith('oai-authenticated-user-')) req.rawHeaders.splice(i, 2);
    }
    const respond = (status: number, text: string) => {
      res.statusCode = status;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(text);
    };
    if (req.headers.host !== `127.0.0.1:${port}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
      respond(403, 'Test runtime is loopback-only'); return;
    }
    const url = new URL(req.url ?? '/', origin);
    const values = (req.headers.cookie ?? '').split(';').map(x => x.trim())
      .filter(x => x.startsWith(`${cookieName}=`)).map(x => x.slice(cookieName.length + 1));
    const sessionKey = values.length === 1 ? values[0] : undefined;
    const session = sessionKey ? sessions.get(sessionKey) : undefined;
    const selected = session && session.expires > Date.now() ? session.persona : undefined;
    const path = url.pathname;
    if (path === '/__test/personas' || path === '/signin-with-chatgpt') {
      if (req.method !== 'GET') { respond(405, 'GET required'); return; }
      respond(200, `<!doctype html><html lang="ru"><meta charset="utf-8"><title>ORION — тестовые роли</title><h1>Изолированная проверка ролей</h1><p>Только искусственные данные. Это не вход в рабочую клинику.</p>${personas.map(p => `<form method="post" action="/__test/select?persona=${p}"><button>${p}</button></form>`).join('')}</html>`);
      return;
    }
    if (path === '/__test/select' || path === '/signout-with-chatgpt') {
      if (req.headers.origin !== origin || req.method !== 'POST') {
        // Production shell uses GET signout: present explicit same-origin POST.
        if (path === '/signout-with-chatgpt' && req.method === 'GET' && req.headers['sec-fetch-site'] !== 'cross-site') {
          respond(200, '<form method="post"><button>Завершить тестовую сессию</button></form>'); return;
        }
        respond(403, 'Same-origin POST required'); return;
      }
      if (path === '/__test/select' && (url.searchParams.getAll('persona').length !== 1 || !personas.includes(url.searchParams.get('persona') as Persona))) {
        respond(400, 'Unknown persona'); return;
      }
      if (sessionKey) sessions.delete(sessionKey);
      const newToken = path === '/__test/select' ? randomUUID() : '';
      for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
      if (newToken) sessions.set(newToken, { persona: url.searchParams.get('persona') as Persona, expires: Date.now() + 1800000 });
      res.setHeader('Set-Cookie', `${cookieName}=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${newToken ? 1800 : 0}`);
      res.setHeader('Location', newToken ? '/access' : '/__test/personas');
      res.statusCode = 303; res.end(); return;
    }
    if (selected) {
      req.headers['oai-authenticated-user-id'] = `persona-${selected}`;
      req.headers['oai-authenticated-user-email'] = `${selected}@example.test`;
      req.headers['oai-authenticated-user-full-name'] = `Test ${selected}`;
      for (const key of ['oai-authenticated-user-id', 'oai-authenticated-user-email', 'oai-authenticated-user-full-name']) {
        req.rawHeaders.push(key, String(req.headers[key]));
      }
    }
    next();
  };
}
