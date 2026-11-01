import type { RegionalScope } from './contracts';

/** Navigation convenience only. Every API/RPC independently checks current grants. */
export function regionalLanding(scope: RegionalScope, requested: { districtId: string | null; facilityId: string | null }) {
  const assigned = scope.facilities.find(row => row.id === requested.facilityId);
  if (scope.canViewRegion) return {
    districtId: assigned?.districtId ?? requested.districtId,
    facilityId: assigned?.id ?? null,
    denied: Boolean(requested.facilityId && !assigned),
  };
  return {
    districtId: null,
    facilityId: assigned?.id ?? (scope.facilities.length === 1 ? scope.facilities[0].id : null),
    denied: Boolean(requested.districtId || (requested.facilityId && !assigned)),
  };
}

export function regionalLocationUrl(districtId: string | null, facilityId: string | null) {
  const query = new URLSearchParams();
  if (districtId) query.set('area', districtId);
  if (facilityId) query.set('facility', facilityId);
  return `/crm${query.size ? `?${query}` : ''}`;
}
