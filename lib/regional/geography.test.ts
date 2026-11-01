import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REGIONAL_UNIT_IDS,
  pointInsideRegionalGeometry,
  regionalPolygons,
  type RegionalCoordinate,
  type RegionalFeature,
  type RegionalFeatureCollection,
} from './geography';

function load(name: string): RegionalFeatureCollection {
  return JSON.parse(readFileSync(new URL(`../../public/maps/${name}`, import.meta.url), 'utf8'));
}
const districts = load('turkestan-districts.geojson');
const original = load('turkestan-districts-source.geojson');
const region = load('turkestan-region.geojson').features[0];
const units = districts.features.filter((feature) => feature.properties.parentId === 'turkestan-region');
const get = (id: string) => districts.features.find((feature) => feature.id === id)!;

function signedEdges(features: readonly RegionalFeature[]): Map<string, number> {
  const edges = new Map<string, number>();
  for (const feature of features) {
    for (const polygon of regionalPolygons(feature.geometry)) {
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1].join(',');
          const b = ring[i].join(',');
          const key = [a, b].sort().join('|');
          edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1));
        }
      }
    }
  }
  return new Map([...edges].filter(([, count]) => count !== 0).sort(([a], [b]) => a.localeCompare(b)));
}

function ringArea(ring: readonly RegionalCoordinate[]): number {
  return ring.reduce((sum, point, index) => index === 0 ? sum
    : sum + ring[index - 1][0] * point[1] - point[0] * ring[index - 1][1], 0) / 2;
}

describe('current Turkestan geographic reference', () => {
  it('contains all 14 districts and 3 regional cities; Shymkent stays separate', () => {
    expect(districts.features.map((feature) => feature.id).sort()).toEqual([...REGIONAL_UNIT_IDS].sort());
    expect(units.filter((feature) => feature.properties.kind === 'district')).toHaveLength(14);
    expect(units.filter((feature) => feature.properties.kind === 'city')).toHaveLength(3);
    expect(get('shymkent').properties).toMatchObject({ kind: 'republican_city', parentId: null });
    expect(get('sauran').properties.osmRelationId).toBe(3407078);
    expect(get('keles').properties.osmRelationId).toBe(9210172);
  });

  it('retains finite closed rings with GeoJSON exterior/hole winding', () => {
    for (const feature of [...districts.features, region]) {
      for (const polygon of regionalPolygons(feature.geometry)) {
        for (const [index, ring] of polygon.entries()) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring.at(-1));
          expect(new Set(ring.map((point) => point.join(','))).size).toBeGreaterThanOrEqual(3);
          expect(Math.sign(ringArea(ring))).toBe(index === 0 ? 1 : -1);
          for (const [longitude, latitude] of ring) {
            expect(Number.isFinite(longitude) && Number.isFinite(latitude)).toBe(true);
            expect(longitude).toBeGreaterThan(65);
            expect(longitude).toBeLessThan(72);
            expect(latitude).toBeGreaterThan(40);
            expect(latitude).toBeLessThan(47);
          }
        }
      }
    }
  });

  it('exactly reconstructs the oblast boundary when shared district edges cancel', () => {
    // This checks every retained shared edge, not just a near-equal total area.
    expect(signedEdges(units)).toEqual(signedEdges([region]));
    const sum = (features: readonly RegionalFeature[]) => features.reduce((total, feature) => total
      + regionalPolygons(feature.geometry).reduce((total, polygon) => total
        + polygon.reduce((total, ring) => total + ringArea(ring), 0), 0), 0);
    expect(sum(units)).toBeCloseTo(sum([region]), 8);
  });

  it('preserves the Shymkent hole and city holes inside Sauran', () => {
    const shymkent = get('shymkent').properties.administrativeCentre!;
    const turkestan = get('turkestan').properties.administrativeCentre!;
    const kentau = get('kentau').properties.administrativeCentre!;
    expect(pointInsideRegionalGeometry(shymkent, region.geometry)).toBe(false);
    expect(pointInsideRegionalGeometry(turkestan, region.geometry)).toBe(true);
    expect(pointInsideRegionalGeometry(turkestan, get('sauran').geometry)).toBe(false);
    expect(pointInsideRegionalGeometry(kentau, get('sauran').geometry)).toBe(false);
  });

  it('places every label and administrative centre inside its own exact area', () => {
    for (const feature of districts.features) {
      expect(pointInsideRegionalGeometry(feature.properties.labelPoint, feature.geometry), feature.id).toBe(true);
      expect(feature.properties.administrativeCentre, feature.id).not.toBeNull();
      expect(pointInsideRegionalGeometry(feature.properties.administrativeCentre!, feature.geometry), feature.id).toBe(true);
    }
  });

  it('documents the single source overlap and uses the unchanged Arys exclave as a Baydibek hole', () => {
    const sourceBaydibek = original.features.find((feature) => feature.id === 'baydibek')!;
    const sourceArys = original.features.find((feature) => feature.id === 'arys')!;
    const arysExclave = regionalPolygons(sourceArys.geometry)[1][0];
    expect(arysExclave).toHaveLength(67);
    for (const point of arysExclave.slice(0, -1)) {
      expect(pointInsideRegionalGeometry(point, sourceBaydibek.geometry)).toBe(true);
    }
    expect(get('arys').geometry).toEqual(sourceArys.geometry);
    expect(get('baydibek').properties.derivedTopologyCorrection).toBe(true);
    expect(regionalPolygons(get('baydibek').geometry)[0]).toEqual([
      ...regionalPolygons(sourceBaydibek.geometry)[0], [...arysExclave].reverse(),
    ]);
    expect(original.features.filter((feature) => feature.id !== 'baydibek'))
      .toEqual(districts.features.filter((feature) => feature.id !== 'baydibek'));
  });

  it('ships attribution and a bounded local payload without external tiles or keys', () => {
    expect(districts.attribution).toBe('© OpenStreetMap contributors');
    expect(districts.license).toBe('ODbL-1.0');
    expect(districts.attributionUrl).toBe('https://www.openstreetmap.org/copyright');
    expect(districts.licenseUrl).toBe('https://opendatacommons.org/licenses/odbl/1-0/');
    expect(Buffer.byteLength(JSON.stringify(districts))).toBeLessThan(220_000);
    expect(districts.features.every((feature) => feature.properties.osmVersion > 0)).toBe(true);
  });
});
