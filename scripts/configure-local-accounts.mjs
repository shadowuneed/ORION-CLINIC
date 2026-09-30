import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bytesToHex, derivePassword } from './local-account-auth.ts';
import { findLocalStaffDatabase, localAccountPaths, openLocalAccountStore, readLocalStaff } from './local-account-store.ts';

// Local operating-system operator only. No HTTP registration, role grants,
// migrations, clinical writes, credential output or provider network traffic.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--reset')) throw new Error('Usage: node scripts/configure-local-accounts.mjs [--reset existing-user-id]');
const staffPath = findLocalStaffDatabase(root);
const paths = localAccountPaths(root);
const store = openLocalAccountStore(paths.database, staffPath);
const escape = value => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
try {
  const staff = readLocalStaff(staffPath);
  const existing = store.loadAccounts();
  const reset = args[1];
  if (reset && !staff.some(person => person.id === reset)) throw new Error('An existing active staff user is required');
  const pending = staff.filter(person => reset ? person.id===reset : !existing.some(account=>account.issuer===person.issuer && account.subject===person.subject));
  const rows = [];
  for (const person of pending) {
    const login = existing.find(account=>account.issuer===person.issuer && account.subject===person.subject)?.login ?? person.id.toLowerCase().replace(/[^a-z0-9._-]/g,'-');
    if (!/^[a-z0-9._-]{3,64}$/.test(login)) throw new Error('Staff ID cannot be used as a login');
    const generatedPassword = randomBytes(18).toString('base64url');
    const salt = bytesToHex(randomBytes(16));
    const digest = bytesToHex(await derivePassword(generatedPassword,salt));
    store.provision(person,login,salt,digest);
    rows.push(`<tr><td>${escape(person.name)}</td><td><code>${escape(login)}</code></td><td><code>${escape(generatedPassword)}</code></td></tr>`);
  }
  if (rows.length) {
    const previous = existsSync(paths.handoff) ? readFileSync(paths.handoff,'utf8') : '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ORION Clinic — локальные аккаунты</title><style>body{font:16px/1.6 system-ui;background:#f0f5f2;color:#14392e;padding:32px;max-width:1000px;margin:auto}table{width:100%;border-collapse:collapse;background:white}th,td{padding:14px;text-align:left;border:1px solid #cbdad3}code{font-size:15px;user-select:all}a{color:#126b5e}</style><h1>ORION Clinic — вход сотрудников</h1><p>Этот файл содержит личные пароли. Храните его только на этом компьютере и не публикуйте.</p><p><a href="http://127.0.0.1:3200/sign-in" rel="noreferrer">Открыть окно входа</a></p>';
    writeFileSync(paths.handoff,`${previous}<h2>Выдано ${escape(new Date().toLocaleString('ru-RU'))}</h2><p>При повторной выдаче используйте последний пароль для этого логина.</p><table><tr><th>Сотрудник</th><th>Логин</th><th>Пароль</th></tr>${rows.join('')}</table>`,{mode:0o600});
  }
  console.log(JSON.stringify({configured:rows.length,total:store.loadAccounts().length,credentialFile:paths.handoff,restart:'Restart the local web service without migrations to activate personal login.'}));
} finally { store.close(); }
