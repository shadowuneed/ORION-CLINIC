import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector3, type Group, type Mesh, type MeshStandardMaterial, type OrthographicCamera, type Scene } from 'three';
import type { RegionalFacility } from '@/lib/regional/contracts';
import type { RegionalFeatureCollection } from '@/lib/regional/geography';
import { pointInsideRegionalGeometry, regionalPolygons } from '@/lib/regional/geography';
import { projectRegionalPosition, regionalBounds } from '@/lib/regional/map-camera';

const gpu = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(), setSize: vi.fn() }));
vi.mock('three', async importOriginal => ({ ...await importOriginal<typeof import('three')>(), WebGLRenderer: class {
  setPixelRatio() {} setSize = gpu.setSize; render = gpu.render; dispose = gpu.dispose; forceContextLoss = gpu.forceContextLoss;
} }));
import { createRegionalWebgl, type Regional3dFrame, type Regional3dOptions, type Regional3dState } from './regional-webgl-renderer';

const geographicFeatures = (JSON.parse(readFileSync('public/maps/turkestan-districts.geojson', 'utf8')) as RegionalFeatureCollection).features;
const features = geographicFeatures.filter(feature => ['turkestan', 'kentau'].includes(feature.id));
const metrics = { hospitalCount: 1, polyclinicCount: 1, patientCount: 3, activeVisits: 1, queuedVisits: 1, openTasks: 2,
  overdueTasks: 0, completedTasks: 1, totalTasks: 3, onTimeTasks: 1, dueTasks: 1, kpiPercent: 100 };
const facilities: RegionalFacility[] = ['one', 'two'].map((id, index) => ({ ...metrics, id, districtId: 'turkestan', clinicId: `clinic-${id}`,
  name: id, kind: 'hospital', latitude: 43.3 + index * .01, longitude: 68.3, address: 'Учебная организация', populated: true }));
let raf: Map<number, FrameRequestCallback>;
let nextFrame: number;
let documentMock: EventTarget & { hidden: boolean; documentElement: object };
let media: EventTarget & { matches: boolean };
let observedResize: (() => void) | null;
const resources: { dispose: () => void }[] = [];
function canvasMock() {
  const canvas = new EventTarget();
  return Object.assign(canvas, { clientWidth: 630, clientHeight: 600, dataset: {}, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 630, height: 600 }) }) as unknown as HTMLCanvasElement;
}
function tick(time: number) { const tasks = [...raf.values()]; raf.clear(); tasks.forEach(task => task(time)); }
function setup(overrides: Partial<Regional3dOptions> = {}, canvas = canvasMock()) {
  const options: Regional3dOptions = { features, facilities, districts: [], selectedDistrictId: null,
    onSelectDistrict: vi.fn(), onOpenFacility: vi.fn(), onFacilityFocusComplete: vi.fn(), onFacilityFocusCancel: vi.fn(),
    onFrame: vi.fn(), onFailure: vi.fn(), ...overrides };
  const controller = createRegionalWebgl(canvas, options); resources.push(controller);
  return { controller, options, canvas };
}
beforeEach(() => {
  vi.clearAllMocks(); raf = new Map(); nextFrame = 1;
  documentMock = Object.assign(new EventTarget(), { hidden: false, documentElement: {} });
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('window', { devicePixelRatio: 2, matchMedia: () => media }); vi.stubGlobal('document', documentMock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; raf.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => raf.delete(id));
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  observedResize = null;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observedResize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { resources.splice(0).forEach(resource => resource.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('on-demand WebGL lifecycle and transitions', () => {
  it('renders once at rest, draws camera flights on demand, then returns to zero queued animation frames', () => {
    const { controller, options } = setup();
    expect(raf.size).toBe(1); tick(0); expect(gpu.render).toHaveBeenCalledTimes(1); expect(raf.size).toBe(0);
    controller.update({ ...options, selectedDistrictId: 'turkestan' }); tick(10);
    expect(raf.size).toBe(1); tick(400); expect(raf.size).toBe(1); tick(790); expect(raf.size).toBe(0);
    controller.update({ ...options, selectedDistrictId: 'turkestan', selectedFacilityId: 'one' }); tick(800); tick(1480);
    expect(options.onFacilityFocusComplete).toHaveBeenCalledExactlyOnceWith('one', expect.objectContaining({ clientX: expect.any(Number), clientY: expect.any(Number) })); expect(raf.size).toBe(0);
  });
  it('never reports an old facility after selection changed or the camera flight was cancelled', () => {
    const { controller, options } = setup({ selectedDistrictId: 'turkestan' }); tick(0); tick(780);
    controller.update({ ...options, selectedFacilityId: 'one' }); tick(1000); tick(1200);
    controller.update({ ...options, selectedFacilityId: 'two' }); tick(1400); tick(2080);
    expect(options.onFacilityFocusComplete).toHaveBeenCalledExactlyOnceWith('two', expect.objectContaining({ clientX: expect.any(Number), clientY: expect.any(Number) }));
    controller.update({ ...options, selectedFacilityId: 'one' }); tick(2200);
    controller.pan(20, 0); tick(3000);
    expect(options.onFacilityFocusComplete).toHaveBeenCalledTimes(1);
    expect(options.onFacilityFocusCancel).toHaveBeenCalledExactlyOnceWith('one');
    expect(raf.size).toBe(0);
  });
  it('pauses all GPU rendering while the interior/hidden tab is active and resumes without time-jumping', () => {
    const { controller, options } = setup(); tick(0);
    const focused: Regional3dState = { ...options, selectedDistrictId: 'turkestan', selectedFacilityId: 'one' };
    controller.update(focused); tick(100); tick(300);
    controller.update({ ...focused, active: false }); expect(raf.size).toBe(0);
    const calls = gpu.render.mock.calls.length;
    controller.zoom(1.1); tick(99999); expect(gpu.render).toHaveBeenCalledTimes(calls);
    controller.update({ ...focused, active: true }); tick(100000); expect(gpu.render.mock.calls.length).toBeGreaterThan(calls);
    documentMock.hidden = true; documentMock.dispatchEvent(new Event('visibilitychange'));
    controller.orbit(.1, 0); expect(raf.size).toBe(0);
    documentMock.hidden = false; documentMock.dispatchEvent(new Event('visibilitychange')); tick(100100); expect(raf.size).toBe(0);
  });
  it('finishes immediately in reduced-motion mode and does not require a timer before opening the interior', () => {
    media.matches = true;
    const { options } = setup({ selectedDistrictId: 'turkestan', selectedFacilityId: 'one' }); tick(0);
    expect(options.onFacilityFocusComplete).toHaveBeenCalledExactlyOnceWith('one', expect.objectContaining({ clientX: expect.any(Number), clientY: expect.any(Number) })); expect(raf.size).toBe(0);
  });
  it('requires a separate settled building click: territory focus never automatically opens its first hospital', () => {
    const frames: Regional3dFrame[] = [];
    const { options, controller, canvas } = setup({ onFrame: frame => frames.push(frame) }); tick(0);
    controller.update({ ...options, selectedDistrictId: 'turkestan' }); tick(100); tick(300);
    const arriving = frames[frames.length - 1]; expect(arriving.navigating).toBe(true);
    const target = arriving.facilities[0];
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1, button: 0, clientX: target.x, clientY: target.y, shiftKey: false,
    }));
    tick(310);
    expect(options.onOpenFacility).not.toHaveBeenCalled();
    expect(options.onFacilityFocusComplete).not.toHaveBeenCalled();
    expect(options.onSelectDistrict).not.toHaveBeenCalled();
    expect(frames[frames.length - 1].navigating).toBe(true);
    expect(raf.size).toBe(1);
    tick(720);
    expect(frames[frames.length - 1].navigating).toBe(false);
    expect(frames[frames.length - 1].zoomPercent).toBeCloseTo(100);
    expect(raf.size).toBe(0);
  });
  it('opens a direct facility URL from its fitted district, with no overview flash and an exact district return', () => {
    const districtFrames: Regional3dFrame[] = [];
    const district = setup({ selectedDistrictId: 'turkestan', onFrame: frame => districtFrames.push(frame) }); tick(0);
    const districtPose = districtFrames[0].pose;
    district.controller.dispose();
    const frames: Regional3dFrame[] = [];
    const direct = setup({ selectedDistrictId: 'turkestan', selectedFacilityId: 'one', onFrame: frame => frames.push(frame) }); tick(100);
    expect(frames[0].pose.span).toBeCloseTo(districtPose.span);
    expect(frames[0].pose.x).toBeCloseTo(districtPose.x);
    expect(frames[0].pose.z).toBeCloseTo(districtPose.z);
    tick(750);
    expect(frames[frames.length - 1].pose.span).toBeCloseTo(districtPose.span / 1.12);
    direct.controller.update({ ...direct.options, selectedFacilityId: null }); tick(800); tick(1400);
    expect(frames[frames.length - 1].pose.span).toBeCloseTo(districtPose.span);
    expect(frames[frames.length - 1].pose.x).toBeCloseTo(districtPose.x);
    direct.controller.update({ ...direct.options, selectedFacilityId: null, selectedDistrictId: null }); tick(1500); tick(2100);
    expect(frames[frames.length - 1].pose.span).toBeGreaterThan(districtPose.span);
    expect(direct.options.onFacilityFocusComplete).toHaveBeenCalledExactlyOnceWith('one', expect.objectContaining({ clientX: expect.any(Number), clientY: expect.any(Number) }));
  });
  it('keeps the selected district fitted when resizing from a phone map into the desktop dispatcher', () => {
    const canvas = canvasMock(); Object.assign(canvas, { clientWidth: 375, clientHeight: 470 });
    const frames: Regional3dFrame[] = [];
    setup({ selectedDistrictId: 'turkestan', onFrame: frame => frames.push(frame) }, canvas); tick(0);
    expect(frames.at(-1)!.zoomPercent).toBeCloseTo(100);
    Object.assign(canvas, { clientWidth: 1440, clientHeight: 1000 }); observedResize!(); tick(100);
    expect(frames.at(-1)!.zoomPercent).toBeCloseTo(100);
    expect(frames.at(-1)!.size).toEqual({ width: 1440, height: 1000 });
    expect(raf.size).toBe(0);
  });
  it('resizes saved district and overview cameras so step-by-step return keeps their fit and the actual user pan', () => {
    const canvas = canvasMock(); Object.assign(canvas, { clientWidth: 375, clientHeight: 470 });
    const frames: Regional3dFrame[] = [];
    const { controller, options } = setup({ onFrame: frame => frames.push(frame) }, canvas); tick(0);
    controller.update({ ...options, selectedDistrictId: 'turkestan' }); tick(100); tick(1100);
    controller.pan(12, 8); controller.zoom(1.4); tick(1200);
    const savedDistrict = { ...frames.at(-1)!.pose };
    controller.update({ ...options, selectedDistrictId: 'turkestan', selectedFacilityId: 'one' }); tick(1300); tick(2300);
    Object.assign(canvas, { clientWidth: 1440, clientHeight: 1000 }); observedResize!(); tick(2400);
    controller.update({ ...options, selectedDistrictId: 'turkestan', selectedFacilityId: null }); tick(2500); tick(3500);
    expect(frames.at(-1)!.zoomPercent).toBeCloseTo(140);
    expect(frames.at(-1)!.pose.x).toBeCloseTo(savedDistrict.x); expect(frames.at(-1)!.pose.z).toBeCloseTo(savedDistrict.z);
    controller.update({ ...options, selectedDistrictId: null }); tick(3600); tick(4600);
    expect(frames.at(-1)!.zoomPercent).toBeCloseTo(100);
    expect(raf.size).toBe(0);
  });
  it('rejects a pointer gesture that began before the selected territory changed', () => {
    const { options, controller, canvas } = setup(); tick(0);
    const pick = vi.spyOn(Raycaster.prototype, 'intersectObjects');
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 1, button: 0, clientX: 300, clientY: 300, shiftKey: false }));
    controller.update({ ...options, selectedDistrictId: 'turkestan' }); tick(100); tick(600);
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, button: 0, clientX: 300, clientY: 300, shiftKey: false }));
    expect(pick).not.toHaveBeenCalled(); expect(options.onOpenFacility).not.toHaveBeenCalled(); expect(options.onSelectDistrict).not.toHaveBeenCalled();
  });
  it('gives the selected district an independent bright outline/fill and separates real DB-linked building symbols', () => {
    const frames: Regional3dFrame[] = [];
    setup({ selectedDistrictId: 'turkestan', onFrame: frame => frames.push(frame) }); tick(0); tick(500);
    const scene = gpu.render.mock.calls[gpu.render.mock.calls.length - 1][0] as Scene;
    const meshes: Mesh[] = [];
    scene.traverse(object => { if (object.userData.kind === 'district') meshes.push(object as Mesh); });
    const selected = meshes.find(mesh => mesh.userData.id === 'turkestan')!, other = meshes.find(mesh => mesh.userData.id === 'kentau')!;
    expect((selected.material as MeshStandardMaterial[])[0].emissiveIntensity).toBeGreaterThan(0);
    expect((other.material as MeshStandardMaterial[])[0].emissiveIntensity).toBe(0);
    expect(selected.parent!.scale.y / other.parent!.scale.y).toBeCloseTo(1.6);
    expect((selected.parent!.children[1] as Group).visible).toBe(true);
    const outline = (selected.parent!.children[1] as Group).children[0] as unknown as { material: { depthTest: boolean } };
    expect(outline.material.depthTest).toBe(true);
    expect((other.parent!.children[1] as Group).visible).toBe(false);
    const pins = frames[frames.length - 1].facilities;
    expect(pins).toHaveLength(2); expect(pins.every(pin => pin.displaced)).toBe(true);
    expect(Math.hypot(pins[0].markerFoot.x - pins[1].markerFoot.x, pins[0].markerFoot.y - pins[1].markerFoot.y)).toBeGreaterThanOrEqual(105.999);
    expect(pins.every(pin => Math.hypot(pin.markerFoot.x - pin.geographicAnchor.x, pin.markerFoot.y - pin.geographicAnchor.y) > 10)).toBe(true);
  });
  it('reuses the same canvas in StrictMode without explicitly destroying its context', () => {
    const canvas = canvasMock();
    const first = setup({}, canvas); tick(0); first.controller.dispose();
    expect(raf.size).toBe(0); expect(gpu.dispose).toHaveBeenCalledTimes(1); expect(gpu.forceContextLoss).not.toHaveBeenCalled();
    const second = setup({}, canvas); tick(100); expect(gpu.render).toHaveBeenCalledTimes(2);
    first.controller.dispose(); expect(gpu.dispose).toHaveBeenCalledTimes(1);
    second.controller.dispose(); expect(gpu.dispose).toHaveBeenCalledTimes(2); expect(gpu.forceContextLoss).not.toHaveBeenCalled();
  });
  it('shows distinct hospital and polyclinic silhouettes with readable grounded symbols', () => {
    setup({ selectedDistrictId: 'turkestan', facilities: [facilities[0], { ...facilities[1], kind: 'polyclinic' }] }); tick(0);
    const scene = gpu.render.mock.calls.at(-1)![0] as Scene;
    const hospital = scene.getObjectByName('facility-one') as Group;
    const polyclinic = scene.getObjectByName('facility-two') as Group;
    expect(hospital).toBeDefined(); expect(polyclinic).toBeDefined();
    const hospitalBody = hospital.getObjectByName('main-building') as Mesh;
    const clinicBody = polyclinic.getObjectByName('main-building') as Mesh;
    expect(hospitalBody.scale.y).toBeGreaterThan(clinicBody.scale.y);
    expect(hospital.getObjectByName('care-wing')).toBeDefined();
    expect(polyclinic.getObjectByName('clinic-canopy')).toBeDefined();
    expect(hospital.getObjectByName('contact-shadow')).toBeDefined();
    expect(polyclinic.getObjectByName('contact-shadow')).toBeDefined();
    // Measure the complete hospital silhouette, rather than requiring its main
    // wall alone to occupy 100px and forcing oversized courtyards into a city.
    const camera = gpu.render.mock.calls.at(-1)![1] as OrthographicCamera;
    const horizontal: number[] = [];
    hospital.traverse(object => {
      if (!('isMesh' in object) || object.name.startsWith('contact-shadow')) return;
      const positions = (object as Mesh).geometry.getAttribute('position');
      for (let vertex = 0; vertex < positions.count; vertex++) horizontal.push(new Vector3().fromBufferAttribute(positions, vertex)
        .applyMatrix4(object.matrixWorld).project(camera).x * 630 / 2);
    });
    expect(Math.max(...horizontal) - Math.min(...horizontal)).toBeGreaterThanOrEqual(96);
    expect(scene.getObjectByName('map-fill-light')).toBeDefined();
    expect(raf.size).toBe(0);
  });
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('keeps the public entrances visible after orbiting %s radians, including the Arys screenshot back-wall view', orbit => {
    const { controller } = setup({ selectedDistrictId: 'turkestan', facilities: [facilities[0], { ...facilities[1], kind: 'polyclinic' }] });
    tick(0); controller.orbit(orbit, 0); tick(100);
    const [scene, camera] = gpu.render.mock.calls.at(-1)! as [Scene, OrthographicCamera];
    for (const id of ['one', 'two']) {
      const group = scene.getObjectByName(`facility-${id}`)!;
      const entrance = group.getObjectByName('public-entrance')!;
      const normal = new Vector3(0, 0, 1).transformDirection(entrance.matrixWorld);
      const center = entrance.getWorldPosition(new Vector3());
      const viewing = camera.getWorldDirection(new Vector3()).negate(); viewing.y = 0; viewing.normalize();
      expect(normal.dot(viewing), `${id} entrance facing away from the camera`).toBeGreaterThan(.85);
      const projected = center.project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
    }
    expect(raf.size).toBe(0);
  });
  it.each([{ width: 630, height: 600 }, { width: 1440, height: 1000 }, { width: 375, height: 470 }])('keeps the whole Arys hospital courtyard on its selected geographic surface at $width × $height instead of perching on the district edge', size => {
    const arys = geographicFeatures.find(feature => feature.id === 'arys')!;
    const center = arys.properties.administrativeCentre!;
    const canvas = canvasMock(); Object.assign(canvas, { clientWidth: size.width, clientHeight: size.height });
    setup({ features: geographicFeatures, selectedDistrictId: 'arys', facilities: ['hospital', 'polyclinic'].map((kind, index) => ({
      ...facilities[0], id: `arys-${kind}`, kind: kind as RegionalFacility['kind'], districtId: 'arys',
      longitude: center[0] + (index ? .01 : -.01), latitude: center[1] + (index ? .012 : -.012),
    })) }, canvas); tick(0);
    const scene = gpu.render.mock.calls.at(-1)![0] as Scene;
    const bounds = regionalBounds(geographicFeatures.flatMap(feature => regionalPolygons(feature.geometry).flat()
      .flatMap(ring => ring.map(coordinate => projectRegionalPosition(...coordinate)))));
    const origin = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    for (const id of ['arys-hospital', 'arys-polyclinic']) {
      const court = scene.getObjectByName(`facility-${id}`)!.getObjectByName('paved-courtyard')!;
      for (const x of [-.5, .5]) for (const z of [-.5, .5]) {
        const point = new Vector3(x, 0, z).applyMatrix4(court.matrixWorld);
        const longitude = (point.x + origin.x) / 100;
        const latitude = (2 * Math.atan(Math.exp(-(point.z + origin.y) / 100 * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
        expect(pointInsideRegionalGeometry([longitude, latitude], arys.geometry), `${id} courtyard crossing the Arys outline at ${longitude}, ${latitude}`).toBe(true);
      }
    }
  });
  it('arrives near the Arys institutions with readable facades while Home still shows the whole accurate territory', () => {
    const arys = geographicFeatures.find(feature => feature.id === 'arys')!;
    const center = arys.properties.administrativeCentre!;
    const canvas = canvasMock(); Object.assign(canvas, { clientWidth: 950, clientHeight: 520 });
    const frames: Regional3dFrame[] = [];
    const { controller } = setup({ features: geographicFeatures, selectedDistrictId: 'arys', onFrame: frame => frames.push(frame),
      facilities: ['hospital', 'polyclinic'].map((kind, index) => ({ ...facilities[0], id: `arys-${kind}`,
        kind: kind as RegionalFacility['kind'], districtId: 'arys', longitude: center[0] + (index ? .01 : -.01),
        latitude: center[1] + (index ? .012 : -.012) })) }, canvas); tick(0);
    const [scene, camera] = gpu.render.mock.calls.at(-1)! as [Scene, OrthographicCamera];
    const symbolX: number[] = [];
    scene.getObjectByName('facility-arys-hospital')!.traverse(object => {
      if (!('isMesh' in object) || object.name.startsWith('contact-shadow')) return;
      const positions = (object as Mesh).geometry.getAttribute('position');
      for (let vertex = 0; vertex < positions.count; vertex++) symbolX.push(new Vector3().fromBufferAttribute(positions, vertex)
        .applyMatrix4(object.matrixWorld).project(camera).x * 950 / 2);
    });
    expect(Math.max(...symbolX) - Math.min(...symbolX)).toBeGreaterThan(110);
    expect(Math.max(...symbolX) - Math.min(...symbolX)).toBeLessThan(180);
    const body = scene.getObjectByName('facility-arys-hospital')!.getObjectByName('main-building') as Mesh;
    const front = [-.5, .5].map(x => new Vector3(x, 0, .5).applyMatrix4(body.matrixWorld).project(camera).x * 950 / 2);
    expect(Math.abs(front[1] - front[0])).toBeGreaterThan(60);
    expect(frames.at(-1)!.facilities.every(item => item.visible)).toBe(true);
    const arrivalSpan = frames.at(-1)!.pose.span;
    controller.home(); tick(100); tick(1100);
    expect(frames.at(-1)!.pose.span).toBeGreaterThan(arrivalSpan * 2);
    expect(raf.size).toBe(0);
  });
  it('highlights a previewed building without firing entry or moving the camera', () => {
    const frames: Regional3dFrame[] = [];
    const { controller, options } = setup({ selectedDistrictId: 'turkestan', onFrame: frame => frames.push(frame) }); tick(0);
    const before = { ...frames.at(-1)!.pose };
    controller.update({ ...options, previewFacilityId: 'two' } as Regional3dState); tick(100);
    const scene = gpu.render.mock.calls.at(-1)![0] as Scene;
    expect(scene.getObjectByName('facility-two')?.getObjectByName('selection-plinth')?.visible).toBe(true);
    expect(scene.getObjectByName('facility-one')?.getObjectByName('selection-plinth')?.visible).toBe(false);
    expect(frames.at(-1)!.pose).toEqual(before); expect(frames.at(-1)!.navigating).toBe(false);
    expect(options.onFacilityFocusComplete).not.toHaveBeenCalled(); expect(options.onOpenFacility).not.toHaveBeenCalled();
    expect(raf.size).toBe(0);
  });
  it('keeps five institutions within a bounded shared-geometry budget and makes their shadows unpickable', () => {
    setup({ selectedDistrictId: 'turkestan', facilities: Array.from({ length: 5 }, (_, index) => ({ ...facilities[0], id: `institution-${index}`, kind: index % 2 ? 'polyclinic' : 'hospital' })) }); tick(0);
    const scene = gpu.render.mock.calls.at(-1)![0] as Scene;
    const geometries = new Set();
    for (let index = 0; index < 5; index++) {
      const group = scene.getObjectByName(`facility-institution-${index}`)!;
      const meshes: Mesh[] = []; group.traverse(object => { if ('isMesh' in object) meshes.push(object as Mesh); });
      expect(meshes.length).toBeLessThanOrEqual(48);
      meshes.forEach(mesh => geometries.add(mesh.geometry));
      const shadow = group.getObjectByName('contact-shadow') as Mesh;
      const intersects: Parameters<Mesh['raycast']>[1] = [];
      shadow.raycast(new Raycaster(), intersects); expect(intersects).toEqual([]);
    }
    expect(geometries.size).toBe(2); expect(raf.size).toBe(0);
  });
  it.each([{ width: 375, height: 470 }, { width: 630, height: 350 }])('keeps five clustered buildings, their roofs and selection plinths inside $width × $height', size => {
    const canvas = canvasMock(); Object.assign(canvas, { clientWidth: size.width, clientHeight: size.height });
    const frames: Regional3dFrame[] = [];
    setup({ selectedDistrictId: 'turkestan', previewFacilityId: 'institution-0', onFrame: frame => frames.push(frame),
      facilities: Array.from({ length: 5 }, (_, index) => ({ ...facilities[0], id: `institution-${index}`, kind: index % 2 ? 'polyclinic' : 'hospital' })) }, canvas); tick(0);
    const [scene, camera] = gpu.render.mock.calls.at(-1)! as [Scene, OrthographicCamera];
    for (let index = 0; index < 5; index++) {
      const group = scene.getObjectByName(`facility-institution-${index}`)!;
      group.traverse(object => {
        if (!('isMesh' in object) || object.name.startsWith('contact-shadow')) return;
        const mesh = object as Mesh; const positions = mesh.geometry.getAttribute('position');
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const point = new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld).project(camera);
          const x = (point.x + 1) / 2 * size.width, y = (1 - point.y) / 2 * size.height;
          expect(x, `${group.name}/${mesh.name} left`).toBeGreaterThanOrEqual(8);
          expect(x, `${group.name}/${mesh.name} right`).toBeLessThanOrEqual(size.width - 8);
          expect(y, `${group.name}/${mesh.name} top`).toBeGreaterThanOrEqual(38);
          expect(y, `${group.name}/${mesh.name} bottom`).toBeLessThanOrEqual(size.height - 8);
        }
      });
    }
    expect(frames.at(-1)!.facilities).toHaveLength(5);
    expect(frames.at(-1)!.facilities.every(item => item.displaced)).toBe(true);
    expect(raf.size).toBe(0);
  });
  it('suppresses selection after dragging a building instead of treating the release as entry', () => {
    const { canvas, options } = setup({ selectedDistrictId: 'turkestan' }); tick(0);
    const pick = vi.spyOn(Raycaster.prototype, 'intersectObjects');
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 1, button: 0, clientX: 300, clientY: 300, shiftKey: false }));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, button: 0, clientX: 345, clientY: 335, shiftKey: false }));
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, button: 0, clientX: 345, clientY: 335, shiftKey: false })); tick(10);
    expect(pick).not.toHaveBeenCalled(); expect(options.onOpenFacility).not.toHaveBeenCalled();
    expect(options.onFacilityFocusComplete).not.toHaveBeenCalled(); expect(raf.size).toBe(0);
  });
  it('halts rendering and requests accessible fallback on genuine context loss', () => {
    const { options, canvas } = setup({ selectedDistrictId: 'turkestan', selectedFacilityId: 'one' }); tick(0);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(options.onFailure).toHaveBeenCalledTimes(1); expect(raf.size).toBe(0);
    tick(5000); expect(options.onFacilityFocusComplete).not.toHaveBeenCalled();
  });
});
