import { Path, Shape, Vector2 } from 'three';
import { projectRegionalPosition, type MapPoint } from './map-camera';
import { regionalPolygons, type RegionalGeometry } from './geography';

/** Preserve every source ring, including Shymkent and the Arys enclave holes. */
export function regionalThreeShapes(geometry: RegionalGeometry, origin: MapPoint): Shape[] {
  return regionalPolygons(geometry).map(polygon => {
    const rings = polygon.map(ring => ring.map(([longitude, latitude]) => {
      const point = projectRegionalPosition(longitude, latitude);
      // Rotating XY by -90° around X places geographic north along negative world Z.
      return new Vector2(point.x - origin.x, origin.y - point.y);
    }));
    const shape = new Shape(rings[0]);
    shape.holes = rings.slice(1).map(ring => new Path(ring));
    return shape;
  });
}
