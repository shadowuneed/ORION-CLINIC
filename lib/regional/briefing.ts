import { z } from 'zod';
import { regionalIdSchema, type RegionalFacilitySnapshot, type RegionalOverview } from './contracts';

export const regionalBriefingRequestSchema = z.object({ districtId: regionalIdSchema.optional(), facilityId: regionalIdSchema.optional() })
  .strict().refine(value => !(value.districtId && value.facilityId));
export type RegionalBriefingRequest = z.infer<typeof regionalBriefingRequestSchema>;
export const regionalBriefingContentSchema = z.object({
  summary: z.string().trim().min(1).max(900),
  priorities: z.array(z.string().trim().min(1).max(300)).max(5),
}).strict();
export const regionalBriefingResponseSchema = regionalBriefingContentSchema.extend({
  id: regionalIdSchema, provider: z.literal('groq'), model: z.string().min(1).max(120),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), generatedAt: z.iso.datetime(), reviewRequired: z.literal(true),
}).strict();
export type RegionalBriefing = z.infer<typeof regionalBriefingResponseSchema>;

const counts = (row: RegionalOverview['totals']) => ({
  hospitalCount: row.hospitalCount, polyclinicCount: row.polyclinicCount, patientCount: row.patientCount,
  activeVisits: row.activeVisits, queuedVisits: row.queuedVisits, openTasks: row.openTasks,
  overdueTasks: row.overdueTasks, onTimeTasks: row.onTimeTasks, dueTasks: row.dueTasks,
  completedTasks: row.completedTasks, totalTasks: row.totalTasks, kpiPercent: row.kpiPercent,
});
const kpi = (definition: RegionalOverview['kpiDefinition']) => ({
  meaning: 'Доля задач с истёкшим сроком, завершённых вовремя',
  periodStart: definition.periodStart, periodEnd: definition.periodEnd,
});

/** Fixed aggregate projection: no patient IDs, names, diagnoses or arbitrary text. */
export function regionalBriefingSource(snapshot: RegionalOverview, scope: RegionalBriefingRequest) {
  const facility = scope.facilityId ? snapshot.facilities.find(row => row.id === scope.facilityId) : undefined;
  const district = scope.districtId ? snapshot.districts.find(row => row.id === scope.districtId) : undefined;
  if ((scope.facilityId && !facility) || (scope.districtId && !district)) throw new Error('REGIONAL_NOT_FOUND');
  return {
    dataMode: 'training', scopeType: facility ? 'facility' : district ? 'district' : 'region',
    scopeId: facility?.id ?? district?.id ?? 'turkestan',
    metrics: counts(facility ?? district ?? snapshot.totals),
    comparisons: facility ? [] : snapshot.districts.filter(row => district ? row.id === district.id : row.regionId === 'turkestan')
      .map(row => ({ id: row.id, ...counts(row) })),
    kpi: kpi(snapshot.kpiDefinition),
  };
}

/** Employee path never requests an oblast overview, even temporarily. */
export function regionalFacilityBriefingSource(
  snapshot: Pick<RegionalFacilitySnapshot, 'facility' | 'kpiDefinition'>, facilityId: string,
) {
  if (snapshot.facility.id !== facilityId) throw new Error('REGIONAL_NOT_FOUND');
  return {
    dataMode: 'training', scopeType: 'facility', scopeId: snapshot.facility.id,
    metrics: counts(snapshot.facility), comparisons: [], kpi: kpi(snapshot.kpiDefinition),
  };
}
