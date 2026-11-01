/** Geographic reference data is separate from patient/KPI records in PostgreSQL. */
export const REGIONAL_UNIT_IDS = [
  'sozak', 'sauran', 'otyrar', 'maktaaral', 'shardara', 'arys',
  'baydibek', 'ordabasy', 'kazygurt', 'turkestan', 'sayram', 'saryagash',
  'tulkibas', 'tolebi', 'zhetisay', 'kentau', 'keles', 'shymkent',
] as const;

export type RegionalUnitId = typeof REGIONAL_UNIT_IDS[number];
export type RegionalCoordinate = readonly [longitude: number, latitude: number];
export type RegionalRing = readonly RegionalCoordinate[];
export type RegionalPolygon = readonly RegionalRing[];
export type RegionalGeometry =
  | { type: 'Polygon'; coordinates: RegionalPolygon }
  | { type: 'MultiPolygon'; coordinates: readonly RegionalPolygon[] };

export interface RegionalFeature {
  type: 'Feature';
  id: RegionalUnitId | 'turkestan-region';
  bbox: readonly [west: number, south: number, east: number, north: number];
  properties: {
    id: RegionalUnitId | 'turkestan-region';
    name: string;
    nameKk: string;
    kind: 'district' | 'city' | 'republican_city' | 'region';
    /** Shymkent is a separate first-level administrative unit. */
    parentId: 'turkestan-region' | null;
    labelPoint: RegionalCoordinate;
    administrativeCentre: RegionalCoordinate | null;
    administrativeCentreName: string | null;
    source: string;
    osmRelationId: number;
    osmVersion: number;
    derivedTopologyCorrection?: boolean;
    topologyCorrection?: string;
  };
  geometry: RegionalGeometry;
}

export interface RegionalFeatureCollection {
  type: 'FeatureCollection';
  source: string;
  attribution: string;
  attributionUrl: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string;
  generalization: string;
  features: RegionalFeature[];
}

export const REGIONAL_GEOJSON_URL = '/maps/turkestan-districts.geojson';
export const REGIONAL_BOUNDARY_URL = '/maps/turkestan-region.geojson';
export const REGIONAL_ATTRIBUTION = '© OpenStreetMap contributors';
export const REGIONAL_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';

export function regionalPolygons(geometry: RegionalGeometry): readonly RegionalPolygon[] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function pointInsideRing(point: RegionalCoordinate, ring: RegionalRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/** Display containment, including enclave holes; never an access-control decision. */
export function pointInsideRegionalGeometry(point: RegionalCoordinate, geometry: RegionalGeometry): boolean {
  return regionalPolygons(geometry).some((polygon) => pointInsideRing(point, polygon[0])
    && !polygon.slice(1).some((hole) => pointInsideRing(point, hole)));
}
