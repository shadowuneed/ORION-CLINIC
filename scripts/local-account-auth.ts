import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LocalSession, LocalSessionStore } from './local-account-store.ts';

export type LocalAccount = { login: string; subject: string; issuer: string; name: string; salt: string; digest: string };
export const localAccountCookie = 'orion_local_session';
const generationCookie = 'orion_local_generation';
const generationHeader = 'x-orion-local-generation';
export const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const derivePassword = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});

export function parseLocalAccounts(value: unknown): LocalAccount[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid local account registry');
  const logins = new Set(); const subjects = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || !/^[a-z0-9._-]{3,64}$/.test(item.login) ||
      typeof item.subject !== 'string' || !/^[^\s\p{Cc}]{1,256}$/u.test(item.subject) ||
      typeof item.issuer !== 'string' || !/^[^\s\p{Cc}]{1,256}$/u.test(item.issuer) ||
      typeof item.name !== 'string' || !item.name.length || item.name.length > 120 ||
      !/^[a-f0-9]{32}$/.test(item.salt) || !/^[a-f0-9]{128}$/.test(item.digest) ||
      logins.has(item.login) || subjects.has(JSON.stringify([item.issuer,item.subject]))) throw new Error('Invalid local account registry');
    logins.add(item.login); subjects.add(JSON.stringify([item.issuer,item.subject]));
    return { login: item.login, subject: item.subject, issuer: item.issuer, name: item.name, salt: item.salt, digest: item.digest };
  });
}

function screen(title: string, content: string, dark: boolean) {
  return `<!doctype html><html lang="ru" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — ORION Clinic</title><style>
:root{color-scheme:light;--bg:#eef3f0;--panel:#ffffff;--text:#172b27;--muted:#586c64;--line:#cbdad3;--accent:#126b5e;--soft:#e4efea;--on-accent:#ffffff}[data-theme=dark]{color-scheme:dark;--bg:#14211e;--panel:#1c2e29;--text:#eff6f1;--muted:#bdd0c8;--line:#48665a;--accent:#91d3bf;--soft:#253f35;--on-accent:#112a22}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}.frame{width:min(100%,960px);display:grid;grid-template-columns:.95fr 1fr;border:1px solid var(--line);border-radius:26px;background:var(--panel);overflow:hidden;box-shadow:0 24px 80px #10282012}aside{padding:44px;background:var(--soft);display:flex;flex-direction:column;justify-content:space-between;gap:56px}.brand{display:flex;align-items:center;gap:14px;font-size:24px;letter-spacing:.08em}.brand svg{width:48px;height:48px;color:var(--accent)}.brand small{display:block;font-size:14px;font-weight:500;letter-spacing:.02em;color:var(--muted)}aside h2{font-size:30px;line-height:1.2;letter-spacing:-.035em;font-weight:650;margin:0 0 16px}aside p{color:var(--muted);margin:0}main{padding:44px}h1{font-size:28px;line-height:1.2;margin:0 0 14px;letter-spacing:-.03em}p{color:var(--muted)}label{display:block;margin:20px 0 7px;font-weight:650;font-size:14px}input,button{font:inherit;width:100%;border-radius:11px;padding:13px 14px;border:1px solid var(--line);background:var(--panel);color:var(--text)}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button{margin-top:24px;background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:700;cursor:pointer}a{color:var(--accent);text-underline-offset:3px}.foot{margin-top:26px;font-size:13px;color:var(--muted)}[role=alert]{background:#fff0e9;color:#782f21;padding:12px;border-radius:10px;font-size:14px}.success{background:var(--soft);padding:10px 12px;border-radius:10px}.account{font-size:14px;padding:12px;background:var(--soft);border-radius:10px}code{overflow-wrap:anywhere}@media(max-width:700px){.frame{max-width:450px;grid-template-columns:1fr}aside{padding:24px;gap:0}aside .intro{display:none}main{padding:28px}.brand{font-size:22px}}
</style></head><body><div class="frame"><aside><div class="brand"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="20" stroke="currentColor" stroke-width="8"/><ellipse cx="32" cy="32" rx="33" ry="9" transform="rotate(-29 32 32)" stroke="currentColor" stroke-width="2"/><circle cx="54" cy="18" r="4" fill="currentColor"/></svg><strong>ORION<small>Clinic</small></strong></div><div class="intro"><h2>Ваше рабочее<br>пространство</h2><p>Пациенты, приёмы и задачи команды — с доступом, назначенным лично вам.</p></div><p class="foot">Вход сотрудника · на этом компьютере</p></aside><main><h1>${escape(title)}</h1>${content}</main></div></body></html>`;
}

function memoryStore(): LocalSessionStore {
  const sessions = new Map<string, LocalSession>(); let attempts = { count: 0, until: 0 };
  return {
    getSession(key, now) { const session=sessions.get(key); if (session && (now-session.touched>1_800_000 || now-session.created>28_800_000)) { sessions.delete(key); return undefined; } return session; },
    putSession(key, session) { sessions.set(key, {...session}); }, deleteSession(key) { sessions.delete(key); },
    reserveAttempt(now) { if (attempts.until<=now) attempts={count:0,until:now+300_000}; if(attempts.count>=10)return false; attempts.count++; return true; },
    finishAttempt() { /* Successful login cannot replenish the global KDF budget. */ },
  };
}

export function localAccountAuth(port: number, loadAccounts: () => Promise<LocalAccount[]>, now = () => Date.now(), store: LocalSessionStore = memoryStore()) {
  const dummySalt = bytesToHex(randomBytes(16)); let derivations = 0;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Sole identity provider in explicit local mode: Sites development auto-login is absent.
    const incomingGeneration = req.headers[generationHeader];
    const isIdentity = (key: string) => key.toLowerCase().startsWith('oai-authenticated-user-') || key.toLowerCase().startsWith('x-orion-local-');
    for (const key of Object.keys(req.headers)) if (isIdentity(key)) delete req.headers[key];
    for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) if (isIdentity(req.rawHeaders[i])) req.rawHeaders.splice(i, 2);
    const send = (status: number, title: string, content: string) => {
      res.statusCode = status; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      res.end(screen(title, content, /(?:^|;\s*)orion-theme=dark(?:;|$)/.test(req.headers.cookie ?? '')));
    };
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host ?? '') ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers['x-forwarded-host']) {
      send(403, 'Локальный доступ', '<p>Этот способ входа доступен только на компьютере клиники.</p>'); return;
    }
    const origin = `http://${host}`; const url = new URL(req.url ?? '/', origin);
    const loginRoute = ['/login', '/sign-in', '/signin-with-chatgpt', '/signed-out'].includes(url.pathname);
    const logoutRoute = ['/logout', '/signout-with-chatgpt'].includes(url.pathname);
    const passwordRoute = url.pathname==='/account/password';
    if (url.pathname.includes('/local-auth/') || url.pathname.includes('accounts.sqlite') || url.pathname.includes('accounts.html')) { res.statusCode=404;res.end();return; }
    try {
      const accounts = parseLocalAccounts(await loadAccounts());
      const cookies = (req.headers.cookie ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${localAccountCookie}=`));
      const sessionId = cookies.length === 1 ? cookies[0].slice(localAccountCookie.length + 1) : '';
      const sessionHash = hash(sessionId);
      const session = /^[a-f0-9]{64}$/.test(sessionId) ? store.getSession(sessionHash, now()) : undefined;
      const account = session && accounts.find(a => a.issuer===session.issuer && a.subject === session.subject && a.digest === session.digest);
      if (session && !account) store.deleteSession(sessionHash);
      const redirect = (path: string) => { res.statusCode = 303; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Location', path); res.end(); };
      const loginForm = (error = '') => `${error ? `<p role="alert">${escape(error)}</p>` : '<p>Введите личный логин и пароль.</p>'}${url.searchParams.has('signedout') ? '<p class="success">Вы вышли из аккаунта.</p>' : ''}${account ? `<p class="account">Сейчас: <strong>${escape(account.name)}</strong><br><a href="/">Продолжить работу</a> · <a href="/logout">Выйти</a></p>` : ''}<form method="post" action="/login"><label for="login">Логин сотрудника</label><input id="login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="64" placeholder="Ваш логин"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="Введите пароль"><button type="submit">${account ? 'Войти в другой аккаунт' : 'Войти в рабочее место'}</button></form><p class="foot">Учётную запись и первоначальный пароль выдаёт администратор компьютера.</p>`;
      const passwordForm=(error='')=>`${error?`<p role="alert">${escape(error)}</p>`:''}<p>Аккаунт ${escape(account?.name??'')}. После смены пароля все его сеансы завершатся.</p><form method="post" action="/account/password"><label for="password">Текущий пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><label for="next-password">Новый пароль</label><input id="next-password" name="nextPassword" type="password" autocomplete="new-password" required minlength="15" maxlength="256"><label for="confirm-password">Повторите новый пароль</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required minlength="15" maxlength="256"><p class="foot">Не менее 15 символов. Можно использовать длинную фразу.</p><button>Сохранить новый пароль</button></form><p><a href="/">Вернуться к работе</a></p>`;
      if (loginRoute || logoutRoute || passwordRoute) {
        if(passwordRoute && !account){redirect('/sign-in');return;}
        if (req.method === 'GET') {
          if(passwordRoute){send(200,'Сменить пароль',passwordForm());return;}
          if (logoutRoute) { send(200, 'Выйти из аккаунта?', `<p>Сеанс ${account ? escape(account.name) : 'сотрудника'} будет завершён. Сохраните текущие изменения перед выходом.</p><form method="post" action="/logout"><button>Выйти из аккаунта</button></form><p><a href="/">Продолжить работу</a></p>`); return; }
          if (!accounts.length) { send(200, 'Вход пока не настроен', '<p>Администратору компьютера нужно один раз выполнить <code>node scripts/configure-local-accounts.mjs</code> из папки ORION Clinic.</p>'); return; }
          send(200, 'Вход в ORION Clinic', `${url.searchParams.has('passwordchanged')?'<p class="success">Пароль обновлён. Войдите с новым паролем.</p>':''}${loginForm()}${account?'<p><a href="/account/password">Сменить пароль</a></p>':''}`); return;
        }
        if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') { send(403, 'Запрос отклонён', '<p>Повторите вход с этого компьютера.</p>'); return; }
        if (logoutRoute) {
          store.deleteSession(sessionHash);
          res.setHeader('Set-Cookie', [`${localAccountCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,`${generationCookie}=${bytesToHex(randomBytes(16))}; SameSite=Strict; Path=/; Max-Age=28800`]);
          redirect('/sign-in?signedout=1'); return;
        }
        if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { send(415, 'Запрос отклонён', '<p>Используйте форму входа.</p>'); return; }
        if (derivations>=2 || !store.reserveAttempt(now())) { res.setHeader('Retry-After', '300'); send(429, 'Подождите перед входом', '<p>Слишком много попыток. Повторите через пять минут.</p>'); return; }
        let body = ''; const timeout = setTimeout(() => req.destroy(), 5000);
        try { for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 4096) { send(413, 'Запрос отклонён', '<p>Форма слишком велика.</p>'); return; } } }
        finally { clearTimeout(timeout); }
        const form = new URLSearchParams(body);
        const login = (form.get('login') ?? '').trim().toLowerCase(); const password = form.get('password') ?? '';
        const candidate = passwordRoute ? account : accounts.find(a => a.login === login);
        if (derivations>=2) { res.setHeader('Retry-After','5');send(429,'Подождите перед входом','<p>Вход уже проверяется. Повторите через несколько секунд.</p>');return; }
        derivations++; let valid = false;
        try {
          const derived = await derivePassword(password.slice(0, 256), candidate?.salt ?? dummySalt);
          valid = (passwordRoute || form.getAll('login').length === 1) && form.getAll('password').length === 1 && password.length <= 256 &&
            !!candidate && timingSafeEqual(derived, Buffer.from(candidate.digest, 'hex')); derived.fill(0);
        } finally { derivations--; }
        const current = valid && candidate ? parseLocalAccounts(await loadAccounts()).find(a=>a.issuer===candidate.issuer && a.subject===candidate.subject && a.digest===candidate.digest) : undefined;
        if (!current) { store.finishAttempt(false);send(401, passwordRoute?'Сменить пароль':'Вход в ORION Clinic', passwordRoute?passwordForm('Текущий пароль не подтверждён.'):loginForm('Неверный логин или пароль.')); return; }
        if(passwordRoute){
          const next=form.get('nextPassword')??'';
          if(form.getAll('nextPassword').length!==1 || form.getAll('confirmPassword').length!==1 || Array.from(next).length<15 || next.length>256 || next!==form.get('confirmPassword')) {
            send(400,'Сменить пароль',passwordForm('Укажите одинаковый новый пароль от 15 до 256 символов.'));return;
          }
          if(derivations>=2 || !store.updatePassword){send(503,'Сменить пароль',passwordForm('Смена пароля временно недоступна. Повторите позже.'));return;}
          const salt=bytesToHex(randomBytes(16));derivations++;
          let digest:string;
          try{const derived=await derivePassword(next,salt);digest=bytesToHex(derived);derived.fill(0);}finally{derivations--;}
          if(!store.updatePassword(current,salt,digest)){send(409,'Сменить пароль',passwordForm('Аккаунт изменился. Выполните вход заново.'));return;}
          res.setHeader('Set-Cookie',[`${localAccountCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,`${generationCookie}=${bytesToHex(randomBytes(16))}; SameSite=Strict; Path=/; Max-Age=28800`]);
          redirect('/sign-in?passwordchanged=1');return;
        }
        store.finishAttempt(true); store.deleteSession(sessionHash);
        const opaque = bytesToHex(randomBytes(32)); const generation=bytesToHex(randomBytes(16));
        store.putSession(hash(opaque), { issuer:current.issuer, subject: current.subject, digest: current.digest, created: now(), touched: now(), generation });
        res.setHeader('Set-Cookie', [`${localAccountCookie}=${opaque}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,`${generationCookie}=${generation}; SameSite=Strict; Path=/; Max-Age=28800`]);
        redirect('/'); return;
      }
      if (url.pathname === '/api/local-account/session') {
        res.statusCode = account ? 200 : 401; res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify(account && session ? { generation:session.generation } : { error:'AUTHENTICATION_REQUIRED' }));return;
      }
      // Native image/download navigation cannot add fetch headers. These exact
      // resource routes retain their existing patient/object authorization.
      // Every JSON API read and write needs the current page's session fence.
      const nativeRead = req.method==='GET' && (url.pathname.startsWith('/api/health/') ||
        /^\/api\/patients\/[^/]+\/photo$/.test(url.pathname) || /^\/api\/orders\/[^/]+\/result$/.test(url.pathname) ||
        url.pathname==='/api/workspace/exports/download');
      const fencedApi = url.pathname.startsWith('/api/') && !nativeRead;
      if (account && session && ((incomingGeneration && incomingGeneration!==session.generation) || (fencedApi && incomingGeneration!==session.generation))) {
        res.statusCode=409;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{code:'SESSION_CHANGED',message:'Аккаунт изменён. Откройте рабочее место заново.'}}));return;
      }
      if (account && session) {
        session.touched = now(); store.putSession(sessionHash,session);
        const identity = { 'oai-authenticated-user-id': account.subject, 'oai-authenticated-user-full-name': encodeURIComponent(account.name),
          'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8','x-orion-local-issuer':account.issuer,[generationHeader]:session.generation };
        for (const [key, value] of Object.entries(identity)) { req.headers[key] = value; req.rawHeaders.push(key, value); }
      }
      next();
    } catch { send(503, 'Вход временно недоступен', '<p>Не удалось проверить аккаунт. Повторите позже.</p>'); }
  };
}
