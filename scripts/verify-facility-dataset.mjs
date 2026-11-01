/** Rollback-only checks, confined to this PC's owned PostgreSQL cluster. */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const mode = process.argv[2];
if (!['dry-run', 'verify'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: verify-facility-dataset.mjs dry-run|verify');
if (!process.env.LOCALAPPDATA) throw new Error('Dedicated PC runtime required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
const data = join(runtime, 'data');
const marker = JSON.parse(readFileSync(join(runtime, 'cluster-owner.json'), 'utf8'));
if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 || resolve(marker.data).toLowerCase() !== resolve(data).toLowerCase()) throw new Error('Owned PostgreSQL marker required');
const admin = JSON.parse(readFileSync(join(runtime, 'admin.json'), 'utf8'));
if (admin.host !== '127.0.0.1' || admin.port !== 55432 || admin.user !== 'postgres' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) throw new Error('Invalid dedicated PC configuration');
const { password } = admin;
const client = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password,
  database: 'orion_crm_local', ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 60000, lock_timeout: 5000 });
function body(sql, ending) {
  const withoutBegin = sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, '$1');
  if (withoutBegin === sql || !new RegExp(`${ending};\\s*$`).test(withoutBegin)) throw new Error('Expected transaction-wrapped SQL');
  return withoutBegin.replace(new RegExp(`${ending};\\s*$`), '');
}
// All before/after fingerprints stay inside PostgreSQL. No patient values,
// credential hashes, account names or statement text are returned or logged.
const captureExisting = `
CREATE TEMP TABLE dataset_existing_rows(table_oid oid,table_name text,hashes jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; h jsonb; BEGIN
  FOR r IN SELECT c.oid,n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('orion_crm','orion_region','orion_directory','orion_clinical') AND c.relkind='r' ORDER BY c.oid LOOP
    EXECUTE format('SELECT coalesce(jsonb_object_agg(d,n),''{}''::jsonb) FROM (SELECT md5(to_jsonb(t)::text) d,count(*) n FROM %s t GROUP BY 1) x',r.oid::regclass) INTO h;
    INSERT INTO dataset_existing_rows VALUES(r.oid,r.name,h);
  END LOOP;
END $$;`;
const checkExisting = `
DO $$ DECLARE r record; h jsonb; BEGIN
  FOR r IN SELECT * FROM dataset_existing_rows ORDER BY table_oid LOOP
    EXECUTE format('SELECT coalesce(jsonb_object_agg(d,n),''{}''::jsonb) FROM (SELECT md5(to_jsonb(t)::text) d,count(*) n FROM %s t GROUP BY 1) x',r.table_oid::regclass) INTO h;
    IF EXISTS(SELECT 1 FROM jsonb_each(r.hashes) x WHERE coalesce((h->>x.key)::bigint,0)<x.value::bigint) THEN
      RAISE EXCEPTION 'FACILITY_DATASET_CHECK_FAILED: Existing rows were changed or removed'; END IF;
    IF r.table_name<>ALL(ARRAY['orion_crm.patients','orion_region.patient_details','orion_region.conditions','orion_region.patient_history',
      'orion_region.visits','orion_region.work_tasks','orion_region.labs','orion_region.stocks']) AND r.hashes<>h THEN
      RAISE EXCEPTION 'FACILITY_DATASET_CHECK_FAILED: Import wrote outside allowed source tables'; END IF;
  END LOOP;
END $$;`;
let phase = 'connect'; let statement = ''; let manifest; let preservationChecked = false; let nonemptyInstitutionChecked = false;
try {
  await client.connect();
  if (realpathSync((await client.query('SHOW data_directory')).rows[0].data_directory).toLowerCase() !== realpathSync(data).toLowerCase() ||
    (await client.query('SELECT current_database() n')).rows[0].n !== 'orion_crm_local') throw new Error('Wrong PostgreSQL target');
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(7791324006)');
  if (mode === 'dry-run') {
    if ((await client.query("SELECT to_regclass('orion_region.training_datasets') IS NOT NULL installed")).rows[0].installed) throw new Error('Migration already installed; use verify');
    phase = 'capture-existing'; await client.query(captureExisting);
    // An existing canonical patient without regional details must still cause
    // the entire institution to be skipped, not overwritten or half-filled.
    phase = 'nonempty-institution'; await client.query('SAVEPOINT nonempty_institution');
    const control = await client.query(`INSERT INTO orion_crm.patients(clinic_id,id,name,mrn,sex)
      SELECT 'region-baydibek-hospital','dataset-existing-control','Existing control person','ORION-0000000000000000','male'
      WHERE NOT EXISTS(SELECT 1 FROM orion_crm.patients WHERE clinic_id='region-baydibek-hospital') RETURNING id`);
    if (control.rowCount !== 1) throw new Error('FACILITY_DATASET_CHECK_FAILED: Empty control institution required for dry run');
    statement = body(readFileSync(join(root, 'db/regional/0006_facility_dataset.sql'), 'utf8'), 'COMMIT');
    await client.query(statement);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM orion_region.training_datasets WHERE manifest->'skippedNonemptyFacilityIds' @> '["baydibek-hospital"]'::jsonb) OR
        EXISTS(SELECT 1 FROM orion_region.training_dataset_patients WHERE facility_id='baydibek-hospital') OR
        EXISTS(SELECT 1 FROM orion_region.work_tasks WHERE clinic_id='region-baydibek-hospital' AND id LIKE 'dataset-20261009-%') OR
        EXISTS(SELECT 1 FROM orion_region.stocks WHERE clinic_id='region-baydibek-hospital' AND id LIKE 'dataset-20261009-%') OR
        (SELECT count(*) FROM orion_crm.patients WHERE clinic_id='region-baydibek-hospital')<>1 OR
        NOT EXISTS(SELECT 1 FROM orion_crm.patients WHERE clinic_id='region-baydibek-hospital' AND id='dataset-existing-control' AND name='Existing control person')
      THEN RAISE EXCEPTION 'FACILITY_DATASET_CHECK_FAILED: Nonempty institution was not preserved'; END IF;
    END $$;`);
    nonemptyInstitutionChecked = true;
    await client.query('ROLLBACK TO SAVEPOINT nonempty_institution');
    phase = 'migration'; statement = body(readFileSync(join(root, 'db/regional/0006_facility_dataset.sql'), 'utf8'), 'COMMIT');
    await client.query(statement);
    phase = 'preserve-existing'; await client.query(checkExisting); preservationChecked = true;
  }
  for (const file of ['facility-dataset-rollback.sql']) {
    phase = file; statement = body(readFileSync(join(root, 'db/regional', file), 'utf8'), 'ROLLBACK');
    await client.query(statement);
  }
  manifest = (await client.query("SELECT manifest FROM orion_region.training_datasets WHERE id='regional-live-records-20261009-v1'")).rows[0]?.manifest;
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ mode, passed: true, rolledBack: true, preservationChecked, nonemptyInstitutionChecked, manifest,
    sequenceNote: 'Queue sequence allocation can leave unused gaps after rollback; existing values are never reset.' }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  const safeDiagnostic = error instanceof Error && (/^FACILITY_DATASET_CHECK_FAILED: [a-zA-Z0-9 ,:()_-]+$/.test(error.message) || /^column reference "[A-Za-z_][A-Za-z0-9_]*" is ambiguous$/.test(error.message) || /^syntax error at (?:end of input|or near "[A-Za-z_(),;$=]+")$/.test(error.message));
  const label = safeDiagnostic ? error.message : error?.code === '42601' ? error.message.replace(/"[^"]*"|'[^']*'/g, '[token]').slice(0, 180) : 'Facility dataset verification failed';
  const position = typeof error?.position === 'string' && /^\d+$/.test(error.position) ? Number(error.position) : undefined;
  console.error(JSON.stringify({ passed: false, phase, message: label, line: position ? statement.slice(0, position - 1).split('\n').length : undefined,
    sqlState: typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined }));
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
