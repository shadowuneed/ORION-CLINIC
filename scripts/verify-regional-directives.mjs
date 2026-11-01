/** Rollback-only acceptance runner; never targets a cloud/shared PostgreSQL. */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const mode = process.argv[2];
if (!['dry-run', 'verify'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: verify-regional-directives.mjs dry-run|verify');
if (!process.env.LOCALAPPDATA) throw new Error('Dedicated PC runtime required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
const data = join(runtime, 'data');
const marker = JSON.parse(readFileSync(join(runtime, 'cluster-owner.json'), 'utf8'));
if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 || resolve(marker.data).toLowerCase() !== resolve(data).toLowerCase()) throw new Error('Owned PostgreSQL marker required');
const admin = JSON.parse(readFileSync(join(runtime, 'admin.json'), 'utf8'));
if (admin.host !== '127.0.0.1' || admin.port !== 55432 || admin.user !== 'postgres' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) throw new Error('Invalid dedicated PC configuration');
const { password } = admin;
const client = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password, database: 'orion_crm_local', ssl: false,
  connectionTimeoutMillis: 3000, statement_timeout: 30000, lock_timeout: 5000 });
function body(sql, ending) {
  const withoutBegin = sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, '$1');
  if (withoutBegin === sql || !new RegExp(`${ending};\\s*$`).test(withoutBegin)) throw new Error('Expected transaction-wrapped SQL');
  return withoutBegin.replace(new RegExp(`${ending};\\s*$`), '');
}
let phase = 'connect';
let statement = '';
try {
  await client.connect();
  if (realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase() !== realpathSync(data).toLowerCase() ||
    (await client.query('SELECT current_database() n')).rows[0].n !== 'orion_crm_local') throw new Error('Wrong PostgreSQL target');
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(7791324003)');
  if (mode === 'dry-run') {
    if ((await client.query("SELECT to_regclass('orion_region.directive_grants') IS NOT NULL installed")).rows[0].installed) throw new Error('Migration already installed; use verify');
    phase = 'migration'; statement = body(readFileSync(join(root, 'db/regional/0004_directives.sql'), 'utf8'), 'COMMIT');
    await client.query(statement);
  }
  phase = 'rollback-checks'; statement = body(readFileSync(join(root, 'db/regional/directives-rollback.sql'), 'utf8'), 'ROLLBACK');
  await client.query(statement);
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ mode, passed: true, rolledBack: true }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  const label = error instanceof Error && /^DIRECTIVE(?:_CHECK_FAILED: [a-zA-Z0-9 ,:()_-]+|_MIGRATION_REQUIRED)$/.test(error.message) ? error.message : 'Regional directives verification failed';
  const position = typeof error?.position === 'string' && /^\d+$/.test(error.position) ? Number(error.position) : undefined;
  console.error(JSON.stringify({ passed: false, phase, message: label, line: position ? statement.slice(0, position - 1).split('\n').length : undefined,
    sqlState: typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined }));
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
