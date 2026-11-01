import { describe, expect, it } from 'vitest';
import { isRegionalLocation, regionalBackTarget, regionalDoorwayOrigin, regionalInteriorReady, regionalNavigationTarget } from './journey';
import type { RegionalScope } from './contracts';

const scope: RegionalScope = { schemaVersion: 1, canViewRegion: true, generatedAt: '2026-10-08T10:00:00.000Z',
  facilities: [{ id: 'hospital-a', name: 'Больница', kind: 'hospital', clinicId: 'clinic-a', districtId: 'area-a', canManage: true }] };
describe('regional navigation hierarchy and camera gate', () => {
  it('anchors an interior reveal to the chosen building and bounds off-screen/fallback positions', () => {
    const bounds = { left: 100, top: 200, width: 800, height: 600 };
    expect(regionalDoorwayOrigin({ clientX: 420, clientY: 650 }, bounds)).toEqual({ x: 320, y: 450 });
    expect(regionalDoorwayOrigin({ clientX: -20, clientY: 1200 }, bounds)).toEqual({ x: 0, y: 600 });
    expect(regionalDoorwayOrigin(undefined, bounds)).toEqual({ x: 400, y: 300 });
    expect(regionalDoorwayOrigin({ clientX: NaN, clientY: Infinity }, bounds)).toEqual({ x: 400, y: 300 });
  });
  it('keeps explicit district selection separate from hospital selection and rejects unknown targets', () => {
    expect(regionalNavigationTarget(scope, ['area-a'], 'area-a', null)).toEqual({ districtId: 'area-a', facilityId: null });
    expect(regionalNavigationTarget(scope, ['area-a'], 'foreign', null)).toBeNull();
    expect(regionalNavigationTarget(scope, ['area-a'], 'area-a', 'foreign')).toBeNull();
    expect(regionalNavigationTarget(scope, ['area-a'], 'wrong-parent', 'hospital-a')).toEqual({ districtId: 'area-a', facilityId: 'hospital-a' });
    expect(regionalNavigationTarget({ ...scope, canViewRegion: false }, ['area-a'], 'area-a', null)).toBeNull();
    expect(regionalNavigationTarget({ ...scope, canViewRegion: false }, [], 'area-a', 'hospital-a')).toEqual({ districtId: null, facilityId: 'hospital-a' });
  });
  it('leaves other pages and legacy clinic history entries to the application router', () => {
    expect(isRegionalLocation('/crm', '?area=area-a&facility=hospital-a')).toBe(true);
    expect(isRegionalLocation('/crm', '')).toBe(true);
    expect(isRegionalLocation('/patients', '')).toBe(false);
    expect(isRegionalLocation('/crm', '?view=clinic')).toBe(false);
    expect(isRegionalLocation('/crm', '?view=schedule')).toBe(false);
    expect(isRegionalLocation('/crm', '?view=directives')).toBe(false);
  });
  it('returns from hospital to its actual district, then to the region', () => {
    expect(regionalBackTarget(scope, 'wrong-area', 'hospital-a')?.districtId).toBe('area-a');
    expect(regionalBackTarget(scope, 'area-a', null)?.districtId).toBeNull();
    expect(regionalBackTarget(scope, null, null)).toBeNull();
  });
  it('never sends staff to an unassigned regional view', () => {
    const staff = { ...scope, canViewRegion: false };
    expect(regionalBackTarget(staff, 'area-a', 'hospital-a')).toEqual({ districtId: null, facilityId: null, label: 'К моим больницам' });
    expect(regionalBackTarget(staff, 'area-a', null)).toBeNull();
    expect(regionalInteriorReady(staff, 'hospital-a', 'hospital-a', null)).toBe(true);
  });
  it('reveals a hospital only after matching data and camera destination', () => {
    expect(regionalInteriorReady(scope, 'hospital-a', 'hospital-a', 'hospital-a')).toBe(true);
    expect(regionalInteriorReady(scope, 'hospital-a', 'hospital-a', null)).toBe(false);
    expect(regionalInteriorReady(scope, 'hospital-a', 'hospital-b', 'hospital-a')).toBe(false);
    expect(regionalInteriorReady(scope, 'hospital-a', 'hospital-a', 'hospital-b')).toBe(false);
  });
  it('drops stale interiors immediately on scope loss, even if camera has completed', () => {
    expect(regionalInteriorReady(null, 'hospital-a', 'hospital-a', 'hospital-a')).toBe(false);
    expect(regionalInteriorReady({ ...scope, facilities: [] }, 'hospital-a', 'hospital-a', 'hospital-a')).toBe(false);
    expect(regionalInteriorReady(scope, null, 'hospital-a', 'hospital-a')).toBe(false);
  });
});
