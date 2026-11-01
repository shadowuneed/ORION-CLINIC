export type CrmCameraPoint = { x: number; y: number };
export type CrmMapCamera = { zoom: number; pan: CrmCameraPoint };
export type CrmCampusBounds = { minX: number; maxX: number; minY: number; maxY: number };
export const CRM_GAME_MIN_ZOOM = .4;
export const CRM_GAME_MAX_ZOOM = 2.8;
export const CRM_GAME_PAN_LIMIT = 1400;

export function clampCrmCameraZoom(value: number, gameMode = false) {
  if (Number.isNaN(value)) return 1;
  return Math.max(gameMode ? CRM_GAME_MIN_ZOOM : .65, Math.min(gameMode ? CRM_GAME_MAX_ZOOM : 1.8, value));
}
export function clampCrmCameraPan(value: number, gameMode = false) {
  if (Number.isNaN(value)) return 0;
  const limit = gameMode ? CRM_GAME_PAN_LIMIT : 260;
  return Math.max(-limit, Math.min(limit, value));
}
export function panCrmCamera(camera: CrmMapCamera, delta: CrmCameraPoint, gameMode = false): CrmMapCamera {
  return { zoom: clampCrmCameraZoom(camera.zoom, gameMode), pan: {
    x: clampCrmCameraPan(camera.pan.x + delta.x, gameMode), y: clampCrmCameraPan(camera.pan.y + delta.y, gameMode),
  } };
}
/** Anchor is measured in viewport pixels relative to its centre, not in SVG units. */
export function zoomCrmCameraAt(camera: CrmMapCamera, nextZoom: number, anchor: CrmCameraPoint, gameMode = false): CrmMapCamera {
  const zoom = clampCrmCameraZoom(nextZoom, gameMode);
  const previousZoom = clampCrmCameraZoom(camera.zoom, gameMode);
  const safeAnchor = { x: Number.isFinite(anchor.x) ? anchor.x : 0, y: Number.isFinite(anchor.y) ? anchor.y : 0 };
  return { zoom, pan: {
    x: clampCrmCameraPan(safeAnchor.x - (safeAnchor.x - camera.pan.x) * zoom / previousZoom, gameMode),
    y: clampCrmCameraPan(safeAnchor.y - (safeAnchor.y - camera.pan.y) * zoom / previousZoom, gameMode),
  } };
}
/** SVG uses the default xMidYMid meet aspect-ratio mapping inside the viewport. */
export function crmSvgPointInViewport(point: CrmCameraPoint, size: { width: number; height: number }): CrmCameraPoint | null {
  if (![point.x, point.y, size.width, size.height].every(Number.isFinite) || size.width <= 0 || size.height <= 0) return null;
  const scale = Math.min(size.width / 1000, size.height / 680);
  return { x: (point.x - 500) * scale, y: (point.y - 340) * scale };
}
export function focusCrmCamera(camera: CrmMapCamera, point: CrmCameraPoint, size: { width: number; height: number }, gameMode = true): CrmMapCamera {
  const local = crmSvgPointInViewport(point, size);
  if (!local) return camera;
  const zoom = clampCrmCameraZoom(camera.zoom, gameMode);
  return { zoom, pan: { x: clampCrmCameraPan(-local.x * zoom, gameMode), y: clampCrmCameraPan(-local.y * zoom, gameMode) } };
}
/** A clicked moving avatar is focused from its rendered position, not its saved-stage anchor. */
export function focusCrmRenderedPoint(camera: CrmMapCamera, renderedOffset: CrmCameraPoint, gameMode = true): CrmMapCamera {
  if (!Number.isFinite(renderedOffset.x) || !Number.isFinite(renderedOffset.y)) return camera;
  return { zoom: clampCrmCameraZoom(camera.zoom, gameMode), pan: {
    x: clampCrmCameraPan(camera.pan.x - renderedOffset.x, gameMode), y: clampCrmCameraPan(camera.pan.y - renderedOffset.y, gameMode),
  } };
}
export const resetCrmCamera = (): CrmMapCamera => ({ zoom: 1, pan: { x: 0, y: 0 } });

function campusViewport(size: { width: number; height: number }, bounds: CrmCampusBounds, overview = false) {
  if (![size.width, size.height, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) ||
    size.width <= 0 || size.height <= 0 || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) return null;
  const scale = Math.min(size.width / 1000, size.height / 680);
  // Narrow screens use stacked panels; large screens reserve the HUD side columns.
  const left = !overview && size.width >= 1100 ? 370 : 18, right = !overview && size.width >= 1100 ? 125 : 18;
  const top = overview ? Math.min(110, size.height * .15) : Math.min(150, size.height * .2);
  const bottom = overview ? Math.min(120, size.height * .16) : Math.min(180, size.height * .25);
  const margin = 14;
  return { minX: (bounds.minX - 500) * scale, maxX: (bounds.maxX - 500) * scale,
    minY: (bounds.minY - 340) * scale, maxY: (bounds.maxY - 340) * scale,
    left: left + margin - size.width / 2, right: size.width / 2 - right - margin,
    top: top + margin - size.height / 2, bottom: size.height / 2 - bottom - margin };
}
/** Explicit Home/overview fit, using geometry only—not patient locations or live tracking. */
export function fitCrmCampusCamera(size: { width: number; height: number }, bounds: CrmCampusBounds): CrmMapCamera {
  const view = campusViewport(size, bounds, true);
  if (!view || view.left >= view.right || view.top >= view.bottom) return resetCrmCamera();
  const zoom = clampCrmCameraZoom(Math.min(1, (view.right - view.left) / (view.maxX - view.minX),
    (view.bottom - view.top) / (view.maxY - view.minY)), true);
  return { zoom, pan: { x: clampCrmCameraPan((view.left + view.right - (view.minX + view.maxX) * zoom) / 2, true),
    y: clampCrmCameraPan((view.top + view.bottom - (view.minY + view.maxY) * zoom) / 2, true) } };
}
/** Readable initial game view intentionally shows part of the navigable campus. */
export function initialCrmGameCamera(size: { width: number; height: number }, bounds: CrmCampusBounds): CrmMapCamera {
  const view = campusViewport(size, bounds);
  if (!view) return resetCrmCamera();
  const zoom = 1;
  return { zoom, pan: { x: clampCrmCameraPan((view.left + view.right - (view.minX + view.maxX) * zoom) / 2, true),
    y: clampCrmCameraPan((view.top + view.bottom - (view.minY + view.maxY) * zoom) / 2, true) } };
}
/** Explicit building navigation keeps normal room sizes, restoring them after overview. */
export function centreCrmBuildingCamera(size: { width: number; height: number }, bounds: CrmCampusBounds, previousZoom = 1): CrmMapCamera {
  const view = campusViewport(size, bounds);
  if (!view) return resetCrmCamera();
  const zoom = clampCrmCameraZoom(Math.max(1, previousZoom), true);
  return { zoom, pan: { x: clampCrmCameraPan((view.left + view.right - (view.minX + view.maxX) * zoom) / 2, true),
    y: clampCrmCameraPan((view.top + view.bottom - (view.minY + view.maxY) * zoom) / 2, true) } };
}
/** Auto-focus may nudge the campus, but never throw the opposite rooms off-screen. Free drag is separate. */
export function keepCrmCampusVisible(camera: CrmMapCamera, size: { width: number; height: number }, bounds: CrmCampusBounds): CrmMapCamera {
  const view = campusViewport(size, bounds);
  if (!view) return camera;
  const zoom = clampCrmCameraZoom(camera.zoom, true);
  const limit = (desired: number, min: number, max: number, lo: number, hi: number) => {
    const lower = lo - min * zoom, upper = hi - max * zoom;
    if (lower <= upper) return Math.max(lower, Math.min(upper, desired));
    const centre = (lower + upper) / 2;
    // The large game world can be only partly visible. Let selection navigate it,
    // but keep a useful campus portion on-screen instead of panning into empty space.
    const travel = Math.max(90, Math.min(1200, (lower - upper) / 2 * .8));
    return Math.max(centre - travel, Math.min(centre + travel, desired));
  };
  return { zoom, pan: { x: clampCrmCameraPan(limit(camera.pan.x, view.minX, view.maxX, view.left, view.right), true),
    y: clampCrmCameraPan(limit(camera.pan.y, view.minY, view.maxY, view.top, view.bottom), true) } };
}
