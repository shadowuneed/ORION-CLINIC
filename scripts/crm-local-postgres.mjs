/** Dedicated PC-only PostgreSQL. No D1/Supabase access and no credential output. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required');
const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
const binaries = join(runtime, 'postgresql-17.11', 'pgsql', 'bin');
const data = join(runtime, 'data');
const marker = join(runtime, 'cluster-owner.json');
const privatePath = join(runtime, 'admin.json');
const publicRuntimePath = join(runtime, 'runtime.json');
const command = process.argv[2];
if (!['init', 'start', 'stop', 'migrate', 'seed', 'grant-owner', 'health', 'backup'].includes(command) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/crm-local-postgres.mjs init|start|stop|migrate|seed|grant-owner|health|backup');
}
const exe = name => join(binaries, `${name}.exe`);
// pg_ctl on Windows can leave inherited pipe handles open in its background
// postmaster. No output pipes: server diagnostics go to its private -l file.
const run = (name, args, env = process.env) => execFileSync(exe(name), args, { windowsHide: true, env, stdio: 'ignore' });
function verifyOwned() {
  const identity = JSON.parse(readFileSync(marker, 'utf8'));
  if (identity.kind !== 'orion-crm-local-v1' || identity.data !== data || identity.port !== 55432) throw new Error('Unrecognized cluster; refusing access');
}
function readPrivate() {
  verifyOwned();
  const config = JSON.parse(readFileSync(privatePath, 'utf8'));
  if (config.host !== '127.0.0.1' || config.port !== 55432 || config.user !== 'postgres' || !/^[A-Za-z0-9_-]{32,128}$/.test(config.password)) throw new Error('Invalid private cluster configuration');
  // Never forward optional driver settings such as connectionString/ssl from
  // JSON: they can override the checked loopback target before ownership checks.
  const { password } = config;
  return { host: '127.0.0.1', port: 55432, user: 'postgres', password };
}
async function connect(database = 'orion_crm_local') {
  const client = new pg.Client({ ...readPrivate(), database, connectionTimeoutMillis: 3000, statement_timeout: 15000 });
  await client.connect();
  const location = (await client.query('show data_directory')).rows[0].data_directory;
  if (resolve(location).toLowerCase() !== resolve(data).toLowerCase()) { await client.end(); throw new Error('Unexpected PostgreSQL cluster'); }
  return client;
}
function start() {
  verifyOwned();
  if (!existsSync(join(data, 'PG_VERSION'))) throw new Error('Cluster not initialized');
  try { run('pg_ctl', ['status', '-D', data]); console.log('ORION CRM PostgreSQL already running on 127.0.0.1:55432'); return; } catch { /* Start only the owned data directory. */ }
  run('pg_ctl', ['start', '-D', data, '-l', join(runtime, 'postgresql.log'), '-w', '-t', '30']);
  console.log('ORION CRM PostgreSQL started on 127.0.0.1:55432');
}
async function initialize() {
  if (!existsSync(exe('initdb'))) throw new Error('Install the official PostgreSQL 17.11 Windows binaries in the dedicated runtime first');
  if (existsSync(marker)) { verifyOwned(); start(); if (!existsSync(publicRuntimePath)) await provisionApp(); return; }
  if (existsSync(data) || existsSync(privatePath) || existsSync(publicRuntimePath)) throw new Error('Runtime target already contains state; refusing overwrite');
  mkdirSync(runtime, { recursive: true });
  const adminPass = randomBytes(36).toString('base64url');
  // Generated configuration lives outside repo/OneDrive, under current-user-only directory ACL.
  writeFileSync(privatePath, JSON.stringify({ host: '127.0.0.1', port: 55432, user: 'postgres', password: adminPass }), { mode: 0o600, flag: 'wx' });
  const passwordFile = join(runtime, 'init-password.txt');
  writeFileSync(passwordFile, adminPass, { mode: 0o600, flag: 'wx' });
  try { run('initdb', ['-D', data, '-U', 'postgres', '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']); }
  finally { unlinkSync(passwordFile); }
  writeFileSync(join(data, 'postgresql.auto.conf'), "listen_addresses = '127.0.0.1'\nport = 55432\nmax_connections = 20\nshared_buffers = '64MB'\npassword_encryption = 'scram-sha-256'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n", { mode: 0o600 });
  writeFileSync(marker, JSON.stringify({ kind: 'orion-crm-local-v1', data, port: 55432 }), { mode: 0o600, flag: 'wx' });
  start();
  await provisionApp();
}
async function provisionApp() {
  const appPassword = randomBytes(36).toString('base64url');
  const client = await connect('postgres');
  try {
    if ((await client.query("select 1 from pg_roles where rolname='orion_crm_app'")).rowCount ||
      (await client.query("select 1 from pg_database where datname='orion_crm_local'")).rowCount) throw new Error('Partial application provisioning exists; refusing role/password overwrite');
    // Generated base64url password cannot contain SQL syntax; never log this statement.
    await client.query(`create role orion_crm_app login password '${appPassword}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    await client.query('create database orion_crm_local encoding UTF8 template template0');
    await client.query('revoke all on database orion_crm_local from public');
    await client.query('grant connect on database orion_crm_local to orion_crm_app');
    writeFileSync(publicRuntimePath, JSON.stringify({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app', password: appPassword }), { mode: 0o600, flag: 'wx' });
    console.log('Dedicated database created; credentials stored only in private PC runtime');
  } finally { await client.end(); }
}
async function applyFiles(seed) {
  const directory = join(repository, 'crm', 'sql');
  const files = readdirSync(directory).filter(file => /^\d{4}_[a-z_]+\.sql$/.test(file)).sort()
    .filter(file => seed ? file.includes('synthetic_seed') : !file.includes('synthetic_seed'));
  if (!files.length) throw new Error('No reviewed CRM SQL files found');
  const client = await connect();
  try {
    await client.query('select pg_advisory_lock(7791324001)');
    await client.query('create table if not exists public.orion_crm_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())');
    await client.query('revoke all on public.orion_crm_migrations from public, orion_crm_app');
    for (const name of files) {
      const sql = readFileSync(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = (await client.query('select checksum from public.orion_crm_migrations where name=$1', [name])).rows[0];
      if (existing) { if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`); console.log(`Already applied: ${name}`); continue; }
      await client.query('begin');
      try {
        // Reviewed files have standalone BEGIN/COMMIT wrappers; the migration
        // ledger and schema must instead commit together in this transaction.
        const body = sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, '$1').replace(/COMMIT;\s*$/, '');
        await client.query(body);
        await client.query('insert into public.orion_crm_migrations(name,checksum) values($1,$2)', [name, checksum]);
        await client.query('commit');
        console.log(`Applied: ${name}`);
      } catch (error) { await client.query('rollback'); throw error; }
    }
  } finally { await client.query('select pg_advisory_unlock(7791324001)').catch(() => {}); await client.end(); }
}
try {
  if (command === 'init') await initialize();
  if (command === 'start') start();
  if (command === 'stop') { verifyOwned(); run('pg_ctl', ['stop', '-D', data, '-m', 'smart', '-w', '-t', '30']); console.log('Dedicated CRM PostgreSQL stopped'); }
  if (command === 'migrate') await applyFiles(false);
  if (command === 'seed') await applyFiles(true);
  if (command === 'grant-owner') {
    const { findLocalStaffDatabase, localAccountPaths, openLocalAccountStore, readLocalStaff } = await import('./local-account-store.ts');
    const staffPath = findLocalStaffDatabase(repository);
    const person = readLocalStaff(staffPath).find(item => item.id === 'user-a');
    if (!person) throw new Error('The exact existing local operator user-a is not active');
    const store = openLocalAccountStore(localAccountPaths(repository).database, staffPath);
    try {
      if (!store.loadAccounts().some(account => account.issuer === person.issuer && account.subject === person.subject)) throw new Error('Local operator credentials are not provisioned');
    } finally { store.close(); }
    const client = await connect();
    try {
      await client.query(`insert into orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage)
        values('crm-local-operator','crm-clinic-local',$1,$2,'Локальный оператор CRM',true,true) on conflict(id) do nothing`, [person.issuer, person.subject]);
      const grant = (await client.query("select issuer,subject,active,can_read,can_manage from orion_crm.actor_grants where id='crm-local-operator'")).rows[0];
      if (!grant || grant.issuer !== person.issuer || grant.subject !== person.subject || !grant.active || !grant.can_read || !grant.can_manage) throw new Error('Existing CRM owner grant differs; refusing overwrite');
      console.log('CRM simulation access assigned to the exact provisioned local operator user-a; D1 roles unchanged');
    } finally { await client.end(); }
  }
  if (command === 'health') {
    const client = await connect();
    try { const result = await client.query('select version(),current_database() as database'); console.log(JSON.stringify({ status: 'ok', database: result.rows[0].database, version: result.rows[0].version, host: '127.0.0.1', port: 55432 })); }
    finally { await client.end(); }
  }
  if (command === 'backup') {
    const ownedClient = await connect();
    await ownedClient.end();
    const config = readPrivate();
    const backupDirectory = join(runtime, 'backups'); mkdirSync(backupDirectory, { recursive: true });
    const backup = join(backupDirectory, `orion-crm-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
    run('pg_dump', ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', 'orion_crm_local', '-Fc', '-f', backup], { ...process.env, PGPASSWORD: config.password });
    console.log(`CRM-only backup: ${backup}`);
  }
} catch (error) {
  // Driver exceptions can include database statements; do not expose their details.
  console.error(error instanceof Error && !('severity' in error) && !('stderr' in error) ? error.message : 'CRM PostgreSQL operation failed; inspect the private runtime log locally');
  process.exitCode = 1;
}
