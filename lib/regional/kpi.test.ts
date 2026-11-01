import { describe, expect, it } from 'vitest';
import {
  aggregateRegionalKpi, compareRegionalKpi, regionalKpiDefinitionSchema,
  regionalKpiEvidenceQuerySchema, regionalKpiEvidenceSchema,
  regionalKpiObservationSchema, regionalKpiQuerySchema, regionalKpiSnapshotSchema,
  type RegionalKpiDefinition, type RegionalKpiObservation, type RegionalKpiSnapshot,
} from './kpi';

function definition(overrides: Partial<RegionalKpiDefinition> = {}): RegionalKpiDefinition {
  return {
    id: 'complaints-hospital', title: 'Обоснованные жалобы', category: 'quality',
    sourceType: 'official', sourceTitle: 'Приказ ҚР ДСМ-230/2020',
    sourceUrl: 'https://adilet.zan.kz/rus/docs/V2000021713', sourceVersion: '2025-09-18',
    applicableKinds: ['hospital'], basis: 'ratio_per_1000', direction: 'lower',
    target: 1, targetPeriod: 'calendar_month', unit: 'на 1000',
    numeratorLabel: 'Обоснованные жалобы', denominatorLabel: 'Пролеченные пациенты',
    periodKind: 'interval', note: 'Месячный показатель; учебные данные.', ...overrides,
  };
}

function observation(overrides: Partial<RegionalKpiObservation> = {}): RegionalKpiObservation {
  return {
    facilityId: 'h1', indicatorId: 'complaints-hospital', numerator: 1, denominator: 100,
    sourceCount: 101, lastObservedAt: '2026-09-30T18:00:00+05:00', ...overrides,
  };
}

function snapshot(): RegionalKpiSnapshot {
  return {
    schemaVersion: 1, dataMode: 'training', generatedAt: '2026-10-09T12:00:00.000Z',
    period: { start: '2026-09-01', end: '2026-09-30' }, definitions: [definition()],
    facilities: [
      { id: 'h1', name: 'Больница 1', kind: 'hospital', districtId: 'a', regionId: 'turkestan' },
      { id: 'h2', name: 'Больница 2', kind: 'hospital', districtId: 'b', regionId: 'turkestan' },
      { id: 'h3', name: 'Больница 3', kind: 'hospital', districtId: 'a', regionId: 'shymkent' },
      { id: 'p1', name: 'Поликлиника 1', kind: 'polyclinic', districtId: 'a', regionId: 'turkestan' },
    ],
    observations: [observation(), observation({ facilityId: 'h2', numerator: 0, denominator: 900, sourceCount: 900 })],
  };
}

describe('regional KPI contracts', () => {
  it('accepts PostgreSQL offset timestamps, strict snapshots and fractional staffing positions', () => {
    expect(regionalKpiSnapshotSchema.parse(snapshot())).toEqual(snapshot());
    expect(regionalKpiObservationSchema.safeParse(observation({ denominator: 12.5 })).success).toBe(true);
  });

  it.each([
    { start: '2026-02-29', end: '2026-03-01' },
    { start: '2026-04-31', end: '2026-05-01' },
    { start: '2026-09-02', end: '2026-09-01' },
    { start: '2025-01-01', end: '2026-01-02' },
    { start: '2026-1-01', end: '2026-01-31' },
    { start: '2026-01-01T00:00:00Z', end: '2026-01-31' },
    { start: '2026-01-01', end: '2026-01-31', regionId: 'turkestan' },
    { start: '2026-01-01', end: '2026-01-31', facilityId: '' },
    { start: '1899-12-31', end: '1900-01-01' },
    { start: '2200-12-31', end: '2201-01-01' },
  ])('rejects malformed or overbroad queries: %j', query => {
    expect(regionalKpiQuerySchema.safeParse(query).success).toBe(false);
  });

  it('allows actual leap dates, a single date and exactly 366 inclusive days', () => {
    for (const query of [
      { start: '2024-02-29', end: '2024-02-29' },
      { start: '2024-01-01', end: '2024-12-31' },
      { start: '2026-01-01', end: '2027-01-01', facilityId: 'h1' },
    ]) expect(regionalKpiQuerySchema.safeParse(query).success).toBe(true);
  });

  it.each([
    { numerator: -1 }, { denominator: -1 }, { numerator: Infinity }, { denominator: NaN },
    { sourceCount: 0.5 }, { sourceCount: -1 }, { sourceCount: 0 }, { lastObservedAt: null },
    { lastObservedAt: '2026-09-30' }, { denominator: Number.MIN_VALUE }, { patientName: 'private' },
  ])('rejects invalid counts or unproven reported values: %j', patch => {
    expect(regionalKpiObservationSchema.safeParse({ ...observation(), ...patch }).success).toBe(false);
  });

  it('accepts explicit missing observation and does not cap staffing or complaints at 100%', () => {
    expect(regionalKpiObservationSchema.safeParse(observation({ numerator: 0, denominator: 0, sourceCount: 0, lastObservedAt: null })).success).toBe(true);
    expect(regionalKpiObservationSchema.safeParse(observation({ numerator: 125, denominator: 100 })).success).toBe(true);
  });

  it.each(['unknown-facility', 'unknown-indicator', 'duplicate-pair', 'inapplicable', 'duplicate-facility', 'duplicate-definition', 'extra-field'])('rejects inconsistent snapshot relations: %s', change => {
    const input = snapshot();
    if (change === 'unknown-facility') input.observations[0].facilityId = 'missing';
    if (change === 'unknown-indicator') input.observations[0].indicatorId = 'missing';
    if (change === 'duplicate-pair') input.observations.push({ ...input.observations[0] });
    if (change === 'inapplicable') input.observations[0].facilityId = 'p1';
    if (change === 'duplicate-facility') input.facilities.push({ ...input.facilities[0] });
    if (change === 'duplicate-definition') input.definitions.push({ ...input.definitions[0] });
    const candidate = change === 'extra-field' ? { ...input, records: [] } : input;
    expect(regionalKpiSnapshotSchema.safeParse(candidate).success).toBe(false);
  });

  it('requires explicit official source, unique applicability and compatible snapshot timing', () => {
    for (const patch of [
      { sourceUrl: null }, { sourceUrl: 'javascript:alert(1)' },
      { applicableKinds: ['hospital', 'hospital'] }, { targetPeriod: 'snapshot' },
      { periodKind: 'snapshot' }, { title: ' ' },
    ]) expect(regionalKpiDefinitionSchema.safeParse({ ...definition(), ...patch }).success).toBe(false);
  });
});

describe('weighted multi-facility aggregation', () => {
  it('uses 1/1000, not a naive mean of the two facility rates (10 and 0)', () => {
    const result = aggregateRegionalKpi(snapshot(), 'complaints-hospital', { regionId: 'turkestan' });
    expect(result).toMatchObject({ value: 1, numerator: 1, denominator: 1000, sourceCount: 1001,
      effectiveTarget: 1, status: 'within_target', coverage: { eligible: 2, reporting: 2, missing: 0 } });
    expect(result.value).not.toBe(5);
  });

  it('keeps out-of-region institutions and incompatible polyclinic denominators out', () => {
    const input = snapshot();
    input.observations.push(observation({ facilityId: 'h3', numerator: 100, denominator: 100 }));
    const result = aggregateRegionalKpi(input, 'complaints-hospital', { regionId: 'turkestan', districtId: 'a' });
    expect(result).toMatchObject({ value: 10, status: 'outside_target', coverage: { eligible: 1, reporting: 1, missing: 0 } });
  });

  it.each([{ regionId: 'missing' }, { districtId: 'missing' }, { facilityId: 'missing' },
    { districtId: 'a', facilityId: 'h2' }, { facilityId: 'p1' }])('never falls back to the network for an unmatched scope %j', scope => {
    expect(aggregateRegionalKpi(snapshot(), 'complaints-hospital', scope)).toMatchObject({
      value: null, status: 'no_data', coverage: { eligible: 0, reporting: 0, missing: 0 },
    });
  });

  it('reports missing coverage rather than turning absent data into zero or penalizing the value', () => {
    const result = aggregateRegionalKpi(snapshot(), 'complaints-hospital');
    expect(result).toMatchObject({ value: 1, coverage: { eligible: 3, reporting: 2, missing: 1 } });
    expect(aggregateRegionalKpi(snapshot(), 'complaints-hospital', { facilityId: 'h3' })).toMatchObject({
      value: null, status: 'no_data', numerator: 0, denominator: 0, sourceCount: 0,
      lastObservedAt: null, coverage: { eligible: 1, reporting: 0, missing: 1 },
    });
  });

  it('distinguishes a measured zero rate from a missing denominator', () => {
    const input = snapshot();
    input.observations.push(observation({ facilityId: 'h3', numerator: 0, denominator: 0, sourceCount: 0, lastObservedAt: null }));
    expect(aggregateRegionalKpi(input, 'complaints-hospital', { facilityId: 'h2' })).toMatchObject({ value: 0, status: 'within_target' });
    expect(aggregateRegionalKpi(input, 'complaints-hospital', { facilityId: 'h3' })).toMatchObject({ value: null, status: 'no_data' });
  });

  it('preserves complaints with no denominator, blocking a misleading network rate', () => {
    const input = snapshot();
    input.observations.push(observation({ facilityId: 'h3', numerator: 2, denominator: 0, sourceCount: 2 }));
    expect(regionalKpiSnapshotSchema.safeParse(input).success).toBe(true);
    expect(aggregateRegionalKpi(input, 'complaints-hospital', { facilityId: 'h3' })).toMatchObject({
      numerator: 2, denominator: 0, sourceCount: 2, value: null, status: 'no_data', incompleteDenominator: true,
      coverage: { eligible: 1, reporting: 0, missing: 1 },
    });
    expect(aggregateRegionalKpi(input, 'complaints-hospital')).toMatchObject({
      numerator: 3, denominator: 1000, sourceCount: 1003, value: null, incompleteDenominator: true,
      coverage: { eligible: 3, reporting: 2, missing: 1 },
    });
    expect(aggregateRegionalKpi(input, 'complaints-hospital', { regionId: 'turkestan' }).value).toBe(1);
  });

  it('cannot report a sourceCount-zero row even if handed an unvalidated in-memory object', () => {
    const input = snapshot();
    input.observations[0].sourceCount = 0;
    expect(aggregateRegionalKpi(input, 'complaints-hospital', { facilityId: 'h1' })).toMatchObject({
      value: null, coverage: { eligible: 1, reporting: 0, missing: 1 },
    });
  });

  it.each([
    { start: '2026-09-01', end: '2026-09-29' },
    { start: '2026-09-02', end: '2026-09-30' },
    { start: '2026-09-01', end: '2026-10-31' },
  ])('preserves the measured rate without applying a monthly norm to custom interval %j', period => {
    const input = snapshot(); input.period = period;
    expect(aggregateRegionalKpi(input, 'complaints-hospital')).toMatchObject({
      value: 1, effectiveTarget: null, targetApplicability: 'different_period', status: 'no_target',
    });
  });

  it('qualifies exact leap-month bounds and does not round before threshold comparison', () => {
    const input = snapshot(); input.period = { start: '2024-02-01', end: '2024-02-29' };
    input.observations = [observation({ numerator: 1, denominator: 999.99 })];
    expect(aggregateRegionalKpi(input, 'complaints-hospital')).toMatchObject({ effectiveTarget: 1, status: 'outside_target' });
  });

  it('weights lab turnaround by actual specimen count without a fabricated target', () => {
    const input = snapshot();
    input.definitions = [definition({ id: 'lab-turnaround', category: 'laboratory', basis: 'mean_minutes',
      applicableKinds: ['hospital', 'polyclinic'], target: null, targetPeriod: 'any', unit: 'мин' })];
    input.observations = [
      observation({ indicatorId: 'lab-turnaround', numerator: 90, denominator: 3, sourceCount: 3 }),
      observation({ facilityId: 'p1', indicatorId: 'lab-turnaround', numerator: 90, denominator: 1, sourceCount: 1 }),
    ];
    expect(aggregateRegionalKpi(input, 'lab-turnaround')).toMatchObject({
      value: 45, numerator: 180, denominator: 4, status: 'no_target', targetApplicability: 'not_defined',
    });
  });

  it('aggregates one staffing snapshot per hospital and never sums snapshots over months', () => {
    const input = snapshot();
    input.definitions = [definition({ id: 'doctor-staffing', category: 'resources', basis: 'percent',
      direction: 'higher', target: 80, targetPeriod: 'snapshot', periodKind: 'snapshot', unit: '%' })];
    input.observations = [
      observation({ indicatorId: 'doctor-staffing', numerator: 10, denominator: 12.5, sourceCount: 23 }),
      observation({ facilityId: 'h2', indicatorId: 'doctor-staffing', numerator: 30, denominator: 37.5, sourceCount: 68 }),
    ];
    expect(aggregateRegionalKpi(input, 'doctor-staffing')).toMatchObject({ value: 80, status: 'within_target' });
    input.period.start = '2026-01-01';
    expect(aggregateRegionalKpi(input, 'doctor-staffing')).toMatchObject({ value: 80, status: 'within_target' });
    input.observations.push({ ...input.observations[0], lastObservedAt: '2026-08-31T00:00:00Z' });
    expect(regionalKpiSnapshotSchema.safeParse(input).success).toBe(false);
  });

  it('keeps internal task on-time performance separate from medical quality', () => {
    const input = snapshot();
    input.definitions.push(definition({ id: 'task-ontime', title: 'Задачи в срок', category: 'operations',
      basis: 'percent', direction: 'higher', target: null, targetPeriod: 'any', sourceType: 'internal', sourceUrl: null }));
    input.observations.push(observation({ indicatorId: 'task-ontime', numerator: 99, denominator: 100 }));
    const quality = aggregateRegionalKpi(input, 'complaints-hospital');
    const operations = aggregateRegionalKpi(input, 'task-ontime');
    expect(quality.value).toBe(1); expect(operations.value).toBe(99);
    expect(compareRegionalKpi(quality, operations)).toEqual({ comparable: false, reason: 'different_indicator', delta: null });
  });

  it('uses actual instants for latest source time even with different offsets', () => {
    const input = snapshot();
    input.observations[0].lastObservedAt = '2026-09-30T20:00:00+05:00';
    input.observations[1].lastObservedAt = '2026-09-30T16:00:00Z';
    expect(aggregateRegionalKpi(input, 'complaints-hospital').lastObservedAt).toBe('2026-09-30T16:00:00Z');
  });

  it('rejects unknown indicators and never mutates source arrays', () => {
    const input = snapshot(); const before = JSON.stringify(input);
    expect(() => aggregateRegionalKpi(input, 'unknown')).toThrow('REGIONAL_KPI_INDICATOR_UNKNOWN');
    aggregateRegionalKpi(input, 'complaints-hospital');
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('like-for-like comparison', () => {
  it('compares the same definition and period at two facilities', () => {
    const input = snapshot();
    expect(compareRegionalKpi(aggregateRegionalKpi(input, 'complaints-hospital', { facilityId: 'h1' }),
      aggregateRegionalKpi(input, 'complaints-hospital', { facilityId: 'h2' }))).toEqual({ comparable: true, reason: 'comparable', delta: 10 });
  });

  it.each(['period', 'version', 'basis', 'target', 'source', 'missing'])('does not compare mismatched %s', change => {
    const input = snapshot(); const left = aggregateRegionalKpi(input, 'complaints-hospital');
    if (change === 'period') input.period = { start: '2026-08-01', end: '2026-08-31' };
    if (change === 'version') input.definitions[0] = { ...input.definitions[0], sourceVersion: 'different' };
    if (change === 'basis') input.definitions[0] = { ...input.definitions[0], basis: 'percent' };
    if (change === 'target') input.definitions[0] = { ...input.definitions[0], target: 2 };
    if (change === 'source') input.definitions[0] = { ...input.definitions[0], sourceType: 'internal' };
    if (change === 'missing') input.observations = [];
    expect(compareRegionalKpi(left, aggregateRegionalKpi(input, 'complaints-hospital')).comparable).toBe(false);
  });
});

describe('bounded source evidence', () => {
  function evidence() {
    return {
      schemaVersion: 1, facilityId: 'h1', indicatorId: 'complaints-hospital',
      period: { start: '2026-09-01', end: '2026-09-30' }, total: 2, offset: 0, nextOffset: null,
      items: [
        { id: 'care:one', observedAt: '2026-09-30T12:00:00Z', kind: 'care_episode', label: 'Завершённый случай', value: 1, unit: 'случай' },
        { id: 'complaint:two', observedAt: '2026-09-29T12:00:00Z', kind: 'complaint_decision', label: 'Решение по жалобе', value: 0, unit: 'жалоба' },
      ],
    };
  }

  it('requires exact facility and indicator and bounded numeric offsets', () => {
    const query = { start: '2026-09-01', end: '2026-09-30', facilityId: 'h1', indicatorId: 'complaints-hospital' };
    expect(regionalKpiEvidenceQuerySchema.parse(query)).toEqual(query);
    for (const patch of [{ facilityId: undefined }, { indicatorId: undefined }, { offset: -1 },
      { offset: 10_001 }, { offset: '20' }, { offset: 0.5 }, { patientId: 'private' }, { indicatorId: 'unknown' }]) {
      expect(regionalKpiEvidenceQuerySchema.safeParse({ ...query, ...patch }).success).toBe(false);
    }
  });

  it('accepts no-PHI source references and retains rejected complaint evidence as zero', () => {
    expect(regionalKpiEvidenceSchema.safeParse(evidence()).success).toBe(true);
    expect(regionalKpiEvidenceSchema.safeParse({ ...evidence(), total: 0, items: [] }).success).toBe(true);
    expect(regionalKpiEvidenceSchema.safeParse({ ...evidence(), total: 1, indicatorId: 'doctor-staffing', items: [
      { ...evidence().items[0], id: 'position:staffing-snapshot-09:doctor-position-01', kind: 'doctor_position', value: 0.5 },
    ] }).success).toBe(true);
  });

  it('validates fixed pages of twenty and forward-only offsets', () => {
    const value = evidence(); value.total = 21;
    value.items = Array.from({ length: 20 }, (_, i) => ({ ...value.items[0], id: `care:${String(i).padStart(2, '0')}` }));
    const first = { ...value, nextOffset: 20 };
    expect(regionalKpiEvidenceSchema.safeParse(first).success).toBe(true);
    expect(regionalKpiEvidenceSchema.safeParse({ ...first, nextOffset: 0 }).success).toBe(false);
    expect(regionalKpiEvidenceSchema.safeParse({ ...first, nextOffset: null }).success).toBe(false);
    expect(regionalKpiEvidenceSchema.safeParse({ ...first, items: [...value.items, { ...value.items[0], id: 'care:99' }] }).success).toBe(false);
    expect(regionalKpiEvidenceSchema.safeParse({ ...value, offset: 20, items: [value.items[0]], nextOffset: null }).success).toBe(true);
  });

  it.each(['reverse', 'duplicate', 'wrong-kind', 'unknown-kind', 'extra-private', 'missing-row', 'unknown-field'])('rejects inconsistent source evidence: %s', change => {
    const value = evidence();
    if (change === 'reverse') value.items.reverse();
    if (change === 'duplicate') value.items[1] = { ...value.items[0] };
    if (change === 'wrong-kind') value.items[0].kind = 'lab_sample';
    if (change === 'unknown-kind') value.items[0].kind = 'patient_record';
    if (change === 'missing-row') value.items.pop();
    const candidate = change === 'extra-private' ? { ...value, items: [{ ...value.items[0], patientName: 'private' }, value.items[1]] }
      : change === 'unknown-field' ? { ...value, clinicalRecords: [] } : value;
    expect(regionalKpiEvidenceSchema.safeParse(candidate).success).toBe(false);
  });

  it('bounds continuation even at the maximum query offset', () => {
    const value = evidence(); value.total = 10_050; value.offset = 10_000;
    value.items = Array.from({ length: 20 }, (_, i) => ({ ...value.items[0], id: `care:${String(i).padStart(2, '0')}` }));
    expect(regionalKpiEvidenceSchema.safeParse(value).success).toBe(true);
  });
});
