import { describe, expect, it } from 'vitest';
import { crmSnapshotSchema, type CrmSnapshot } from './contracts';

function fixture(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', generatedAt: '2026-10-07T00:00:00.000Z',
    clinic: { id: 'clinic', name: 'ORION Clinic' }, capabilities: { read: true, manage: true },
    buildings: [{ id: 'main', name: 'Основной корпус', x: 0, y: 0, width: 17, depth: 11 }],
    rooms: [{ id: 'room', name: 'Кабинет', kind: 'consultation', x: 6, y: 0, width: 5, depth: 4, buildingId: 'main' }],
    staff: [], patients: [], services: [], visits: [], tasks: [], events: [] };
}
describe('persisted building response relationships', () => {
  it('accepts a fully mapped building response and the completely absent legacy extension', () => {
    expect(crmSnapshotSchema.safeParse(fixture()).success).toBe(true);
    const legacy = fixture(); delete legacy.buildings; delete legacy.rooms[0].buildingId;
    expect(crmSnapshotSchema.safeParse(legacy).success).toBe(true);
  });
  it('rejects partial, duplicate and missing building relationships', () => {
    const missingCatalogue = fixture(); delete missingCatalogue.buildings;
    expect(crmSnapshotSchema.safeParse(missingCatalogue).success).toBe(false);
    const missingRoomMap = fixture(); delete missingRoomMap.rooms[0].buildingId;
    expect(crmSnapshotSchema.safeParse(missingRoomMap).success).toBe(false);
    const duplicate = fixture(); duplicate.buildings!.push(duplicate.buildings![0]);
    expect(crmSnapshotSchema.safeParse(duplicate).success).toBe(false);
    const unknown = fixture(); unknown.rooms[0].buildingId = 'other';
    expect(crmSnapshotSchema.safeParse(unknown).success).toBe(false);
  });
  it('rejects rooms outside their persisted building bounds', () => {
    const outside = fixture(); outside.rooms[0].x = 16;
    expect(crmSnapshotSchema.safeParse(outside).success).toBe(false);
  });
});
