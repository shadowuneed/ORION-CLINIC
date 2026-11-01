import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateRegionalKpi, regionalKpiEvidenceSchema, regionalKpiSnapshotSchema,
  type RegionalKpiEvidence, type RegionalKpiEvidenceQuery, type RegionalKpiQuery,
} from './kpi';

// Explicit opt-in, exact owner-marked PC target, no migration/provisioning.
// Only transaction-local synthetic identities and read audits; always rolled back.
describe.runIf(process.env.ORION_KPI_PG_TEST === '1')('regional KPI SQL-to-contract rollback integration', () => {
  let db: Client | undefined;
  let connected = false;
  let began = false;
  const suffix = randomUUID();
  const issuer = `orion:kpi-dto:${suffix}`;
  const identities = ['admin', 'doctor', 'none'] as const;
  const ids = identities.map(subject => `kpi-dto-${subject}-${suffix}`);
  const period = { start: '2026-09-01', end: '2026-09-30' };

  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated PC runtime required');
    const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const data = join(runtime, 'data');
    const marker = JSON.parse(readFileSync(join(runtime, 'cluster-owner.json'), 'utf8'));
    const admin = JSON.parse(readFileSync(join(runtime, 'admin.json'), 'utf8'));
    if (marker?.kind !== 'orion-crm-local-v1' || marker?.port !== 55432 || typeof marker?.data !== 'string'
      || resolve(marker.data).toLowerCase() !== resolve(data).toLowerCase()
      || admin?.host !== '127.0.0.1' || admin?.port !== 55432 || admin?.user !== 'postgres'
      || typeof admin?.password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) {
      throw new Error('Exact dedicated PostgreSQL ownership required');
    }
    const { password } = admin;
    db = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password,
      database: 'orion_crm_local', ssl: false, connectionTimeoutMillis: 3000,
      statement_timeout: 15000, lock_timeout: 3000, application_name: 'orion-kpi-contract-rollback-tests' });
    await db.connect(); connected = true;
    const target = (await db.query('SELECT current_database() name, inet_server_port() port')).rows[0];
    const directory = (await db.query('SHOW data_directory')).rows[0].data_directory;
    if (target.name !== 'orion_crm_local' || target.port !== 55432
      || realpathSync(directory).toLowerCase() !== realpathSync(data).toLowerCase()) {
      throw new Error('Unexpected PostgreSQL target; no test mutations made');
    }
    const installed = (await db.query("SELECT to_regprocedure('public.orion_regional_kpi_v1(text,text,jsonb)') IS NOT NULL AND to_regprocedure('public.orion_regional_kpi_evidence_v1(text,text,jsonb)') IS NOT NULL installed")).rows[0].installed;
    if (!installed) throw new Error('Apply reviewed regional KPI migration before opting into this test');
    await db.query('BEGIN'); began = true;
    for (const [index, subject] of identities.entries()) {
      const clinic = subject === 'none' ? 'crm-clinic-local' : 'region-turkestan-hospital';
      await db.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$3,'KPI DTO rollback fixture','active','postgres')", [ids[index], issuer, subject]);
      await db.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES($1,$2,$2,'active')", [clinic, ids[index]]);
      await db.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,$2,$2,$3::text[],'active',clock_timestamp()-interval '1 day')", [clinic, ids[index], [subject === 'admin' ? 'administrator' : 'doctor']]);
    }
    await db.query("INSERT INTO orion_region.network_grants(user_id,anchor_clinic_id,reason) VALUES($1,'region-turkestan-hospital','Transaction-only KPI DTO verification')", [ids[0]]);
  }, 30000);

  beforeEach(async () => { await db!.query('SAVEPOINT example'); });
  afterEach(async () => { if (began) { await db!.query('ROLLBACK TO SAVEPOINT example'); await db!.query('RELEASE SAVEPOINT example'); } });
  afterAll(async () => {
    if (!db) return;
    try {
      if (began) {
        await db.query('ROLLBACK'); began = false;
        const retained = (await db.query('SELECT count(*)::integer n FROM orion_directory.accounts WHERE id=ANY($1::text[])', [ids])).rows[0].n;
        expect(retained, 'Transaction-only principals must not survive rollback').toBe(0);
      }
    } finally { if (connected) await db.end(); }
  });

  async function rpc(name: 'snapshot' | 'evidence', query: RegionalKpiQuery | RegionalKpiEvidenceQuery, subject = 'admin'): Promise<unknown> {
    await db!.query('SAVEPOINT dto_rpc');
    try {
      await db!.query('SET LOCAL ROLE orion_crm_app');
      const sql = name === 'snapshot' ? 'SELECT public.orion_regional_kpi_v1($1,$2,$3::jsonb) result'
        : 'SELECT public.orion_regional_kpi_evidence_v1($1,$2,$3::jsonb) result';
      const result = (await db!.query(sql, [issuer, subject, JSON.stringify(query)])).rows[0].result;
      await db!.query('RESET ROLE'); await db!.query('RELEASE SAVEPOINT dto_rpc');
      return result;
    } catch (error) {
      await db!.query('ROLLBACK TO SAVEPOINT dto_rpc'); await db!.query('RELEASE SAVEPOINT dto_rpc');
      throw error;
    }
  }

  async function snapshot(query: RegionalKpiQuery = period, subject = 'admin') {
    return regionalKpiSnapshotSchema.parse(await rpc('snapshot', query, subject));
  }

  async function allEvidence(query: Omit<RegionalKpiEvidenceQuery, 'offset'>, subject = 'admin') {
    const items: RegionalKpiEvidence['items'] = [];
    let offset = 0; let total = 0; let pages = 0;
    while (pages < 501) {
      const page = regionalKpiEvidenceSchema.parse(await rpc('evidence', { ...query, offset }, subject));
      expect(page).toMatchObject({ facilityId: query.facilityId, indicatorId: query.indicatorId,
        period: { start: query.start, end: query.end }, offset });
      if (pages > 0) expect(page.total).toBe(total);
      total = page.total; items.push(...page.items); pages += 1;
      if (page.nextOffset === null) break;
      expect(page.nextOffset).toBeGreaterThan(offset); offset = page.nextOffset;
    }
    expect(pages).toBeLessThan(501);
    expect(items).toHaveLength(total);
    expect(new Set(items.map(row => row.id)).size).toBe(total);
    return { items, total, pages };
  }

  it('parses the actual 36-facility snapshot with four independently defined indicators', async () => {
    const value = await snapshot();
    expect(value.definitions.filter(row => row.sourceType === 'official')).toHaveLength(4);
    expect(value.definitions).toHaveLength(9); expect(value.facilities).toHaveLength(36);
    expect(value.observations).toHaveLength(270);
    expect(value.facilities.filter(row => row.regionId === 'shymkent')).toHaveLength(2);
    expect(value.definitions.find(row => row.id === 'doctor-staffing')?.applicableKinds).toEqual(['hospital']);
    expect(JSON.stringify(value)).not.toMatch(/patientId|subject_ref|password|birthDate|allergies|issuer/);
  }, 20000);

  it('matches the region laboratory weighted numerator/denominator to actual SQL evidence', async () => {
    const value = await snapshot();
    const aggregate = aggregateRegionalKpi(value, 'lab-turnaround', { regionId: 'turkestan' });
    const actual = (await db!.query(`SELECT sum(extract(epoch FROM l.result_sent_at-l.received_at)/60)::float8 numerator,
      count(*)::integer denominator FROM orion_region.kpi_lab_samples l
      JOIN orion_region.facilities f ON f.id=l.facility_id JOIN orion_region.districts d ON d.id=f.district_id
      WHERE d.region_id='turkestan' AND l.result_sent_at>='2026-09-01 00:00+05' AND l.result_sent_at<'2026-10-01 00:00+05'`)).rows[0];
    expect(aggregate.numerator).toBeCloseTo(actual.numerator, 8);
    expect(aggregate.denominator).toBe(actual.denominator);
    expect(aggregate.value).toBeCloseTo(actual.numerator / actual.denominator, 8);
    expect(aggregate.coverage).toEqual({ eligible: 34, reporting: 34, missing: 0 });
  }, 20000);

  it.each([
    ['complaints-hospital', 'turkestan-hospital'],
    ['complaints-polyclinic', 'turkestan-polyclinic'],
    ['lab-turnaround', 'turkestan-hospital'],
    ['doctor-staffing', 'turkestan-hospital'],
  ] as const)('parses every page and reconciles %s source facts to its aggregate', async (indicatorId, facilityId) => {
    const value = await snapshot({ ...period, facilityId });
    const result = aggregateRegionalKpi(value, indicatorId, { facilityId });
    const evidence = await allEvidence({ ...period, facilityId, indicatorId });
    expect(evidence.total).toBe(result.sourceCount);
    const sum = (kind: RegionalKpiEvidence['items'][number]['kind']) => evidence.items
      .filter(item => item.kind === kind).reduce((total, item) => total + (item.value ?? 0), 0);
    if (indicatorId.startsWith('complaints-')) {
      expect(sum('complaint_decision')).toBe(result.numerator);
      expect(sum('care_episode')).toBe(result.denominator);
    } else if (indicatorId === 'lab-turnaround') {
      expect(sum('lab_sample')).toBeCloseTo(result.numerator, 8);
      expect(evidence.items).toHaveLength(result.denominator);
    } else {
      expect(sum('main_doctor')).toBe(result.numerator);
      expect(sum('doctor_position')).toBeCloseTo(result.denominator, 8);
    }
    if (result.sourceCount > 20) expect(evidence.pages).toBeGreaterThan(1);
    expect(JSON.stringify(evidence)).not.toMatch(/patientId|subject_ref|birthDate|password|allergies|issuer/);
  }, 20000);

  it('keeps a complaint with no eligible denominator without reporting a false rate', async () => {
    const value = await snapshot({ start: '2026-08-23', end: '2026-08-23', facilityId: 'sozak-hospital' });
    const result = aggregateRegionalKpi(value, 'complaints-hospital');
    expect(result).toMatchObject({ numerator: 1, denominator: 0, sourceCount: 1, value: null,
      status: 'no_data', incompleteDenominator: true, targetApplicability: 'different_period' });
    const evidence = await allEvidence({ ...value.period, facilityId: 'sozak-hospital', indicatorId: 'complaints-hospital' });
    expect(evidence.items).toHaveLength(1); expect(evidence.items[0].kind).toBe('complaint_decision');
  }, 20000);

  it('returns missing historical data and one latest staffing snapshot, never sums months', async () => {
    const empty = await snapshot({ start: '2026-01-01', end: '2026-01-31' });
    for (const definition of empty.definitions) expect(aggregateRegionalKpi(empty, definition.id).value).toBeNull();
    const long = await snapshot({ start: '2026-07-01', end: '2026-09-30', facilityId: 'sozak-hospital' });
    expect(aggregateRegionalKpi(long, 'doctor-staffing')).toMatchObject({ numerator: 6, denominator: 8 });
    const month = await snapshot({ ...period, facilityId: 'sozak-hospital' });
    expect(aggregateRegionalKpi(long, 'doctor-staffing').value).toBe(aggregateRegionalKpi(month, 'doctor-staffing').value);
  }, 20000);

  it('executes as the runtime role and preserves exact staff scope without reusing owner credentials', async () => {
    const own = await snapshot(period, 'doctor');
    expect(own.facilities.map(row => row.id)).toEqual(['turkestan-hospital']);
    expect((await snapshot(period, 'none')).facilities).toEqual([]);
    await expect(rpc('snapshot', { ...period, facilityId: 'sozak-hospital' }, 'doctor')).rejects.toMatchObject({ code: 'PT403' });
    await expect(rpc('evidence', { ...period, facilityId: 'sozak-hospital', indicatorId: 'lab-turnaround' }, 'doctor')).rejects.toMatchObject({ code: 'PT403' });
    await expect(rpc('evidence', { ...period, facilityId: 'turkestan-polyclinic', indicatorId: 'doctor-staffing' })).rejects.toMatchObject({ code: 'PT400' });
    const valid = await allEvidence({ ...period, facilityId: 'turkestan-hospital', indicatorId: 'complaints-hospital' }, 'doctor');
    expect(valid.total).toBeGreaterThan(20);
  }, 20000);
});
