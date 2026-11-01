import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { regionalPolygons, type RegionalFeatureCollection } from './geography';
import { clampRegionalZoom, fitRegionalCamera, panRegionalCamera, placeRegionalLabels, projectRegionalPosition,
  regionalBounds, regionalScreenPoint, zoomRegionalCameraAt } from './map-camera';

describe('regional geographic camera', () => {
  it('keeps geographic north up and east right instead of rotating the oblast into an isometric floor', () => {
    const centre = projectRegionalPosition(68, 43);
    expect(projectRegionalPosition(68, 44).x).toBe(centre.x);
    expect(projectRegionalPosition(68, 44).y).toBeLessThan(centre.y);
    expect(projectRegionalPosition(69, 43).x).toBeGreaterThan(centre.x);
    expect(projectRegionalPosition(69, 43).y).toBe(centre.y);
  });
  it('fits the full actual geographic extent in wide and narrow viewports', () => {
    const bounds = regionalBounds([projectRegionalPosition(67, 40), projectRegionalPosition(71, 46)]);
    for (const size of [{ width: 1000, height: 650 }, { width: 360, height: 470 }]) {
      const camera = fitRegionalCamera(bounds, size, 60);
      const min = regionalScreenPoint(camera, { x: bounds.minX, y: bounds.minY });
      const max = regionalScreenPoint(camera, { x: bounds.maxX, y: bounds.maxY });
      expect(min.x).toBeGreaterThanOrEqual(59.99);
      expect(min.y).toBeGreaterThanOrEqual(59.99);
      expect(max.x).toBeLessThanOrEqual(size.width - 59.99);
      expect(max.y).toBeLessThanOrEqual(size.height - 59.99);
    }
  });
  it('keeps the same geographic point under the pointer during zoom', () => {
    const camera = { x: -3300, y: 2600, zoom: .6 }, anchor = { x: 315, y: 256 };
    for (const zoom of [.2, 3, 40]) {
      const next = zoomRegionalCameraAt(camera, zoom, anchor);
      expect((anchor.x - next.x) / next.zoom).toBeCloseTo((anchor.x - camera.x) / camera.zoom, 8);
      expect((anchor.y - next.y) / next.zoom).toBeCloseTo((anchor.y - camera.y) / camera.zoom, 8);
    }
    expect(camera).toEqual({ x: -3300, y: 2600, zoom: .6 });
  });
  it('bounds invalid camera input and retains a reversible pan', () => {
    const camera = { x: 45, y: 35, zoom: 1 };
    expect(clampRegionalZoom(NaN)).toBe(1);
    expect(clampRegionalZoom(Infinity)).toBe(1);
    expect(clampRegionalZoom(1e10)).toBe(45);
    expect(panRegionalCamera(camera, { x: 40, y: -20 })).toEqual({ x: 85, y: 15, zoom: 1 });
    expect(panRegionalCamera(camera, { x: NaN, y: Infinity })).toEqual(camera);
    expect(regionalBounds([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });
  it('separates nearby persisted facility callouts without moving their source coordinates', () => {
    const anchors = [{ id: 'hospital', x: 400, y: 300, width: 236, height: 104 },
      { id: 'polyclinic', x: 402, y: 301, width: 236, height: 104 }];
    const labels = placeRegionalLabels(anchors, { width: 1000, height: 650 }, 150);
    expect(labels).toHaveLength(2);
    expect(Math.abs(labels[0].x - labels[1].x) >= 244 || Math.abs(labels[0].y - labels[1].y) >= 112).toBe(true);
    expect(anchors[1]).toEqual({ id: 'polyclinic', x: 402, y: 301, width: 236, height: 104 });
  });
  it('keeps district labels inside a small viewport and deterministic across metric refreshes', () => {
    const anchors = Array.from({ length: 8 }, (_, index) => ({ id: `district-${index}`, x: 180 + index,
      y: 300, width: 108, height: 37 }));
    const size = { width: 360, height: 470 }, result = placeRegionalLabels(anchors, size);
    expect(result).toEqual(placeRegionalLabels(anchors, size));
    expect(result.length).toBeLessThan(anchors.length);
    expect(result.length).toBeGreaterThan(0);
    for (const label of result) {
      const anchor = anchors.find(value => value.id === label.id)!;
      expect(Math.hypot(label.x - anchor.x, label.y - anchor.y)).toBeLessThanOrEqual(90.000001);
      expect(label.x - label.width / 2).toBeGreaterThanOrEqual(10);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(350);
      expect(label.y - label.height / 2).toBeGreaterThanOrEqual(12);
      expect(label.y + label.height / 2).toBeLessThanOrEqual(458);
    }
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      expect(Math.abs(result[i].x - result[j].x) >= 116 || Math.abs(result[i].y - result[j].y) >= 45).toBe(true);
    }
  });
  it('never moves actual district/city names to distant geography just to show all 18 labels', () => {
    const geography = JSON.parse(readFileSync('public/maps/turkestan-districts.geojson', 'utf8')) as RegionalFeatureCollection;
    const bounds = regionalBounds(geography.features.flatMap(feature => regionalPolygons(feature.geometry).flat()
      .flatMap(ring => ring.map(point => projectRegionalPosition(...point)))));
    for (const size of [{ width: 1000, height: 650 }, { width: 630, height: 600 }, { width: 360, height: 470 }]) {
      const camera = fitRegionalCamera(bounds, size, 68);
      const anchors = geography.features.map(feature => ({ id: feature.id,
        ...regionalScreenPoint(camera, projectRegionalPosition(...feature.properties.labelPoint)),
        width: size.width < 550 ? 108 : 124, height: 37 }));
      const labels = placeRegionalLabels(anchors, size);
      expect(labels.length).toBeGreaterThan(0); expect(labels.length).toBeLessThanOrEqual(18);
      for (const label of labels) {
        const anchor = anchors.find(value => value.id === label.id)!;
        expect(Math.hypot(label.x - anchor.x, label.y - anchor.y), `${size.width}px: ${label.id} displacement`).toBeLessThanOrEqual(90.000001);
      }
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        expect(Math.abs(labels[i].x - labels[j].x) >= labels[i].width + 8 || Math.abs(labels[i].y - labels[j].y) >= 45,
          `${size.width}px: ${labels[i].id} / ${labels[j].id}`).toBe(true);
      }
    }
  });
  it('reveals previously colliding labels when zoom separates their geographic anchors', () => {
    const nearby = [{ id: 'north', x: 400, y: 300, width: 124, height: 37 },
      { id: 'middle', x: 400, y: 310, width: 124, height: 37 }, { id: 'south', x: 400, y: 320, width: 124, height: 37 }];
    const size = { width: 1000, height: 650 };
    expect(placeRegionalLabels(nearby, size, 0)).toHaveLength(1);
    expect(placeRegionalLabels(nearby.map(label => ({ ...label, y: 100 + (label.y - 300) * 10 })), size, 0)).toHaveLength(3);
    expect(placeRegionalLabels([{ ...nearby[0], x: -400 }], size)).toEqual([]);
  });
});
