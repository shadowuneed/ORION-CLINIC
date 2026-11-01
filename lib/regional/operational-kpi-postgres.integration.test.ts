import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aggregateRegionalKpi, regionalKpiEvidenceSchema, regionalKpiSnapshotSchema,
  type RegionalKpiEvidence, type RegionalKpiEvidenceQuery } from './kpi';

const operational = ['pharmacy-fulfillment', 'procurement-on-time', 'tasks-on-time', 'visits-completion', 'encounter-documentation'] as const;
const period = { start: '2025-01-01', end: '2025-01-31' };
const facilityId = 'turkestan-hospital';
const fixtureIds = ['ops-rollback-admin', 'ops-rollback-doctor', 'ops-rollback-none'];

// Public SQL DTO seam, not a migration runner. The reviewed SQL acceptance fixture
// supplies deliberately authored cohorts inside this one rollback-only transaction.
describe.runIf(process.env.ORION_OPERATIONAL_KPI_PG_TEST === '1')('operational KPI public SQL DTO integration', () => {
  let db: Client | undefined; let connected = false; let began = false; let example = false;
  let today: string;
  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated PC runtime required');
    const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM'); const data = join(runtime, 'data');
    const marker = JSON.parse(readFileSync(join(runtime, 'cluster-owner.json'), 'utf8'));
    const admin = JSON.parse(readFileSync(join(runtime, 'admin.json'), 'utf8'));
    if (marker?.kind !== 'orion-crm-local-v1' || marker?.port !== 55432 || typeof marker?.data !== 'string'
      || resolve(marker.data).toLowerCase() !== resolve(data).toLowerCase()
      || admin?.host !== '127.0.0.1' || admin?.port !== 55432 || admin?.user !== 'postgres'
      || typeof admin?.password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) throw new Error('Exact dedicated PostgreSQL ownership required');
    const { password } = admin;
    db = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password, database: 'orion_crm_local',
      ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 15000, lock_timeout: 3000, application_name: 'orion-operational-kpi-contract-rollback-tests' });
    await db.connect(); connected = true;
    const target = (await db.query('SELECT current_database() name, inet_server_port() port')).rows[0];
    const directory = (await db.query('SHOW data_directory')).rows[0].data_directory;
    if (target.name !== 'orion_crm_local' || target.port !== 55432
      || realpathSync(directory).toLowerCase() !== realpathSync(data).toLowerCase()) throw new Error('Unexpected PostgreSQL target; no mutations made');
    const installed = (await db.query("SELECT to_regprocedure('orion_region.operational_kpi_records(text[],timestamptz,timestamptz,text)') IS NOT NULL installed")).rows[0].installed;
    if (!installed) throw new Error('Apply reviewed operational KPI migration before opting into this test');
    if ((await db.query('SELECT count(*)::int n FROM orion_directory.accounts WHERE id=ANY($1::text[])', [fixtureIds])).rows[0].n !== 0) throw new Error('Fixture identities already exist; no mutations made');
    const source = readFileSync(new URL('../../db/regional/operational-kpi-rollback.sql', import.meta.url), 'utf8');
    const fixture = source.replace(/^(\s*(?:--[^\n]*\n\s*)*)BEGIN;\s*/, '$1').replace(/ROLLBACK;\s*$/, '');
    if (fixture === source || !/ROLLBACK;\s*$/.test(source) || /^\s*(?:BEGIN|COMMIT|ROLLBACK);/m.test(fixture)) throw new Error('Expected rollback-only acceptance fixture');
    await db.query('BEGIN'); began = true;
    today = (await db.query("SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date+1)::text AS future_day")).rows[0].future_day;
    await db.query(fixture);
    // The acceptance fixture ends by testing revocation of its own synthetic
    // doctor. Restore only that transaction-local membership for DTO reads.
    await db.query("UPDATE orion_directory.memberships SET interactive=true WHERE user_id='ops-rollback-doctor'");
  }, 30000);
  beforeEach(async () => { if (began) { await db!.query('SAVEPOINT example'); example = true; } });
  afterEach(async () => { if (example) { await db!.query('ROLLBACK TO SAVEPOINT example'); await db!.query('RELEASE SAVEPOINT example'); example = false; } });
  afterAll(async () => {
    if (!db) return;
    try {
      if (began) {
        await db.query('ROLLBACK'); began = false;
        expect((await db.query('SELECT count(*)::int n FROM orion_directory.accounts WHERE id=ANY($1::text[])', [fixtureIds])).rows[0].n).toBe(0);
        expect((await db.query("SELECT count(*)::int n FROM orion_clinical.encounters WHERE clinic_id='region-turkestan-hospital' AND id LIKE 'ops-encounter-%'")).rows[0].n).toBe(0);
      }
    } finally { if (connected) await db.end(); }
  });
  async function asRuntime(sql: string, params: unknown[] = []) {
    await db!.query('SAVEPOINT dto_rpc');
    try {
      await db!.query('SET LOCAL ROLE orion_crm_app');
      const result: unknown = (await db!.query(sql, params)).rows[0]?.result;
      await db!.query('RESET ROLE'); await db!.query('RELEASE SAVEPOINT dto_rpc'); return result;
    } catch (error) { await db!.query('ROLLBACK TO SAVEPOINT dto_rpc'); await db!.query('RELEASE SAVEPOINT dto_rpc'); throw error; }
  }
  async function snapshot(query: object = { ...period, facilityId }, subject = 'doctor') {
    return regionalKpiSnapshotSchema.parse(await asRuntime('SELECT public.orion_regional_kpi_v1($1,$2,$3::jsonb) result', ['orion:ops-rollback', subject, JSON.stringify(query)]));
  }
  async function evidence(query: RegionalKpiEvidenceQuery, subject = 'doctor') {
    return regionalKpiEvidenceSchema.parse(await asRuntime('SELECT public.orion_regional_kpi_evidence_v1($1,$2,$3::jsonb) result', ['orion:ops-rollback', subject, JSON.stringify(query)]));
  }
  async function allEvidence(indicatorId: typeof operational[number]) {
    const items: RegionalKpiEvidence['items'] = []; let offset = 0; let total = 0;
    for (let page = 0; page < 501; page += 1) {
      const result = await evidence({ ...period, facilityId, indicatorId, offset });
      if (page > 0) expect(result.total).toBe(total);
      total = result.total; items.push(...result.items);
      if (result.nextOffset === null) return { items, total };
      offset = result.nextOffset;
    }
    throw new Error('Evidence pagination exceeded its bound');
  }

  it('exposes nine definitions with five explicit internal, untargeted operational measures', async () => {
    const value = await snapshot(period, 'admin');
    expect(value.facilities).toHaveLength(36); expect(value.definitions).toHaveLength(9); expect(value.observations).toHaveLength(270);
    expect(value.definitions.filter(row => row.sourceType === 'official')).toHaveLength(4);
    for (const indicator of operational) expect(value.definitions.find(row => row.id === indicator)).toMatchObject({ sourceType: 'internal', target: null, basis: 'percent', category: 'operations' });
  });

  it.each([
    ['pharmacy-fulfillment', 2, 3, 'prescription'], ['procurement-on-time', 1, 3, 'procurement'],
    ['tasks-on-time', 1, 28, 'work_task'], ['visits-completion', 1, 3, 'visit'], ['encounter-documentation', 1, 3, 'encounter'],
  ] as const)('%s matches the authored cohort, full evidence and weighted aggregate', async (indicator, numerator, denominator, kind) => {
    const value = await snapshot(); const actual = aggregateRegionalKpi(value, indicator);
    expect(actual).toMatchObject({ numerator, denominator, sourceCount: denominator, status: 'no_target', effectiveTarget: null });
    const sources = await allEvidence(indicator);
    expect(sources.total).toBe(denominator); expect(sources.items).toHaveLength(denominator);
    expect(new Set(sources.items.map(row => row.id)).size).toBe(denominator);
    expect(sources.items.every(row => row.kind === kind && [0, 1].includes(row.value!))).toBe(true);
    expect(sources.items.reduce((sum, row) => sum + row.value!, 0)).toBe(numerator);
    expect(sources.items.every(row => /^[a-z_]+:[a-f0-9]{32}$/.test(row.id))).toBe(true);
    expect(JSON.stringify(sources)).not.toMatch(/ROLLBACK_PRIVATE|patient-1|patientId|practitioner|prescribed_by|supplier|content/);
  });

  it('sums 1/3 and 2/2 source counts into 3/5, not the average of facility percentages', async () => {
    const value = await snapshot(period, 'admin');
    expect(aggregateRegionalKpi(value, 'procurement-on-time')).toMatchObject({ numerator: 3, denominator: 5, value: 60,
      coverage: { eligible: 36, reporting: 2, missing: 34 } });
  });

  it('keeps dates inclusive in Kazakhstan time and does not count publication or delivery after period end', async () => {
    const january = await snapshot();
    expect(aggregateRegionalKpi(january, 'pharmacy-fulfillment')).toMatchObject({ numerator: 2, denominator: 3 });
    expect(aggregateRegionalKpi(january, 'encounter-documentation')).toMatchObject({ numerator: 1, denominator: 3 });
    const extended = await snapshot({ start: period.start, end: '2025-02-28', facilityId });
    expect(aggregateRegionalKpi(extended, 'pharmacy-fulfillment')).toMatchObject({ numerator: 4, denominator: 4, value: 100 });
    expect(aggregateRegionalKpi(extended, 'encounter-documentation')).toMatchObject({ numerator: 2, denominator: 3 });
  });

  it('returns no-data rather than 0/100 for empty historical or entirely future cohorts', async () => {
    for (const query of [{ start: '2024-01-01', end: '2024-01-31', facilityId }, { start: today, end: today, facilityId }]) {
      const value = await snapshot(query);
      for (const indicator of operational) expect(aggregateRegionalKpi(value, indicator)).toMatchObject({ numerator: 0, denominator: 0, sourceCount: 0, value: null, status: 'no_data' });
    }
  });

  it('preserves official laboratory evidence and calculation through private-core wrappers', async () => {
    const q = { start: '2026-09-01', end: '2026-09-30', facilityId };
    const value = await snapshot(q);
    expect(aggregateRegionalKpi(value, 'lab-turnaround')).toMatchObject({ numerator: 186, denominator: 3, value: 62 });
    expect((await evidence({ ...q, indicatorId: 'lab-turnaround' })).items.map(row => row.kind)).toEqual(['lab_sample', 'lab_sample', 'lab_sample']);
  });

  it('denies cross-facility evidence, unassigned actors and reads after membership revocation', async () => {
    await expect(evidence({ ...period, facilityId: 'kentau-hospital', indicatorId: 'procurement-on-time' })).rejects.toMatchObject({ code: 'PT403' });
    await expect(snapshot({ ...period, facilityId }, 'none')).rejects.toMatchObject({ code: 'PT403' });
    await db!.query("UPDATE orion_directory.memberships SET interactive=false WHERE user_id='ops-rollback-doctor'");
    await expect(snapshot()).rejects.toMatchObject({ code: 'PT403' });
    await expect(evidence({ ...period, facilityId, indicatorId: 'tasks-on-time' })).rejects.toMatchObject({ code: 'PT403' });
  });

  it('keeps the raw cohort and renamed cores inaccessible through runtime credentials', async () => {
    for (const name of ['regional_kpi_core_v1', 'regional_kpi_evidence_core_v1']) {
      await expect(asRuntime(`SELECT orion_region.${name}($1,$2,$3::jsonb) result`, ['orion:ops-rollback', 'admin', JSON.stringify(period)]))
        .rejects.toMatchObject({ code: '42501' });
    }
    await expect(asRuntime("SELECT * FROM orion_region.operational_kpi_records(ARRAY['kentau-hospital'],'2025-01-01','2025-02-01',NULL)"))
      .rejects.toMatchObject({ code: '42501' });
  });
});
