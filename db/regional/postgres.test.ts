import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { regionalCommandResultSchema, regionalFacilitySnapshotSchema, regionalOverviewSchema, regionalScopeSchema, type RegionalCommand } from '../../lib/regional/contracts';

// Every DDL, fixture and command is rolled back, including on failures. Explicit PC-only opt in.
describe.runIf(process.env.ORION_REGIONAL_PG_TEST === '1')('regional actual PostgreSQL rollback acceptance', () => {
  let db: Client; let actor: { issuer: string; subject: string };
  const facilityId = 'turkestan-hospital';
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated local runtime required');
    const base = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const marker = JSON.parse(readFileSync(join(base, 'cluster-owner.json'), 'utf8'));
    const admin = JSON.parse(readFileSync(join(base, 'admin.json'), 'utf8'));
    if (marker.kind !== 'orion-crm-local-v1' || marker.port !== 55432 || resolve(marker.data).toLowerCase() !== resolve(base, 'data').toLowerCase() ||
      admin.host !== '127.0.0.1' || admin.port !== 55432 || admin.user !== 'postgres' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) throw new Error('Exact dedicated cluster required');
    const { password } = admin;
    db = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password, database: 'orion_crm_local', ssl: false,
      connectionTimeoutMillis: 3000, statement_timeout: 15000, lock_timeout: 3000, application_name: 'orion-regional-rollback-tests' });
    await db.connect();
    if (realpathSync((await db.query('SHOW data_directory')).rows[0].data_directory).toLowerCase() !== realpathSync(marker.data).toLowerCase()) throw new Error('Wrong PG directory');
    await db.query('BEGIN');
    const installed = (await db.query("SELECT to_regclass('orion_region.facilities') IS NOT NULL installed")).rows[0].installed;
    if (!installed) for (const file of readdirSync('db/regional').filter(n => /^\d{4}_[a-z_]+\.sql$/.test(n)).sort()) {
      const source = readFileSync(join('db/regional', file), 'utf8').replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, '$1').replace(/COMMIT;\s*$/, '');
      await db.query(source);
    }
    await db.query('SET CONSTRAINTS ALL IMMEDIATE'); await db.query('SET CONSTRAINTS ALL DEFERRED');
    actor = (await db.query("SELECT issuer,subject FROM orion_directory.accounts WHERE id='user-a' AND status='active'")).rows[0];
    if (!actor) throw new Error('Existing owner required');
  }, 30000);
  beforeEach(async () => { await db.query('SAVEPOINT example'); });
  afterEach(async () => { await db.query('ROLLBACK TO SAVEPOINT example'); await db.query('RELEASE SAVEPOINT example'); });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => undefined); await db.end(); } });
  async function rpc(sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT rpc');
    try { await db.query('SET LOCAL ROLE orion_crm_app'); const response = await db.query(sql, params); await db.query('RESET ROLE'); await db.query('RELEASE SAVEPOINT rpc'); return response; }
    catch (error) { await db.query('ROLLBACK TO SAVEPOINT rpc'); await db.query('RESET ROLE'); await db.query('RELEASE SAVEPOINT rpc'); throw error; }
  }
  async function overview(identity = actor) { return regionalOverviewSchema.parse((await rpc('SELECT public.orion_regional_overview_v1($1,$2) result', [identity.issuer, identity.subject])).rows[0].result); }
  async function scope(identity = actor) { return regionalScopeSchema.parse((await rpc('SELECT public.orion_regional_scope_v1($1,$2) result', [identity.issuer, identity.subject])).rows[0].result); }
  async function facility(id = facilityId, identity = actor) { return regionalFacilitySnapshotSchema.parse((await rpc('SELECT public.orion_regional_facility_v1($1,$2,$3) result', [identity.issuer, identity.subject, id])).rows[0].result); }
  async function command(body: RegionalCommand, identity = actor) { return regionalCommandResultSchema.parse((await rpc('SELECT public.orion_regional_command_v1($1,$2,$3::jsonb) result', [identity.issuer, identity.subject, JSON.stringify(body)])).rows[0].result); }
  async function employee(roles: string[], deny: string[] = []) {
    const id = 'rollback-' + randomUUID(); const identity = { issuer: 'orion:rollback-only', subject: id };
    await db.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$1,'Rollback staff','active','postgres')", [id, identity.issuer]);
    await db.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES('region-turkestan-hospital',$1,$1,'active')", [id]);
    await db.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,deny_permissions,status,effective_from) VALUES('region-turkestan-hospital',$1,$1,$2,$3,'active',clock_timestamp()-interval '2 days')", [id, roles, deny]);
    return { id, identity };
  }
  const base = () => ({ facilityId, expectedVersion: 1, idempotencyKey: randomUUID() });

  it('persists all 18 divisions, 36 real catalogue rows and excludes Shymkent from region totals', async () => {
    const value = await overview(); expect(value.districts).toHaveLength(18); expect(value.facilities).toHaveLength(36);
    const stored = (await db.query(`SELECT d.region_id,count(*)::int patients,count(DISTINCT f.id)::int populated
      FROM orion_region.patient_details r JOIN orion_crm.patients p ON p.clinic_id=r.clinic_id AND p.id=r.patient_id
      JOIN orion_region.facilities f ON f.clinic_id=r.clinic_id JOIN orion_region.districts d ON d.id=f.district_id
      GROUP BY d.region_id`)).rows as { region_id: string; patients: number; populated: number }[];
    const region = stored.find(row => row.region_id === 'turkestan'); const shymkent = stored.find(row => row.region_id === 'shymkent');
    if (!region || !shymkent) throw new Error('Persisted network patient graph required');
    expect(value.totals.hospitalCount).toBe(17); expect(value.totals.polyclinicCount).toBe(17);
    expect(value.totals.patientCount).toBe(region.patients);
    expect(value.facilities.filter(f => f.populated)).toHaveLength(stored.reduce((count, row) => count + row.populated, 0));
    expect(value.districts.find(d => d.id === 'shymkent')?.patientCount).toBe(shymkent.patients);
    const datasetInstalled = (await db.query("SELECT to_regclass('orion_region.training_datasets') IS NOT NULL installed")).rows[0].installed;
    if (datasetInstalled) expect(value.facilities.every(row => row.populated && row.patientCount > 0)).toBe(true);
    expect(JSON.stringify(value)).not.toMatch(/Айдана|TRAIN-ORION|гипертензия/);
  });
  it('facility CRM rows and clinical records share exact patient/staff/room/stock relations', async () => {
    const value = await facility(); expect(value.crm.patients).toHaveLength(3); expect(value.crm.rooms).toHaveLength(6);
    expect(value.medicalRecords.every(p => /^TRAIN-/.test(p.trainingIin))).toBe(true); expect(value.crm.capabilities.manage).toBe(false);
    // Regional operations are authorized by their own capability contract.
    // The nested legacy CRM intentionally remains read-only and must not be
    // used to disable the regional queue's separately authorized actions.
    expect(value.capabilities).toMatchObject({ manage: true, manageVisits: true, startVisits: true });
    expect(value.prescriptions[0].drugName).toBeTruthy();
    expect(value.crm.visits.some(v => v.status === 'queued' && (v.queueOrder ?? 0) > 0)).toBe(true);
  });
  it('an empty catalogue clinic stays empty rather than inheriting another clinic patients', async () => {
    // All production catalogue fixtures may now contain persisted patients.
    // Create an independent empty institution inside this test's savepoint so
    // the no-cross-tenant-inheritance behavior remains covered without deleting
    // patient history or immutable dataset provenance.
    const clinic = 'region-rollback-empty-hospital'; const id = 'rollback-empty-hospital';
    await db.query("INSERT INTO orion_crm.clinics(id,name) VALUES($1,'Rollback empty institution')", [clinic]);
    await db.query(`INSERT INTO orion_region.facilities(id,district_id,clinic_id,name,kind,latitude,longitude,address)
      VALUES($2,'baydibek',$1,'Rollback empty institution','hospital',43.03,69.38,'Rollback-only address')`, [clinic, id]);
    for (const statement of [
      `INSERT INTO orion_crm.buildings SELECT $1,id,name,x,y,width,depth FROM orion_crm.buildings WHERE clinic_id='region-baydibek-hospital'`,
      `INSERT INTO orion_crm.rooms SELECT $1,id,name,kind,x,y,width,depth FROM orion_crm.rooms WHERE clinic_id='region-baydibek-hospital'`,
      `INSERT INTO orion_crm.room_buildings SELECT $1,room_id,building_id FROM orion_crm.room_buildings WHERE clinic_id='region-baydibek-hospital'`,
      `INSERT INTO orion_crm.staff SELECT $1,id,name,role,room_id FROM orion_crm.staff WHERE clinic_id='region-baydibek-hospital'`,
      `INSERT INTO orion_crm.services SELECT $1,id,name,duration_minutes,room_kind FROM orion_crm.services WHERE clinic_id='region-baydibek-hospital'`,
    ]) await db.query(statement, [clinic]);
    const value = await facility(id); expect(value.facility.populated).toBe(false);
    expect(value.crm.patients).toEqual([]); expect(value.crm.visits).toEqual([]); expect(value.crm.tasks).toEqual([]);
    expect(value.medicalRecords).toEqual([]); expect(value.labs).toEqual([]); expect(value.workTasks).toEqual([]);
    expect(value.crm.rooms).toHaveLength(6); expect(value.crm.staff).toHaveLength(6);
  });
  it('same local patient and visit IDs resolve only the selected institution after dataset import', async () => {
    const baydibek = await facility('baydibek-hospital'); const sozak = await facility('sozak-hospital');
    const patientId = 'dataset-20261009-p1'; const visitId = 'dataset-20261009-v1';
    expect(baydibek.crm.patients.find(row => row.id === patientId)?.name).toBe('Ермек Қуанышев');
    expect(sozak.crm.patients.find(row => row.id === patientId)?.name).toBe('Ерлан Бекенов');
    for (const snapshot of [baydibek, sozak]) {
      expect(snapshot.crm.clinic.id).toBe(snapshot.facility.clinicId);
      expect(snapshot.crm.visits.find(row => row.id === visitId)?.patientId).toBe(patientId);
      expect(snapshot.medicalRecords.find(row => row.patientId === patientId)?.trainingIin).toMatch(/^TRAIN-NET-20261009-/);
      expect(snapshot.crm.tasks.find(row => row.visitId === visitId)?.patientId).toBe(patientId);
    }
    expect(baydibek.medicalRecords.find(row => row.patientId === patientId)?.trainingIin)
      .not.toBe(sozak.medicalRecords.find(row => row.patientId === patientId)?.trainingIin);
  });
  it('unknown/other identities are denied and cannot enroll an existing clinical tenant', async () => {
    await expect(overview({ issuer: actor.issuer, subject: 'nonexistent' })).rejects.toMatchObject({ code: 'PT403' });
    const other = (await db.query("SELECT issuer,subject FROM orion_directory.accounts WHERE id='user-b'")).rows[0];
    if (!other) throw new Error('Expected existing secondary account');
    await expect(overview(other)).rejects.toMatchObject({ code: 'PT403' });
    await expect(facility('crm-clinic-local')).rejects.toMatchObject({ code: 'PT404' });
  });
  it('direct table access and helper function execution stay closed to the runtime role', async () => {
    await expect(rpc('SELECT * FROM orion_region.patient_details')).rejects.toMatchObject({ code: '42501' });
    await expect(rpc("SELECT orion_region.metrics('region-turkestan-hospital')")).rejects.toMatchObject({ code: '42501' });
    const functions = (await db.query("SELECT proname,has_function_privilege('public',p.oid,'execute') exposed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'orion_regional_%' ")).rows;
    expect(functions.length).toBeGreaterThanOrEqual(4); expect(functions.some(f => f.exposed)).toBe(false);
  });
  it('revocation is applied to reads, commands and idempotent replay', async () => {
    const body: RegionalCommand = { ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' };
    await command(body); await db.query("UPDATE orion_region.network_grants SET active=false WHERE user_id='user-a'");
    await expect(overview()).rejects.toMatchObject({ code: 'PT403' }); await expect(command(body)).rejects.toMatchObject({ code: 'PT403' });
  });
  it('current administrator permission revocation denies inherited regional overview despite active grant', async () => {
    await db.query("UPDATE orion_directory.assignments SET deny_permissions=array_append(deny_permissions,'access.manage') WHERE clinic_id='crm-clinic-local' AND 'administrator'=ANY(roles)");
    await expect(overview()).rejects.toMatchObject({ code: 'PT403' });
  });
  it('owner scope has all facilities while unassigned existing employees get no invented assignments', async () => {
    expect(await scope()).toMatchObject({ canViewRegion: true }); expect((await scope()).facilities).toHaveLength(36);
    const other = (await db.query("SELECT issuer,subject FROM orion_directory.accounts WHERE id='user-b'")).rows[0];
    expect(await scope(other)).toMatchObject({ canViewRegion: false, facilities: [] });
  });
  it('ordinary doctor sees and operates only the exactly assigned hospital, never regional totals or purchases', async () => {
    const staff = await employee(['doctor']); const own = await facility(facilityId, staff.identity);
    expect((await scope(staff.identity)).facilities.map(f => f.id)).toEqual([facilityId]);
    expect(own.capabilities).toMatchObject({ readPatients: true, readClinical: true, manageTasks: true, reviewLabs: true, receiveProcurement: false });
    expect(own.medicalRecords).toHaveLength(3); expect(own.procurements).toEqual([]);
    expect(own.workTasks.some(t => t.category === 'procurement')).toBe(false);
    await command({ ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' }, staff.identity);
    await expect(overview(staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(facility('sayram-hospital', staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(facility('unknown-hospital', staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...base(), facilityId: 'sayram-hospital', type: 'task.transition', taskId: 'task-12', status: 'in_progress' }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...base(), type: 'procurement.receive', procurementId: 'procurement-dressing' }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
  });
  it('registrar can move own queue but cannot receive clinical text through labs, tasks, events or commands', async () => {
    await command({ ...base(), type: 'lab.complete', labId: 'lab-1', result: '128', unit: 'г/л' });
    await command({ ...base(), type: 'prescription.dispense', prescriptionId: 'rx-1' });
    const staff = await employee(['registrar']); const own = await facility(facilityId, staff.identity);
    expect(own.capabilities).toMatchObject({ readPatients: true, readClinical: false, manageVisits: true, startVisits: false, manageTasks: false, manageLabs: false, reviewLabs: false, dispense: false, receiveProcurement: false });
    expect(own.crm.patients).toHaveLength(3); expect(own.medicalRecords).toEqual([]); expect(own.labs).toEqual([]); expect(own.prescriptions).toEqual([]); expect(own.crm.tasks).toEqual([]);
    expect(own.workTasks.every(t => t.patientId === null && t.category !== 'procurement')).toBe(true); expect(own.events).toEqual([]);
    await command({ ...base(), type: 'visit.transition', visitId: 'visit-3', action: 'arrive' }, staff.identity);
    await expect(command({ ...base(), type: 'visit.transition', visitId: 'visit-1', action: 'start' }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...base(), type: 'lab.review', labId: 'lab-1', expectedVersion: 2 }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...base(), type: 'prescription.dispense', prescriptionId: 'rx-1', expectedVersion: 2 }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
  });
  it('pure administrator with explicit network grant sees aggregates and finance, not patient records', async () => {
    const staff = await employee(['administrator']);
    await db.query("INSERT INTO orion_region.network_grants(user_id,anchor_clinic_id,reason) VALUES($1,'region-turkestan-hospital','Rollback acceptance only')", [staff.id]);
    expect((await scope(staff.identity)).canViewRegion).toBe(true); expect((await overview(staff.identity)).facilities).toHaveLength(36);
    const own = await facility('saryagash-polyclinic', staff.identity);
    expect(own.capabilities).toMatchObject({ readPatients: false, readClinical: false, receiveProcurement: true });
    expect(own.crm.patients).toEqual([]); expect(own.crm.visits).toEqual([]); expect(own.medicalRecords).toEqual([]); expect(own.procurements).toHaveLength(1);
    await expect(command({ ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await db.query("UPDATE orion_directory.assignments SET roles=ARRAY['doctor'] WHERE id=$1", [staff.id]);
    await expect(overview(staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    expect((await scope(staff.identity)).facilities.map(f => f.id)).toEqual([facilityId]);
  });
  it('unlinked clinical task text remains clinical even without patientId, including old receipt replay', async () => {
    await db.query("INSERT INTO orion_region.work_tasks(clinic_id,id,patient_id,visit_id,owner_id,title,category,priority,status,due_at,created_at) VALUES('region-turkestan-hospital','task-unlinked',NULL,NULL,'doctor','Private clinical handover','laboratory','routine','pending',clock_timestamp()+interval '1 day',clock_timestamp())");
    const staff = await employee(['administrator', 'doctor']);
    const body: RegionalCommand = { ...base(), type: 'task.transition', taskId: 'task-unlinked', status: 'in_progress' };
    await command(body, staff.identity);
    await db.query("UPDATE orion_directory.assignments SET roles=ARRAY['administrator'] WHERE id=$1", [staff.id]);
    const own = await facility(facilityId, staff.identity);
    expect(own.workTasks.every(t => t.category === 'procurement' && t.patientId === null)).toBe(true);
    expect(own.events.some(e => e.resourceId === 'task-unlinked')).toBe(false);
    await expect(command(body, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command({ ...body, status: 'completed', expectedVersion: 2, idempotencyKey: randomUUID() }, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
  });
  it.each(['membership', 'assignment', 'expiry', 'account'])('revoked %s removes own access and idempotent command replay', async kind => {
    const staff = await employee(['doctor']); const body: RegionalCommand = { ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' };
    await command(body, staff.identity);
    if (kind === 'membership') await db.query("UPDATE orion_directory.memberships SET status='disabled' WHERE id=$1", [staff.id]);
    if (kind === 'assignment') await db.query("UPDATE orion_directory.assignments SET status='revoked' WHERE id=$1", [staff.id]);
    if (kind === 'expiry') await db.query("UPDATE orion_directory.assignments SET effective_until=clock_timestamp()-interval '1 day' WHERE id=$1", [staff.id]);
    if (kind === 'account') await db.query("UPDATE orion_directory.accounts SET status='disabled' WHERE id=$1", [staff.id]);
    await expect(facility(facilityId, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command(body, staff.identity)).rejects.toMatchObject({ code: 'PT403' });
    if (kind === 'assignment' || kind === 'expiry') expect((await scope(staff.identity)).facilities).toEqual([]);
  });
  it('does not combine permissions from separate assignments to expose clinical records', async () => {
    const staff = await employee(['doctor'], ['patient.directory.read']);
    await db.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES('region-turkestan-hospital',$1,$2,ARRAY['registrar'],'active',clock_timestamp()-interval '1 day')", [staff.id + '-second', staff.id]);
    const own = await facility(facilityId, staff.identity); expect(own.capabilities.readPatients).toBe(true); expect(own.capabilities.readClinical).toBe(false); expect(own.medicalRecords).toEqual([]);
  });
  it('staff briefing save is own-facility only and obeys current assignment revocation', async () => {
    const staff = await employee(['doctor']);
    const artifact = { scopeType: 'facility', scopeId: facilityId, sourceHash: 'c'.repeat(64), provider: 'groq', model: 'rollback-only', summary: 'Сроки задач', priorities: [], generatedAt: new Date().toISOString() };
    const save = (body = artifact) => rpc('SELECT public.orion_regional_briefing_save_v1($1,$2,$3::jsonb) result', [staff.identity.issuer, staff.identity.subject, JSON.stringify(body)]);
    expect((await save()).rows[0].result.id).toMatch(/^briefing-/);
    await expect(save({ ...artifact, scopeId: 'sayram-hospital' })).rejects.toMatchObject({ code: 'PT403' });
    await expect(save({ ...artifact, scopeType: 'region', scopeId: 'turkestan' })).rejects.toMatchObject({ code: 'PT403' });
    await expect(save({ ...artifact, scopeType: 'district', scopeId: 'turkestan' })).rejects.toMatchObject({ code: 'PT403' });
    await db.query("UPDATE orion_directory.assignments SET status='revoked' WHERE id=$1", [staff.id]);
    await expect(save()).rejects.toMatchObject({ code: 'PT403' });
  });
  it('queue transitions preserve FIFO, room capacity, replay and explicit clinician start', async () => {
    const queue: RegionalCommand = { ...base(), facilityId: 'turkestan-polyclinic', type: 'visit.transition', visitId: 'visit-4', action: 'queue' };
    await command(queue); expect((await command(queue)).replayed).toBe(true);
    await expect(command({ ...queue, action: 'call', expectedVersion: 2, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: 'REGIONAL_QUEUE_CONFLICT' });
    const call: RegionalCommand = { ...base(), facilityId: 'turkestan-polyclinic', type: 'visit.transition', visitId: 'visit-5', action: 'call' };
    await command(call);
    await expect(command({ ...queue, action: 'call', expectedVersion: 2, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: 'REGIONAL_CAPACITY_CONFLICT' });
    await command({ ...call, action: 'requeue', expectedVersion: 2, idempotencyKey: randomUUID() });
    await command({ ...queue, action: 'call', expectedVersion: 2, idempotencyKey: randomUUID() });
    await command({ ...queue, action: 'start', expectedVersion: 3, idempotencyKey: randomUUID() });
    const snapshot = await facility('turkestan-polyclinic');
    expect(snapshot.crm.visits.find(v => v.id === 'visit-4')).toMatchObject({ status: 'in_service', version: 4 });
    expect(snapshot.crm.visits.find(v => v.id === 'visit-5')?.queueOrder).toBeGreaterThan(20);
    await expect(command({ ...queue, action: 'cancel', expectedVersion: 4, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: 'REGIONAL_INVALID_TRANSITION' });
  });
  it('active fixture observations are not future appointments and no old scheduler rows were seeded', async () => {
    const value = await facility(); const now = Date.now();
    expect(value.crm.visits.filter(v => v.status !== 'scheduled').every(v => Date.parse(v.scheduledAt) <= now && Date.parse(v.updatedAt) <= now)).toBe(true);
    expect((await db.query("SELECT count(*)::int n FROM orion_crm.visits WHERE clinic_id LIKE 'region-%'")).rows[0].n).toBe(0);
  });
  it('task transitions are versioned, terminal and update derived task KPI source counts', async () => {
    const before = await facility(); const body: RegionalCommand = { ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' };
    const result = await command(body); expect(result.version).toBe(2); expect((await command(body)).replayed).toBe(true);
    await expect(command({ ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PT409', message: 'REGIONAL_VERSION_CONFLICT' });
    await command({ ...body, expectedVersion: 2, status: 'completed', idempotencyKey: randomUUID() });
    const after = await facility(); expect(after.facility.completedTasks).toBe(before.facility.completedTasks + 1);
    expect(after.facility.openTasks).toBe(before.facility.openTasks - 1);
    await expect(command({ ...body, expectedVersion: 3, idempotencyKey: randomUUID() })).rejects.toMatchObject({ message: 'REGIONAL_INVALID_TRANSITION' });
  });
  it('same idempotency key with altered payload is a conflict and cross-facility IDs stay inaccessible', async () => {
    const body: RegionalCommand = { ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress' }; await command(body);
    await expect(command({ ...body, status: 'escalated' })).rejects.toMatchObject({ message: 'REGIONAL_IDEMPOTENCY_CONFLICT' });
    await expect(command({ ...body, taskId: 'task-7', idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PT404' });
  });
  it('manual lab result becomes ready and only a distinct explicit review marks it reviewed', async () => {
    const body: RegionalCommand = { ...base(), type: 'lab.complete', labId: 'lab-1', result: '128', unit: 'г/л' };
    await command(body); expect((await facility()).labs.find(l => l.id === 'lab-1')?.status).toBe('ready');
    await command({ ...base(), type: 'lab.review', labId: 'lab-1', expectedVersion: 2 });
    expect((await facility()).labs.find(l => l.id === 'lab-1')).toMatchObject({ status: 'reviewed', result: '128', version: 3 });
    await expect(command({ ...base(), type: 'lab.review', labId: 'lab-1', expectedVersion: 3 })).rejects.toMatchObject({ message: 'REGIONAL_INVALID_TRANSITION' });
  });
  it('dispensing decrements stock atomically once with audit and movement, retries never double issue', async () => {
    const before = await facility(); const amount = before.prescriptions.find(p => p.id === 'rx-1')!.quantity;
    const stock = before.stocks.find(s => s.id === 'stock-medication')!;
    const body: RegionalCommand = { ...base(), type: 'prescription.dispense', prescriptionId: 'rx-1' };
    await command(body); await command(body); const after = await facility();
    expect(after.stocks.find(s => s.id === stock.id)?.quantity).toBe(stock.quantity - amount);
    expect(after.prescriptions.find(p => p.id === 'rx-1')?.status).toBe('dispensed');
    expect((await db.query("SELECT count(*)::int n FROM orion_region.stock_movements WHERE clinic_id='region-turkestan-hospital' AND resource_id='rx-1'")).rows[0].n).toBe(1);
  });
  it('insufficient or expired stock leaves prescription, receipt and stock unchanged', async () => {
    await db.query("UPDATE orion_region.stocks SET quantity=0 WHERE clinic_id='region-turkestan-hospital' AND id='stock-medication'");
    const body: RegionalCommand = { ...base(), type: 'prescription.dispense', prescriptionId: 'rx-1' };
    await expect(command(body)).rejects.toMatchObject({ message: 'REGIONAL_STOCK_UNAVAILABLE' });
    expect((await facility()).prescriptions.find(p => p.id === 'rx-1')?.status).toBe('approved');
    expect((await db.query('SELECT count(*)::int n FROM orion_region.command_receipts WHERE idempotency_key=$1', [body.idempotencyKey])).rows[0].n).toBe(0);
    await db.query("UPDATE orion_region.stocks SET quantity=100,expires_at=current_date-1 WHERE clinic_id='region-turkestan-hospital' AND id='stock-medication'");
    await expect(command(body)).rejects.toMatchObject({ message: 'REGIONAL_STOCK_UNAVAILABLE' });
  });
  it('receiving an order increments stock once, advances its version and retains supplier history', async () => {
    const before = await facility(); const stock = before.stocks.find(s => s.id === 'stock-dressing')!;
    const body: RegionalCommand = { ...base(), type: 'procurement.receive', procurementId: 'procurement-dressing' }; await command(body); await command(body);
    const after = await facility(); expect(after.stocks.find(s => s.id === stock.id)?.quantity).toBe(stock.quantity + 40);
    expect(after.procurements[0]).toMatchObject({ status: 'received', version: 2, supplier: before.procurements[0].supplier });
  });
  it('unknown command types and caller-supplied authority fail before mutation', async () => {
    await expect(rpc('SELECT public.orion_regional_command_v1($1,$2,$3::jsonb)', [actor.issuer, actor.subject, JSON.stringify({ ...base(), type: 'invented', prescriptionId: 'rx-1' })])).rejects.toMatchObject({ code: 'PT400' });
    await expect(rpc('SELECT public.orion_regional_command_v1($1,$2,$3::jsonb)', [actor.issuer, actor.subject, JSON.stringify({ ...base(), type: 'task.transition', taskId: 'task-1', status: 'in_progress', userId: 'user-a' })])).rejects.toMatchObject({ code: 'PT400' });
  });
  it('read and command audit cannot be erased even through elevated accidental UPDATE', async () => {
    await facility(); await db.query('SAVEPOINT immutable');
    await expect(db.query("UPDATE orion_region.audit_events SET action='changed'")).rejects.toMatchObject({ code: 'PT409' });
    await db.query('ROLLBACK TO SAVEPOINT immutable'); await db.query('RELEASE SAVEPOINT immutable');
  });
  it('stores an internal AI draft with exact scope/hash without clinical mutation', async () => {
    const artifact = { scopeType: 'facility', scopeId: facilityId, sourceHash: 'a'.repeat(64), provider: 'groq', model: 'mock-validation', summary: 'Проверить сроки задач', priorities: ['Уточнить ответственного'], generatedAt: new Date().toISOString() };
    const reply = await rpc('SELECT public.orion_regional_briefing_save_v1($1,$2,$3::jsonb) result', [actor.issuer, actor.subject, JSON.stringify(artifact)]);
    expect(reply.rows[0].result.id).toMatch(/^briefing-/);
    expect((await db.query('SELECT status,source_hash,policy_version FROM orion_region.ai_briefings WHERE id=$1', [reply.rows[0].result.id])).rows[0]).toEqual({ status: 'draft', source_hash: artifact.sourceHash, policy_version: 'regional-kpi-v1' });
  });
});
