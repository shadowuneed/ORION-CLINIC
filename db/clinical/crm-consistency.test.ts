import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { crmSnapshotSchema } from '../../lib/crm/contracts';

describe.runIf(process.env.ORION_CLINICAL_PG_TEST === '1')('CRM / clinical consistency in PostgreSQL', () => {
  let db: Client; let clinic: string; let patient: string; let visit: string;
  const issuer = 'orion:consistency-rollback';
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Local runtime required');
    const base = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
    const config = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
    if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 || resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase() ||
      config.host !== '127.0.0.1' || config.port !== 55432 || config.user !== 'postgres') throw new Error('Owned local cluster required');
    const { password } = config;
    db = new Client({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'postgres', password, ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 15000 });
    await db.connect();
    expect(realpathSync((await db.query('SHOW data_directory')).rows[0].data_directory)).toBe(realpathSync(marker.data));
    await db.query('BEGIN');
    const hasLedger = Boolean((await db.query("SELECT to_regclass('public.orion_clinical_migrations') present")).rows[0].present);
    const applied = hasLedger && Boolean((await db.query("SELECT 1 FROM public.orion_clinical_migrations WHERE name IN ('0003_crm_encounter_consistency.sql','0004_exact_visit_and_recipient.sql')")).rowCount);
    const hasNewerGuard = Boolean((await db.query("SELECT to_regprocedure('orion_clinical.is_current_recipient(text,text)') present")).rows[0].present);
    if (!applied && !hasNewerGuard) {
      const top = new URL('./0003_crm_encounter_consistency.sql', import.meta.url);
      const sql = readFileSync(existsSync(top) ? top : new URL('./drafts/0003_crm_encounter_consistency.sql', import.meta.url), 'utf8').replace(/\bBEGIN;/, '').replace(/COMMIT;\s*$/, '');
      await db.query(sql);
    }
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK'); await db.end(); } });
  beforeEach(async () => {
    await db.query('SAVEPOINT consistency_case');
    clinic = `consistency-${randomUUID()}`; patient = 'patient'; visit = 'visit';
    await db.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Rollback clinic')", [clinic]);
    await db.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')", [clinic]);
    await db.query("INSERT INTO orion_crm.rooms VALUES($1,'room','Room','consultation',0,0,4,4)", [clinic]);
    await db.query("INSERT INTO orion_crm.staff VALUES($1,'doctor','Clinician','doctor','room')", [clinic]);
    await db.query("INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES('grant',$1,$2,$1,'Clinician',true,true)", [clinic, issuer]);
    await db.query("INSERT INTO orion_clinical.practitioners VALUES($1,'practitioner','doctor',$2,$1,'Clinician','General medicine',true,clock_timestamp(),'rollback fixture')", [clinic, issuer]);
    if ((await db.query("SELECT 1 FROM pg_namespace WHERE nspname='orion_directory'")).rowCount) {
      await db.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$1,'Rollback clinician','active','postgres')", [clinic, issuer]);
      await db.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES($1,'member',$1,'active')", [clinic]);
      await db.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,'assignment','member',ARRAY['doctor'],'active',clock_timestamp()-interval '1 day')", [clinic]);
    }
    await db.query("INSERT INTO orion_crm.services VALUES($1,'service','Consultation',30,'consultation')", [clinic]);
    await db.query("INSERT INTO orion_crm.patients VALUES($1,$2,'Patient','CRM-9000','unknown')", [clinic, patient]);
    const scheduledAt = (await db.query("WITH d AS (SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '30 days' t) SELECT orion_crm.iso((t+((8-extract(isodow FROM t)::int)%7)*interval '1 day'+interval '10 hours') AT TIME ZONE 'Asia/Qyzylorda') t FROM d")).rows[0].t;
    const saved = (await db.query('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) result', [issuer, clinic, JSON.stringify({ type: 'visit.create', patientId: patient, staffId: 'doctor', roomId: 'room', serviceId: 'service', scheduledAt, testDataAcknowledged: true, idempotencyKey: randomUUID() })])).rows[0].result;
    visit = saved.resourceId;
  });
  afterEach(async () => { await db.query('ROLLBACK TO SAVEPOINT consistency_case'); await db.query('RELEASE SAVEPOINT consistency_case'); });
  async function call(name: string, body?: Record<string, unknown>) {
    await db.query('SAVEPOINT consistency_probe');
    try {
      await db.query('SET LOCAL ROLE orion_crm_app');
      const result = await db.query(`SELECT public.${name}($1,$2${body ? ',$3::jsonb' : ''}) result`, body ? [issuer, clinic, JSON.stringify({ ...body, idempotencyKey: randomUUID() })] : [issuer, clinic]);
      await db.query('RESET ROLE'); await db.query('RELEASE SAVEPOINT consistency_probe'); return result.rows[0].result;
    } catch (error) { await db.query('ROLLBACK TO SAVEPOINT consistency_probe'); await db.query('RESET ROLE'); await db.query('RELEASE SAVEPOINT consistency_probe'); throw error; }
  }
  it.each(['start', 'complete'])('does not allow direct CRM %s to replace the clinical workflow', async action => {
    await expect(call('orion_clinical_crm_command_v1', { type: 'visit.transition', visitId: visit, expectedVersion: 1, action, testDataAcknowledged: true })).rejects.toMatchObject({ message: 'CRM_CLINICAL_WORKFLOW_REQUIRED' });
    expect((await db.query('SELECT status FROM orion_crm.visits WHERE clinic_id=$1 AND id=$2', [clinic, visit])).rows[0].status).toBe('scheduled');
  });
  it('does not orphan a running clinical encounter by cancelling or requeueing its CRM visit', async () => {
    await db.query("INSERT INTO orion_clinical.encounters(clinic_id,id,patient_id,practitioner_id,visit_id,status) VALUES($1,'encounter',$2,'practitioner',$3,'in_progress')", [clinic, patient, visit]);
    for (const action of ['cancel', 'requeue', 'mark_no_show']) {
      await expect(call('orion_clinical_crm_command_v1', { type: 'visit.transition', visitId: visit, expectedVersion: 1, action, testDataAcknowledged: true })).rejects.toMatchObject({ message: 'CRM_CLINICAL_WORKFLOW_REQUIRED' });
    }
  });
  it('projects a newly registered patient and birth date into the same CRM registry', async () => {
    const result = await call('orion_clinical_command_v1', { type: 'patient.register', name: 'Manually entered fixture', birthDate: '2000-01-02', sex: 'female' });
    const snapshot = crmSnapshotSchema.parse(await call('orion_clinical_crm_snapshot_v1'));
    expect(snapshot.patients.find(p => p.id === result.resourceId)).toMatchObject({ birthDate: '2000-01-02', sex: 'female' });
    expect(snapshot.capabilities.staffId).toBe('doctor');
  });
});
