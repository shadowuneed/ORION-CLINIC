import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crmSnapshotSchema, type CrmActor } from '../../lib/crm/contracts';

// The operator installs the actual 20-card migration. Every test fixture here
// rolls back in the dedicated, owner-marked PC cluster only.
describe.runIf(process.env.ORION_CRM_PG_TEST === '1')('CRM manual training registry', () => {
  let pool: Pool; let client: PoolClient; let clinic: string; let actor: CrmActor;
  const source = readFileSync(new URL('../../crm/sql/0009_manual_patient_registry.sql', import.meta.url), 'utf8');
  const preflight = source.match(/DO \$\$\r?\nDECLARE actor orion_crm\.actor_grants;[\s\S]*?END \$\$;/)?.[0];
  if (!preflight) throw new Error('Manual registry migration preflight missing');
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated CRM test directory unavailable');
    const base = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
    if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 ||
      resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase()) throw new Error('Dedicated CRM owner marker mismatch');
    const admin = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
    if (admin.host !== '127.0.0.1' || admin.port !== 55432 || typeof admin.user !== 'string' || typeof admin.password !== 'string') throw new Error('Dedicated CRM test configuration mismatch');
    const { password } = admin;
    pool = new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: admin.user,
      password, ssl: false, max: 2, connectionTimeoutMillis: 3000, statement_timeout: 8000, lock_timeout: 3000,
      application_name: 'orion-registry-rollback-tests' });
    const location = await pool.query('SHOW data_directory');
    if (realpathSync(location.rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) {
      await pool.end(); throw new Error('Dedicated CRM directory mismatch');
    }
    if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== 'orion_crm_local') throw new Error('Dedicated CRM database mismatch');
  });
  beforeEach(async () => {
    client = await pool.connect(); await client.query('BEGIN'); clinic = `registry-acceptance-${randomUUID()}`;
    actor = { issuer: 'orion:registry-acceptance', subject: `operator-${randomUUID()}` };
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Training registry acceptance')", [clinic]);
    await client.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')", [clinic]);
    await client.query("INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES('registry-test-operator',$1,$2,$3,'Training fixture operator',true,true)", [clinic, actor.issuer, actor.subject]);
    await client.query(`INSERT INTO orion_crm.patients VALUES
      ($1,'patient-test-1','Тестовый пациент 01','CRM-TEST-0001','male'),
      ($1,'patient-test-2','Тестовый пациент 02','CRM-TEST-0002','female'),
      ($1,'patient-test-3','Тестовый пациент 03','CRM-TEST-0003','unknown'),
      ($1,'patient-test-4','Тестовый пациент 04','CRM-TEST-0004','female'),
      ($1,'patient-test-5','Тестовый пациент 05','CRM-TEST-0005','male'),
      ($1,'patient-test-6','Тестовый пациент 06','CRM-TEST-0006','unknown'),
      ($1,'patient-test-7','Тестовый пациент 07','CRM-TEST-0007','male'),
      ($1,'patient-test-8','Тестовый пациент 08','CRM-TEST-0008','female'),
      ($1,'patient-test-9','Тестовый пациент 09','CRM-TEST-0009','unknown'),
      ($1,'patient-test-10','Тестовый пациент 10','CRM-TEST-0010','female'),
      ($1,'patient-test-11','Тестовый пациент 11','CRM-TEST-0011','male'),
      ($1,'patient-test-12','Тестовый пациент 12','CRM-TEST-0012','unknown')`, [clinic]);
  });
  afterEach(async () => { if (client) { await client.query('ROLLBACK'); client.release(); } });
  afterAll(async () => {
    if (pool) {
      const remaining = await pool.query("SELECT count(*)::int AS total FROM orion_crm.clinics WHERE id LIKE 'registry-acceptance-%'");
      await pool.end(); expect(remaining.rows[0].total).toBe(0);
    }
  });
  async function probe(sql: string, args: unknown[] = [], runtime = false, immediate = false) {
    await client.query('SAVEPOINT registry_probe');
    try {
      if (runtime) await client.query('SET LOCAL ROLE orion_crm_app');
      const result = await client.query(sql, args);
      if (immediate) { await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED'); }
      if (runtime) await client.query('RESET ROLE'); await client.query('RELEASE SAVEPOINT registry_probe'); return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT registry_probe'); if (runtime) await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT registry_probe'); throw error;
    }
  }
  async function capture() {
    await client.query(`INSERT INTO orion_crm.patient_registry_history SELECT clinic_id,id,1,NULL,name,mrn,sex,NULL,
      'synthetic_seed_capture','registry-acceptance-batch','registry-test-operator',clock_timestamp(),
      jsonb_build_object('birthDatePreviouslyRecorded',false) FROM orion_crm.patients WHERE clinic_id=$1`, [clinic]);
  }
  it('refuses original seed data edits before registry writes', async () => {
    const guarded = preflight!.replaceAll("'crm-clinic-local'", `'${clinic}'`).replaceAll("'crm-local-operator'", "'registry-test-operator'");
    await probe(guarded);
    const locks = await client.query(`SELECT mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation='orion_crm.patients'::regclass
      AND granted AND mode='ShareRowExclusiveLock'`);
    expect(locks.rows.length).toBe(1);
    for (const [field, value] of [['name', 'Учебное пользовательское исправление'], ['sex', 'female'], ['mrn', 'CRM-TEST-EDITED']]) {
      await client.query('SAVEPOINT profile_change');
      await client.query(`UPDATE orion_crm.patients SET ${field}=$2 WHERE clinic_id=$1 AND id='patient-test-1'`, [clinic, value]);
      await expect(probe(guarded)).rejects.toMatchObject({ message: 'CRM_MANUAL_REGISTRY_ORIGINAL_PROFILES_CHANGED' });
      expect((await client.query('SELECT count(*)::int AS total FROM orion_crm.patient_registry_history WHERE clinic_id=$1', [clinic])).rows[0].total).toBe(0);
      await client.query('ROLLBACK TO SAVEPOINT profile_change'); await client.query('RELEASE SAVEPOINT profile_change');
    }
  });
  it('captures absent prior DOB and returns the manually stored current profile through the actual RPC', async () => {
    await capture();
    await client.query(`INSERT INTO orion_crm.patient_registry_history VALUES($1,'patient-test-1',2,1,
      'Ерлан Нурланович Садыков','CRM-TEST-0001','male','1984-05-12','manual_training',
      'registry-acceptance-batch','registry-test-operator',clock_timestamp(),jsonb_build_object('fictional',true,'medicalDataImported',false))`, [clinic]);
    await client.query("UPDATE orion_crm.patients SET name='Ерлан Нурланович Садыков' WHERE clinic_id=$1 AND id='patient-test-1'", [clinic]);
    const reply = await probe('SELECT public.orion_crm_snapshot_v1($1,$2) AS result', [actor.issuer, actor.subject], true, true);
    const snapshot = crmSnapshotSchema.parse(reply.rows[0].result);
    expect(snapshot.patients.find(patient => patient.id === 'patient-test-1')).toMatchObject({ name: 'Ерлан Нурланович Садыков',
      birthDate: '1984-05-12', registrationSource: 'manual_training', mrn: 'CRM-TEST-0001' });
    const history = await client.query("SELECT name,sex,birth_date,source,provenance FROM orion_crm.patient_registry_history WHERE clinic_id=$1 AND patient_id='patient-test-1' ORDER BY version", [clinic]);
    expect(history.rows[0]).toMatchObject({ name: 'Тестовый пациент 01', sex: 'male', birth_date: null, source: 'synthetic_seed_capture', provenance: { birthDatePreviouslyRecorded: false } });
    expect(history.rows.length).toBe(2);
  });
  it('preserves immutable linear history and rejects unmatched current-card publication', async () => {
    await capture();
    await expect(probe("UPDATE orion_crm.patient_registry_history SET name='Незаконное изменение' WHERE clinic_id=$1", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe('DELETE FROM orion_crm.patient_registry_history WHERE clinic_id=$1', [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe(`INSERT INTO orion_crm.patient_registry_history SELECT clinic_id,patient_id,3,1,name,mrn,sex,NULL,
      source,batch_id,actor_grant_id,clock_timestamp(),provenance FROM orion_crm.patient_registry_history WHERE clinic_id=$1 AND patient_id='patient-test-1'`, [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe(`INSERT INTO orion_crm.patient_registry_history SELECT clinic_id,patient_id,2,NULL,name,mrn,sex,NULL,
      source,batch_id,actor_grant_id,clock_timestamp(),provenance FROM orion_crm.patient_registry_history WHERE clinic_id=$1 AND patient_id='patient-test-1'`, [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe("UPDATE orion_crm.patients SET name='Несогласованное имя' WHERE clinic_id=$1 AND id='patient-test-1'", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe(`INSERT INTO orion_crm.patient_registry_history VALUES($1,'patient-test-1',2,1,
      'Имя без публикации','CRM-TEST-0001','male','1984-05-12','manual_training','registry-acceptance-batch',
      'registry-test-operator',clock_timestamp(),jsonb_build_object('fictional',true))`, [clinic], false, true)).rejects.toMatchObject({ code: 'PT409' });
  });
  it('keeps registry RLS closed with only two callable RPCs', async () => {
    await expect(probe('SELECT * FROM orion_crm.patient_registry_history', [], true)).rejects.toMatchObject({ code: '42501' });
    const rights = await client.query(`SELECT has_schema_privilege('orion_crm_app','orion_crm','USAGE') AS schema_access,
      has_table_privilege('orion_crm_app','orion_crm.patient_registry_history','SELECT') AS table_access,
      (SELECT relrowsecurity FROM pg_class WHERE oid='orion_crm.patient_registry_history'::regclass) AS rls,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND p.proname LIKE 'orion_crm_%' AND has_function_privilege('orion_crm_app',p.oid,'EXECUTE')) AS functions`);
    expect(rights.rows[0]).toEqual({ schema_access: false, table_access: false, rls: true, functions: 2 });
  });
  it('reads all twenty stored training cards, prior captures and eight planned linked bookings', async () => {
    const realActor = (await client.query("SELECT issuer,subject FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND active AND can_manage")).rows[0];
    const reply = await probe('SELECT public.orion_crm_snapshot_v1($1,$2) AS result', [realActor.issuer, realActor.subject], true);
    const snapshot = crmSnapshotSchema.parse(reply.rows[0].result);
    expect(snapshot.patients.length).toBe(20);
    expect(snapshot.patients.every(patient => patient.registrationSource === 'manual_training' && Boolean(patient.birthDate) && /^CRM-[0-9]{4}$/.test(patient.mrn))).toBe(true);
    expect(snapshot.clinic.name).toBe('ORION Clinic');
    expect(snapshot.staff.every(person => !person.name.startsWith('Тест'))).toBe(true);
    expect(snapshot.services.every(service => !service.name.startsWith('Учебная'))).toBe(true);
    const versions = await client.query(`SELECT source,count(*)::int AS total FROM orion_crm.patient_registry_history
      WHERE clinic_id='crm-clinic-local' GROUP BY source ORDER BY source`);
    expect(versions.rows).toEqual([{ source: 'manual_training', total: 20 }, { source: 'synthetic_seed_capture', total: 12 }]);
    const priorCodes = await client.query("SELECT count(*)::int AS total FROM orion_crm.patient_registry_history WHERE clinic_id='crm-clinic-local' AND version=1 AND source='synthetic_seed_capture' AND mrn LIKE 'CRM-TEST-%' AND birth_date IS NULL");
    expect(priorCodes.rows[0].total).toBe(12);
    const bookings = await client.query(`SELECT h.status,b.source,((h.snapshot->>'scheduled_at')::timestamptz>=seed.created_at+interval '7 days') AS future,
      count(t.id) FILTER (WHERE t.kind='preparation')::int AS tasks FROM orion_crm.command_receipts r JOIN orion_crm.visits v ON v.clinic_id=r.clinic_id AND v.id=r.result->>'resourceId'
      JOIN orion_crm.visit_versions h ON h.clinic_id=v.clinic_id AND h.visit_id=v.id AND h.version=1
      JOIN orion_crm.audit_entries seed ON seed.clinic_id=v.clinic_id AND seed.kind='registry.manual_training'
      JOIN orion_crm.visit_booking b ON b.clinic_id=v.clinic_id AND b.visit_id=v.id LEFT JOIN orion_crm.tasks t ON t.clinic_id=v.clinic_id AND t.visit_id=v.id
      WHERE r.clinic_id='crm-clinic-local' AND r.idempotency_key IN
        ('00900000-0000-4000-8000-000000000013','00900000-0000-4000-8000-000000000014','00900000-0000-4000-8000-000000000015',
         '00900000-0000-4000-8000-000000000016','00900000-0000-4000-8000-000000000017','00900000-0000-4000-8000-000000000018',
         '00900000-0000-4000-8000-000000000019','00900000-0000-4000-8000-000000000020') GROUP BY v.id,b.source,h.status,h.snapshot,seed.created_at`);
    expect(bookings.rows.length).toBe(8);
    expect(bookings.rows.every(row => row.status === 'scheduled' && row.source === 'booking' && row.future && row.tasks >= 1)).toBe(true);
    const batch = await client.query("SELECT payload FROM orion_crm.audit_entries WHERE clinic_id='crm-clinic-local' AND kind='registry.manual_training'");
    expect(batch.rows.length).toBe(1);
    expect(batch.rows[0].payload).toMatchObject({ source: 'manual_training', fictional: true, patients: 20, capturedPriorProfiles: 12, newBookings: 8 });
    const maintenance = await client.query("SELECT payload FROM orion_crm.audit_entries WHERE clinic_id='crm-clinic-local' AND kind='catalogue.normalized'");
    expect(maintenance.rows.length).toBe(1);
    expect(maintenance.rows[0].payload).toMatchObject({ purpose: 'display_names_only', currentCatalogue: { clinic: 'ORION Clinic' } });
    const changes = maintenance.rows[0].payload.taskVersions as { taskId: string; priorVersion: number; currentVersion: number; priorTitle: string; currentTitle: string; status: string }[];
    expect(changes.length > 0).toBe(true);
    for (const change of changes) {
      const history = await client.query('SELECT version,status,snapshot FROM orion_crm.task_versions WHERE clinic_id=$1 AND task_id=$2 AND version IN ($3,$4) ORDER BY version',
        ['crm-clinic-local', change.taskId, change.priorVersion, change.currentVersion]);
      expect(history.rows.length).toBe(2);
      expect(history.rows[0].snapshot.title === change.priorTitle && history.rows[1].snapshot.title === change.currentTitle).toBe(true);
      expect(history.rows[0].status === history.rows[1].status && change.currentVersion === change.priorVersion + 1).toBe(true);
    }
  });
  it('keeps the stage guard restored, normalizes future auto-prep titles and preserves manually written task text', async () => {
    expect((await client.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='orion_crm.tasks'::regclass AND tgname='task_state_guard'")).rows[0].tgenabled).toBe('O');
    await client.query("INSERT INTO orion_crm.rooms VALUES($1,'room','Кабинет','consultation',0,0,4,4)", [clinic]);
    await client.query("INSERT INTO orion_crm.staff VALUES($1,'doctor','Врач','doctor','room')", [clinic]);
    await client.query("INSERT INTO orion_crm.services VALUES($1,'service','Консультация',30,'consultation')", [clinic]);
    const date = (await client.query(`WITH next_day AS (SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '30 days' AS d),
      monday AS (SELECT d+((8-extract(isodow FROM d)::int)%7)*interval '1 day' AS d FROM next_day)
      SELECT orion_crm.iso((d+interval '10 hours') AT TIME ZONE 'Asia/Qyzylorda') AS at FROM monday`)).rows[0].at;
    const command = { type: 'visit.create', patientId: 'patient-test-1', staffId: 'doctor', roomId: 'room', serviceId: 'service',
      scheduledAt: date, testDataAcknowledged: true, idempotencyKey: randomUUID() };
    const created = (await probe('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) AS result',
      [actor.issuer, actor.subject, JSON.stringify(command)], true)).rows[0].result;
    const tasks = await client.query('SELECT id,title FROM orion_crm.tasks WHERE clinic_id=$1 AND visit_id=$2', [clinic, created.resourceId]);
    expect(tasks.rows.length).toBe(1); expect(tasks.rows[0].title).toBe('Подготовка к приёму');
    await expect(probe("UPDATE orion_crm.tasks SET title='Запрещённое прямое исправление',version=version+1 WHERE clinic_id=$1", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    const manual = { type: 'task.create', visitId: created.resourceId, ownerId: 'doctor', kind: 'preparation',
      title: 'Подготовка к тестовому визиту', priority: 'routine', dueAt: date, testDataAcknowledged: true, idempotencyKey: randomUUID() };
    const saved = (await probe('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) AS result',
      [actor.issuer, actor.subject, JSON.stringify(manual)], true, true)).rows[0].result;
    expect((await client.query('SELECT title FROM orion_crm.tasks WHERE clinic_id=$1 AND id=$2', [clinic, saved.resourceId])).rows[0].title).toBe(manual.title);
  });
});
