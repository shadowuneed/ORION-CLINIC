import type { MapBounds, MapPoint, MapSize } from './map-camera';

/** Span is the orthographic viewport height, not a fabricated geographic scale. */
export type RegionalPose = { x: number; z: number; span: number; yaw: number; tilt: number };
export const REGIONAL_DEFAULT_TILT = Math.PI * 48 / 180;
export const REGIONAL_DEFAULT_YAW = -Math.PI / 15;
const TAU = Math.PI * 2;
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function safeRegionalPose(pose: RegionalPose): RegionalPose {
  return { x: Math.max(-100000, Math.min(100000, finite(pose.x, 0))), z: Math.max(-100000, Math.min(100000, finite(pose.z, 0))),
    span: Math.max(.03, Math.min(10000, finite(pose.span, 1000))),
    yaw: ((finite(pose.yaw, 0) + Math.PI) % TAU + TAU) % TAU - Math.PI,
    tilt: Math.max(0, Math.min(Math.PI * .34, finite(pose.tilt, REGIONAL_DEFAULT_TILT))) };
}

export function fitRegionalPose(bounds: MapBounds, origin: MapPoint, size: MapSize, tilt = REGIONAL_DEFAULT_TILT, yaw = REGIONAL_DEFAULT_YAW): RegionalPose {
  const aspect = Math.max(.1, size.width / Math.max(1, size.height));
  // Preserve all projected boundary coordinates. Only the view/camera is tilted.
  const width = Math.max(.01, bounds.maxX - bounds.minX), height = Math.max(.01, bounds.maxY - bounds.minY);
  const horizontal = (width * Math.abs(Math.cos(yaw)) + height * Math.abs(Math.sin(yaw))) / aspect;
  const vertical = (height * Math.abs(Math.cos(yaw)) + width * Math.abs(Math.sin(yaw))) * Math.cos(tilt);
  return safeRegionalPose({ x: (bounds.minX + bounds.maxX) / 2 - origin.x,
    z: (bounds.minY + bounds.maxY) / 2 - origin.y, span: Math.max(horizontal, vertical) * 1.32,
    yaw, tilt });
}

/** Initial district arrival shows the institutions and nearby real ground; Home fits the full territory. */
export function regionalDistrictArrivalBounds(bounds: MapBounds, facilities: readonly MapPoint[]): MapBounds {
  const points = facilities.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY);
  if (!points.length) return bounds;
  const margin = Math.max(.01, Math.min(28, Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * .22));
  return { minX: Math.max(bounds.minX, Math.min(...points.map(point => point.x)) - margin),
    maxX: Math.min(bounds.maxX, Math.max(...points.map(point => point.x)) + margin),
    minY: Math.max(bounds.minY, Math.min(...points.map(point => point.y)) - margin),
    maxY: Math.min(bounds.maxY, Math.max(...points.map(point => point.y)) + margin) };
}

/** A layout resize retains the user's pan, orbit and zoom relative to the visible scope. */
export function resizeRegionalPose(pose: RegionalPose, bounds: MapBounds, origin: MapPoint, from: MapSize, to: MapSize): RegionalPose {
  const before = fitRegionalPose(bounds, origin, from, pose.tilt, pose.yaw);
  const after = fitRegionalPose(bounds, origin, to, pose.tilt, pose.yaw);
  return safeRegionalPose({ ...pose, span: pose.span * after.span / before.span });
}

/** Entering an institution is a data/navigation action, not a dive through the map. */
export function focusRegionalFacility(pose: RegionalPose, point: MapPoint): RegionalPose {
  const limit = pose.span * .14;
  return safeRegionalPose({ ...pose, span: pose.span / 1.12,
    x: pose.x + Math.max(-limit, Math.min(limit, point.x - pose.x)),
    z: pose.z + Math.max(-limit, Math.min(limit, point.y - pose.z)) });
}

export function interpolateRegionalPose(start: RegionalPose, end: RegionalPose, progress: number): RegionalPose {
  const t = Math.max(0, Math.min(1, finite(progress, 1)));
  const ease = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  // Follow the short orbit through north; a district zoom is geometric rather than an abrupt linear jump.
  const yawDelta = ((end.yaw - start.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return safeRegionalPose({ x: start.x + (end.x - start.x) * ease, z: start.z + (end.z - start.z) * ease,
    span: Math.exp(Math.log(start.span) + (Math.log(end.span) - Math.log(start.span)) * ease),
    yaw: start.yaw + yawDelta * ease, tilt: start.tilt + (end.tilt - start.tilt) * ease });
}

/** Bookmarks are runtime view state only: changing a camera never writes clinical data. */
export class RegionalCameraHistory {
  private readonly saved = new Map<string, RegionalPose>();
  private current: string;
  constructor(initialScope = 'overview') { this.current = initialScope; }
  transition(next: string, currentPose: RegionalPose, fallback: RegionalPose): RegionalPose {
    if (next !== this.current) { this.saved.set(this.current, { ...currentPose }); this.current = next; }
    return { ...(this.saved.get(next) ?? fallback) };
  }
  reset(scope: string) { this.saved.delete(scope); }
  remember(scope: string, pose: RegionalPose) { this.saved.set(scope, { ...pose }); }
  get(scope: string): RegionalPose | undefined { const pose = this.saved.get(scope); return pose ? { ...pose } : undefined; }
}
