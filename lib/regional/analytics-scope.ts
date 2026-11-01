import type { RegionalBriefingRequest } from './briefing';
import type { RegionalFacilitySnapshot, RegionalOverview, RegionalScope } from './contracts';

type Input = {
  access: RegionalScope | null;
  overview: RegionalOverview | null;
  facility: RegionalFacilitySnapshot | null;
  districtId: string | null;
  facilityId: string | null;
  previewFacilityId: string | null;
};
export type RegionalAnalyticsScope = {
  request: RegionalBriefingRequest;
  label: string;
  metrics: RegionalOverview['totals'] | null;
  insights: RegionalOverview['insights'];
  definition: RegionalOverview['kpiDefinition'] | null;
};

/** The report, its findings, and the AI request describe one selected scope.
 * This is UI selection, never a substitute for API authorization. A stale or
 * unavailable selection must not silently become a broader district report.
 */
export function regionalAnalyticsScope(input: Input): RegionalAnalyticsScope | null {
  const { access, facility, districtId, facilityId, previewFacilityId } = input;
  if (!access) return null;
  const overview = access.canViewRegion ? input.overview : null;
  const selectedId = facilityId ?? previewFacilityId;
  if (selectedId) {
    const assigned = access.facilities.find(row => row.id === selectedId);
    if (!assigned) return null;
    const snapshot = facility?.facility.id === selectedId ? facility : null;
    const aggregate = snapshot?.facility ?? overview?.facilities.find(row => row.id === selectedId) ?? null;
    return {
      request: { facilityId: selectedId }, label: aggregate?.name ?? assigned.name, metrics: aggregate,
      insights: snapshot ? snapshot.insights.filter(item => !item.facilityId || item.facilityId === selectedId)
        : overview?.insights.filter(item => item.facilityId === selectedId) ?? [],
      definition: snapshot?.kpiDefinition ?? overview?.kpiDefinition ?? null,
    };
  }
  if (!overview) return null;
  const district = districtId ? overview.districts.find(row => row.id === districtId) : null;
  if (districtId && !district) return null;
  const districtIds = new Set(district ? [district.id] : overview.districts.filter(row => row.regionId === 'turkestan').map(row => row.id));
  const facilityIds = new Set(overview.facilities.filter(row => districtIds.has(row.districtId)).map(row => row.id));
  return {
    request: district ? { districtId: district.id } : {}, label: district?.name ?? 'Туркестанская область',
    metrics: district ?? overview.totals, definition: overview.kpiDefinition,
    insights: overview.insights.filter(item => item.facilityId ? facilityIds.has(item.facilityId)
      : item.districtId ? districtIds.has(item.districtId) : !district),
  };
}
