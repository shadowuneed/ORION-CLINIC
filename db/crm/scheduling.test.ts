import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crmCommandResultSchema, crmSnapshotSchema, type CrmActor, type CrmCommand } from '../../lib/crm/contracts';

// Explicitly opted-in PC cluster only. All fixtures, commands and temporary
// fault-injection DDL are rolled back; no persistent acceptance record is added.
describe.runIf(process.env.ORION_CRM_PG_TEST === '1')('CRM-3 actual PostgreSQL scheduling', () => {
  let pool: Pool; let client: PoolClient; let clinic: string; let actor: CrmActor; let reader: CrmActor;
  let day: string; let saturday: string;
  const ack = () => ({ testDataAcknowledged: true as const, idempotencyKey: randomUUID() });
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated CRM test directory unavailable');
    const base = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
    if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 ||
      resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase()) throw new Error('Dedicated CRM owner marker mismatch');
    const admin = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
    if (admin.host !== '127.0.0.1' || admin.port !== 55432 || typeof admin.user !== 'string' || typeof admin.password !== 'string') {
      throw new Error('Dedicated CRM configuration mismatch');
    }
    const { password } = admin;
    pool = new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: admin.user,
      password, ssl: false, max: 4, connectionTimeoutMillis: 3000, query_timeout: 10000,
      statement_timeout: 8000, lock_timeout: 3000, application_name: 'orion-crm3-explicit-tests' });
    const location = await pool.query('SHOW data_directory');
    if (realpathSync(location.rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) {
      await pool.end(); throw new Error('Dedicated CRM PostgreSQL directory mismatch');
    }
    if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== 'orion_crm_local') throw new Error('Dedicated CRM database mismatch');
  });
  beforeEach(async () => {
    client = await pool.connect(); await client.query('BEGIN'); clinic = `crm3-acceptance-${randomUUID()}`;
    actor = { issuer: 'orion:crm3-acceptance', subject: `operator-${randomUUID()}` };
    reader = { issuer: actor.issuer, subject: `reader-${randomUUID()}` };
    await client.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Synthetic scheduling acceptance')", [clinic]);
    await client.query("INSERT INTO orion_crm.clinic_calendar VALUES($1,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy')", [clinic]);
    await client.query(`INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage)
      VALUES('crm3-operator',$1,$2,$3,'Synthetic operator',true,true),('crm3-reader',$1,$2,$4,'Synthetic reader',true,false)`,
    [clinic, actor.issuer, actor.subject, reader.subject]);
    await client.query("INSERT INTO orion_crm.rooms VALUES($1,'room-a','Synthetic room A','consultation',0,0,4,4),($1,'room-b','Synthetic room B','consultation',6,0,4,4)", [clinic]);
    await client.query("INSERT INTO orion_crm.staff VALUES($1,'doctor-a','Synthetic doctor A','doctor','room-a'),($1,'doctor-b','Synthetic doctor B','doctor','room-b'),($1,'nurse','Synthetic nurse','nurse','room-a')", [clinic]);
    await client.query("INSERT INTO orion_crm.services VALUES($1,'service','Synthetic consultation',30,'consultation')", [clinic]);
    await client.query("INSERT INTO orion_crm.patients VALUES($1,'patient-a','Synthetic patient A','CRM-TEST-SCHED-A','unknown'),($1,'patient-b','Synthetic patient B','CRM-TEST-SCHED-B','unknown')", [clinic]);
    const dates = await client.query(`WITH next_day AS (SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')+interval '30 days' AS d),
      monday AS (SELECT d+((8-extract(isodow FROM d)::int)%7)*interval '1 day' AS d FROM next_day)
      SELECT to_char(d,'YYYY-MM-DD') AS day,to_char(d+interval '5 days','YYYY-MM-DD') AS saturday FROM monday`);
    day = dates.rows[0].day; saturday = dates.rows[0].saturday;
  });
  afterEach(async () => { if (client) { await client.query('ROLLBACK'); client.release(); } });
  afterAll(async () => {
    if (pool) {
      const leftovers = await pool.query("SELECT count(*)::int AS total FROM orion_crm.clinics WHERE id LIKE 'crm3-acceptance-%'");
      await pool.end(); expect(leftovers.rows[0].total).toBe(0);
    }
  });
  async function probe(query: string, params: unknown[] = [], runtime = false, immediate = false) {
    await client.query('SAVEPOINT crm3_probe');
    try {
      if (runtime) await client.query('SET LOCAL ROLE orion_crm_app');
      const result = await client.query(query, params);
      if (immediate) { await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED'); }
      if (runtime) await client.query('RESET ROLE'); await client.query('RELEASE SAVEPOINT crm3_probe'); return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT crm3_probe'); if (runtime) await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT crm3_probe'); throw error;
    }
  }
  async function slot(time: string, date = day) {
    return (await client.query("SELECT orion_crm.iso(($1::date+$2::time) AT TIME ZONE 'Asia/Qyzylorda') AS at", [date, time])).rows[0].at as string;
  }
  async function command(body: unknown, principal = actor, immediate = false) {
    const result = await probe('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb) AS result', [principal.issuer, principal.subject, JSON.stringify(body)], true, immediate);
    return crmCommandResultSchema.parse(result.rows[0].result);
  }
  async function snapshot() {
    return crmSnapshotSchema.parse((await probe('SELECT public.orion_crm_snapshot_v1($1,$2) AS result', [actor.issuer, actor.subject], true)).rows[0].result);
  }
  async function create(time = '10:00', patientId = 'patient-a', roomId = 'room-a', staffId = 'doctor-a') {
    return command({ type: 'visit.create', patientId, roomId, staffId, serviceId: 'service', scheduledAt: await slot(time), ...ack() });
  }
  const transition = (visitId: string, expectedVersion: number, action: Extract<CrmCommand, { type: 'visit.transition' }>['action']) =>
    ({ type: 'visit.transition' as const, visitId, expectedVersion, action, ...ack() });
  async function counts() {
    return (await client.query(`SELECT (SELECT count(*)::int FROM orion_crm.visits WHERE clinic_id=$1) AS visits,
      (SELECT count(*)::int FROM orion_crm.visit_booking WHERE clinic_id=$1) AS bookings,
      (SELECT count(*)::int FROM orion_crm.visit_versions WHERE clinic_id=$1) AS versions,
      (SELECT count(*)::int FROM orion_crm.command_receipts WHERE clinic_id=$1) AS receipts,
      (SELECT count(*)::int FROM orion_crm.audit_entries WHERE clinic_id=$1) AS audits`, [clinic])).rows[0];
  }
  it('checks future local policy for the whole interval and accepts exact opening/closing boundaries', async () => {
    const input = { type: 'visit.create', patientId: 'patient-a', roomId: 'room-a', staffId: 'doctor-a', serviceId: 'service', ...ack() };
    await expect(command({ ...input, scheduledAt: '2020-01-01T04:00:00.000Z' })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_PAST_SLOT' });
    for (const time of ['08:59', '17:45', '18:00']) await expect(command({ ...input, scheduledAt: await slot(time) })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_OUTSIDE_HOURS' });
    await expect(command({ ...input, scheduledAt: await slot('10:00', saturday) })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_OUTSIDE_HOURS' });
    await command({ ...input, scheduledAt: await slot('09:00') }, actor, true);
    await command({ ...input, scheduledAt: await slot('17:30'), ...ack() }, actor, true);
    expect((await counts()).visits).toBe(2);
  });
  it('uses half-open slot intervals and rejects room/staff/patient overlaps atomically', async () => {
    await create(); const baseline = await counts();
    await expect(create('10:15', 'patient-b')).rejects.toMatchObject({ code: 'PT409', message: 'CRM_SCHEDULE_CONFLICT' });
    await expect(create('10:15', 'patient-a', 'room-b', 'doctor-b')).rejects.toMatchObject({ code: 'PT409', message: 'CRM_SCHEDULE_CONFLICT' });
    expect(await counts()).toEqual(baseline);
    await create('10:30', 'patient-b');
    await create('10:30', 'patient-a', 'room-b', 'doctor-b');
    expect((await counts()).visits).toBe(3);
  });
  it('freezes duration/provenance despite catalogue edits and reschedules with CAS/history', async () => {
    const visit = await create();
    await client.query('UPDATE orion_crm.services SET duration_minutes=60 WHERE clinic_id=$1', [clinic]);
    const body = { type: 'visit.reschedule', visitId: visit.resourceId, expectedVersion: 1, scheduledAt: await slot('17:30'), ...ack() };
    const result = await command(body, actor, true); expect(result.version).toBe(2);
    expect(await command(body)).toEqual({ ...result, replayed: true });
    const data = await snapshot(); expect(data.visits[0]).toMatchObject({ durationMinutes: 30, bookingSource: 'booking', scheduledAt: body.scheduledAt, version: 2 });
    expect(data.calendar).toEqual({ timeZone: 'Asia/Qyzylorda', weekdays: [1, 2, 3, 4, 5], openMinute: 540, closeMinute: 1080, source: 'synthetic_policy' });
    expect(data.tasks[0].dueAt).toBe(await slot('10:00'));
    for (const field of ['arrivedAt', 'queuedAt', 'calledAt', 'startedAt', 'completedAt', 'queueOrder']) expect(Object.hasOwn(data.visits[0], field)).toBe(true);
    await expect(command({ ...body, scheduledAt: await slot('16:00'), ...ack() })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_VERSION_CONFLICT' });
    await expect(probe('UPDATE orion_crm.visit_booking SET duration_minutes=5 WHERE clinic_id=$1', [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe('DELETE FROM orion_crm.visit_booking WHERE clinic_id=$1', [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await expect(probe('UPDATE orion_crm.clinic_calendar SET open_minute=0 WHERE clinic_id=$1', [clinic])).rejects.toMatchObject({ code: 'PT409' });
  });
  it('calls the FIFO head, reserves capacity, requeues at the end and never auto-starts the next visit', async () => {
    const first = await create(); const second = await create('11:00', 'patient-b');
    for (const visit of [first, second]) {
      await command(transition(visit.resourceId, 1, 'arrive')); await command(transition(visit.resourceId, 2, 'queue'));
    }
    await expect(command(transition(first.resourceId, 3, 'start'))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_INVALID_TRANSITION' });
    await expect(command(transition(second.resourceId, 3, 'call'))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_QUEUE_ORDER_CONFLICT' });
    const call = transition(first.resourceId, 3, 'call'); const called = await command(call); expect(await command(call)).toEqual({ ...called, replayed: true });
    await expect(command(transition(second.resourceId, 3, 'call'))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_CAPACITY_CONFLICT' });
    await command(transition(first.resourceId, 4, 'requeue'));
    await expect(command(transition(first.resourceId, 5, 'call'))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_QUEUE_ORDER_CONFLICT' });
    await command(transition(second.resourceId, 3, 'call')); await command(transition(second.resourceId, 4, 'start')); await command(transition(second.resourceId, 5, 'complete'), actor, true);
    const data = await snapshot();
    expect(data.visits.find(visit => visit.id === first.resourceId)!.queueOrder!).toBeGreaterThan(data.visits.find(visit => visit.id === second.resourceId)!.queueOrder!);
    expect(data.visits.find(visit => visit.id === first.resourceId)).toMatchObject({ status: 'queued', version: 5 });
    expect(data.visits.find(visit => visit.id === second.resourceId)).toMatchObject({ status: 'completed', version: 6 });
    const completed = data.visits.find(visit => visit.id === second.resourceId)!;
    expect([completed.arrivedAt, completed.queuedAt, completed.calledAt, completed.startedAt, completed.completedAt].every(value => typeof value === 'string')).toBe(true);
    expect(data.tasks.every(task => task.status === 'pending')).toBe(true);
  });
  it('checks patient reservation across rooms and allows explicit called cancellation', async () => {
    const first = await create(); const second = await create('11:00', 'patient-a', 'room-b', 'doctor-b');
    for (const visit of [first, second]) { await command(transition(visit.resourceId, 1, 'arrive')); await command(transition(visit.resourceId, 2, 'queue')); }
    await command(transition(first.resourceId, 3, 'call'));
    await expect(command(transition(second.resourceId, 3, 'call'))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_CAPACITY_CONFLICT' });
    await command(transition(first.resourceId, 4, 'cancel')); await command(transition(second.resourceId, 3, 'call'), actor, true);
    const data = await snapshot(); expect(data.visits.find(visit => visit.id === first.resourceId)?.status).toBe('cancelled');
    expect(data.tasks.every(task => task.status === 'pending')).toBe(true);
  });
  it('marks due historical synthetic bookings no_show only explicitly and preserves their tasks', async () => {
    const future = await create();
    await expect(command(transition(future.resourceId, 1, 'mark_no_show'))).rejects.toMatchObject({ code: 'PT409', message: 'CRM_NO_SHOW_TOO_EARLY' });
    // Trusted rollback-only historical fixture: no production RPC can disable
    // a table trigger. Its missing past arrival/queue history remains absent.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query('ALTER TABLE orion_crm.visits DISABLE TRIGGER visit_schedule_guard');
    await client.query(`INSERT INTO orion_crm.visits VALUES($1,'historical','patient-b','doctor-a','room-a','service',
      clock_timestamp()-interval '1 day','scheduled',1,clock_timestamp())`, [clinic]);
    await client.query("INSERT INTO orion_crm.visit_versions SELECT clinic_id,id,1,status,to_jsonb(v),updated_at FROM orion_crm.visits v WHERE clinic_id=$1 AND id='historical'", [clinic]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE'); await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query('ALTER TABLE orion_crm.visits ENABLE TRIGGER visit_schedule_guard');
    const preparation = { type: 'task.create', visitId: 'historical', ownerId: 'nurse', kind: 'preparation', title: 'Synthetic original preparation',
      priority: 'routine', dueAt: await slot('11:00'), ...ack() };
    const original = await command(preparation);
    await command(transition('historical', 1, 'mark_no_show'), actor, true);
    expect(await command(preparation)).toEqual({ ...original, replayed: true });
    const beforeRejectedPreparation = await counts();
    await expect(command({ ...preparation, ...ack() })).rejects.toMatchObject({ code: 'PT409', message: 'CRM_INVALID_TRANSITION' });
    expect(await counts()).toEqual(beforeRejectedPreparation);
    await expect(command(transition('historical', 2, 'arrive'))).rejects.toMatchObject({ code: 'PT409' });
    const task = { type: 'task.create', visitId: 'historical', ownerId: 'nurse', kind: 'follow_up', title: 'Synthetic missed appointment follow-up',
      priority: 'routine', dueAt: await slot('11:00'), ...ack() };
    await command(task); await expect(command({ ...task, kind: 'service', ...ack() })).rejects.toMatchObject({ code: 'PT409' });
    const data = await snapshot(); expect(data.visits.find(visit => visit.id === 'historical')).toMatchObject({ status: 'no_show', arrivedAt: null, queuedAt: null });
    expect(data.tasks.every(item => item.status === 'pending')).toBe(true);
  });
  it('keeps actor/schema boundaries and denies bypasses, skipped publication and malformed queue commands', async () => {
    const visit = await create(); const baseline = await counts();
    await expect(command(transition(visit.resourceId, 1, 'arrive'), reader)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...transition(visit.resourceId, 1, 'arrive'), action: 'autocall' })).rejects.toMatchObject({ code: 'PT400' });
    await expect(command({ ...transition(visit.resourceId, 1, 'arrive'), durationMinutes: 5 })).rejects.toMatchObject({ code: 'PT400' });
    await expect(command(transition('another-clinic-visit', 1, 'call'))).rejects.toMatchObject({ code: 'PT404' });
    await expect(probe("UPDATE orion_crm.visits SET scheduled_at=clock_timestamp()-interval '1 hour',version=version+1 WHERE clinic_id=$1", [clinic])).rejects.toMatchObject({ code: 'PT409', message: 'CRM_PAST_SLOT' });
    await expect(probe('SELECT * FROM orion_crm.visit_booking', [], true)).rejects.toMatchObject({ code: '42501' });
    await expect(probe("UPDATE orion_crm.visits SET status='in_service',version=version+1 WHERE clinic_id=$1", [clinic])).rejects.toMatchObject({ code: 'PT409' });
    await client.query("INSERT INTO orion_crm.staff VALUES($1,'support','Synthetic support','support','room-a')", [clinic]);
    await client.query("INSERT INTO orion_crm.services VALUES($1,'diagnostic','Synthetic diagnostic',20,'diagnostics')", [clinic]);
    for (const [patient, staff, room, service] of [['patient-a', 'support', 'room-a', 'service'],
      ['patient-a', 'doctor-a', 'room-b', 'service'], ['patient-a', 'doctor-a', 'room-a', 'diagnostic'],
      ['missing-patient', 'doctor-a', 'room-a', 'service']]) {
      await expect(probe(`INSERT INTO orion_crm.visits VALUES($1,'direct-invalid',$2,$3,$4,$5,$6,'scheduled',1,clock_timestamp())`,
        [clinic, patient, staff, room, service, await slot('12:00')])).rejects.toMatchObject({ code: 'PT404', message: 'CRM_RESOURCE_NOT_FOUND' });
    }
    expect(await counts()).toEqual(baseline);
    const security = await client.query(`SELECT count(*)::int AS total,bool_and(relrowsecurity) AS rls FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='orion_crm' AND relkind='r'`);
    expect(security.rows[0]).toEqual({ total: 17, rls: true });
    expect((await client.query(`SELECT count(*)::int AS total FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'orion_crm_%' AND has_function_privilege('orion_crm_app',p.oid,'EXECUTE')`)).rows[0].total).toBe(2);
  });
  it('serialized clinic lock makes a second scheduling writer wait; both transactions roll back', async () => {
    const current = (await client.query("SELECT issuer,subject,clinic_id FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND active AND can_manage")).rows[0];
    if (!current) throw new Error('Explicit local simulation operator required');
    const records = (await client.query(`SELECT v.patient_id,v.room_id,v.staff_id,v.service_id FROM orion_crm.visits v
      WHERE clinic_id=$1 ORDER BY id LIMIT 1`, [current.clinic_id])).rows[0];
    const left = await pool.connect(); const right = await pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await left.query('BEGIN'); await right.query('BEGIN'); await left.query('SET LOCAL ROLE orion_crm_app'); await right.query('SET LOCAL ROLE orion_crm_app');
      const request = { type: 'visit.create', patientId: records.patient_id, roomId: records.room_id, staffId: records.staff_id,
        serviceId: records.service_id, scheduledAt: await slot('12:00'), ...ack() };
      await left.query('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb)', [current.issuer, current.subject, JSON.stringify(request)]);
      const pid = (await right.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = right.query('SELECT public.orion_crm_command_v1($1,$2,$3::jsonb)', [current.issuer, current.subject, JSON.stringify({ ...request, ...ack() })]);
      await client.query('SELECT pg_sleep(0.02)');
      const wait = (await client.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
      expect(wait.wait_event_type).toBe('Lock');
      await left.query('ROLLBACK'); await pending; pending = undefined;
      await right.query('ROLLBACK');
    } finally {
      await left.query('ROLLBACK').catch(() => undefined); await pending?.catch(() => undefined);
      await right.query('ROLLBACK').catch(() => undefined); left.release(); right.release();
    }
  });
});
