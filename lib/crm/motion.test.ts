import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CrmScene } from '@/app/crm/crm-scene';
import type { CrmRoom, CrmSnapshot, CrmVisit } from './contracts';
import { boundedCrmRooms, CRM_SCENE_MOVING_LIMIT, CRM_SCENE_STAFF_LIMIT, CRM_SCENE_VISIT_LIMIT,
  crmMapGeometry, crmMotionAllowed, crmMotionKeyframes, crmMotionSeed, crmOrthogonalPath, crmPathLength, crmSceneActors, crmSceneExtent, crmVisitVisualRoute } from './motion';

const now = '2026-10-06T07:00:00.000Z';
const rooms: CrmRoom[] = [
  { id: 'reception', name: 'Тестовая регистратура', kind: 'reception', x: 0, y: 0, width: 5, depth: 4 },
  { id: 'upper', name: 'Тестовый кабинет', kind: 'consultation', x: 6, y: 0, width: 5, depth: 4 },
  { id: 'lower', name: 'Тестовая диагностика', kind: 'diagnostics', x: 0, y: 6, width: 5, depth: 5 },
];
function visit(status: CrmVisit['status'] = 'queued', id = 'visit-a', roomId = 'upper'): CrmVisit {
  return { id, status, roomId, patientId: 'patient-a', staffId: 'staff-a', serviceId: 'service-a', version: 3, scheduledAt: now, updatedAt: now };
}
function snapshot(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-test', name: 'Тест' }, rooms,
    patients: [{ id: 'patient-a', name: 'Искусственный пациент', mrn: 'SIM-01', sex: 'unknown' }],
    staff: [{ id: 'staff-a', name: 'Тестовый врач', role: 'doctor', roomId: 'upper' }],
    services: [{ id: 'service-a', name: 'Тестовая консультация', durationMinutes: 20, roomKind: 'consultation' }],
    visits: [visit()], tasks: [], events: [], capabilities: { read: true, manage: true }, generatedAt: now };
}
function assertOrthogonal(path: readonly { x: number; y: number }[]) {
  for (let index = 1; index < path.length; index++) expect(path[index].x === path[index - 1].x || path[index].y === path[index - 1].y).toBe(true);
}
function crossesRoom(path: readonly { x: number; y: number }[], room: CrmRoom) {
  return path.slice(1).some((point, index) => {
    const previous = path[index];
    return point.x === previous.x
      ? point.x > room.x && point.x < room.x + room.width && Math.max(point.y, previous.y) > room.y && Math.min(point.y, previous.y) < room.y + room.depth
      : point.y > room.y && point.y < room.y + room.depth && Math.max(point.x, previous.x) > room.x && Math.min(point.x, previous.x) < room.x + room.width;
  });
}

describe('CRM visual corridors', () => {
  it('preserves the original compact room/person scale when saved rooms extend into a second building', () => {
    const campus = [...rooms, { ...rooms[1], id: 'upper-b', x: 12 }, { ...rooms[2], id: 'lower-b', x: 6 }, { ...rooms[2], id: 'lower-c', x: 12 }];
    const primary = { id: 'building-main', name: 'Основной корпус', x: 0, y: 0, width: 17, depth: 11 };
    const extended = [...campus, ...campus.map(room => ({ ...room, id: `${room.id}-second`, x: room.x + 28 }))];
    const old = crmMapGeometry(campus), game = crmMapGeometry(extended, true, primary);
    const width = (geometry: typeof game) => geometry.project(5, 0).x - geometry.project(0, 0).x;
    expect(width(game)).toBeCloseTo(width(old), 10);
    expect(game.project(0, 0)).toEqual(old.project(0, 0));
    expect(game.project(6, 0).x - game.project(5, 0).x).toBeCloseTo(660 / 28, 10);
    expect(game.project(28, 0).x - game.project(0, 0).x).toBeCloseTo(660, 10);
    expect(game.scale).toBeCloseTo(23.5714285714, 8);
    const before = JSON.stringify(campus); crmMapGeometry(campus, true); expect(JSON.stringify(campus)).toBe(before);
  });
  it('routes registration to an upper cabinet along the actual empty corridor, not through floors', () => {
    const route = crmVisitVisualRoute(visit(), rooms)!;
    expect(route.full).not.toBeNull(); expect(route.corridor).not.toBeNull();
    assertOrthogonal(route.full!);
    for (const room of rooms) expect(crossesRoom(route.corridor!, room)).toBe(false);
    expect(route.full![0].x).toBeGreaterThan(rooms[0].x);
    expect(route.full!.at(-1)!.x).toBeGreaterThan(rooms[1].x);
    expect(route.full!.at(-1)!.y).toBeLessThan(rooms[1].depth);
  });
  it('goes around the lower row instead of walking across a diagnosis room', () => {
    const route = crmVisitVisualRoute(visit('queued', 'visit-lower', 'lower'), rooms)!;
    expect(route.corridor!.some(point => point.x < 0 || point.x > rooms[2].x + rooms[2].width)).toBe(true);
    assertOrthogonal(route.full!);
    for (const room of rooms) expect(crossesRoom(route.corridor!, room)).toBe(false);
  });
  it('uses saved stages for distinct visual activity and never treats a booking as an arrival', () => {
    const arrived = crmVisitVisualRoute(visit('arrived'), rooms)!;
    const queued = crmVisitVisualRoute(visit('queued'), rooms)!;
    const service = crmVisitVisualRoute(visit('in_service'), rooms)!;
    const scheduled = crmVisitVisualRoute(visit('scheduled'), rooms)!;
    expect(arrived.path![0].y).toBeLessThan(4);
    expect(queued.path![0].y).toBeGreaterThan(4);
    expect(queued.path!.at(-1)!.y).toBeGreaterThan(4);
    expect(service.path!.every(point => point.x > 6 && point.x < 11 && point.y > 0 && point.y < 4)).toBe(true);
    expect(scheduled.path).toBeNull();
    expect(visit('queued').status).toBe('queued');
  });
  it('fails safe rather than animating a corridor whose start lies in an obstacle', () => {
    expect(crmOrthogonalPath({ x: 1, y: 1 }, { x: 12, y: 12 }, rooms)).toBeNull();
    expect(crmOrthogonalPath({ x: NaN, y: 1 }, { x: 12, y: 12 }, rooms)).toBeNull();
    expect(crmVisitVisualRoute(visit('queued', 'unknown', 'missing'), rooms)).toBeNull();
  });
  it('has a safe exterior entrance when no reception is configured, without inventing a room', () => {
    const route = crmVisitVisualRoute(visit(), rooms.slice(1))!;
    expect(route.full![0].x).toBeLessThan(0);
    expect(route.full).not.toBeNull();
    expect(crmSceneExtent([])).toEqual({ x: 8, y: 8 });
  });
  it('returns fixed, finite, bounded extents without variadic spread over untrusted arrays', () => {
    const invalid = { ...rooms[0], width: Infinity };
    expect(boundedCrmRooms([invalid])).toEqual([]);
    const many = Array.from({ length: 10000 }, (_, index) => ({ ...rooms[0], id: `room-${index}`, x: index > 99 ? 100 : 0 }));
    expect(boundedCrmRooms(many)).toHaveLength(100);
    expect(crmSceneExtent(many)).toEqual({ x: 8, y: 8 });
  });
});

describe('CRM animation limits and stable sequences', () => {
  it('bounds all scene actors and all moving actors separately at full contract size', () => {
    const data = snapshot();
    data.visits = Array.from({ length: 1000 }, (_, index) => ({ ...visit('queued', `visit-${String(index).padStart(4, '0')}`), staffId: `staff-${index % 200}` }));
    data.staff = Array.from({ length: 200 }, (_, index) => ({ ...data.staff[0], id: `staff-${index}` }));
    data.tasks = Array.from({ length: 2000 }, (_, index) => ({ id: `task-${index}`, visitId: data.visits[index % 1000].id, patientId: 'patient-a',
      ownerId: `staff-${index % 200}`, kind: 'service', title: 'Тестовая задача', status: 'in_progress', priority: 'routine', dueAt: now, version: 1 }));
    const actors = crmSceneActors(data, new Set(data.visits.map(row => row.id)));
    expect(actors.visits).toHaveLength(CRM_SCENE_VISIT_LIMIT);
    expect(actors.staff).toHaveLength(CRM_SCENE_STAFF_LIMIT);
    expect(actors.movingCount).toBe(CRM_SCENE_MOVING_LIMIT);
    expect(actors.visits.filter(row => row.moving).length + actors.staff.filter(row => row.moving).length).toBe(CRM_SCENE_MOVING_LIMIT);
    expect(actors.activeCount).toBe(1000);
  });
  it('keeps phase keys/variants stable through server reordering and changes only the updated visit sequence', () => {
    const data = snapshot(); data.visits.push(visit('arrived', 'visit-b'));
    const ids = new Set(data.visits.map(row => row.id));
    const first = crmSceneActors(data, ids);
    const reordered = crmSceneActors({ ...data, visits: [...data.visits].reverse(), rooms: [...data.rooms].reverse() }, ids);
    expect(reordered.visits.map(row => [row.key, row.seed])).toEqual(first.visits.map(row => [row.key, row.seed]));
    data.visits[0] = { ...data.visits[0], version: 4 };
    const changed = crmSceneActors(data, ids);
    expect(changed.visits[0].key).not.toBe(first.visits[0].key);
    expect(changed.visits[1].key).toBe(first.visits[1].key);
    expect(crmMotionSeed(first.visits[0].key)).toBe(first.visits[0].seed);
  });
  it('excludes terminal or filtered visits and derives staff work only from saved active visit/task state', () => {
    const data = snapshot(); data.visits = [visit('completed'), visit('cancelled', 'visit-b')];
    expect(crmSceneActors(data, new Set(['visit-a', 'visit-b'])).movingCount).toBe(0);
    data.visits = [visit('in_service')];
    expect(crmSceneActors(data, new Set()).staff[0].moving).toBe(true);
    expect(crmSceneActors(data, new Set()).visits).toEqual([]);
    expect(data.visits[0].status).toBe('in_service');
    expect(data.events).toEqual([]);
  });
  it.each([
    [true, true, false, true], [false, true, false, false], [true, false, false, false], [true, true, true, false],
  ])('motion requires explicit playback, visible document and no reduced-motion preference (%s,%s,%s)', (requested, visible, reduced, allowed) => {
    expect(crmMotionAllowed(requested, visible, reduced)).toBe(allowed);
  });
  it('builds exact corner keyframes, weighted by segment length, and returns without cutting a corner', () => {
    const path = [{ x: 500, y: 160 }, { x: 600, y: 160 }, { x: 600, y: 360 }];
    const frames = crmMotionKeyframes(path);
    expect(frames.map(frame => frame.point)).toEqual([...path, path[1], path[0]]);
    [0, 100 / 6, 50, 100 - 100 / 6, 100].forEach((percent, index) => expect(frames[index].percent).toBeCloseTo(percent, 10));
    expect(crmPathLength(path)).toBe(300);
    expect(crmMotionKeyframes([{ x: Infinity, y: 0 }])).toEqual([]);
    expect(crmMotionKeyframes([{ x: 0, y: 0 }])).toEqual([]);
  });
});

describe('CRM visual movement controls and shared hit targets', () => {
  it('first paint is paused and exposes native motion/staff/visit controls without moving DB state', () => {
    const data = snapshot(); data.visits[0] = visit('in_service');
    const before = JSON.stringify(data); const select = vi.fn();
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: { kind: 'visit', id: 'visit-a' }, onSelect: select, visibleVisitIds: new Set(['visit-a']) }));
    expect(html).toContain('data-motion="paused"');
    expect(html).toContain('Движение: пауза');
    expect(html).toContain('не отслеживание людей');
    expect(html).toContain('местоположение и этапы не меняет');
    expect(html).toContain('aria-label="Открыть сотрудника: Тестовый врач"');
    expect(html).toContain('data-sequence="visit:visit-a:3"');
    expect(html).toMatch(/data-sequence="visit:visit-a:3"[\s\S]*?<foreignObject[\s\S]*?aria-label="Открыть визит: Искусственный пациент"[\s\S]*?<\/foreignObject><\/g>/);
    expect(html).toContain('<polyline');
    expect(select).not.toHaveBeenCalled(); expect(JSON.stringify(data)).toBe(before);
  });
  it('does not create moving patient controls for completed records or absent relations', () => {
    const data = snapshot(); data.visits[0].status = 'completed';
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: { kind: 'patient', id: 'patient-a' }, onSelect: vi.fn(), visibleVisitIds: new Set(['visit-a']) }));
    expect(html).not.toContain('data-sequence="visit:');
    expect(html).not.toContain('Открыть визит:');
  });
});
