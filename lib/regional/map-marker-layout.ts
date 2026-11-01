import type { MapBounds, MapPoint, MapSize } from './map-camera';

export type RegionalMarkerAnchor = MapPoint & { id: string };
export type RegionalMarkerPlacement = RegionalMarkerAnchor & { anchor: MapPoint; displaced: boolean };
type MarkerFootprint = { bounds: MapBounds; columns: number; rowSeparation: number; labelRoom: number };

/** Fit the complete symbols, not just their ground pins. Geometry and DB anchors stay untouched. */
export function fitRegionalBuildingSymbols(markers: readonly RegionalMarkerAnchor[], size: MapSize, unitBounds: MapBounds, preferredPixelsPerUnit: number) {
  const count = Math.max(1, markers.length), padding = 12, gap = 18, labelRoom = Math.min(46, size.height * .12);
  const width = Math.max(.01, unitBounds.maxX - unitBounds.minX), height = Math.max(.01, unitBounds.maxY - unitBounds.minY);
  let pixelsPerUnit = 0, columns = 1;
  for (let candidate = 1; candidate <= Math.min(3, count); candidate++) {
    const rows = Math.ceil(count / candidate);
    const scale = Math.min(preferredPixelsPerUnit,
      (size.width - padding * 2 - gap * (candidate - 1)) / (candidate * width),
      (size.height - padding * 2 - labelRoom - gap * (rows - 1)) / (rows * height));
    // When several grids keep the preferred size, favour side-by-side symbols
    // instead of a tall stack that wastes a wide district view.
    if (scale >= pixelsPerUnit) { pixelsPerUnit = scale; columns = candidate; }
  }
  pixelsPerUnit = Math.max(.1, pixelsPerUnit);
  const bounds = { minX: unitBounds.minX * pixelsPerUnit, maxX: unitBounds.maxX * pixelsPerUnit,
    minY: unitBounds.minY * pixelsPerUnit, maxY: unitBounds.maxY * pixelsPerUnit };
  const rowSeparation = height * pixelsPerUnit + gap;
  const placements = spreadRegionalMarkers(markers, size, width * pixelsPerUnit + gap, { bounds, columns, rowSeparation, labelRoom });
  const fits = (point: MapPoint) => point.x + bounds.minX >= padding - .001 && point.x + bounds.maxX <= size.width - padding + .001
    && point.y + bounds.minY >= padding + labelRoom - .001 && point.y + bounds.maxY <= size.height - padding + .001;
  const separated = (points: readonly MapPoint[]) => points.every((point, index) => points.slice(index + 1).every(other =>
    Math.abs(point.x - other.x) >= bounds.maxX - bounds.minX + 8 - .001
      || Math.abs(point.y - other.y) >= bounds.maxY - bounds.minY + 8 - .001));
  return { pixelsPerUnit, bounds, placements, fits, separated };
}

/** Separate *symbols*, never stored geography. Callers must show the anchor and its connector. */
export function spreadRegionalMarkers(markers: readonly RegionalMarkerAnchor[], size: MapSize, separation = 106, footprint?: MarkerFootprint): RegionalMarkerPlacement[] {
  const ordered = [...markers].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const groups: RegionalMarkerAnchor[][] = [];
  const visited = new Set<string>();
  const overlaps = (a: MapPoint, b: MapPoint, tolerance = 0) => footprint
    ? Math.abs(a.x - b.x) < separation - tolerance && Math.abs(a.y - b.y) < footprint.rowSeparation - tolerance
    : Math.hypot(a.x - b.x, a.y - b.y) < separation - tolerance;
  for (const marker of ordered) {
    if (visited.has(marker.id)) continue;
    const group = [marker]; visited.add(marker.id);
    for (let index = 0; index < group.length; index++) {
      for (const candidate of ordered) if (!visited.has(candidate.id)
        && overlaps(group[index], candidate)) {
        group.push(candidate); visited.add(candidate.id);
      }
    }
    groups.push(group.sort((a, b) => a.id.localeCompare(b.id, 'en')));
  }
  const placeGroup = (group: RegionalMarkerAnchor[]): RegionalMarkerPlacement[] => {
    if (group.length === 1 && !footprint) return [{ ...group[0], anchor: { x: group[0].x, y: group[0].y }, displaced: false }];
    const center = { x: group.reduce((sum, marker) => sum + marker.x, 0) / group.length,
      y: group.reduce((sum, marker) => sum + marker.y, 0) / group.length };
    // Do not bring a cluster back into view when the user intentionally pans it off screen.
    const visible = center.x >= 0 && center.x <= size.width && center.y >= 0 && center.y <= size.height;
    const columns = Math.max(1, Math.min(3, group.length, footprint?.columns ?? Math.floor((size.width - 84) / separation) + 1));
    const rows = Math.ceil(group.length / columns);
    const offsets = group.map((_, index) => {
      const row = Math.floor(index / columns), count = Math.min(columns, group.length - row * columns);
      return { x: ((index % columns) - (count - 1) / 2) * separation, y: (row - (rows - 1) / 2) * (footprint?.rowSeparation ?? separation) };
    });
    if (visible) {
      const minX = Math.min(...offsets.map(point => point.x)), maxX = Math.max(...offsets.map(point => point.x));
      const minY = Math.min(...offsets.map(point => point.y)), maxY = Math.max(...offsets.map(point => point.y));
      const left = footprint ? 12 - footprint.bounds.minX : 42, right = footprint ? 12 + footprint.bounds.maxX : 42;
      const top = footprint ? 12 + footprint.labelRoom - footprint.bounds.minY : 42, bottom = footprint ? 12 + footprint.bounds.maxY : 42;
      if (maxX - minX + left + right <= size.width + .001) center.x = Math.max(left - minX, Math.min(size.width - right - maxX, center.x));
      if (maxY - minY + top + bottom <= size.height + .001) center.y = Math.max(top - minY, Math.min(size.height - bottom - maxY, center.y));
    }
    return group.map((marker, index) => ({ id: marker.id, x: center.x + offsets[index].x, y: center.y + offsets[index].y,
      anchor: { x: marker.x, y: marker.y }, displaced: group.length > 1 || Math.hypot(center.x + offsets[index].x - marker.x, center.y + offsets[index].y - marker.y) > .01 }));
  };
  // A newly spread cluster may touch a neighbouring cluster. Merge those symbols and lay
  // them out together instead of solving one overlap only to introduce another.
  let merged = true;
  while (merged) {
    merged = false;
    const placements = groups.map(placeGroup);
    outer: for (let left = 0; left < groups.length; left++) for (let right = left + 1; right < groups.length; right++) {
      if (placements[left].some(a => placements[right].some(b => overlaps(a, b, .001)))) {
        groups[left] = [...groups[left], ...groups[right]].sort((a, b) => a.id.localeCompare(b.id, 'en'));
        groups.splice(right, 1); merged = true; break outer;
      }
    }
  }
  return groups.flatMap(placeGroup);
}
