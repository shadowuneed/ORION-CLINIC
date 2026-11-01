import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crmCommandResultSchema, crmSnapshotSchema, type CrmCommand } from '../../lib/crm/contracts';
import { createCrmPostgresRepository, type CrmPostgresConfig } from '../../scripts/crm-postgres-repository';

// Explicit opt-in targets ONLY the new owner-marked local cluster. No PG* env,
// cloud configuration, clinical D1, password output or database reset. Regular
// ORION_CRM_PG_TEST runs roll back every fixture. The historical persistent
// case requires the separate ORION_CRM_LEGACY_RUNTIME_TEST opt-in too.
describe.runIf(process.env.ORION_CRM_PG_TEST === '1')('CRM actual dedicated PostgreSQL', () => {
  let pool: Pool; let client: PoolClient; let runtime: CrmPostgresConfig;
  let clinic: string; let actor: { issuer: string; subject: string }; let reader: typeof actor;
  let originalTime: string; let secondaryTime: string;
  beforeAll(async () => {
    const base = join(process.env.LOCALAPPDATA ?? '', 'ORION-Clinic-CRM');
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated CRM test directory unavailable');
    const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
    if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 ||
      resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase()) throw new Error('Dedicated CRM owner marker mismatch');
    const admin = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
    if (admin.host !== '127.0.0.1' || admin.port !== 55432 || typeof admin.user !== 'string' || typeof admin.password !== 'string') {
      throw new Error('Dedicated CRM test configuration mismatch');
    }
    const { password } = admin;
    pool = new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: admin.user,
      password, ssl: false, max: 2, connectionTimeoutMillis: 3000, query_timeout: 10000,
      statement_timeout: 8000, lock_timeout: 3000, application_name: 'orion-crm-explicit-tests' });
    const directory = await pool.query('SHOW data_directory');
    if (realpathSync(directory.rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) {
      await pool.end(); throw new Error('Dedicated CRM PostgreSQL directory mismatch');
    }
    const database = await pool.query('SELECT current_database() AS name');
    if (database.rows[0].name !== 'orion_crm_local') throw new Error('Dedicated CRM PostgreSQL target mismatch');
    if (process.env.ORION_CRM_LEGACY_RUNTIME_TEST === '1') runtime = JSON.parse(readFileSync(join(base, 'runtime.json'), 'utf8'));
  });
  beforeEach(async () => {
    client = await pool.connect(); await client.query('BEGIN');
    clinic = `crm-acceptance-${randomUUID()}`;
    actor = { issuer: 'orion:crm-acceptance', subject: `operator-${randomUUID()}` };
    reader = { issuer: actor.issuer, subject: `reader-${randomUUID()}` };
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Synthetic acceptance clinic')", [clinic]);
    await client.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')", [clinic]);
    await client.query(`INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage)
      VALUES('operator',$1,$2,$3,'Synthetic operator',true,true),('reader',$1,$2,$4,'Synthetic reader',true,false)`,
    [clinic, actor.issuer, actor.subject, reader.subject]);
    await client.query("INSERT INTO orion_crm.rooms VALUES($1,'room','Synthetic room','consultation',0,0,4,4)", [clinic]);
    await client.query("INSERT INTO orion_crm.staff VALUES($1,'doctor','Synthetic doctor','doctor','room'),($1,'nurse','Synthetic nurse','nurse','room')", [clinic]);
    await client.query("INSERT INTO orion_crm.services VALUES($1,'service','Synthetic service',30,'consultation')", [clinic]);
    await client.query("INSERT INTO orion_crm.patients VALUES($1,'patient','Synthetic patient','CRM-TEST-ACCEPTANCE','unknown'),($1,'patient-b','Synthetic patient B','CRM-TEST-ACCEPTANCE-B','unknown')", [clinic]);
    const times = await client.query(`WITH next_day AS (SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '30 days' AS d),
      monday AS (SELECT d+((8-extract(isodow FROM d)::int)%7)*interval '1 day' AS d FROM next_day)
      SELECT orion_crm.iso((d+interval '10 hours') AT TIME ZONE 'Asia/Qyzylorda') AS original,
        orion_crm.iso((d+interval '11 hours') AT TIME ZONE 'Asia/Qyzylorda') AS secondary FROM monday`);
    originalTime = times.rows[0].original; secondaryTime = times.rows[0].secondary;
  });
  afterEach(async () => { if (client) { await client.query('ROLLBACK'); client.release(); } });
  afterAll(async () => {
    if (pool) {
      const leftovers = await pool.query("SELECT count(*)::int AS total FROM orion_crm.clinics WHERE id LIKE 'crm-acceptance-%'");
      await pool.end(); expect(leftovers.rows[0].total).toBe(0);
    }
  });

  async function sql(text: string, parameters: unknown[] = [], immediate = false) {
    await client.query('SAVEPOINT probe');
    try {
      const reply = await client.query(text, parameters);
      if (immediate) { await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED'); }
      await client.query('RELEASE SAVEPOINT probe'); return reply;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT probe'); await client.query('RELEASE SAVEPOINT probe'); throw error;
    }
  }
  async function rpc(text: string, parameters: unknown[], immediate = false) {
    await client.query('SAVEPOINT rpc');
    try {
      await client.query('SET LOCAL ROLE orion_crm_app');
      const reply = await client.query(text, parameters);
      if (immediate) { await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED'); }
      await client.query('RESET ROLE'); await client.query('RELEASE SAVEPOINT rpc'); return reply;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT rpc'); await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT rpc'); throw error;
    }
  }
  const create = (patientId = 'patient'): CrmCommand => ({ type: 'visit.create', patientId, staffId: 'doctor',
    roomId: 'room', serviceId: 'service', scheduledAt: patientId === 'patient-b' ? secondaryTime : originalTime,
    testDataAcknowledged: true, idempotencyKey: randomUUID() });
  async function command(body: CrmCommand, principal = actor, immediate = false) {
    const reply = await rpc('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) AS result',
      [principal.issuer, principal.subject, JSON.stringify(body)], immediate);
    return crmCommandResultSchema.parse(reply.rows[0].result);
  }
  async function snapshot(principal = actor) {
    const reply = await rpc('SELECT public.orion_crm_snapshot_v1($1,$2) AS result', [principal.issuer, principal.subject]);
    return crmSnapshotSchema.parse(reply.rows[0].result);
  }
  async function counts() {
    const reply = await client.query(`SELECT (SELECT count(*) FROM orion_crm.visits WHERE clinic_id=$1)::int AS visits,
      (SELECT count(*) FROM orion_crm.tasks WHERE clinic_id=$1)::int AS tasks,
      (SELECT count(*) FROM orion_crm.visit_versions WHERE clinic_id=$1)::int AS versions,
      (SELECT count(*) FROM orion_crm.command_receipts WHERE clinic_id=$1)::int AS receipts,
      (SELECT count(*) FROM orion_crm.audit_entries WHERE clinic_id=$1)::int AS audits`, [clinic]);
    return reply.rows[0];
  }
  it('uses RLS and only two runtime functions; no direct tables/private helpers', async () => {
    const permissions = await client.query(`SELECT count(*)::int AS total,bool_and(c.relrowsecurity) AS all_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='orion_crm' AND c.relkind='r'`);
    expect(permissions.rows[0]).toEqual({ total: 17, all_rls: true });
    await expect(rpc('SELECT * FROM orion_crm.patients', [])).rejects.toMatchObject({ code: '42501' });
    await expect(rpc('SELECT orion_crm.require_actor($1,$2,false)', [actor.issuer, actor.subject])).rejects.toMatchObject({ code: '42501' });
    const functions = await client.query(`SELECT count(*)::int AS total FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'orion_crm_%' AND has_function_privilege('orion_crm_app',p.oid,'EXECUTE')`);
    expect(functions.rows[0].total).toBe(2);
    expect((await snapshot()).capabilities).toEqual({ read: true, manage: true });
  }, 20000);
  it('publishes related visit/task, exact command replay, full lineage and CAS conflict', async () => {
    const body = create(); const created = await command(body);
    expect(created.version).toBe(1); const before = await counts();
    expect(await command(body)).toEqual({ ...created, replayed: true });
    expect(await counts()).toMatchObject({ visits: 1, tasks: 1, versions: 1, receipts: 1, audits: before.audits + 1 });
    await expect(command({ ...body, patientId: 'patient-b' } as CrmCommand)).rejects.toMatchObject({ code: 'PT409', message: 'CRM_IDEMPOTENCY_CONFLICT' });
    const actions = ['arrive', 'queue', 'call', 'start', 'complete'] as const;
    for (let i = 0; i < actions.length; i++) await command({ type: 'visit.transition', visitId: created.resourceId,
      expectedVersion: i + 1, action: actions[i], testDataAcknowledged: true, idempotencyKey: randomUUID() });
    await expect(command({ type: 'visit.transition', visitId: created.resourceId, expectedVersion: 1, action: 'cancel',
      testDataAcknowledged: true, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_VERSION_CONFLICT' });
    const data = await snapshot(); expect(data.visits[0]).toMatchObject({ status: 'completed', version: 6, durationMinutes: 30, bookingSource: 'booking' });
    expect(data.visits[0].queueOrder).toBeGreaterThan(0);
    expect(data.tasks[0]).toMatchObject({ visitId: created.resourceId, patientId: 'patient', status: 'pending', version: 1 });
    expect((await counts()).versions).toBe(6);
  }, 20000);
  it('denies forged/revoked/read-only actors and does not adopt another clinic resource', async () => {
    expect((await snapshot(reader)).capabilities.manage).toBe(false);
    const baseline = await counts();
    await expect(command(create(), reader)).rejects.toMatchObject({ code: 'PT403' });
    await expect(snapshot({ ...actor, subject: 'ungranted' })).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...create(), roomId: 'room-from-another-clinic' } as CrmCommand)).rejects.toMatchObject({ code: 'PT404' });
    expect(await counts()).toEqual(baseline);
    const body = create(); await command(body);
    await client.query("UPDATE orion_crm.actor_grants SET active=false,version=version+1 WHERE clinic_id=$1 AND id='operator'", [clinic]);
    await expect(command(body)).rejects.toMatchObject({ code: 'PT403' });
  }, 20000);
  it('guards service capacity and task transitions without completing tasks through animation', async () => {
    const first = await command(create()); const second = await command(create('patient-b'));
    for (const visit of [first, second]) for (const [i, action] of (['arrive', 'queue'] as const).entries()) {
      await command({ type: 'visit.transition', visitId: visit.resourceId, expectedVersion: i + 1, action,
        testDataAcknowledged: true, idempotencyKey: randomUUID() });
    }
    await command({ type: 'visit.transition', visitId: first.resourceId, expectedVersion: 3, action: 'call',
      testDataAcknowledged: true, idempotencyKey: randomUUID() });
    await command({ type: 'visit.transition', visitId: first.resourceId, expectedVersion: 4, action: 'start',
      testDataAcknowledged: true, idempotencyKey: randomUUID() });
    await expect(command({ type: 'visit.transition', visitId: second.resourceId, expectedVersion: 3, action: 'call',
      testDataAcknowledged: true, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_CAPACITY_CONFLICT' });
    const task = (await snapshot()).tasks[0];
    await expect(command({ type: 'task.transition', taskId: task.id, expectedVersion: 1, action: 'complete',
      testDataAcknowledged: true, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_INVALID_TRANSITION' });
    await command({ type: 'task.transition', taskId: task.id, expectedVersion: 1, action: 'escalate',
      testDataAcknowledged: true, idempotencyKey: randomUUID() });
    expect((await snapshot()).tasks.find(item => item.id === task.id)).toMatchObject({ status: 'escalated', priority: 'urgent', version: 2 });
  }, 20000);
  it('rejects direct history corruption and rolls back commands when audit publication fails', async () => {
    const created = await command(create());
    await expect(sql("UPDATE orion_crm.visit_versions SET status='cancelled' WHERE clinic_id=$1", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(sql(`INSERT INTO orion_crm.visit_versions SELECT clinic_id,visit_id,2,status,snapshot,created_at
      FROM orion_crm.visit_versions WHERE clinic_id=$1 AND visit_id=$2`, [clinic, created.resourceId])).rejects.toMatchObject({ code: 'PT409' });
    await client.query(`CREATE FUNCTION pg_temp.crm_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'CRM_TEST_AUDIT_FAILURE' USING ERRCODE='PT503'; END $$`);
    await client.query(`CREATE TRIGGER crm_acceptance_fail_audit BEFORE INSERT ON orion_crm.audit_entries
      FOR EACH ROW WHEN (NEW.clinic_id='${clinic}') EXECUTE FUNCTION pg_temp.crm_reject_audit()`);
    const baseline = await counts();
    await expect(command({ type: 'visit.transition', visitId: created.resourceId, expectedVersion: 1, action: 'arrive',
      testDataAcknowledged: true, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PT503' });
    expect(await counts()).toEqual(baseline);
    expect((await client.query('SELECT status,version FROM orion_crm.visits WHERE clinic_id=$1', [clinic])).rows[0]).toEqual({ status: 'scheduled', version: 1 });
  }, 20000);
  it('rejects a skipped audit head at commit without publishing a partial command', async () => {
    const created = await command(create());
    await client.query(`CREATE FUNCTION pg_temp.crm_skip_head() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
    await client.query(`CREATE TRIGGER aaa_crm_acceptance_skip_head BEFORE UPDATE ON orion_crm.clinics
      FOR EACH ROW WHEN (NEW.id='${clinic}') EXECUTE FUNCTION pg_temp.crm_skip_head()`);
    const baseline = await counts();
    await expect(command({ type: 'visit.transition', visitId: created.resourceId, expectedVersion: 1, action: 'arrive',
      testDataAcknowledged: true, idempotencyKey: randomUUID() }, actor, true)).rejects.toMatchObject({ code: 'PT503' });
    expect(await counts()).toEqual(baseline);
  }, 20000);
  it.runIf(process.env.ORION_CRM_LEGACY_RUNTIME_TEST === '1')('actual runtime connection persists a new synthetic visit and gives one CAS winner across clients', async () => {
    const owner = await client.query("SELECT issuer,subject FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND active AND can_manage");
    const principal = owner.rows[0]; if (!principal) throw new Error('Explicit local simulation operator required');
    const repository = createCrmPostgresRepository(runtime);
    try {
      const before = await repository.snapshot(principal);
      const person = before.staff.find(staff => staff.role === 'doctor');
      const service = before.services.find(service => service.roomKind === before.rooms.find(room => room.id === person?.roomId)?.kind);
      if (!person || !service || !before.patients[0]) throw new Error('Explicit synthetic CRM seed required');
      const created = await repository.command(principal, { type: 'visit.create', patientId: before.patients[0].id,
        staffId: person.id, roomId: person.roomId, serviceId: service.id, scheduledAt: originalTime,
        testDataAcknowledged: true, idempotencyKey: randomUUID() });
      const left: CrmCommand = { type: 'visit.transition', visitId: created.resourceId, expectedVersion: 1,
        action: 'arrive', testDataAcknowledged: true, idempotencyKey: randomUUID() };
      const results = await Promise.allSettled([repository.command(principal, left), repository.command(principal, { ...left, idempotencyKey: randomUUID() })]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejection.reason).toMatchObject({ code: 'CRM_VERSION_CONFLICT', status: 409 });
      await repository.close();
      const reopened = createCrmPostgresRepository(runtime);
      try { expect((await reopened.snapshot(principal)).visits.find(visit => visit.id === created.resourceId)).toMatchObject({ status: 'arrived', version: 2 }); }
      finally { await reopened.close(); }
      // Deliberately retains this new, labelled synthetic visit/task and its audit.
    } finally { await repository.close(); }
  }, 30000);
});
