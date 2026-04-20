import {
  computeLocalToWorldScale,
  translateLocalToWorldPx,
  maxRadiusFromOrigin,
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
  const METERS_PER_MILE = 1609.344;

  test('uses pixels_per_mile when world is calibrated', () => {
    const scale = computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 200,
      pixelsPerMile: 50,
    });
    const expected = (200 * Math.pow(10000 / 100, 0.4) / 2 / METERS_PER_MILE) * 50 / 200;
    expect(scale).toBeCloseTo(expected, 6);
  });

  test('falls back to FALLBACK when pixels_per_mile is null', () => {
    const scale = computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 200,
      pixelsPerMile: null,
    });
    expect(scale).toBeGreaterThan(0);
    expect(Number.isFinite(scale)).toBe(true);
  });

  test('returns 0 when wallRadiusLocal is 0 (degenerate)', () => {
    expect(computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 0,
      pixelsPerMile: 50,
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
