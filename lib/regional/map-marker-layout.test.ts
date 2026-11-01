import { describe, expect, it } from 'vitest';
import { fitRegionalBuildingSymbols, spreadRegionalMarkers } from './map-marker-layout';
import { placeRegionalLabels } from './map-camera';

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
describe('readable DB-anchored hospital clusters', () => {
  it('separates two co-located buildings without changing their original geographic anchors', () => {
    const input = [{ id: 'hospital', x: 300, y: 260 }, { id: 'polyclinic', x: 301, y: 260 }];
    const result = spreadRegionalMarkers(input, { width: 630, height: 600 });
    expect(distance(result[0], result[1])).toBeGreaterThanOrEqual(105.999);
    for (const marker of result) {
      expect(marker.displaced).toBe(true); expect(marker.anchor).toEqual(input.find(item => item.id === marker.id) && { x: input.find(item => item.id === marker.id)!.x, y: 260 });
    }
    expect(input[0]).toEqual({ id: 'hospital', x: 300, y: 260 });
  });
  it('keeps all five buildings individually selectable on a small viewport and stable after API reordering', () => {
    const input = Array.from({ length: 5 }, (_, index) => ({ id: `hospital-${index}`, x: 160 + index, y: 260 }));
    const size = { width: 360, height: 470 }, result = spreadRegionalMarkers(input, size);
    expect(result).toEqual(spreadRegionalMarkers([...input].reverse(), size));
    for (let i = 0; i < result.length; i++) {
      expect(result[i].x).toBeGreaterThanOrEqual(41.99); expect(result[i].x).toBeLessThanOrEqual(318.01);
      for (let j = i + 1; j < result.length; j++) expect(distance(result[i], result[j])).toBeGreaterThanOrEqual(105.999);
    }
  });
  it('merges neighbouring exploded groups if separating their symbols would cause a new overlap', () => {
    const result = spreadRegionalMarkers([{ id: 'a', x: 300, y: 300 }, { id: 'b', x: 330, y: 300 }, { id: 'c', x: 440, y: 300 }], { width: 900, height: 600 });
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) expect(distance(result[i], result[j])).toBeGreaterThanOrEqual(105.999);
  });
  it('leaves isolated geography untouched and does not pull intentionally offscreen symbols back into view', () => {
    const result = spreadRegionalMarkers([{ id: 'a', x: 80, y: 180 }, { id: 'b', x: 300, y: 180 }], { width: 360, height: 470 });
    expect(result.every(marker => !marker.displaced)).toBe(true);
    const offscreen = spreadRegionalMarkers([{ id: 'a', x: -500, y: 100 }, { id: 'b', x: -500, y: 100 }], { width: 360, height: 470 });
    expect(offscreen.every(marker => marker.x < 0)).toBe(true);
  });
  it('keeps facility callouts off the visible 3D building footprints', () => {
    const reserved = [{ id: 'building-a', x: 240, y: 270, width: 90, height: 94 }, { id: 'building-b', x: 346, y: 270, width: 90, height: 94 }];
    const labels = placeRegionalLabels([{ id: 'a', x: 190, y: 200, width: 196, height: 90 }, { id: 'b', x: 390, y: 200, width: 196, height: 90 }], { width: 630, height: 600 }, 160, reserved);
    expect(labels).toHaveLength(2);
    for (const label of labels) for (const building of reserved) expect(Math.abs(label.x - building.x) >= (label.width + building.width) / 2 + 8
      || Math.abs(label.y - building.y) >= (label.height + building.height) / 2 + 8).toBe(true);
  });
  it.each([{ width: 375, height: 470 }, { width: 630, height: 350 }, { width: 320, height: 340 }])('fits five whole model rectangles in $width × $height with top room and stable anchors', size => {
    const input = Array.from({ length: 5 }, (_, index) => ({ id: `hospital-${index}`, x: 50, y: 90 }));
    const footprint = { minX: -2.15, maxX: 2.18, minY: -2.2, maxY: 1.25 };
    const layout = fitRegionalBuildingSymbols(input, size, footprint, 46);
    expect(layout.pixelsPerUnit).toBeGreaterThan(15); expect(layout.pixelsPerUnit).toBeLessThanOrEqual(46);
    expect(layout.placements).toEqual(fitRegionalBuildingSymbols([...input].reverse(), size, footprint, 46).placements);
    expect(layout.placements.every(layout.fits)).toBe(true); expect(layout.separated(layout.placements)).toBe(true);
    for (const marker of layout.placements) expect(marker.anchor).toEqual({ x: 50, y: 90 });
    expect(input.every(marker => marker.x === 50 && marker.y === 90)).toBe(true);
    // A geography-edge fallback must not compress footprints back into overlapping symbols.
    const compressed = layout.placements.map(marker => ({ ...marker, x: marker.x * .5, y: marker.y * .5 }));
    expect(layout.separated(compressed)).toBe(false);
  });
  it('retains preferred scale for two large-screen symbols and never pulls an offscreen group back', () => {
    const footprint = { minX: -2.15, maxX: 2.18, minY: -2.2, maxY: 1.25 };
    const input = [{ id: 'a', x: 310, y: 320 }, { id: 'b', x: 310, y: 320 }];
    const visible = fitRegionalBuildingSymbols(input, { width: 900, height: 600 }, footprint, 46);
    expect(visible.pixelsPerUnit).toBe(46); expect(visible.placements.every(visible.fits)).toBe(true);
    expect(visible.placements[0].y).toBe(visible.placements[1].y);
    expect(visible.placements[0].x).toBeLessThan(visible.placements[1].x);
    const away = fitRegionalBuildingSymbols(input.map(marker => ({ ...marker, x: -1000 })), { width: 375, height: 470 }, footprint, 38);
    expect(away.placements.every(marker => marker.x < 0)).toBe(true);
  });
});
