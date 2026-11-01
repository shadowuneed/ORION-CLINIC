import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crmSnapshotSchema, type CrmActor } from '../../lib/crm/contracts';

describe.runIf(process.env.ORION_CRM_PG_TEST === '1')('CRM persisted building layout', () => {
  let pool: Pool; let client: PoolClient; let clinic: string; let actor: CrmActor;
  const source = readFileSync(new URL('../../crm/sql/0011_clinic_buildings.sql', import.meta.url), 'utf8');
  const preflight = source.match(/DO \$\$ BEGIN\r?\n  PERFORM 1 FROM orion_crm\.clinics[\s\S]*?END \$\$;/)?.[0];
  if (!preflight) throw new Error('Building preflight missing');
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated CRM test directory unavailable');
    const base = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
    const admin = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
    if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 || resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase() ||
      admin.host !== '127.0.0.1' || admin.port !== 55432 || typeof admin.user !== 'string' || typeof admin.password !== 'string') throw new Error('Dedicated CRM target mismatch');
    const { password } = admin;
    pool = new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: admin.user,
      password, ssl: false, max: 2, connectionTimeoutMillis: 3000, statement_timeout: 8000, application_name: 'orion-buildings-rollback-tests' });
    const location = await pool.query('SHOW data_directory');
    if (realpathSync(location.rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) {
      await pool.end(); throw new Error('Dedicated CRM directory mismatch');
    }
    if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== 'orion_crm_local') throw new Error('Dedicated CRM database mismatch');
  });
  beforeEach(async () => {
    client = await pool.connect(); await client.query('BEGIN'); clinic = `buildings-acceptance-${randomUUID()}`;
    actor = { issuer: 'orion:buildings-acceptance', subject: `operator-${randomUUID()}` };
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'ORION Clinic')", [clinic]);
    await client.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')", [clinic]);
    await client.query("INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES('buildings-operator',$1,$2,$3,'Layout operator',true,true)", [clinic, actor.issuer, actor.subject]);
    await client.query(`INSERT INTO orion_crm.rooms VALUES
      ($1,'room-reception','Регистратура','reception',0,0,5,4),($1,'room-consultation-a','Кабинет 101','consultation',6,0,5,4),
      ($1,'room-consultation-b','Кабинет 102','consultation',12,0,5,4),($1,'room-diagnostics','Диагностика','diagnostics',0,6,5,5),
      ($1,'room-treatment','Процедурная','treatment',6,6,5,5),($1,'room-staff','Комната команды','staff',12,6,5,5)`, [clinic]);
  });
  afterEach(async () => { if (client) { await client.query('ROLLBACK'); client.release(); } });
  afterAll(async () => {
    if (pool) {
      const leftovers = await pool.query("SELECT count(*)::int AS total FROM orion_crm.clinics WHERE id LIKE 'buildings-acceptance-%'");
      await pool.end(); expect(leftovers.rows[0].total).toBe(0);
    }
  });
  async function probe(sql: string, args: unknown[] = [], runtime = false, immediate = false) {
    await client.query('SAVEPOINT layout_probe');
    try {
      if (runtime) await client.query('SET LOCAL ROLE orion_crm_app');
      const result = await client.query(sql, args);
      if (immediate) { await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED'); }
      if (runtime) await client.query('RESET ROLE'); await client.query('RELEASE SAVEPOINT layout_probe'); return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT layout_probe'); if (runtime) await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT layout_probe'); throw error;
    }
  }
  async function snapshot(principal = actor) {
    return crmSnapshotSchema.parse((await probe('SELECT public.orion_crm_snapshot_v1($1,$2) AS result', [principal.issuer, principal.subject], true)).rows[0].result);
  }
  it('validates exact original room layout and preserves legacy no-building fixture responses', async () => {
    const guard = preflight!.replaceAll("'crm-clinic-local'", `'${clinic}'`).replaceAll("'crm-local-operator'", "'buildings-operator'");
    await probe(guard); expect((await snapshot()).buildings).toBeUndefined();
    await client.query("UPDATE orion_crm.rooms SET x=1 WHERE clinic_id=$1 AND id='room-reception'", [clinic]);
    await expect(probe(guard)).rejects.toMatchObject({ message: 'CRM_BUILDINGS_ORIGINAL_ROOMS_CHANGED' });
    expect((await client.query('SELECT count(*)::int AS total FROM orion_crm.buildings WHERE clinic_id=$1', [clinic])).rows[0].total).toBe(0);
  });
  it('enforces scoped mapping, bounds, immutability and closed runtime access', async () => {
    await client.query("INSERT INTO orion_crm.buildings VALUES($1,'main','Основной корпус',0,0,17,11),($1,'other','Корпус Б',28,0,17,11)", [clinic]);
    await expect(probe("INSERT INTO orion_crm.room_buildings VALUES($1,'room-reception','other')", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe("INSERT INTO orion_crm.room_buildings VALUES($1,'room-reception','unknown')", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(snapshot()).rejects.toMatchObject({ code: 'PT503' });
    await client.query("INSERT INTO orion_crm.room_buildings SELECT clinic_id,id,'main' FROM orion_crm.rooms WHERE clinic_id=$1", [clinic]);
    expect((await snapshot()).rooms.every(room => room.buildingId === 'main')).toBe(true);
    await expect(probe('UPDATE orion_crm.buildings SET x=1 WHERE clinic_id=$1', [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe('DELETE FROM orion_crm.room_buildings WHERE clinic_id=$1', [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe('SELECT * FROM orion_crm.buildings', [], true)).rejects.toMatchObject({ code: '42501' });
    const security = await client.query(`SELECT count(*)::int AS total,bool_and(relrowsecurity) AS rls FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='orion_crm' AND c.relkind='r'`);
    expect(security.rows[0]).toEqual({ total: 17, rls: true });
  });
  it('reads the two persisted buildings and books a compatible second-building room without inventing its queue', async () => {
    const main = (await client.query("SELECT issuer,subject FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND active AND can_manage")).rows[0];
    const actual = await snapshot(main); expect(actual.buildings?.length).toBe(2); expect(actual.rooms.length).toBe(12);
    expect(actual.staff.length).toBe(12); expect(actual.services.length).toBe(6);
    expect(actual.rooms.filter(room => room.buildingId === 'building-outpatient').length).toBe(6);
    const date = (await client.query(`WITH day AS(SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '60 days' AS d),
      monday AS(SELECT d+((8-extract(isodow FROM d)::int)%7)*interval '1 day' AS d FROM day)
      SELECT orion_crm.iso((d+interval '10 hours') AT TIME ZONE 'Asia/Qyzylorda') AS at FROM monday`)).rows[0].at;
    const command = { type: 'visit.create', patientId: actual.patients[0].id, staffId: 'staff-diagnostics-b', roomId: 'room-diagnostics-b',
      serviceId: 'service-ultrasound', scheduledAt: date, testDataAcknowledged: true, idempotencyKey: randomUUID() };
    const created = (await probe('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) AS result', [main.issuer, main.subject, JSON.stringify(command)], true, true)).rows[0].result;
    const booked = await snapshot(main); const visit = booked.visits.find(visit => visit.id === created.resourceId);
    expect(visit).toMatchObject({ roomId: 'room-diagnostics-b', staffId: 'staff-diagnostics-b', serviceId: 'service-ultrasound', durationMinutes: 20, status: 'scheduled' });
    expect(visit?.queuedAt).toBeNull(); expect(visit?.calledAt).toBeNull();
    expect((await client.query("SELECT payload FROM orion_crm.audit_entries WHERE clinic_id='crm-clinic-local' AND kind='buildings.added'")).rows[0].payload)
      .toMatchObject({ existingAssignmentsMoved: false, visitsCreated: 0 });
  });
});
