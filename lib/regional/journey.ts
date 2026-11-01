import type { RegionalScope } from './contracts';

/** CSS-only doorway anchor. No identity/clinical data is retained for transitions. */
export function regionalDoorwayOrigin(anchor: { clientX: number; clientY: number } | undefined,
  bounds: { left: number; top: number; width: number; height: number }) {
  const x = anchor && Number.isFinite(anchor.clientX) ? anchor.clientX - bounds.left : bounds.width / 2;
  const y = anchor && Number.isFinite(anchor.clientY) ? anchor.clientY - bounds.top : bounds.height / 2;
  return { x: Math.max(0, Math.min(bounds.width, x)), y: Math.max(0, Math.min(bounds.height, y)) };
}

/** Validate UI destinations without granting access; API authorization remains authoritative. */
export function regionalNavigationTarget(scope: RegionalScope, districtIds: readonly string[], districtId: string | null, facilityId: string | null) {
  if (facilityId) {
    const facility = scope.facilities.find(row => row.id === facilityId);
    return facility ? { districtId: scope.canViewRegion ? facility.districtId : null, facilityId: facility.id } : null;
  }
  if (districtId && (!scope.canViewRegion || !districtIds.includes(districtId))) return null;
  return { districtId, facilityId: null };
}

export function isRegionalLocation(pathname: string, search: string) {
  const view = new URLSearchParams(search).get('view');
  return pathname === '/crm' && view !== 'clinic' && view !== 'schedule' && view !== 'directives';
}

export function regionalBackTarget(scope: RegionalScope, districtId: string | null, facilityId: string | null) {
  if (facilityId) {
    const facility = scope.facilities.find(row => row.id === facilityId);
    return { districtId: scope.canViewRegion ? facility?.districtId ?? districtId : null, facilityId: null,
      label: scope.canViewRegion ? 'Выйти из больницы на карту территории' : 'К моим больницам' };
  }
  if (districtId && scope.canViewRegion) return { districtId: null, facilityId: null, label: 'Вернуться к карте области' };
  return null;
}

export function regionalInteriorReady(scope: RegionalScope | null, targetId: string | null, snapshotId: string | undefined, focusedId: string | null) {
  return Boolean(scope && targetId && targetId === snapshotId && scope.facilities.some(row => row.id === targetId)
    && (!scope.canViewRegion || focusedId === targetId));
}
