import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExtrudeGeometry, ShapeUtils, Vector2 } from 'three';
import { regionalPolygons, type RegionalFeatureCollection } from './geography';
import { projectRegionalPosition } from './map-camera';
import { regionalThreeShapes } from './map-geometry-3d';

const source = JSON.parse(readFileSync('public/maps/turkestan-districts.geojson', 'utf8')) as RegionalFeatureCollection;
const boundary = JSON.parse(readFileSync('public/maps/turkestan-region.geojson', 'utf8')) as RegionalFeatureCollection;
const origin = { x: 6900, y: -5300 };

describe('actual geographic 3D extrusion', () => {
  it('retains every Polygon/MultiPolygon and every hole from the persisted GeoJSON', () => {
    for (const feature of [...source.features, ...boundary.features]) {
      const polygons = regionalPolygons(feature.geometry), shapes = regionalThreeShapes(feature.geometry, origin);
      expect(shapes).toHaveLength(polygons.length);
      shapes.forEach((shape, index) => {
        expect(shape.holes).toHaveLength(polygons[index].length - 1);
        const points = shape.getPoints(1), first = projectRegionalPosition(...polygons[index][0][0]);
        expect(points[0].x).toBeCloseTo(first.x - origin.x, 9);
        expect(points[0].y).toBeCloseTo(origin.y - first.y, 9);
      });
    }
  });
  it('does not fill Shymkent or the Arys enclave when triangulating the actual oblast surface', () => {
    for (const feature of [...boundary.features, source.features.find(item => item.id === 'baydibek')!]) {
      const shapes = regionalThreeShapes(feature.geometry, origin);
      expect(shapes.reduce((count, shape) => count + shape.holes.length, 0)).toBeGreaterThan(0);
      const geometry = new ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
      const vertices = geometry.getAttribute('position');
      let actual = 0;
      for (let index = 0; index < vertices.count; index += 3) {
        if ([index, index + 1, index + 2].every(vertex => vertices.getZ(vertex) === 1)) {
          const points = [index, index + 1, index + 2].map(vertex => new Vector2(vertices.getX(vertex), vertices.getY(vertex)));
          actual += Math.abs(ShapeUtils.area(points));
        }
      }
      const expected = shapes.reduce((area, shape) => area + Math.abs(ShapeUtils.area(shape.getPoints(1)))
        - shape.holes.reduce((holes, hole) => holes + Math.abs(ShapeUtils.area(hole.getPoints(1))), 0), 0);
      expect(Math.abs(actual - expected) / expected).toBeLessThan(.00001);
      geometry.dispose();
    }
  });
  it('places north and east correctly in the real 3D X/Z ground plane', () => {
    const shapes = regionalThreeShapes({ type: 'Polygon', coordinates: [[[68, 43], [69, 43], [69, 44], [68, 44], [68, 43]]] }, origin);
    const geometry = new ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2); geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 5);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1, 5);
    const southwest = projectRegionalPosition(68, 43), northeast = projectRegionalPosition(69, 44);
    expect(geometry.boundingBox!.min.x).toBeCloseTo(southwest.x - origin.x, 4);
    expect(geometry.boundingBox!.min.z).toBeCloseTo(northeast.y - origin.y, 4);
    geometry.dispose();
  });
});
