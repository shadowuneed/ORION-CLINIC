import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bytesToHex, derivePassword } from './local-account-auth.ts';
import { findLocalStaffDatabase, localAccountPaths, openLocalAccountStore, readLocalAccountAuthority, readLocalStaff } from './local-account-store.ts';
import { assertReviewedSyntheticStaff, generateMemorableLocalPassword, parseLocalAccountProvisionArgs } from './memorable-local-password.ts';

// Local operating-system operator only. No HTTP registration, role grants,
// migrations, clinical writes, credential output or provider network traffic.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Validate flags before opening any storage. Memorable passwords are available
// only through the explicit all-existing-test-accounts reset operation.
const mode = parseLocalAccountProvisionArgs(process.argv.slice(2));
const paths = localAccountPaths(root);
if (readLocalAccountAuthority(paths.database) === 'postgresql') throw new Error('Legacy account provisioning is disabled after PostgreSQL authority cutover. Existing credentials are unchanged.');
const staffPath = findLocalStaffDatabase(root);
const store = openLocalAccountStore(paths.database, staffPath);
const escape = value => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
try {
  const staff = readLocalStaff(staffPath);
  const existing = store.loadAccounts();
  const reset = mode.mode === 'reset_one' ? mode.userId : undefined;
  if (reset && !staff.some(person => person.id === reset)) throw new Error('An existing active staff user is required');
  const pending = staff.filter(person => mode.mode === 'reset_test_all'
    ? existing.some(account=>account.issuer===person.issuer && account.subject===person.subject)
    : reset ? person.id===reset : !existing.some(account=>account.issuer===person.issuer && account.subject===person.subject));
  if (mode.mode === 'reset_test_all') assertReviewedSyntheticStaff(pending);
  const rows = [];
  const prepared = [];
  const issued = new Set();
  let credentialFile = paths.handoff;
  let handoffPublication = 'current_file';
  for (const person of pending) {
    const login = existing.find(account=>account.issuer===person.issuer && account.subject===person.subject)?.login ?? person.id.toLowerCase().replace(/[^a-z0-9._-]/g,'-');
    if (!/^[a-z0-9._-]{3,64}$/.test(login)) throw new Error('Staff ID cannot be used as a login');
    let generatedPassword;
    do {
      generatedPassword = mode.mode === 'reset_test_all' ? generateMemorableLocalPassword() : randomBytes(18).toString('base64url');
    } while (issued.has(generatedPassword));
    issued.add(generatedPassword);
    const salt = bytesToHex(randomBytes(16));
    const digest = bytesToHex(await derivePassword(generatedPassword,salt));
    if (mode.mode === 'reset_test_all') prepared.push({ person, login, salt, digest,
      previous: existing.find(account=>account.issuer===person.issuer && account.subject===person.subject) });
    else store.provision(person,login,salt,digest);
    rows.push(`<tr><td>${escape(person.name)}</td><td><code>${escape(login)}</code></td><td><code>${escape(generatedPassword)}</code></td></tr>`);
  }
  let credentialDocument;
  if (rows.length) {
    const previous = existsSync(paths.handoff) ? readFileSync(paths.handoff,'utf8') : '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ORION Clinic — локальные аккаунты</title><style>body{font:16px/1.6 system-ui;background:#f0f5f2;color:#14392e;padding:32px;max-width:1000px;margin:auto}table{width:100%;border-collapse:collapse;background:white}th,td{padding:14px;text-align:left;border:1px solid #cbdad3}code{font-size:15px;user-select:all}a{color:#126b5e}</style><h1>ORION Clinic — вход сотрудников</h1><p>Этот файл содержит личные пароли. Храните его только на этом компьютере и не публикуйте.</p><p><a href="http://127.0.0.1:3200/sign-in" rel="noreferrer">Открыть окно входа</a></p>';
    credentialDocument = `${previous}<h2>Выдано ${escape(new Date().toLocaleString('ru-RU'))}</h2><p>При повторной выдаче используйте последний пароль для этого логина.</p><table><tr><th>Сотрудник</th><th>Логин</th><th>Пароль</th></tr>${rows.join('')}</table>`;
  }
  if (mode.mode === 'reset_test_all') {
    // No new account or role is provisioned. Prepare all derivations first, then
    // reset the existing test credential rows and revoke their sessions together.
    const currentStaff = readLocalStaff(staffPath);
    if (pending.some(person=>!currentStaff.some(current=>current.id===person.id && current.issuer===person.issuer && current.subject===person.subject))) {
      throw new Error('Active test staff changed during preparation; no passwords changed');
    }
    if (resolve(dirname(paths.handoff)) !== resolve(paths.directory)) throw new Error('Private credential handoff directory mismatch; no passwords changed');
    const stagedFile = join(paths.directory,`accounts-reset-${randomBytes(16).toString('hex')}.html`);
    let stagedOwned = false;
    let auth;
    let committed = false;
    try {
      // Exclusively create and flush the full private handoff BEFORE any
      // credential changes. Only this invocation's own staged file is cleaned.
      const descriptor = openSync(stagedFile,'wx',0o600); stagedOwned = true;
      try { writeFileSync(descriptor,credentialDocument,'utf8'); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
      auth = new DatabaseSync(paths.database);
      auth.exec('pragma busy_timeout=3000; begin immediate');
      try {
        const change = auth.prepare('update local_accounts set salt=?,digest=? where user_id=? and issuer=? and subject=? and login=? and salt=? and digest=?');
        const revoke = auth.prepare('delete from local_sessions where issuer=? and subject=?');
        for (const entry of prepared) {
          const changed = change.run(entry.salt,entry.digest,entry.person.id,entry.person.issuer,entry.person.subject,
            entry.login,entry.previous.salt,entry.previous.digest).changes;
          if (Number(changed)!==1) throw new Error('Test credential changed during preparation; no passwords changed');
          revoke.run(entry.person.issuer,entry.person.subject);
        }
        auth.exec('commit'); committed = true;
      } catch (error) { auth.exec('rollback'); throw error; }
    } catch (error) {
      if (!committed && stagedOwned) unlinkSync(stagedFile);
      throw error;
    } finally { auth?.close(); }
    try { renameSync(stagedFile,paths.handoff); }
    catch {
      // Successful DB reset stays recoverable even when Windows/file locking
      // prevents replacement. Never delete the now-authoritative staged file.
      credentialFile = stagedFile;
      handoffPublication = 'retained_private_stage';
    }
  }
  if (rows.length && mode.mode !== 'reset_test_all') writeFileSync(paths.handoff,credentialDocument,{mode:0o600});
  console.log(JSON.stringify({configured:rows.length,total:store.loadAccounts().length,credentialFile,handoffPublication,
    mode:mode.mode,sessionsRevoked:mode.mode==='reset_test_all',
    restart:'Restart the local web service without migrations to activate personal login.'}));
} finally { store.close(); }
