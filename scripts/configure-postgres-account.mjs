import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { bytesToHex, derivePassword } from './local-account-auth.ts';
import { localAccountPaths, openLocalAccountStore, readLocalAccountAuthority } from './local-account-store.ts';
import { createPostgresStaffDirectory } from './postgres-staff-directory.ts';
import { readCrmLocalConfig } from './crm-local-config.ts';
import { generateMemorableLocalPassword } from './memorable-local-password.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function parsePostgresAccountArgs(args) {
  if (args.length !== 1 || !/^[A-Za-z0-9_-]{1,160}$/.test(args[0])) throw new Error('Usage: node scripts/configure-postgres-account.mjs <exactUserId>');
  return args[0];
}

/** Core is separately injectable for disposable tests. Production main derives
 * these paths solely from this checkout and the existing LocalAppData namespace.
 * Returns no password, salt or digest. Never reads/writes the legacy directory.
 */
export async function provisionPostgresAccount({ userId, paths, directory }) {
  parsePostgresAccountArgs([userId]);
  if (readLocalAccountAuthority(paths.database) !== 'postgresql') throw new Error('PG_NEW_CREDENTIAL_REQUIRES_CUTOVER');
  const mode = await directory.mode();
  if (mode.source !== 'postgres' || !mode.importComplete) throw new Error('PG_NEW_CREDENTIAL_REQUIRES_CUTOVER');
  const before = await directory.loadStaff();
  if (!before.some(person => person.id === userId)) throw new Error('PG_NEW_CREDENTIAL_IDENTITY_UNAVAILABLE');
  const privateDirectory = realpathSync(paths.directory);
  if (realpathSync(dirname(paths.database)) !== privateDirectory) throw new Error('PG_NEW_CREDENTIAL_PRIVATE_PATH_REQUIRED');
  const file = join(privateDirectory, `accounts-pg-${hash(userId).slice(0, 24)}.html`);
  const login = /^[a-z0-9._-]{3,64}$/.test(userId.toLowerCase()) ? userId.toLowerCase() : `staff-${hash(userId).slice(0, 24)}`;
  const generatedPassword = generateMemorableLocalPassword();
  const salt = bytesToHex(randomBytes(16));
  const derived = await derivePassword(generatedPassword, salt);
  const digest = bytesToHex(derived); derived.fill(0);
  const store = openLocalAccountStore(paths.database, directory);
  let ownedFile = false; let issued = false;
  try {
    await store.provisionPostgresNew(userId, login, salt, digest, person => {
      const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>ORION — первый пароль сотрудника</title><style>body{font:17px/1.6 system-ui;max-width:760px;margin:48px auto;padding:24px;color:#17362e;background:#f1f6f3}dl{padding:24px;background:white;border:1px solid #bdcec5;border-radius:12px}dd{margin:0 0 16px;overflow-wrap:anywhere}code{font-size:18px}a{color:#126b5e}</style><h1>Первый вход в ORION</h1><p>${escape(person.name)}</p><dl><dt>Идентификатор сотрудника</dt><dd>${escape(person.id)}</dd><dt>Логин</dt><dd><code id="login">${escape(login)}</code></dd><dt>Первоначальный пароль</dt><dd><code id="initial-password">${escape(generatedPassword)}</code></dd></dl><p>Этот файл содержит пароль. Передайте его только этому сотруднику и храните на этом компьютере. После входа сотрудник может сменить пароль в профиле.</p><a href="http://127.0.0.1:3200/sign-in" rel="noreferrer">Войти в ORION</a></html>`;
      const fd = openSync(file, 'wx', 0o600); ownedFile = true;
      try { writeFileSync(fd, html, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    });
    issued = true;
    return { userId, credentialFile: file };
  } finally {
    // Only this invocation's exact, exclusively-created file; never overwrite
    // another handoff. Preserve it if a rare COMMIT error leaves outcome unclear.
    store.close();
    if (!issued && ownedFile) {
      let persisted = true;
      try {
        const check = new DatabaseSync(paths.database, { readOnly: true });
        try { persisted = !!check.prepare('select 1 from local_accounts where user_id=? and salt=? and digest=?').get(userId, salt, digest); }
        finally { check.close(); }
      } catch { /* Keep the recoverable private file; never erase an ambiguous issuance. */ }
      if (!persisted) unlinkSync(file);
    }
  }
}

async function main() {
  const userId = parsePostgresAccountArgs(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const paths = localAccountPaths(root);
  if (readLocalAccountAuthority(paths.database) !== 'postgresql') throw new Error('PG_NEW_CREDENTIAL_REQUIRES_CUTOVER');
  const config = readCrmLocalConfig();
  if (!config) throw new Error('PG_NEW_CREDENTIAL_REQUIRES_POSTGRES');
  const directory = createPostgresStaffDirectory(config);
  try { console.log(JSON.stringify(await provisionPostgresAccount({ userId, paths, directory }))); }
  finally { await directory.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('First credential was not issued. Check the exact active PostgreSQL user, cutover state and existing private credential/handoff. Existing accounts and sessions were not reset.');
  process.exitCode = 1;
});
