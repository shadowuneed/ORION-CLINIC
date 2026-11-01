import { describe, expect, it } from 'vitest';
import { regionalAnalyticsScope } from './analytics-scope';
import type { RegionalFacilitySnapshot, RegionalOverview, RegionalScope } from './contracts';
import { regionalBriefingRequestSchema } from './briefing';

const time = '2026-10-09T10:00:00.000Z';
const metrics = { hospitalCount: 1, polyclinicCount: 1, patientCount: 8, activeVisits: 6, queuedVisits: 3,
  openTasks: 7, overdueTasks: 1, completedTasks: 3, totalTasks: 10, onTimeTasks: 2, dueTasks: 4, kpiPercent: 50 };
const facilities: RegionalOverview['facilities'] = ['one', 'two', 'neighbor'].map((id, index) => ({ ...metrics, id,
  clinicId: `clinic-${id}`, districtId: index === 2 ? 'shymkent' : 'sozak', name: `Больница ${id}`,
  kind: 'hospital', latitude: 43.8, longitude: 69.1, address: 'Учебная организация', populated: true }));
const access: RegionalScope = { schemaVersion: 1, canViewRegion: true, generatedAt: time,
  facilities: facilities.map(row => ({ id: row.id, clinicId: row.clinicId, districtId: row.districtId,
    name: row.name, kind: row.kind, canManage: true })) };
const overview: RegionalOverview = { schemaVersion: 1, dataMode: 'training', generatedAt: time,
  districts: [{ ...metrics, id: 'sozak', name: 'Сузакский район', kind: 'district', regionId: 'turkestan' },
    { ...metrics, id: 'shymkent', name: 'Шымкент', kind: 'city', regionId: 'shymkent' }],
  facilities, totals: { ...metrics, dueTasks: 20, onTimeTasks: 10 }, sourceNote: 'Сохранённые учебные записи',
  kpiDefinition: { title: 'Задачи', formula: 'Соблюдение сроков', periodStart: time, periodEnd: time },
  insights: facilities.map(row => ({ id: `finding-${row.id}`, severity: 'warning', title: row.name, detail: 'Сохранённое событие',
    districtId: row.districtId, facilityId: row.id })),
};
function input(overrides: Partial<Parameters<typeof regionalAnalyticsScope>[0]> = {}) {
  return { access, overview, facility: null, districtId: 'sozak', facilityId: null, previewFacilityId: null, ...overrides };
}

describe('single selected scope for operational reports and AI', () => {
  it('uses the previewed facility for all report inputs, not the district it belongs to', () => {
    const result = regionalAnalyticsScope(input({ previewFacilityId: 'one' }))!;
    expect(result.request).toEqual({ facilityId: 'one' });
    expect(regionalBriefingRequestSchema.safeParse(result.request).success).toBe(true);
    expect(result.label).toBe('Больница one');
    expect(result.metrics).toBe(facilities[0]);
    expect(result.insights.map(item => item.id)).toEqual(['finding-one']);
  });
  it('gives an open institution priority over a residual preview', () => {
    expect(regionalAnalyticsScope(input({ facilityId: 'two', previewFacilityId: 'one' }))?.request).toEqual({ facilityId: 'two' });
  });
  it('falls back to the district only after the preview is explicitly closed', () => {
    const result = regionalAnalyticsScope(input())!;
    expect(result.request).toEqual({ districtId: 'sozak' });
    expect(result.metrics).toBe(overview.districts[0]);
    expect(result.insights.map(item => item.id)).toEqual(['finding-one', 'finding-two']);
  });
  it('never broadens an unavailable or unassigned facility selection into district data', () => {
    expect(regionalAnalyticsScope(input({ previewFacilityId: 'missing' }))).toBeNull();
    expect(regionalAnalyticsScope(input({ facilityId: 'missing', previewFacilityId: 'one' }))).toBeNull();
    const result = regionalAnalyticsScope(input({ previewFacilityId: 'one', overview: { ...overview, facilities: [] } }))!;
    expect(result.request).toEqual({ facilityId: 'one' });
    expect(result.metrics).toBeNull();
  });
  it('does not manufacture operational counters for a scope-only staff preview', () => {
    const result = regionalAnalyticsScope(input({ access: { ...access, canViewRegion: false }, previewFacilityId: 'one' }))!;
    expect(result.request).toEqual({ facilityId: 'one' });
    expect(result.metrics).toBeNull(); expect(result.definition).toBeNull(); expect(result.insights).toEqual([]);
  });
  it('takes matching institution data and ignores a stale snapshot of another institution', () => {
    const snapshot = { facility: { ...facilities[1], dueTasks: 8 }, kpiDefinition: overview.kpiDefinition,
      insights: [{ id: 'current', title: 'Текущее учреждение', detail: 'Сохранено', severity: 'info' }] } as RegionalFacilitySnapshot;
    const selected = regionalAnalyticsScope(input({ facilityId: 'two', facility: snapshot }))!;
    expect(selected.metrics?.dueTasks).toBe(8); expect(selected.insights.map(row => row.id)).toEqual(['current']);
    const other = regionalAnalyticsScope(input({ previewFacilityId: 'one', facility: snapshot }))!;
    expect(other.metrics).toBe(facilities[0]); expect(other.insights.map(row => row.id)).toEqual(['finding-one']);
  });
  it('keeps the neighboring city separate from the oblast counters and findings', () => {
    const region = regionalAnalyticsScope(input({ districtId: null }))!;
    expect(region.request).toEqual({}); expect(region.metrics).toBe(overview.totals);
    expect(region.insights.map(row => row.id)).toEqual(['finding-one', 'finding-two']);
    expect(regionalAnalyticsScope(input({ districtId: 'shymkent' }))?.insights.map(row => row.id)).toEqual(['finding-neighbor']);
  });
  it('fails closed for lost access, unavailable overview and unknown territory', () => {
    expect(regionalAnalyticsScope(input({ access: null, facilityId: 'one' }))).toBeNull();
    expect(regionalAnalyticsScope(input({ overview: null }))).toBeNull();
    expect(regionalAnalyticsScope(input({ districtId: 'missing' }))).toBeNull();
    expect(regionalAnalyticsScope(input({ access: { ...access, canViewRegion: false } }))).toBeNull();
  });
});
