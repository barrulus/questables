import { jest } from '@jest/globals';
import {
  computeLocalToWorldScale,
  translateLocalToWorldPx,
  maxRadiusFromOrigin,
  translateWorldPixelToSettlementLocal,
} from '../../server/services/settlemaker/coordinate-translator.js';

describe('maxRadiusFromOrigin', () => {
  test('returns largest Euclidean distance from origin over polygon vertices', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[[10, 0], [0, 20], [-30, 0], [0, -10], [10, 0]]],
    };
    expect(maxRadiusFromOrigin(polygon)).toBe(30);
  });

  test('returns 0 when polygon has no rings', () => {
    expect(maxRadiusFromOrigin({ type: 'Polygon', coordinates: [] })).toBe(0);
  });
});

describe('computeLocalToWorldScale', () => {
  test('uses meters_per_pixel when world is calibrated', () => {
    // metersPerPixel = 32.18688 corresponds to pixels_per_mile = 50
    const scale = computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 200,
      metersPerPixel: 1609.344 / 50,
    });
    const diameterMeters = 200 * Math.pow(10000 / 100, 0.4);
    const expected = (diameterMeters / 2 / (1609.344 / 50)) / 200;
    expect(scale).toBeCloseTo(expected, 6);
  });

  test('falls back to FALLBACK when meters_per_pixel is null', () => {
    const scale = computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 200,
      metersPerPixel: null,
    });
    expect(scale).toBeGreaterThan(0);
    expect(Number.isFinite(scale)).toBe(true);
  });

  test('returns 0 when wallRadiusLocal is 0 (degenerate)', () => {
    expect(computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 0,
      metersPerPixel: 1609.344 / 50,
    })).toBe(0);
  });
});

describe('translateLocalToWorldPx', () => {
  test('scales and translates relative to the burg centroid', () => {
    const world = translateLocalToWorldPx({
      localPoint: { x: 50, y: -30 },
      burgCentroidPx: { x: 1000, y: 2000 },
      scale: 0.1,
    });
    expect(world.x).toBeCloseTo(1005, 6);
    expect(world.y).toBeCloseTo(1997, 6);
  });
});

describe('translateWorldPixelToSettlementLocal', () => {
  const BASE = {
    burgWorldCenterPx: { x: 1000, y: 2000 },
    worldMetersPerPixel: 1609.344 / 50, // pixels_per_mile = 50
    sidecar: {
      metersPerUnit: 8,
      localBounds: { min_x: -250, min_y: -250, max_x: 250, max_y: 250 },
    },
  };

  test('at burg center returns origin', () => {
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      playerWorldPx: { x: 1000, y: 2000 },
    });
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.y).toBeCloseTo(0, 6);
  });

  test('translates a small offset in proportion to pixels_per_settlement_unit', () => {
    const pixelsPerUnit = BASE.sidecar.metersPerUnit / BASE.worldMetersPerPixel;
    // move 50 pixels east of center → 50 / pixelsPerUnit units
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      playerWorldPx: { x: 1050, y: 2000 },
    });
    expect(local.x).toBeCloseTo(50 / pixelsPerUnit, 6);
    expect(local.y).toBeCloseTo(0, 6);
  });

  test('returns origin and warns when metersPerUnit is zero', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      sidecar: { metersPerUnit: 0, localBounds: BASE.sidecar.localBounds },
      playerWorldPx: { x: 1050, y: 2000 },
      burgId: 'bad-burg',
    });
    expect(local).toEqual({ x: 0, y: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('out-of-bounds logs a warn but still returns coords', () => {
    // logWarn (house-style logger) delegates to console.warn; spy at that layer
    // since native ESM live bindings prevent jest.spyOn on the named export directly.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      playerWorldPx: { x: 1000000, y: 2000000 },
      burgId: 'test-burg',
    });
    expect(Number.isFinite(local.x)).toBe(true);
    expect(Number.isFinite(local.y)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
