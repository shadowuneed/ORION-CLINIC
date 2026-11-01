/** Provision only the dedicated identities introduced by regional migration 0004.
 * Existing credentials are never replaced. Passwords remain in private handoffs.
 */
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { provisionPostgresAccount } from './configure-postgres-account.mjs';
import { localAccountPaths, readLocalAccountAuthority } from './local-account-store.ts';
import { createPostgresStaffDirectory } from './postgres-staff-directory.ts';
import { readCrmLocalConfig } from './crm-local-config.ts';

const issuer = 'orion:local:directives';
const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function directiveCredentialPlan(staff, existing) {
  const people = staff.filter(person => person.issuer === issuer);
  if (people.length !== 37 || new Set(people.map(person => person.id)).size !== 37 ||
    people.filter(person => person.id === 'directive-admin').length !== 1 ||
    people.some(person => person.subject !== person.id || !/^(directive-admin|head-[a-z0-9-]{1,100})$/.test(person.id))) throw new Error('Unexpected directive identity set');
  return people.sort((a, b) => a.id.localeCompare(b.id)).map(person => {
    const conflicts = existing.filter(row => row.user_id === person.id || row.issuer === person.issuer && row.subject === person.subject || row.login === person.id);
    if (conflicts.length && (conflicts.length !== 1 || conflicts[0].user_id !== person.id || conflicts[0].issuer !== issuer || conflicts[0].subject !== person.id || conflicts[0].login !== person.id)) throw new Error('Existing identity conflict');
    return { person, create: conflicts.length === 0 };
  });
}
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== 'provision') throw new Error('Usage: configure-directive-accounts.mjs provision');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const paths = localAccountPaths(root);
  if (readLocalAccountAuthority(paths.database) !== 'postgresql') throw new Error('PostgreSQL cutover required');
  const config = readCrmLocalConfig();
  if (!config) throw new Error('Owned PostgreSQL runtime required');
  const directory = createPostgresStaffDirectory(config);
  const credentialDb = new DatabaseSync(paths.database, { readOnly: true });
  const existing = credentialDb.prepare('SELECT * FROM local_accounts ORDER BY user_id').all();
  const fingerprint = hash(JSON.stringify(existing));
  let created = 0; let preserved = false;
  try {
    const plan = directiveCredentialPlan(await directory.loadStaff(), existing);
    const handoffs = [];
    for (const { person, create } of plan) {
      const file = join(realpathSync(paths.directory), `accounts-pg-${hash(person.id).slice(0, 24)}.html`);
      if (!create && !existsSync(file)) throw new Error('Existing account has no private handoff; no reset performed');
      if (create) { await provisionPostgresAccount({ userId: person.id, paths, directory }); created++; }
      handoffs.push({ userId: person.id, name: person.name, credentialFile: file });
    }
    const after = existing.map(row => credentialDb.prepare('SELECT * FROM local_accounts WHERE user_id=?').get(row.user_id));
    preserved = hash(JSON.stringify(after)) === fingerprint;
    if (!preserved) throw new Error('Existing credential fingerprint changed');
    const indexPath = join(paths.directory, `directive-accounts-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
    const list = handoffs.map(item => `<li><a href="accounts-pg-${hash(item.userId).slice(0, 24)}.html">${escape(item.name)}</a> · ${escape(item.userId)}</li>`).join('');
    writeFileSync(indexPath, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>ORION — доступ к поручениям</title><style>body{font:17px/1.6 system-ui;max-width:900px;margin:40px auto;padding:24px}li{margin:10px 0}</style><h1>Отдельные аккаунты поручений</h1><p>Администратор выдаёт и проверяет поручения. Руководители видят поручения только своего учреждения. Медицинские карты этим аккаунтам недоступны. Ссылки ведут к личным файлам с паролями — не пересылайте весь список.</p><ul>${list}</ul></html>`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ created, existingPreserved: preserved, accounts: handoffs.length, indexPath,
      administratorFile: handoffs.find(item => item.userId === 'directive-admin').credentialFile }));
  } finally { credentialDb.close(); await directory.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Dedicated credential provisioning stopped. Existing accounts were not reset. Completed handoffs remain private; retry will not replace them.');
  process.exitCode = 1;
});
