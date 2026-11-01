export type MapPoint = { x: number; y: number };
export type MapSize = { width: number; height: number };
export type MapBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type RegionalCamera = MapPoint & { zoom: number };
export type MapLabel = MapPoint & { id: string; width: number; height: number };

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
export const clampRegionalZoom = (zoom: number) => Math.max(.15, Math.min(45, finite(zoom, 1)));

/** Standard north-up Mercator; depth is a separate visual layer, never a rotation of geography. */
export function projectRegionalPosition(longitude: number, latitude: number): MapPoint {
  const boundedLatitude = Math.max(-85, Math.min(85, finite(latitude)));
  return { x: finite(longitude) * 100, y: -Math.log(Math.tan(Math.PI / 4 + boundedLatitude * Math.PI / 360)) * 180 / Math.PI * 100 };
}

export function regionalBounds(points: readonly MapPoint[]): MapBounds {
  const valid = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!valid.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX: Math.min(...valid.map(point => point.x)), maxX: Math.max(...valid.map(point => point.x)),
    minY: Math.min(...valid.map(point => point.y)), maxY: Math.max(...valid.map(point => point.y)) };
}

export function fitRegionalCamera(bounds: MapBounds, size: MapSize, padding = 60): RegionalCamera {
  const width = Math.max(1, finite(size.width, 1000)), height = Math.max(1, finite(size.height, 650));
  const safePadding = Math.min(padding, width * .2, height * .2);
  const zoom = clampRegionalZoom(Math.min((width - safePadding * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (height - safePadding * 2) / Math.max(1, bounds.maxY - bounds.minY)));
  return { zoom, x: width / 2 - (bounds.minX + bounds.maxX) * zoom / 2,
    y: height / 2 - (bounds.minY + bounds.maxY) * zoom / 2 };
}

export function regionalScreenPoint(camera: RegionalCamera, point: MapPoint): MapPoint {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

export function zoomRegionalCameraAt(camera: RegionalCamera, requestedZoom: number, anchor: MapPoint): RegionalCamera {
  const zoom = clampRegionalZoom(requestedZoom), ratio = zoom / camera.zoom;
  return { zoom, x: finite(anchor.x) - (finite(anchor.x) - camera.x) * ratio,
    y: finite(anchor.y) - (finite(anchor.y) - camera.y) * ratio };
}

export function panRegionalCamera(camera: RegionalCamera, delta: MapPoint): RegionalCamera {
  return { ...camera, x: Math.max(-1e7, Math.min(1e7, camera.x + finite(delta.x))),
    y: Math.max(-1e7, Math.min(1e7, camera.y + finite(delta.y))) };
}

const intersects = (a: MapLabel, b: MapLabel) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 8
  && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 8;

/** Keep names near their geographic anchor. Lower-priority collisions wait for zoom, never move to another district. */
export function placeRegionalLabels(labels: readonly MapLabel[], size: MapSize, maximumDisplacement = 90, reserved: readonly MapLabel[] = []): MapLabel[] {
  const placed: MapLabel[] = [];
  const radiusLimit = Math.max(0, Math.min(180, finite(maximumDisplacement, 90)));
  for (const label of labels) {
    if (label.width + 20 > size.width || label.height + 24 > size.height) continue;
    const constrain = (point: MapPoint): MapLabel => ({ ...label,
      x: Math.max(label.width / 2 + 10, Math.min(size.width - label.width / 2 - 10, point.x)),
      y: Math.max(label.height / 2 + 12, Math.min(size.height - label.height / 2 - 12, point.y)) });
    const candidates = [constrain(label)];
    for (let radius = 15; radius <= radiusLimit; radius += 15) {
      for (let direction = 0; direction < 16; direction++) {
        const angle = direction * Math.PI / 8 - Math.PI / 2;
        candidates.push(constrain({ x: label.x + Math.cos(angle) * radius, y: label.y + Math.sin(angle) * radius }));
      }
    }
    const distance = (candidate: MapLabel) => Math.hypot(candidate.x - label.x, candidate.y - label.y);
    const available = candidates.filter(candidate => distance(candidate) <= radiusLimit + 1e-8
      && !placed.some(item => intersects(candidate, item)) && !reserved.some(item => intersects(candidate, item)));
    available.sort((a, b) => distance(a) - distance(b));
    if (available[0]) placed.push(available[0]);
  }
  return placed;
}
