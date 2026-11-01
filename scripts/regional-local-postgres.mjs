/** Explicit additive migration command for the existing owner-marked PC cluster. */
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2];
if (!['migrate', 'status'].includes(action) || process.argv.length !== 3) throw new Error('Usage: regional-local-postgres.mjs migrate|status');
if (!process.env.LOCALAPPDATA) throw new Error('Dedicated PC runtime required');
const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
const marker = JSON.parse(readFileSync(join(runtime, 'cluster-owner.json'), 'utf8'));
const data = join(runtime, 'data');
if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 || resolve(marker.data).toLowerCase() !== resolve(data).toLowerCase()) throw new Error('Owned PostgreSQL marker required');
const admin = JSON.parse(readFileSync(join(runtime, 'admin.json'), 'utf8'));
if (admin.host !== '127.0.0.1' || admin.port !== 55432 || admin.user !== 'postgres' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) throw new Error('Invalid dedicated PC configuration');
const { password } = admin;
const client = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password, database: 'orion_crm_local',
  ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 30000, lock_timeout: 5000 });
try {
  await client.connect();
  if (realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase() !== realpathSync(data).toLowerCase() ||
    (await client.query('SELECT current_database() n')).rows[0].n !== 'orion_crm_local') throw new Error('Wrong PostgreSQL target');
  if (action === 'status') {
    const installed = (await client.query("SELECT to_regclass('orion_region.facilities') IS NOT NULL installed")).rows[0].installed;
    if (!installed) console.log('Regional module is not installed.');
    else console.log(JSON.stringify({ ...(await client.query('SELECT (SELECT count(*)::int FROM orion_region.districts) districts,(SELECT count(*)::int FROM orion_region.facilities) facilities,(SELECT count(*)::int FROM orion_region.patient_details) patients')).rows[0],
      migrations: (await client.query('SELECT name,checksum FROM public.orion_regional_migrations ORDER BY name')).rows,
      unicodeCollations: (await client.query("SELECT collname,collprovider FROM pg_collation WHERE collname IN ('und-x-icu','ru-x-icu','unicode') ORDER BY collname")).rows }));
  } else {
    await client.query('SELECT pg_advisory_lock(7791324003)');
    try {
      await client.query('BEGIN');
      try {
        await client.query('CREATE TABLE IF NOT EXISTS public.orion_regional_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
        await client.query('REVOKE ALL ON public.orion_regional_migrations FROM PUBLIC,orion_crm_app');
        const directory = join(repository, 'db', 'regional');
        for (const name of readdirSync(directory).filter(n => /^\d{4}_[a-z_]+\.sql$/.test(n)).sort()) {
          const sql = readFileSync(join(directory, name), 'utf8'); const checksum = createHash('sha256').update(sql).digest('hex');
          const old = (await client.query('SELECT checksum FROM public.orion_regional_migrations WHERE name=$1', [name])).rows[0];
          if (old) { if (old.checksum !== checksum) throw new Error(`Applied regional migration changed: ${name}`); continue; }
          await client.query(sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, '$1').replace(/COMMIT;\s*$/, ''));
          await client.query('INSERT INTO public.orion_regional_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        }
        await client.query('COMMIT'); console.log('Regional schema and explicit training records committed; existing clinical data preserved.');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    } finally { await client.query('SELECT pg_advisory_unlock(7791324003)'); }
  }
} catch (error) {
  console.error(error instanceof Error && !('severity' in error) ? error.message : 'Regional PostgreSQL operation failed; no SQL or credentials printed.');
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
