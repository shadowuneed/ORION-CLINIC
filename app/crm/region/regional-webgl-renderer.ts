import { ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color, DirectionalLight, ExtrudeGeometry, Group, HemisphereLight, LineBasicMaterial,
  LineLoop, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
  type Material, type Object3D } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { RegionalDistrict, RegionalFacility } from '@/lib/regional/contracts';
import type { RegionalFeature } from '@/lib/regional/geography';
import { pointInsideRegionalGeometry, regionalPolygons } from '@/lib/regional/geography';
import { projectRegionalPosition, regionalBounds, type MapBounds, type MapPoint, type MapSize } from '@/lib/regional/map-camera';
import { fitRegionalPose, focusRegionalFacility, interpolateRegionalPose, regionalDistrictArrivalBounds, RegionalCameraHistory, resizeRegionalPose, safeRegionalPose, type RegionalPose } from '@/lib/regional/map-camera-3d';
import { regionalThreeShapes } from '@/lib/regional/map-geometry-3d';
import { fitRegionalBuildingSymbols } from '@/lib/regional/map-marker-layout';

export type Regional3dFrame = {
  size: MapSize; pose: RegionalPose; zoomPercent: number; navigating: boolean;
  districts: { id: string; x: number; y: number; visible: boolean }[];
  facilities: { id: string; x: number; y: number; visible: boolean; geographicAnchor: MapPoint; markerFoot: MapPoint; displaced: boolean }[];
};
export type Regional3dState = {
  districts: readonly RegionalDistrict[]; facilities: readonly RegionalFacility[];
  selectedDistrictId: string | null; selectedFacilityId?: string | null; previewFacilityId?: string | null; active?: boolean;
};
export type Regional3dOptions = Regional3dState & {
  features: readonly RegionalFeature[];
  onSelectDistrict: (id: string | null) => void; onOpenFacility: (id: string) => void;
  onFacilityFocusComplete?: (id: string, anchor?: { clientX: number; clientY: number }) => void; onFacilityFocusCancel?: (id: string) => void;
  onFrame: (frame: Regional3dFrame) => void; onFailure: () => void;
};
export type Regional3dController = {
  update: (state: Regional3dState) => void; zoom: (factor: number) => void;
  pan: (x: number, y: number) => void; orbit: (yaw: number, tilt: number) => void;
  home: () => void; dispose: () => void;
};
type FeatureMesh = { feature: RegionalFeature; bounds: MapBounds; group: Group; mesh: Mesh; selectionOutline: Group; top: MeshStandardMaterial; side: MeshStandardMaterial };
type Flight = { start: RegionalPose; end: RegionalPose; time: number; duration: number; revision: number; facility: string | null };

/** Lazy client-only engine. No perpetual animation loop, map SDK, external tiles, or patient fetches. */
export function createRegionalWebgl(canvas: HTMLCanvasElement, options: Regional3dOptions): Regional3dController {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  const scene = new Scene();
  scene.add(new AmbientLight('#e5f1ee', .38));
  const fill = new HemisphereLight('#fff7e7', '#3d5c67', 1.2); fill.name = 'map-fill-light'; scene.add(fill);
  const sun = new DirectionalLight('#fff2d8', 2.55);
  sun.position.set(-400, 700, 400); scene.add(sun);
  const rim = new DirectionalLight('#c1e2f7', .55); rim.position.set(500, 180, -400); scene.add(rim);
  const camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100000);
  const raycaster = new Raycaster();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const disposables = new Set<BufferGeometry | Material>();
  const own = <T extends BufferGeometry | Material>(value: T): T => { disposables.add(value); return value; };
  const allBounds = regionalBounds(options.features.flatMap(feature => regionalPolygons(feature.geometry).flat()
    .flatMap(ring => ring.map(coordinate => projectRegionalPosition(...coordinate)))));
  const origin = { x: (allBounds.minX + allBounds.maxX) / 2, y: (allBounds.minY + allBounds.maxY) / 2 };
  const featureMeshes: FeatureMesh[] = [];
  const pickable: Object3D[] = [];
  const edgeMaterial = own(new LineBasicMaterial({ color: '#5e9681', transparent: true, opacity: .9 }));
  const selectionMaterial = own(new LineMaterial({ color: '#a9ffe6', linewidth: 2.5, depthTest: true, depthWrite: false }));
  const hospitalMaterial = own(new MeshStandardMaterial({ color: '#eeeade', roughness: .82 }));
  const clinicMaterial = own(new MeshStandardMaterial({ color: '#b5d5d3', roughness: .82 }));
  const roofMaterial = own(new MeshStandardMaterial({ color: '#486f75', roughness: .85 }));
  const glassMaterial = own(new MeshStandardMaterial({ color: '#507d92', roughness: .38, metalness: .2 }));
  const crossMaterial = own(new MeshStandardMaterial({ color: '#e9fbf0', roughness: .7 }));
  const pavementMaterial = own(new MeshStandardMaterial({ color: '#9eafa9', roughness: 1 }));
  const entryMaterial = own(new MeshStandardMaterial({ color: '#3b8478', roughness: .6 }));
  const plantingMaterial = own(new MeshStandardMaterial({ color: '#55745a', roughness: 1 }));
  const selectionPlinthMaterial = own(new MeshBasicMaterial({ color: '#82d8c6', transparent: true, opacity: .72, depthWrite: false }));
  const shadowMaterial = own(new MeshBasicMaterial({ color: '#142d32', transparent: true, opacity: .13, depthWrite: false }));
  const buildingGeometry = own(new BoxGeometry(1, 1, 1));
  const shadowGeometry = own(new CircleGeometry(1, 32));
  const buildingRoot = new Group(); scene.add(buildingRoot);
  const buildings = new Map<string, { group: Group; point: MapPoint; visualPoint: MapPoint; roofHeight: number; selection: Mesh; displaced: boolean }>();
  let interiorSites: (MapPoint & { clearance: number })[] = [];
  const interiorSiteCache = new Map<string, typeof interiorSites>();

  for (const feature of options.features) {
    const top = own(new MeshStandardMaterial({ roughness: .95, metalness: 0 }));
    const side = own(new MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    const geometry = own(new ExtrudeGeometry(regionalThreeShapes(feature.geometry, origin), { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 }));
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, [top, side]);
    mesh.userData = { kind: 'district', id: feature.id };
    const group = new Group(), selectionOutline = new Group(); group.add(mesh); group.add(selectionOutline);
    selectionOutline.visible = false;
    // Line loops retain each real hole; do not simplify/replace boundaries with convex hulls.
    for (const polygon of regionalPolygons(feature.geometry)) for (const ring of polygon) {
      const points = ring.map(coordinate => { const point = projectRegionalPosition(...coordinate); return new Vector3(point.x - origin.x, 1.015, point.y - origin.y); });
      const line = new LineLoop(own(new BufferGeometry().setFromPoints(points)), edgeMaterial);
      group.add(line);
      const bright = new Line2(own(new LineGeometry().setPositions(points.flatMap(point => [point.x, point.y + .015, point.z]))), selectionMaterial);
      selectionOutline.add(bright);
    }
    const bounds = regionalBounds(regionalPolygons(feature.geometry).flat().flatMap(ring => ring.map(coordinate => projectRegionalPosition(...coordinate))));
    featureMeshes.push({ feature, bounds, group, mesh, selectionOutline, top, side }); scene.add(group); pickable.push(mesh);
  }

  let state: Regional3dState = options;
  let size: MapSize = { width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) };
  const initialDistrict = featureMeshes.find(item => item.feature.id === options.selectedDistrictId);
  const overviewPose = fitRegionalPose(allBounds, origin, size);
  const arrivalBounds = (item: FeatureMesh) => regionalDistrictArrivalBounds(item.bounds, state.facilities.filter(facility => facility.districtId === item.feature.id)
    .map(facility => projectRegionalPosition(facility.longitude, facility.latitude)));
  let pose = initialDistrict ? fitRegionalPose(arrivalBounds(initialDistrict), origin, size) : overviewPose;
  let scope = initialDistrict ? `district:${initialDistrict.feature.id}` : 'overview';
  const history = new RegionalCameraHistory(scope);
  history.remember('overview', overviewPose);
  if (initialDistrict) history.remember(scope, pose);
  let flight: Flight | null = null;
  let revision = 0;
  let disposed = false;
  let scheduled = 0;
  let active = state.active !== false;
  let currentDistrict: string | null = initialDistrict?.feature.id ?? null;
  let currentFacility: string | null = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointerState = new Map<number, { x: number; y: number }>();
  let gesture: { start: MapPoint; previous: MapPoint; moved: boolean; rotate: boolean; pointerId: number; canPickFacility: boolean; revision: number; district: string | null } | null = null;
  let pinchDistance = 0;

  function invalidate() {
    if (!scheduled && !disposed && active && !document.hidden) scheduled = requestAnimationFrame(draw);
  }
  function selectedBounds() { return featureMeshes.find(item => item.feature.id === state.selectedDistrictId)?.bounds ?? allBounds; }
  function selectedCameraBounds() { const item = featureMeshes.find(item => item.feature.id === state.selectedDistrictId); return item ? arrivalBounds(item) : allBounds; }
  function depth() { return Math.max(.0001, Math.min(pose.span * .042, (allBounds.maxY - allBounds.minY) * .06)); }
  function featureHeight(id: string) { return depth() * (id === state.selectedDistrictId ? 1.6 : 1); }
  function updateCamera() {
    const aspect = size.width / Math.max(1, size.height), half = pose.span / 2;
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
    const distance = Math.max(100, pose.span * 3);
    const tilt = Math.max(.001, pose.tilt);
    camera.position.set(pose.x + Math.sin(pose.yaw) * Math.sin(tilt) * distance,
      Math.cos(tilt) * distance, pose.z + Math.cos(pose.yaw) * Math.sin(tilt) * distance);
    camera.up.set(0, 1, 0); camera.lookAt(pose.x, 0, pose.z); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    selectionMaterial.resolution.set(size.width, size.height);
    for (const item of featureMeshes) item.group.scale.y = featureHeight(item.feature.id);
    buildingRoot.position.y = featureHeight(state.selectedDistrictId ?? '') + .0001;
    // Symbols are readable on screen. Overlapping symbols are exploded with explicit connectors
    // to the original DB coordinates; stored geography is never modified or misrepresented.
    const anchors = [...buildings].map(([id, item]) => ({ id, ...project(item.point, buildingRoot.position.y) }));
    // Conservative bounds include roof crosses, canopies and even the hidden selection
    // plinth. Project the model's box through the current orbit before choosing its scale.
    // The structures are schematic symbols rather than surveyed building footprints.
    // Keep their public facade readable when the geographic camera is rotated, while
    // the unchanged geographic anchor and map north remain fixed in the real scene.
    const facadeAngle = Math.PI / 7;
    const footprintCorners = [-1.9, 1.9].flatMap(x => [0, 2].flatMap(y => [-1, 1.2].map(z => ({
      x: x * Math.cos(facadeAngle) - z * Math.sin(facadeAngle),
      y: (x * Math.sin(facadeAngle) + z * Math.cos(facadeAngle)) * Math.cos(pose.tilt) - y * Math.sin(pose.tilt),
    }))));
    const footprint = regionalBounds(footprintCorners);
    let symbols = fitRegionalBuildingSymbols(anchors, size, footprint, size.width < 550 ? 32 : 36);
    for (const [id, item] of buildings) {
      item.group.rotation.y = pose.yaw - facadeAngle;
      item.group.scale.setScalar(pose.span / Math.max(1, size.height) * symbols.pixelsPerUnit);
      item.selection.visible = id === (currentFacility ?? state.previewFacilityId);
    }
    const markerPlane = new Plane(new Vector3(0, 1, 0), -buildingRoot.position.y);
    let placements = symbols.placements;
    const selectedFeature = featureMeshes.find(item => item.feature.id === state.selectedDistrictId)?.feature;
    const atSurface = (point: MapPoint) => {
      raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
      return raycaster.ray.intersectPlane(markerPlane, new Vector3());
    };
    const insideWorld = (x: number, z: number) => {
      if (!selectedFeature) return true;
      const longitude = (x + origin.x) / 100;
      const latitude = (2 * Math.atan(Math.exp(-(z + origin.y) / 100 * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
      return pointInsideRegionalGeometry([longitude, latitude], selectedFeature.geometry);
    };
    const clearOfEdge = (point: MapPoint) => {
      const world = atSurface(point);
      if (!world) return false;
      const scale = pose.span / Math.max(1, size.height) * symbols.pixelsPerUnit;
      const yaw = pose.yaw - facadeAngle, cosine = Math.cos(yaw), sine = Math.sin(yaw);
      // Test the actual rotated ground rectangle, not an approximate screen-space
      // square: Arys has narrow edges where a pin inside does not fit a courtyard.
      return [-1.9, 0, 1.9].every(x => [-1, .1, 1.2].every(z =>
        insideWorld(world.x + (x * cosine + z * sine) * scale, world.z + (-x * sine + z * cosine) * scale)));
    };
    if (selectedFeature && placements.length && !placements.every(clearOfEdge)) {
      const safe = project(projectRegionalPosition(...selectedFeature.properties.labelPoint), buildingRoot.position.y);
      const originalScale = symbols.pixelsPerUnit;
      search: for (const factor of [1, .86, .72, .6, .5, .4, .32, .26, .2, .16, .12]) {
        symbols = fitRegionalBuildingSymbols(anchors, size, footprint, originalScale * factor);
        placements = symbols.placements;
        const center = { x: placements.reduce((sum, item) => sum + item.x, 0) / placements.length,
          y: placements.reduce((sum, item) => sum + item.y, 0) / placements.length };
        for (const rotate of [false, true]) for (const blend of [0, .25, .5, .75, 1]) {
          const candidate = placements.map(item => {
            const dx = item.x - center.x, dy = item.y - center.y;
            return { ...item, displaced: true, x: center.x + (safe.x - center.x) * blend + (rotate ? -dy : dx),
              y: center.y + (safe.y - center.y) * blend + (rotate ? dx : dy) };
          });
          if (symbols.separated(candidate) && candidate.every(point => symbols.fits(point) && clearOfEdge(point))) { placements = candidate; break search; }
        }
        // Narrow, irregular districts cannot always hold a rectangular cluster near
        // an administrative-centre pin. Try actual interior sites before making the
        // whole cluster smaller. Their cached boundary clearance is independent of
        // the camera and avoids repeatedly scanning all geographic edges per frame.
        const scale = pose.span / Math.max(1, size.height) * symbols.pixelsPerUnit;
        const candidates = interiorSites.filter(site => site.clearance >= scale * 2.25).map(site => project(site, buildingRoot.position.y))
          .filter(point => symbols.fits(point));
        const placed: typeof placements = [];
        for (const anchor of anchors) {
          const candidate = candidates.filter(point => symbols.separated([...placed, point])).sort((left, right) =>
            Math.hypot(left.x - anchor.x, left.y - anchor.y) - Math.hypot(right.x - anchor.x, right.y - anchor.y))[0];
          if (!candidate) break;
          placed.push({ ...anchor, ...candidate, anchor: { x: anchor.x, y: anchor.y }, displaced: true });
        }
        if (placed.length === anchors.length && placed.every(clearOfEdge)) { placements = placed; break; }
      }
    }
    for (const item of buildings.values()) item.group.scale.setScalar(pose.span / Math.max(1, size.height) * symbols.pixelsPerUnit);
    for (const placement of placements) {
      const item = buildings.get(placement.id)!;
      item.displaced = placement.displaced;
      if (placement.displaced) {
        raycaster.setFromCamera(new Vector2(placement.x / size.width * 2 - 1, 1 - placement.y / size.height * 2), camera);
        const position = raycaster.ray.intersectPlane(markerPlane, new Vector3());
        item.visualPoint = position ? { x: position.x + origin.x, y: position.z + origin.y } : item.point;
      } else item.visualPoint = item.point;
      item.group.position.set(item.visualPoint.x - origin.x, 0, item.visualPoint.y - origin.y);
    }
    scene.updateMatrixWorld();
  }
  function project(point: MapPoint, height: number) {
    const projected = new Vector3(point.x - origin.x, height, point.y - origin.y).project(camera);
    return { x: (projected.x + 1) / 2 * size.width, y: (1 - projected.y) / 2 * size.height,
      visible: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2 };
  }
  function frame() {
    options.onFrame({ size: { ...size }, pose: { ...pose }, navigating: Boolean(flight), zoomPercent: fitRegionalPose(selectedCameraBounds(), origin, size).span / pose.span * 100,
      districts: featureMeshes.map(item => ({ id: item.feature.id, ...project(projectRegionalPosition(...item.feature.properties.labelPoint), featureHeight(item.feature.id)) })),
      facilities: [...buildings].map(([id, item]) => ({ id, ...project(item.visualPoint, buildingRoot.position.y + item.group.scale.x * item.roofHeight),
        geographicAnchor: project(item.point, buildingRoot.position.y), markerFoot: project(item.visualPoint, buildingRoot.position.y), displaced: item.displaced })) });
  }
  function draw(now: number) {
    scheduled = 0;
    if (disposed || !active || document.hidden) return;
    let completed: Flight | null = null;
    if (flight) {
      if (flight.time < 0) flight.time = now;
      const progress = flight.duration ? Math.min(1, (now - flight.time) / flight.duration) : 1;
      pose = interpolateRegionalPose(flight.start, flight.end, progress);
      if (progress === 1) { completed = flight; flight = null; }
    }
    updateCamera(); renderer.render(scene, camera); frame();
    if (flight) invalidate();
    if (completed?.facility && completed.revision === revision && completed.facility === currentFacility) {
      const building = buildings.get(completed.facility);
      const position = building ? project(building.visualPoint, buildingRoot.position.y + building.group.scale.x * .95) : null;
      const rect = canvas.getBoundingClientRect();
      options.onFacilityFocusComplete?.(completed.facility, position ? { clientX: rect.left + position.x, clientY: rect.top + position.y } : undefined);
    }
  }
  function cancelFlight(notify = false) {
    const wasFlying = Boolean(flight);
    const pending = flight?.facility;
    flight = null; revision++;
    if (notify && pending && pending === currentFacility) options.onFacilityFocusCancel?.(pending);
    if (wasFlying) invalidate();
  }
  function fly(end: RegionalPose, facility: string | null = null) {
    cancelFlight();
    flight = { start: { ...pose }, end: safeRegionalPose(end), time: -1,
      duration: reduceMotion.matches ? 0 : facility ? 650 : 600, revision, facility };
    invalidate();
  }
  function palette() {
    const css = getComputedStyle(canvas);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const districtData = new Map(state.districts.map(item => [item.id, item]));
    edgeMaterial.color.set(read('--terrain-edge', '#5e9681'));
    selectionMaterial.color.set(read('--map-selection-edge', '#a9ffe6'));
    hospitalMaterial.color.set(read('--building-wall', '#eeeade'));
    clinicMaterial.color.set(read('--building-clinic', '#b5d5d3'));
    roofMaterial.color.set(read('--building-roof', '#486f75'));
    pavementMaterial.color.set(read('--building-pavement', '#9eafa9'));
    selectionPlinthMaterial.color.set(read('--map-selection-edge', '#82d8c6'));
    for (const item of featureMeshes) {
      const data = districtData.get(item.feature.id);
      const color = !data || data.kpiPercent === null ? read('--terrain-empty', '#d8e2dc')
        : data.overdueTasks ? read('--terrain-warn', '#e3c4a1') : read('--terrain-good', '#a4d6c4');
      item.top.color.set(item.feature.id === 'shymkent' ? read('--doctor-soft', '#9fc6d2') : color);
      item.side.color.copy(item.top.color).multiplyScalar(.55);
      item.selectionOutline.visible = item.feature.id === state.selectedDistrictId;
      item.top.emissive.set(0); item.top.emissiveIntensity = 0;
      if (item.feature.id === state.selectedDistrictId) {
        item.top.color.set(read('--map-selection-fill', '#48c7ac'));
        item.top.emissive.set(read('--map-selection-fill', '#48c7ac')); item.top.emissiveIntensity = .035;
        item.side.color.set(read('--map-selection-side', '#187b66'));
      } else if (state.selectedDistrictId) {
        item.top.color.lerp(new Color(read('--map-muted-region', '#52605a')), .62);
        item.side.color.copy(item.top.color).multiplyScalar(.48);
      }
      item.mesh.visible = true;
    }
    invalidate();
  }
  function box(parent: Group, material: Material, x: number, y: number, z: number, w: number, h: number, d: number, name = '') {
    const mesh = new Mesh(buildingGeometry, material); mesh.name = name; mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh;
  }
  function updateBuildings() {
    buildingRoot.clear(); buildings.clear();
    interiorSites = [];
    const feature = featureMeshes.find(item => item.feature.id === state.selectedDistrictId)?.feature;
    if (feature && interiorSiteCache.has(feature.id)) interiorSites = interiorSiteCache.get(feature.id)!;
    else if (feature) {
      const polygons = regionalPolygons(feature.geometry).map(polygon => polygon.map(ring => ring.map(point => projectRegionalPosition(...point))));
      const sites = [projectRegionalPosition(...feature.properties.labelPoint)];
      for (const polygon of polygons) {
        const bounds = regionalBounds(polygon[0]);
        for (let column = 0; column < 14; column++) for (let row = 0; row < 10; row++) sites.push({
          x: bounds.minX + (column + .5) / 14 * (bounds.maxX - bounds.minX),
          y: bounds.minY + (row + .5) / 10 * (bounds.maxY - bounds.minY),
        });
      }
      for (const site of sites) {
        const coordinate: [number, number] = [site.x / 100,
          (2 * Math.atan(Math.exp(-site.y / 100 * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI];
        if (!pointInsideRegionalGeometry(coordinate, feature.geometry)) continue;
        let clearance = Infinity;
        for (const polygon of polygons) for (const ring of polygon) for (let index = 1; index < ring.length; index++) {
          const a = ring[index - 1], b = ring[index], dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((site.x - a.x) * dx + (site.y - a.y) * dy) / Math.max(.00000001, dx * dx + dy * dy)));
          clearance = Math.min(clearance, Math.hypot(site.x - a.x - dx * t, site.y - a.y - dy * t));
        }
        interiorSites.push({ ...site, clearance });
      }
      interiorSiteCache.set(feature.id, interiorSites);
    }
    for (const facility of [...state.facilities].filter(item => item.districtId === state.selectedDistrictId).sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
      const point = projectRegionalPosition(facility.longitude, facility.latitude), group = new Group();
      group.name = `facility-${facility.id}`; group.position.set(point.x - origin.x, 0, point.y - origin.y);
      group.userData = { kind: 'facility', id: facility.id };
      const hospital = facility.kind === 'hospital';
      const width = hospital ? 3.5 : 3;
      // Three transparent contact layers, shared geometry/material, no shadow-map render pass.
      for (let layer = 0; layer < 3; layer++) {
        const shadow = new Mesh(shadowGeometry, shadowMaterial); shadow.name = layer ? `contact-shadow-${layer}` : 'contact-shadow';
        shadow.raycast = () => {};
        shadow.rotation.x = -Math.PI / 2; shadow.scale.set(width * (.55 + layer * .07), 1.14 + layer * .12, 1);
        shadow.position.set(.1, .005 + layer * .002, .12); group.add(shadow);
      }
      const selection = box(group, selectionPlinthMaterial, 0, .025, .1, width + .24, .035, 2.15, 'selection-plinth'); selection.visible = false; selection.raycast = () => {};
      box(group, pavementMaterial, 0, .085, .1, width, .12, 1.95, 'paved-courtyard');
      if (hospital) {
        box(group, hospitalMaterial, -.28, .91, -.18, 2.2, 1.52, 1.08, 'main-building');
        box(group, roofMaterial, -.28, 1.705, -.18, 2.31, .11, 1.19, 'hospital-roof');
        box(group, hospitalMaterial, 1.18, .66, -.02, .9, 1.02, 1.28, 'care-wing');
        box(group, roofMaterial, 1.18, 1.21, -.02, 1.01, .09, 1.39);
        box(group, glassMaterial, -.28, .57, .382, .85, .75, .035, 'public-entrance');
        box(group, entryMaterial, -.28, .99, .7, 1.06, .1, .72, 'entrance-canopy');
        for (const x of [-.74, .18]) box(group, hospitalMaterial, x, .56, 1, .05, .79, .05);
        for (const x of [-1.07, -.54, -.01, .52]) for (const y of [1.17, 1.48]) box(group, glassMaterial, x, y, .368, .29, .18, .035);
        for (const y of [.5, .85]) box(group, glassMaterial, 1.643, y, -.02, .03, .19, .9);
        box(group, roofMaterial, -.45, 1.83, -.19, .8, .18, .59);
        box(group, crossMaterial, -.45, 1.935, -.19, .14, .028, .43);
        box(group, crossMaterial, -.45, 1.935, -.19, .43, .028, .14);
      } else {
        box(group, clinicMaterial, 0, .62, -.15, 2.35, .94, 1.1, 'main-building');
        box(group, roofMaterial, 0, 1.135, -.15, 2.49, .1, 1.23);
        box(group, glassMaterial, 0, .57, .416, 1.2, .71, .035, 'public-entrance');
        box(group, entryMaterial, 0, .93, .74, 1.57, .095, .79, 'clinic-canopy');
        for (const x of [-.71, .71]) box(group, hospitalMaterial, x, .53, 1.06, .055, .76, .055);
        for (const x of [-.89, .89]) box(group, glassMaterial, x, .65, .414, .35, .39, .03);
        box(group, glassMaterial, 1.181, .65, -.15, .035, .42, .72);
        box(group, crossMaterial, -.79, 1.204, -.15, .13, .03, .4);
        box(group, crossMaterial, -.79, 1.204, -.15, .4, .03, .13);
      }
      // Small planted edges and access path give the symbol a clear entrance and ground plane.
      box(group, hospitalMaterial, 0, .157, .87, .6, .025, .37, 'entry-path');
      for (const x of [-width / 2 + .15, width / 2 - .15]) {
        box(group, roofMaterial, x, .22, .78, .24, .15, .27);
        box(group, plantingMaterial, x, .34, .78, .29, .16, .32);
      }
      group.traverse(object => { if (object instanceof Mesh) object.userData = group.userData; });
      buildingRoot.add(group); buildings.set(facility.id, { group, point, visualPoint: point, roofHeight: hospital ? 1.97 : 1.24, selection, displaced: false });
    }
  }
  function selection() {
    const district = state.selectedDistrictId;
    const facility = state.selectedFacilityId && state.facilities.some(item => item.id === state.selectedFacilityId && item.districtId === district)
      ? state.selectedFacilityId : null;
    if (currentDistrict === district && currentFacility === facility) return;
    const districtChanged = currentDistrict !== district;
    currentDistrict = district; currentFacility = facility;
    const nextScope = facility ? `facility:${facility}` : district ? `district:${district}` : 'overview';
    if (districtChanged) updateBuildings();
    const fitted = fitRegionalPose(selectedCameraBounds(), origin, size, pose.tilt, pose.yaw);
    const building = facility ? buildings.get(facility) : undefined;
    const districtPose = scope.startsWith('facility:') ? history.get(`district:${district}`) ?? pose : pose;
    const fallback = building ? focusRegionalFacility(districtPose, { x: building.point.x - origin.x, y: building.point.y - origin.y }) : fitted;
    const next = history.transition(nextScope, pose, fallback);
    scope = nextScope; fly(next, facility); palette();
  }
  function resize() {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    const nextSize = { width, height };
    if (size.width !== width || size.height !== height) {
      pose = resizeRegionalPose(pose, selectedCameraBounds(), origin, size, nextSize);
      if (flight) flight = { ...flight, start: { ...pose }, end: resizeRegionalPose(flight.end, selectedCameraBounds(), origin, size, nextSize), time: -1 };
      const bookmarks = [{ scope: 'overview', bounds: allBounds },
        ...featureMeshes.map(item => ({ scope: `district:${item.feature.id}`, bounds: arrivalBounds(item) })),
        ...state.facilities.flatMap(item => {
          const feature = featureMeshes.find(feature => feature.feature.id === item.districtId);
          return feature ? [{ scope: `facility:${item.id}`, bounds: arrivalBounds(feature) }] : [];
        })];
      for (const bookmark of bookmarks) {
        const saved = history.get(bookmark.scope);
        if (saved) history.remember(bookmark.scope, resizeRegionalPose(saved, bookmark.bounds, origin, size, nextSize));
      }
    }
    size = nextSize; renderer.setSize(width, height, false); invalidate();
  }
  function pointerWorld(point: MapPoint) {
    updateCamera(); raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, -(point.y / size.height) * 2 + 1), camera);
    return raycaster.ray.intersectPlane(ground, new Vector3());
  }
  function zoom(factor: number, point: MapPoint = { x: size.width / 2, y: size.height / 2 }) {
    cancelFlight(true);
    const before = pointerWorld(point);
    pose = safeRegionalPose({ ...pose, span: pose.span / Math.max(.2, Math.min(5, factor)) });
    const after = pointerWorld(point);
    if (before && after) pose = safeRegionalPose({ ...pose, x: pose.x + before.x - after.x, z: pose.z + before.z - after.z });
    invalidate();
  }
  function pan(x: number, y: number) {
    cancelFlight(true);
    const from = pointerWorld({ x: size.width / 2, y: size.height / 2 });
    const to = pointerWorld({ x: size.width / 2 + x, y: size.height / 2 + y });
    if (from && to) pose = safeRegionalPose({ ...pose, x: pose.x + from.x - to.x, z: pose.z + from.z - to.z });
    invalidate();
  }
  function orbit(yaw: number, tilt: number) { cancelFlight(true); pose = safeRegionalPose({ ...pose, yaw: pose.yaw + yaw, tilt: pose.tilt + tilt }); invalidate(); }
  function local(event: { clientX: number; clientY: number }) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  const wheel = (event: WheelEvent) => { event.preventDefault(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    zoom(Math.exp(-Math.max(-150, Math.min(150, event.deltaY * unit)) * .002), local(event)); };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const canPickFacility = !flight;
    // A second tap while the district is arriving must not stop it halfway. Real drag,
    // pinch, wheel and keyboard movement cancel through pan/orbit/zoom, not pointerdown.
    const point = local(event); pointerState.set(event.pointerId, point);
    gesture = { start: point, previous: point, moved: false, rotate: event.button === 2 || event.shiftKey, pointerId: event.pointerId,
      canPickFacility, revision, district: state.selectedDistrictId };
    if (pointerState.size === 2) { const [a, b] = [...pointerState.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); gesture.moved = true; }
    canvas.setPointerCapture(event.pointerId); canvas.dataset.dragging = 'true';
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointerState.has(event.pointerId)) return;
    const point = local(event); pointerState.set(event.pointerId, point);
    if (pointerState.size === 2) {
      const [a, b] = [...pointerState.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) zoom(distance / pinchDistance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      pinchDistance = distance; if (gesture) { gesture.moved = true; gesture.previous = point; } return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 5) gesture.moved = true;
    if (gesture.moved) {
      const dx = point.x - gesture.previous.x, dy = point.y - gesture.previous.y;
      if (gesture.rotate) orbit(-dx * .007, dy * .004); else pan(dx, dy);
      gesture.previous = point;
    }
  };
  const pointerEnd = (event: PointerEvent) => {
    const click = event.type === 'pointerup' && gesture?.pointerId === event.pointerId && !gesture.moved && pointerState.size === 1
      && event.button === 0 && gesture.canPickFacility && gesture.revision === revision && gesture.district === state.selectedDistrictId;
    const canPickFacility = gesture?.canPickFacility;
    pointerState.delete(event.pointerId); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    gesture = null; pinchDistance = 0; canvas.dataset.dragging = 'false';
    if (!click) return;
    const point = local(event); updateCamera(); raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
    const hits = raycaster.intersectObjects([...buildingRoot.children, ...pickable], true);
    const hit = canPickFacility ? hits[0] : undefined;
    if (hit?.object.userData.kind === 'facility') options.onOpenFacility(hit.object.userData.id as string);
    else if (hit?.object.userData.kind === 'district' && hit.object.userData.id !== state.selectedDistrictId) options.onSelectDistrict(hit.object.userData.id as string);
  };
  const contextMenu = (event: Event) => event.preventDefault();
  const contextLost = (event: Event) => { event.preventDefault(); active = false; cancelFlight(); if (scheduled) cancelAnimationFrame(scheduled); scheduled = 0; options.onFailure(); };
  const freeze = () => { if (scheduled) cancelAnimationFrame(scheduled); scheduled = 0;
    if (flight) { flight.start = { ...pose }; flight.time = -1; } };
  const visibility = () => { if (document.hidden) freeze(); else invalidate(); };
  const motionChanged = () => { if (reduceMotion.matches && flight) flight.duration = 0; invalidate(); };
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  const themeObserver = new MutationObserver(palette); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerEnd); canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('contextmenu', contextMenu); canvas.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', visibility); reduceMotion.addEventListener('change', motionChanged);
  resize(); palette(); updateBuildings(); selection();
  return {
    update(next) {
      const facilitiesChanged = state.facilities !== next.facilities;
      state = next; active = next.active !== false;
      if (!active) freeze();
      if (facilitiesChanged) updateBuildings(); selection(); palette(); invalidate();
    }, zoom, pan, orbit,
    home() { cancelFlight(true); history.reset(scope); fly(fitRegionalPose(selectedBounds(), origin, size)); },
    dispose() {
      if (disposed) return; disposed = true; cancelFlight(); if (scheduled) cancelAnimationFrame(scheduled);
      resizeObserver.disconnect(); themeObserver.disconnect();
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd); canvas.removeEventListener('pointercancel', pointerEnd); canvas.removeEventListener('contextmenu', contextMenu);
      canvas.removeEventListener('webglcontextlost', contextLost); document.removeEventListener('visibilitychange', visibility); reduceMotion.removeEventListener('change', motionChanged);
      // React StrictMode/HMR may immediately re-use this same canvas. Forcing a context loss here
      // poisons that next renderer; disposing all owned GPU resources is sufficient.
      for (const resource of disposables) resource.dispose(); scene.clear(); renderer.dispose();
    },
  };
}
