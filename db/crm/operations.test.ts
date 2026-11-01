import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crmCommandResultSchema, crmSnapshotSchema, type CrmActor, type CrmCommand } from '../../lib/crm/contracts';

// Only explicit owner-marked PC simulation PostgreSQL. Every new fixture and
// fault-injection DDL is rolled back; no legacy credentials/database/env reads.
describe.runIf(process.env.ORION_CRM_PG_TEST === '1')('CRM-2 actual PostgreSQL operations', () => {
  let pool: Pool; let client: PoolClient; let clinic: string; let actor: CrmActor; let reader: CrmActor;
  let originalTime: string; let movedTime: string; let laterTime: string;
  const acknowledgment = () => ({ testDataAcknowledged: true as const, idempotencyKey: randomUUID() });
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated CRM test directory unavailable');
    const base = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
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
      statement_timeout: 8000, lock_timeout: 3000, application_name: 'orion-crm2-explicit-tests' });
    const directory = await pool.query('SHOW data_directory');
    if (realpathSync(directory.rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) {
      await pool.end(); throw new Error('Dedicated CRM PostgreSQL directory mismatch');
    }
    const target = await pool.query('SELECT current_database() AS name');
    if (target.rows[0].name !== 'orion_crm_local') throw new Error('Dedicated CRM PostgreSQL target mismatch');
  });
  beforeEach(async () => {
    client = await pool.connect(); await client.query('BEGIN');
    clinic = `crm2-acceptance-${randomUUID()}`;
    actor = { issuer: 'orion:crm2-acceptance', subject: `operator-${randomUUID()}` };
    reader = { issuer: actor.issuer, subject: `reader-${randomUUID()}` };
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Synthetic CRM2 acceptance clinic')", [clinic]);
    await client.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')", [clinic]);
    await client.query(`INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage)
      VALUES('crm2-operator',$1,$2,$3,'Synthetic operator',true,true),('crm2-reader',$1,$2,$4,'Synthetic reader',true,false)`,
    [clinic, actor.issuer, actor.subject, reader.subject]);
    await client.query("INSERT INTO orion_crm.rooms VALUES($1,'room','Synthetic consultation','consultation',0,0,4,4)", [clinic]);
    await client.query("INSERT INTO orion_crm.staff VALUES($1,'doctor','Synthetic doctor','doctor','room'),($1,'nurse','Synthetic nurse','nurse','room')", [clinic]);
    await client.query("INSERT INTO orion_crm.services VALUES($1,'service','Synthetic service',30,'consultation')", [clinic]);
    await client.query("INSERT INTO orion_crm.patients VALUES($1,'patient','Synthetic patient','CRM-TEST-CRM2','unknown')", [clinic]);
    const times = await client.query(`WITH next_day AS (SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '30 days' AS d),
      monday AS (SELECT d+((8-extract(isodow FROM d)::int)%7)*interval '1 day' AS d FROM next_day)
      SELECT orion_crm.iso((d+interval '10 hours') AT TIME ZONE 'Asia/Qyzylorda') AS original,
        orion_crm.iso((d+interval '11 hours') AT TIME ZONE 'Asia/Qyzylorda') AS moved,
        orion_crm.iso((d+interval '12 hours') AT TIME ZONE 'Asia/Qyzylorda') AS later FROM monday`);
    originalTime = times.rows[0].original; movedTime = times.rows[0].moved; laterTime = times.rows[0].later;
  });
  afterEach(async () => { if (client) { await client.query('ROLLBACK'); client.release(); } });
  afterAll(async () => {
    if (pool) {
      const leftovers = await pool.query("SELECT count(*)::int AS total FROM orion_crm.clinics WHERE id LIKE 'crm2-acceptance-%'");
      await pool.end(); expect(leftovers.rows[0].total).toBe(0);
    }
  });
  async function probe(query: string, params: unknown[] = [], runtime = false, immediate = false) {
    await client.query('SAVEPOINT crm2_probe');
    try {
      if (runtime) await client.query('SET LOCAL ROLE orion_crm_app');
      const response = await client.query(query, params);
      if (immediate) {
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        await client.query('SET CONSTRAINTS ALL DEFERRED');
      }
      if (runtime) await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT crm2_probe'); return response;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT crm2_probe');
      if (runtime) await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT crm2_probe'); throw error;
    }
  }
  async function command(body: unknown, principal = actor, immediate = false) {
    const result = await probe('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) AS result',
      [principal.issuer, principal.subject, JSON.stringify(body)], true, immediate);
    return crmCommandResultSchema.parse(result.rows[0].result);
  }
  async function snapshot(principal = actor) {
    const result = await probe('SELECT public.orion_crm_snapshot_v1($1,$2) AS result', [principal.issuer, principal.subject], true);
    return crmSnapshotSchema.parse(result.rows[0].result);
  }
  const create = (): CrmCommand => ({ type: 'visit.create', patientId: 'patient', staffId: 'doctor', roomId: 'room',
    serviceId: 'service', scheduledAt: originalTime, ...acknowledgment() });
  const reschedule = (visitId: string, expectedVersion = 1): CrmCommand => ({ type: 'visit.reschedule', visitId,
    expectedVersion, scheduledAt: movedTime, ...acknowledgment() });
  const newTask = (visitId: string): Extract<CrmCommand, { type: 'task.create' }> => ({ type: 'task.create', visitId,
    ownerId: 'nurse', kind: 'follow_up', title: 'Проверить учебный визит после консультации', priority: 'urgent', dueAt: movedTime, ...acknowledgment() });
  async function counts() {
    const result = await client.query(`SELECT (SELECT count(*) FROM orion_crm.tasks WHERE clinic_id=$1)::int AS tasks,
      (SELECT count(*) FROM orion_crm.visit_versions WHERE clinic_id=$1)::int AS visit_versions,
      (SELECT count(*) FROM orion_crm.task_versions WHERE clinic_id=$1)::int AS task_versions,
      (SELECT count(*) FROM orion_crm.command_receipts WHERE clinic_id=$1)::int AS receipts,
      (SELECT count(*) FROM orion_crm.audit_entries WHERE clinic_id=$1)::int AS audits`, [clinic]);
    return result.rows[0];
  }
  it('creates a real visit-linked task with server-selected patient and exact replay', async () => {
    const visit = await command(create()); const body = newTask(visit.resourceId); const result = await command(body, actor, true);
    const afterCreate = await counts();
    expect(await command(body)).toEqual({ ...result, replayed: true });
    expect(await counts()).toEqual({ ...afterCreate, audits: afterCreate.audits + 1 });
    const data = await snapshot();
    expect(data.tasks.find(task => task.id === result.resourceId)).toMatchObject({ patientId: 'patient', visitId: visit.resourceId,
      ownerId: 'nurse', kind: 'follow_up', title: body.title, priority: 'urgent', dueAt: movedTime, status: 'pending', version: 1 });
    await expect(command({ ...body, title: 'Другое тело команды' })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_IDEMPOTENCY_CONFLICT' });
    await expect(command({ ...body, patientId: 'injected-patient' })).rejects.toMatchObject({ code: 'PT400', message: 'CRM_INVALID_COMMAND' });
  });
  it('reschedules only the visit, preserving prior version and existing task deadlines', async () => {
    const visit = await command(create()); const body = reschedule(visit.resourceId); const result = await command(body, actor, true);
    expect(result).toEqual({ resourceId: visit.resourceId, version: 2, replayed: false });
    expect(await command(body)).toEqual({ ...result, replayed: true });
    const data = await snapshot();
    expect(data.visits[0]).toMatchObject({ scheduledAt: movedTime, status: 'scheduled', version: 2, durationMinutes: 30, bookingSource: 'booking' });
    expect(data.tasks[0].dueAt).toBe(originalTime);
    expect(data.events.find(event => event.kind === 'visit.rescheduled')).toMatchObject({ resourceId: visit.resourceId,
      fromStatus: 'scheduled', toStatus: 'scheduled', actorLabel: 'Synthetic operator' });
    const versions = await client.query("SELECT version,orion_crm.iso((snapshot->>'scheduled_at')::timestamptz) AS at FROM orion_crm.visit_versions WHERE clinic_id=$1 ORDER BY version", [clinic]);
    expect(versions.rows).toEqual([{ version: 1, at: originalTime }, { version: 2, at: movedTime }]);
    await expect(command(reschedule(visit.resourceId))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_VERSION_CONFLICT' });
    await expect(command(reschedule(visit.resourceId, 2))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_INVALID_TRANSITION' });
    await command({ type: 'visit.transition', visitId: visit.resourceId, expectedVersion: 2, action: 'arrive', ...acknowledgment() });
    await expect(command({ ...reschedule(visit.resourceId, 3), scheduledAt: laterTime })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_INVALID_TRANSITION' });
  });
  it('allows explicit manual review of escalated tasks, retaining urgent priority and lineage', async () => {
    const visit = await command(create()); const task = await command(newTask(visit.resourceId));
    await command({ type: 'task.transition', taskId: task.resourceId, expectedVersion: 1, action: 'escalate', ...acknowledgment() });
    await expect(command({ type: 'task.transition', taskId: task.resourceId, expectedVersion: 2, action: 'complete', ...acknowledgment() })).rejects.toMatchObject({ code: 'PT409' });
    await command({ type: 'task.transition', taskId: task.resourceId, expectedVersion: 2, action: 'start', ...acknowledgment() });
    await command({ type: 'task.transition', taskId: task.resourceId, expectedVersion: 3, action: 'complete', ...acknowledgment() }, actor, true);
    const data = await snapshot(); expect(data.tasks.find(row => row.id === task.resourceId)).toMatchObject({ status: 'completed', priority: 'urgent', version: 4 });
    const history = await client.query('SELECT status FROM orion_crm.task_versions WHERE clinic_id=$1 AND task_id=$2 ORDER BY version', [clinic, task.resourceId]);
    expect(history.rows.map(row => row.status)).toEqual(['pending', 'escalated', 'in_progress', 'completed']);
  });
  it('denies new operations for read-only, unknown or revoked actors and cross-clinic resources', async () => {
    const visit = await command(create()); const task = newTask(visit.resourceId); const move = reschedule(visit.resourceId);
    const baseline = await counts();
    for (const body of [task, move]) {
      await expect(command(body, reader)).rejects.toMatchObject({ code: 'PT403' });
      await expect(command(body, { ...actor, subject: 'ungranted' })).rejects.toMatchObject({ code: 'PT403' });
    }
    await expect(command({ ...task, ownerId: 'other-clinic-staff' })).rejects.toMatchObject({ code: 'PT404' });
    await expect(command({ ...task, visitId: 'other-clinic-visit' })).rejects.toMatchObject({ code: 'PT404' });
    await expect(command({ ...move, visitId: 'other-clinic-visit' })).rejects.toMatchObject({ code: 'PT404' });
    expect(await counts()).toEqual(baseline);
    await command(task);
    await client.query("UPDATE orion_crm.actor_grants SET active=false,version=version+1 WHERE clinic_id=$1 AND id='crm2-operator'", [clinic]);
    await expect(command(task)).rejects.toMatchObject({ code: 'PT403' });
  });
  it('accepts follow-up tasks after completion, and denies cancelled or incompatible terminal visits', async () => {
    const visit = await command(create());
    for (const [index, action] of (['arrive', 'queue', 'call', 'start', 'complete'] as const).entries()) {
      await command({ type: 'visit.transition', visitId: visit.resourceId, expectedVersion: index + 1, action, ...acknowledgment() });
    }
    await command(newTask(visit.resourceId), actor, true);
    await expect(command({ ...newTask(visit.resourceId), kind: 'preparation' })).rejects.toMatchObject({ code: 'PT409' });
    const cancelled = await command(create());
    await command({ type: 'visit.transition', visitId: cancelled.resourceId, expectedVersion: 1, action: 'cancel', ...acknowledgment() });
    await expect(command(newTask(cancelled.resourceId))).rejects.toMatchObject({ code: 'PT409' });
  });
  it('strictly rejects malformed direct RPC fields, titles, dates, acknowledgments and cross-command keys', async () => {
    const visit = await command(create()); const body = newTask(visit.resourceId); const move = reschedule(visit.resourceId);
    const baseline = await counts();
    for (const changed of [{ title: '' }, { title: '  title' }, { title: '\u00a0title' }, { title: 'title\u0085line' },
      { title: 'title\nline' }, { title: '😀'.repeat(121) },
      { priority: 'critical' }, { kind: 'clinical_sign' }, { dueAt: '2026-02-30T10:00:00.000Z' },
      { dueAt: '2026-10-06T10:00:00Z' }, { dueAt: '2100-01-01T10:00:00.000Z' }, { testDataAcknowledged: false },
      { ownerId: null }, { idempotencyKey: 'bad' }, { idempotencyKey: '11111111-1111-0111-0111-111111111111' }, { unexpected: true }]) {
      await expect(command({ ...body, ...changed })).rejects.toMatchObject({ code: 'PT400', message: 'CRM_INVALID_COMMAND' });
    }
    for (const changed of [{ expectedVersion: '1' }, { expectedVersion: 0 }, { expectedVersion: 1.5 },
      { expectedVersion: 2147483648 }, { scheduledAt: null }]) {
      await expect(command({ ...move, ...changed })).rejects.toMatchObject({ code: 'PT400' });
    }
    await expect(command({ ...move, expectedVersion: 2147483647 })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_VERSION_CONFLICT' });
    expect(await counts()).toEqual(baseline);
    await command(body);
    await expect(command({ ...move, idempotencyKey: body.idempotencyKey })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_IDEMPOTENCY_CONFLICT' });
  });
  it('rolls back all new publications when audit fails and rejects bypassed history/audit updates', async () => {
    const visit = await command(create());
    await client.query(`CREATE FUNCTION pg_temp.crm2_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'CRM_TEST_AUDIT_FAILURE' USING ERRCODE='PT503'; END $$`);
    await client.query(`CREATE TRIGGER crm2_acceptance_fail_audit BEFORE INSERT ON orion_crm.audit_entries
      FOR EACH ROW WHEN (NEW.clinic_id='${clinic}') EXECUTE FUNCTION pg_temp.crm2_reject_audit()`);
    const baseline = await counts();
    await expect(command(newTask(visit.resourceId))).rejects.toMatchObject({ code: 'PT503' });
    await expect(command(reschedule(visit.resourceId))).rejects.toMatchObject({ code: 'PT503' });
    expect(await counts()).toEqual(baseline);
    await client.query('DROP TRIGGER crm2_acceptance_fail_audit ON orion_crm.audit_entries');
    await expect(probe('UPDATE orion_crm.visits SET scheduled_at=$2,version=version+1 WHERE clinic_id=$1', [clinic, laterTime], false, true)).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe("UPDATE orion_crm.audit_entries SET kind='visit.rescheduled' WHERE clinic_id=$1", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    expect(await counts()).toEqual(baseline);
  });
  it('keeps all tables/RLS/private helpers closed and only the two public RPCs callable', async () => {
    const functions = await client.query(`SELECT p.proname,n.nspname,p.prosecdef,p.proconfig FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('orion_crm_snapshot_v1','orion_crm_command_v1')`);
    expect(functions.rows).toHaveLength(2);
    expect(functions.rows.every(row => row.nspname === 'public' && row.prosecdef && row.proconfig.includes('search_path=""'))).toBe(true);
    const rights = await client.query(`SELECT count(*)::int AS total FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'orion_crm_%' AND has_function_privilege('orion_crm_app',p.oid,'EXECUTE')`);
    expect(rights.rows[0].total).toBe(2);
    const grants = await client.query(`SELECT has_schema_privilege('orion_crm_app','orion_crm','USAGE') AS schema_access,
      has_function_privilege('orion_crm_app','orion_crm.command_core_v1(text,text,jsonb)','EXECUTE') AS core_execute`);
    expect(grants.rows[0]).toEqual({ schema_access: false, core_execute: false });
    await expect(probe('SELECT * FROM orion_crm.tasks', [], true)).rejects.toMatchObject({ code: '42501' });
    const rls = await client.query(`SELECT bool_and(c.relrowsecurity) AS all_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='orion_crm' AND c.relkind='r'`);
    expect(rls.rows[0].all_rls).toBe(true);
  });
});
