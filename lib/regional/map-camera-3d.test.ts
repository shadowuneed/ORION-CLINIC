import { describe, expect, it } from 'vitest';
import { fitRegionalPose, focusRegionalFacility, interpolateRegionalPose, regionalDistrictArrivalBounds, RegionalCameraHistory, resizeRegionalPose, safeRegionalPose, REGIONAL_DEFAULT_YAW } from './map-camera-3d';

describe('regional 3D camera transitions', () => {
  const overview = { x: 0, z: 0, span: 800, yaw: 0, tilt: .4 };
  const district = { x: 123, z: 75, span: 30, yaw: -.2, tilt: .5 };
  const facility = { x: 124, z: 72, span: 1, yaw: -.3, tilt: .8 };
  it('restores the actual panned/orbited district camera and overview after returning from an institution', () => {
    const history = new RegionalCameraHistory();
    const pannedOverview = { ...overview, x: 55, yaw: .4 };
    expect(history.transition('district:turkestan', pannedOverview, district)).toEqual(district);
    const pannedDistrict = { ...district, x: 125, span: 21, yaw: .1 };
    expect(history.transition('facility:hospital', pannedDistrict, facility)).toEqual(facility);
    expect(history.transition('district:turkestan', facility, district)).toEqual(pannedDistrict);
    expect(history.transition('overview', pannedDistrict, overview)).toEqual(pannedOverview);
    expect(history.transition('district:turkestan', pannedOverview, district)).toEqual(pannedDistrict);
  });
  it('keeps bookmarks independent between districts and does not mutate caller camera objects', () => {
    const history = new RegionalCameraHistory();
    history.transition('district:a', overview, district);
    history.transition('district:b', district, facility);
    const returned = history.transition('district:a', facility, overview);
    returned.x = 999;
    expect(district.x).toBe(123);
    expect(history.transition('district:a', returned, overview).x).toBe(123);
  });
  it('interpolates progressively rather than remounting or instantly jumping to the new scope', () => {
    const start = interpolateRegionalPose(overview, facility, 0), middle = interpolateRegionalPose(overview, facility, .5), end = interpolateRegionalPose(overview, facility, 1);
    expect(start.x).toBe(overview.x); expect(start.span).toBeCloseTo(overview.span);
    expect(end.x).toBe(facility.x); expect(end.span).toBeCloseTo(facility.span);
    expect(middle.x).toBeGreaterThan(start.x); expect(middle.x).toBeLessThan(end.x);
    expect(middle.span).toBeCloseTo(Math.sqrt(overview.span * facility.span));
    expect(interpolateRegionalPose(overview, facility, 1).span).toBe(facility.span);
  });
  it('takes the short path when the camera orbit crosses north', () => {
    const start = { ...overview, yaw: Math.PI - .1 }, end = { ...overview, yaw: -Math.PI + .1 };
    const middle = interpolateRegionalPose(start, end, .5);
    expect(Math.abs(middle.yaw)).toBeCloseTo(Math.PI);
    expect(Math.abs(middle.yaw)).toBeGreaterThan(3);
  });
  it('enters an institution with a small bounded pan/zoom, never a dive or unexpected orbit', () => {
    for (const point of [{ x: 124, y: 72 }, { x: 10000, y: -20000 }]) {
      const focused = focusRegionalFacility(district, point);
      expect(focused.span).toBeCloseTo(district.span / 1.12);
      expect(Math.abs(focused.x - district.x)).toBeLessThanOrEqual(district.span * .14 + .000001);
      expect(Math.abs(focused.z - district.z)).toBeLessThanOrEqual(district.span * .14 + .000001);
      expect(focused.yaw).toBeCloseTo(district.yaw); expect(focused.tilt).toBeCloseTo(district.tilt);
    }
  });
  it('fits geographic extent at mobile/desktop aspect ratios without changing geography', () => {
    const bounds = { minX: 6700, minY: -5800, maxX: 7200, maxY: -4800 }, origin = { x: 6950, y: -5300 };
    for (const size of [{ width: 1200, height: 650 }, { width: 360, height: 470 }]) {
      const pose = fitRegionalPose(bounds, origin, size);
      expect(pose.x).toBe(0); expect(pose.z).toBe(0); expect(pose.yaw).toBeCloseTo(REGIONAL_DEFAULT_YAW);
      expect(pose.span * size.width / size.height).toBeGreaterThan(bounds.maxX - bounds.minX);
      expect(pose.span).toBeGreaterThan((bounds.maxY - bounds.minY) * Math.cos(pose.tilt));
    }
  });
  it('bounds camera inputs and the orbit above the surface, including degenerate tiny cities', () => {
    const pose = safeRegionalPose({ x: NaN, z: Infinity, span: -10, yaw: 80 * Math.PI, tilt: 5 });
    expect(Object.values(pose).every(Number.isFinite)).toBe(true);
    expect(pose.span).toBeGreaterThan(0); expect(pose.tilt).toBeLessThan(Math.PI / 2);
    const small = fitRegionalPose({ minX: 1, maxX: 1, minY: 2, maxY: 2 }, { x: 1, y: 2 }, { width: 1, height: 0 });
    expect(small.span).toBeGreaterThan(0);
  });
  it('preserves manual pan/orbit and relative zoom when changing viewport aspect in either direction', () => {
    const bounds = { minX: 5, maxX: 200, minY: 8, maxY: 85 }, origin = { x: 100, y: 40 };
    const phone = { width: 375, height: 470 }, desktop = { width: 1440, height: 1000 };
    const fitted = fitRegionalPose(bounds, origin, phone, .6, -.4);
    const panned = { ...fitted, x: 26, z: -10, span: fitted.span / 1.7 };
    const resized = resizeRegionalPose(panned, bounds, origin, phone, desktop);
    expect(resized.x).toBe(26); expect(resized.z).toBe(-10); expect(resized.yaw).toBeCloseTo(-.4); expect(resized.tilt).toBe(.6);
    expect(fitRegionalPose(bounds, origin, desktop, .6, -.4).span / resized.span).toBeCloseTo(1.7);
    expect(resizeRegionalPose(resized, bounds, origin, desktop, phone).span).toBeCloseTo(panned.span);
  });
  it('frames all five real institution anchors with nearby ground and leaves the complete geographic bounds unchanged', () => {
    const bounds = { minX: 0, maxX: 600, minY: 0, maxY: 250 };
    const points = Array.from({ length: 5 }, (_, index) => ({ x: 480 + index, y: 110 + index }));
    const arrival = regionalDistrictArrivalBounds(bounds, points);
    expect(arrival.maxX - arrival.minX).toBeLessThan((bounds.maxX - bounds.minX) / 3);
    for (const point of points) {
      expect(point.x).toBeGreaterThan(arrival.minX); expect(point.x).toBeLessThan(arrival.maxX);
      expect(point.y).toBeGreaterThan(arrival.minY); expect(point.y).toBeLessThan(arrival.maxY);
    }
    expect(arrival.minX).toBeGreaterThanOrEqual(bounds.minX); expect(arrival.maxX).toBeLessThanOrEqual(bounds.maxX);
    expect(arrival.minY).toBeGreaterThanOrEqual(bounds.minY); expect(arrival.maxY).toBeLessThanOrEqual(bounds.maxY);
    expect(bounds).toEqual({ minX: 0, maxX: 600, minY: 0, maxY: 250 });
    expect(regionalDistrictArrivalBounds(bounds, [])).toEqual(bounds);
  });
});
