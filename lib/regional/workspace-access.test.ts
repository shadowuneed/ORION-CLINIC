import { describe, expect, it } from 'vitest';
import type { RegionalScope } from './contracts';
import { regionalLanding, regionalLocationUrl } from './workspace-access';

const own = { id: 'own-hospital', name: 'Своя больница', kind: 'hospital' as const, districtId: 'turkestan', clinicId: 'own-clinic', canManage: true };
const second = { ...own, id: 'second-hospital', name: 'Второе учреждение', clinicId: 'second-clinic', districtId: 'sayram' };
function scope(canViewRegion = false, facilities = [own]): RegionalScope {
  return { schemaVersion: 1, canViewRegion, facilities, generatedAt: '2026-10-08T10:00:00.000Z' };
}
describe('regional workspace least-privilege navigation', () => {
  it('opens the sole assigned hospital without a regional map', () => {
    expect(regionalLanding(scope(), { districtId: null, facilityId: null })).toEqual({ districtId: null, facilityId: own.id, denied: false });
  });
  it('does not honour a pasted foreign facility or district for staff', () => {
    expect(regionalLanding(scope(), { districtId: 'shymkent', facilityId: 'foreign-hospital' })).toEqual({ districtId: null, facilityId: own.id, denied: true });
  });
  it('does not grant a hospital when assignments are empty', () => {
    expect(regionalLanding(scope(false, []), { districtId: null, facilityId: 'foreign' })).toEqual({ districtId: null, facilityId: null, denied: true });
  });
  it('offers selection when multiple hospitals are explicitly assigned', () => {
    expect(regionalLanding(scope(false, [own, second]), { districtId: null, facilityId: null })).toEqual({ districtId: null, facilityId: null, denied: false });
    expect(regionalLanding(scope(false, [own, second]), { districtId: null, facilityId: second.id }).facilityId).toBe(second.id);
  });
  it('uses the actual persisted district for an administrator facility link', () => {
    expect(regionalLanding(scope(true), { districtId: 'wrong-district', facilityId: own.id })).toEqual({ districtId: 'turkestan', facilityId: own.id, denied: false });
  });
  it('retains region browsing only for explicitly authorized administrators', () => {
    expect(regionalLanding(scope(true), { districtId: 'sayram', facilityId: null })).toEqual({ districtId: 'sayram', facilityId: null, denied: false });
    expect(regionalLocationUrl(null, own.id)).toBe('/crm?facility=own-hospital');
    expect(regionalLocationUrl('sayram', null)).toBe('/crm?area=sayram');
    expect(regionalLocationUrl(null, null)).toBe('/crm');
  });
});
