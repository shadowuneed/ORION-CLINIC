import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CrmScene } from '@/app/crm/crm-scene';
import type { CrmSnapshot } from './contracts';
import { centreCrmBuildingCamera, clampCrmCameraPan, clampCrmCameraZoom, crmSvgPointInViewport, fitCrmCampusCamera, focusCrmCamera, focusCrmRenderedPoint, initialCrmGameCamera,
  keepCrmCampusVisible, panCrmCamera, resetCrmCamera, zoomCrmCameraAt } from './map-camera';

describe('bounded CRM game camera', () => {
  it('retains legacy pan/zoom limits and widens only explicit game mode', () => {
    expect(clampCrmCameraZoom(.1)).toBe(.65); expect(clampCrmCameraZoom(10)).toBe(1.8);
    expect(clampCrmCameraPan(-2000)).toBe(-260); expect(clampCrmCameraPan(2000)).toBe(260);
    expect(clampCrmCameraZoom(.1, true)).toBe(.4); expect(clampCrmCameraZoom(10, true)).toBe(2.8);
    expect(clampCrmCameraPan(-2000, true)).toBe(-1400); expect(clampCrmCameraPan(2000, true)).toBe(1400);
    expect(clampCrmCameraZoom(NaN, true)).toBe(1); expect(clampCrmCameraPan(NaN, true)).toBe(0);
  });
  it('preserves the world point beneath the wheel pointer when zooming in or out', () => {
    const camera = { zoom: 1.2, pan: { x: 45, y: -35 } }, pointer = { x: 150, y: 80 };
    for (const zoom of [.6, 1.7, 2.8]) {
      const result = zoomCrmCameraAt(camera, zoom, pointer, true);
      expect((pointer.x - result.pan.x) / result.zoom).toBeCloseTo((pointer.x - camera.pan.x) / camera.zoom, 10);
      expect((pointer.y - result.pan.y) / result.zoom).toBeCloseTo((pointer.y - camera.pan.y) / camera.zoom, 10);
    }
    expect(camera).toEqual({ zoom: 1.2, pan: { x: 45, y: -35 } });
  });
  it('bounds drag and anchor extremes while Home can always recover the original pose', () => {
    const dragged = panCrmCamera(resetCrmCamera(), { x: 99999, y: -99999 }, true);
    expect(dragged.pan).toEqual({ x: 1400, y: -1400 });
    const zoomed = zoomCrmCameraAt(dragged, 99, { x: -99999, y: 99999 }, true);
    expect(zoomed.zoom).toBe(2.8); expect(Math.abs(zoomed.pan.x)).toBeLessThanOrEqual(1400); expect(Math.abs(zoomed.pan.y)).toBeLessThanOrEqual(1400);
    expect(resetCrmCamera()).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });
  it('uses SVG letterboxing correctly for wide and narrow game viewports', () => {
    expect(crmSvgPointInViewport({ x: 500, y: 340 }, { width: 1440, height: 680 })).toEqual({ x: 0, y: 0 });
    expect(crmSvgPointInViewport({ x: 250, y: 170 }, { width: 1000, height: 680 })).toEqual({ x: -250, y: -170 });
    expect(crmSvgPointInViewport({ x: 250, y: 170 }, { width: 375, height: 844 })).toEqual({ x: -93.75, y: -63.75 });
    expect(crmSvgPointInViewport({ x: NaN, y: 170 }, { width: 375, height: 844 })).toBeNull();
    expect(crmSvgPointInViewport({ x: 250, y: 170 }, { width: 0, height: 844 })).toBeNull();
  });
  it('centres a selected room without changing zoom or inventing a person position', () => {
    const camera = { zoom: 2, pan: { x: 100, y: 100 } };
    expect(focusCrmCamera(camera, { x: 250, y: 170 }, { width: 1000, height: 680 })).toEqual({ zoom: 2, pan: { x: 500, y: 340 } });
    expect(focusCrmCamera(camera, { x: 250, y: 170 }, { width: 0, height: 0 })).toBe(camera);
  });
  it('focuses a clicked moving actor from its actual rendered offset, not its static anchor', () => {
    const camera = { zoom: 1.5, pan: { x: 150, y: -60 } };
    expect(focusCrmRenderedPoint(camera, { x: 80, y: -20 })).toEqual({ zoom: 1.5, pan: { x: 70, y: -40 } });
    expect(focusCrmRenderedPoint(camera, { x: NaN, y: 0 })).toBe(camera);
  });
  it('uses Home for a whole-campus overview and keeps an edge-room auto-focus inside the useful field', () => {
    const size = { width: 1440, height: 800 }, bounds = { minX: 110, maxX: 890, minY: 50, maxY: 620 };
    const fitted = fitCrmCampusCamera(size, bounds);
    const points = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }];
    const visible = (camera: ReturnType<typeof resetCrmCamera>) => points.map(point => {
      const screen = crmSvgPointInViewport(point, size)!;
      return { x: size.width / 2 + screen.x * camera.zoom + camera.pan.x, y: size.height / 2 + screen.y * camera.zoom + camera.pan.y };
    });
    expect(visible(fitted)[0].x).toBeGreaterThanOrEqual(18);
    expect(visible(fitted)[1].x).toBeLessThanOrEqual(size.width - 18);
    expect(visible(fitted)[0].y).toBeGreaterThanOrEqual(110);
    expect(visible(fitted)[1].y).toBeLessThanOrEqual(size.height - 120);
    const selected = keepCrmCampusVisible(focusCrmCamera(fitted, { x: 870, y: 400 }, size), size, bounds);
    expect(selected.zoom).toBe(fitted.zoom);
    expect(visible(selected)[0].x).toBeGreaterThanOrEqual(370);
    expect(visible(selected)[1].x).toBeLessThanOrEqual(size.width - 125);
    expect(Math.abs(selected.pan.x - fitted.pan.x)).toBeLessThan(50);
  });
  it('starts a large navigable campus at readable zoom, reserving Home for an overview', () => {
    const bounds = { minX: -400, maxX: 1400, minY: -60, maxY: 1200 };
    const desktop = initialCrmGameCamera({ width: 1440, height: 800 }, bounds);
    const narrow = initialCrmGameCamera({ width: 390, height: 680 }, bounds);
    expect(desktop.zoom).toBe(1); expect(narrow.zoom).toBe(1);
    expect(fitCrmCampusCamera({ width: 1440, height: 800 }, bounds).zoom).toBeLessThan(desktop.zoom);
    expect(Math.abs(desktop.pan.x)).toBeLessThanOrEqual(1400); expect(Math.abs(desktop.pan.y)).toBeLessThanOrEqual(1400);
    expect(initialCrmGameCamera({ width: 0, height: 0 }, bounds)).toEqual(resetCrmCamera());
  });
  it('navigates to a real building region at normal scale instead of shrinking both buildings into one default view', () => {
    const size = { width: 1440, height: 800 };
    const main = { minX: 80, maxX: 920, minY: 10, maxY: 600 }, second = { minX: 740, maxX: 1580, minY: 360, maxY: 950 };
    const first = initialCrmGameCamera(size, main), next = centreCrmBuildingCamera(size, second, .5);
    expect(first.zoom).toBe(1); expect(next.zoom).toBe(1);
    expect(next.pan.x).toBeLessThan(first.pan.x); expect(next.pan.y).toBeLessThan(first.pan.y);
    expect(centreCrmBuildingCamera(size, second, 1.5).zoom).toBe(1.5);
  });
  it('uses narrow safe margins and does not override deliberate zoom on later selection', () => {
    const size = { width: 390, height: 680 }, bounds = { minX: 120, maxX: 880, minY: 60, maxY: 610 };
    const fitted = fitCrmCampusCamera(size, bounds);
    expect(fitted.zoom).toBeGreaterThanOrEqual(.4);
    expect(fitted.zoom).toBeLessThanOrEqual(1);
    const selected = keepCrmCampusVisible({ zoom: 2, pan: { x: -1400, y: 1400 } }, size, bounds);
    expect(selected.zoom).toBe(2);
    expect(Math.abs(selected.pan.x)).toBeLessThan(250); expect(Math.abs(selected.pan.y)).toBeLessThan(250);
    expect(fitCrmCampusCamera({ width: 0, height: 0 }, bounds)).toEqual(resetCrmCamera());
  });
});

function snapshot(): CrmSnapshot {
  const now = '2026-10-06T07:00:00.000Z';
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'test-clinic', name: 'Тест' }, generatedAt: now,
    rooms: [{ id: 'room-a', name: 'Тестовый кабинет', kind: 'consultation', x: 0, y: 0, width: 5, depth: 4 }],
    patients: [{ id: 'patient-a', name: 'Искусственный пациент', mrn: 'SIM-01', sex: 'unknown' }],
    staff: [{ id: 'staff-a', name: 'Тестовый врач', role: 'doctor', roomId: 'room-a' }],
    services: [{ id: 'service-a', name: 'Учебная услуга', durationMinutes: 30, roomKind: 'consultation' }],
    visits: [{ id: 'visit-a', status: 'queued', queueOrder: 10, queuedAt: now, durationMinutes: 30, roomId: 'room-a', staffId: 'staff-a', patientId: 'patient-a', serviceId: 'service-a', scheduledAt: now, updatedAt: now, version: 1 }],
    tasks: [{ id: 'task-a', visitId: 'visit-a', patientId: 'patient-a', ownerId: 'staff-a', kind: 'preparation', status: 'pending', priority: 'urgent', title: 'Искусственная подготовка', version: 1, dueAt: now }],
    events: [], capabilities: { read: true, manage: true } };
}
describe('CRM one-map saved-state presentation', () => {
  it('draws separate building platforms and a native selector only when those records come from the snapshot', () => {
    const data = snapshot();
    data.buildings = [{ id: 'building-main', name: 'Основной корпус', x: 0, y: 0, width: 17, depth: 11 },
      { id: 'building-outpatient', name: 'Корпус Б', x: 28, y: 0, width: 17, depth: 11 }];
    data.rooms[0].buildingId = 'building-main';
    data.rooms.push({ ...data.rooms[0], id: 'room-second', name: 'Кабинет Б', x: 28, buildingId: 'building-outpatient' });
    const before = JSON.stringify(data), select = vi.fn();
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: select, visibleVisitIds: new Set(['visit-a']), gameMode: true }));
    expect(html).toContain('data-building-platform="building-main"'); expect(html).toContain('data-building-platform="building-outpatient"');
    expect(html).toContain('aria-label="Корпуса клиники"'); expect(html).toContain('Основной корпус'); expect(html).toContain('Корпус Б');
    expect(html).toContain('Кабинет Б'); expect(select).not.toHaveBeenCalled(); expect(JSON.stringify(data)).toBe(before);
    delete data.buildings; delete data.rooms[0].buildingId; data.rooms.pop();
    const legacy = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: select, visibleVisitIds: new Set(['visit-a']), gameMode: true }));
    expect(legacy).not.toContain('Корпуса клиники'); expect(legacy).not.toContain('Основной корпус'); expect(legacy).not.toContain('data-building-platform');
  });
  it('adds native layers and room work badges in game mode while retaining stationary SSR and recovery controls', () => {
    const data = snapshot(), before = JSON.stringify(data), select = vi.fn();
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: select, visibleVisitIds: new Set(['visit-a']), gameMode: true }));
    expect(html).toContain('data-game-mode="true"'); expect(html).toContain('data-motion="paused"');
    expect(html).toContain('aria-label="Слои большой карты"'); expect(html).toContain('Колесо масштабирует вокруг указателя');
    expect(html).toContain('title="Очередь 1 · вызваны 0 · приём 0 · задачи 1 · срочные 1"');
    expect(html).not.toContain('<small>Очередь');
    expect(html).toContain('title="Открытых задач: 1 · срочных: 1"');
    expect(html).not.toContain('width="200" height="95"');
    expect(html).toContain('#1'); expect(html).toContain('Искусственный пациент · В очереди · открытых задач: 1');
    expect(html).toContain('aria-label="Тестовый кабинет: открыть задачи CRM, 1, срочных 1"');
    expect(html).toContain('aria-label="Показать всю клинику"');
    expect(select).not.toHaveBeenCalled(); expect(JSON.stringify(data)).toBe(before);
  });
  it('does not guess canonical queue numbers and hides game HUD additions from old scene callers', () => {
    const data = snapshot(); data.visits[0].queueOrder = null;
    const game = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: vi.fn(), visibleVisitIds: new Set(['visit-a']), gameMode: true }));
    expect(game).not.toContain('#1');
    const old = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: vi.fn(), visibleVisitIds: new Set(['visit-a']) }));
    expect(old).not.toContain('Слои большой карты'); expect(old).not.toContain('Колесо масштабирует вокруг указателя');
    expect(old).toContain('aria-label="Открыть визит: Искусственный пациент"');
  });
});
