import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CrmScene } from '@/app/crm/crm-scene';
import type { CrmRoom, CrmSnapshot } from './contracts';
import { crmFacilityActorGroups, crmFacilityViewBox } from './facility-layout';
import { crmMapGeometry, crmSceneActors } from './motion';

const now = '2026-10-08T10:00:00.000Z';
const rooms: CrmRoom[] = [
  { id: 'reception', name: 'Регистратура', kind: 'reception', x: 0, y: 0, width: 5, depth: 4 },
  { id: 'doctor', name: 'Кабинет эндокринолога', kind: 'consultation', x: 6, y: 0, width: 5, depth: 4 },
  { id: 'lab', name: 'Лаборатория <script>', kind: 'diagnostics', x: 0, y: 6, width: 5, depth: 5 },
];
function snapshot(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-a', name: 'Больница' }, rooms,
    staff: [{ id: 'staff-a', name: 'Айша С.', role: 'doctor', roomId: 'doctor' }],
    patients: [{ id: 'patient-a', name: 'Дана К.', mrn: 'MRN-01', sex: 'female' }, { id: 'patient-b', name: 'Айжан А.', mrn: 'MRN-02', sex: 'female' }],
    services: [], visits: [{ id: 'visit-a', patientId: 'patient-a', staffId: 'staff-a', roomId: 'doctor', serviceId: 'consultation', status: 'queued',
      version: 1, queueOrder: 1, scheduledAt: now, updatedAt: now }, { id: 'visit-b', patientId: 'patient-b', staffId: 'staff-a', roomId: 'doctor', serviceId: 'consultation', status: 'queued',
      version: 1, queueOrder: 2, scheduledAt: now, updatedAt: now }], tasks: [], events: [], capabilities: { read: true, manage: false }, generatedAt: now };
}
function render(value = snapshot(), facilityMode = true, selection: Parameters<typeof CrmScene>[0]['selection'] = null) {
  return renderToStaticMarkup(createElement(CrmScene, { snapshot: value, visibleVisitIds: new Set(value.visits.map(visit => visit.id)),
    onSelect: vi.fn(), selection, facilityMode, focusSelection: true }));
}

describe('hospital-only 2.5D layout', () => {
  it('fits saved floors, roofs and people without translating the database geometry', () => {
    const input = snapshot(), before = JSON.stringify(input), { project } = crmMapGeometry(input.rooms);
    const actors = crmSceneActors(input, new Set(input.visits.map(visit => visit.id)));
    const view = crmFacilityViewBox(input.rooms, project, actors.visits.map(actor => actor.point))!;
    expect(view.width).toBeLessThan(1000); expect(view.height).toBeLessThan(680);
    for (const room of rooms) for (const point of [project(room.x, room.y, 72), project(room.x + room.width, room.y + room.depth)]) {
      expect(point.x).toBeGreaterThan(view.x); expect(point.x).toBeLessThan(view.x + view.width);
      expect(point.y).toBeGreaterThan(view.y); expect(point.y).toBeLessThan(view.y + view.height);
    }
    expect(JSON.stringify(input)).toBe(before);
  });
  it('has no default fabricated plan when saved rooms are missing or invalid', () => {
    const { project } = crmMapGeometry([]);
    expect(crmFacilityViewBox([], project)).toBeNull();
    expect(crmFacilityViewBox([{ ...rooms[0], width: NaN }], project)).toBeNull();
    const value = snapshot(); value.rooms = []; value.staff = []; value.patients = []; value.visits = [];
    const html = render(value);
    expect(html).toContain('План помещений в БД пока пуст');
    expect(html).toContain('data-empty="true"'); expect(html).not.toContain('<polygon');
    expect(html).not.toContain('Кабинеты учреждения'); expect(html).not.toContain('Дана К.');
  });
  it('shows full cabinet names outside the SVG instead of large text pins over people', () => {
    const html = render(), svg = html.match(/<svg viewBox=[\s\S]*?<\/svg>/)?.[0] ?? '';
    expect(html).toContain('aria-label="Кабинеты учреждения"'); expect(html).toContain('Кабинет эндокринолога<small>2 активных визитов');
    expect(svg).toContain('>2</button>'); expect(svg).not.toContain('<span>Кабинет эндокринолога</span>');
    expect(html).toContain('Лаборатория &lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).not.toContain('2.5D · модель');
  });
  it('groups co-located visits by actual assigned room and preserves every record in the accessible list', () => {
    const value = snapshot(), actors = crmSceneActors(value, new Set(value.visits.map(visit => visit.id))), { project } = crmMapGeometry(rooms);
    const groups = crmFacilityActorGroups(actors.visits, project, actor => actor.visit.roomId);
    expect(groups).toHaveLength(1); expect(groups[0].members.map(member => member.visit.id)).toEqual(['visit-a', 'visit-b']);
    expect(groups[0].actor.point).toEqual(actors.visits[0].point);
    const html = render(value);
    expect(html).toContain('2 визитов: открыть кабинет Кабинет эндокринолога');
    expect(html).toContain('>2П</span>'); expect(html).toContain('Люди и визиты на плане');
    expect(html).toContain('Дана К.'); expect(html).toContain('Айжан А.');
    expect(html).toContain('data-motion="paused"');
  });
  it('does not combine records from distinct cabinets or spatially distinct saved anchors', () => {
    const project = (x: number, y: number) => ({ x, y });
    const values = [{ key: 'a', point: { x: 0, y: 0 }, room: 'a' }, { key: 'b', point: { x: 0, y: 0 }, room: 'b' },
      { key: 'c', point: { x: 100, y: 0 }, room: 'a' }];
    expect(crmFacilityActorGroups(values, project, actor => actor.room)).toHaveLength(3);
  });
  it('highlights selected room consistently and never creates an unknown selected room', () => {
    const selected = render(snapshot(), true, { kind: 'room', id: 'doctor' });
    expect(selected).toContain('<strong>Кабинет эндокринолога</strong>'); expect(selected).toContain('Очередь: 2 · На приёме: 0');
    expect(selected).toContain('data-selected="true"');
    const missing = render(snapshot(), true, { kind: 'room', id: 'missing-room' });
    expect(missing).not.toContain('missing-room'); expect(missing).not.toContain('data-selected="true"');
  });
  it('keeps traditional CRM defaults and individual actor rendering unchanged', () => {
    const html = render(snapshot(), false);
    expect(html).toContain('viewBox="0 0 1000 680"'); expect(html).toContain('2.5D · модель');
    expect(html).not.toContain('Кабинеты учреждения'); expect(html).not.toContain('2П');
    expect(html).toContain('Открыть визит: Дана К.'); expect(html).toContain('Открыть визит: Айжан А.');
  });
  it('never restores a filtered visit to a group, legend or actor list', () => {
    const value = snapshot();
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: value, visibleVisitIds: new Set(['visit-a']),
      onSelect: vi.fn(), selection: null, facilityMode: true }));
    expect(html).not.toContain('Айжан А.'); expect(html).not.toContain('2П'); expect(html).toContain('Дана К.');
  });
});
