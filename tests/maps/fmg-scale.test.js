import { unitToMeters, metersPerPixelFromFmg, METERS_PER_MILE } from '../../server/services/maps/fmg-scale.js';

describe('unitToMeters', () => {
  test('returns canonical meters for each known FMG unit', () => {
    expect(unitToMeters('mi')).toBe(1609.344);
    expect(unitToMeters('km')).toBe(1000);
    expect(unitToMeters('lg')).toBeCloseTo(4828.032, 3);
    expect(unitToMeters('vr')).toBe(1066.8);
    expect(unitToMeters('nmi')).toBe(1852);
    expect(unitToMeters('nlg')).toBe(5556);
  });

  test('returns null for custom_name and unknown units', () => {
    expect(unitToMeters('custom_name')).toBeNull();
    expect(unitToMeters('parsec')).toBeNull();
    expect(unitToMeters('')).toBeNull();
    expect(unitToMeters(undefined)).toBeNull();
  });
});

describe('metersPerPixelFromFmg', () => {
  test('miles: 5 mi/px = 8046.72 m/px', () => {
    expect(metersPerPixelFromFmg({ distanceScale: 5, distanceUnit: 'mi' }))
      .toBeCloseTo(5 * METERS_PER_MILE, 6);
  });

  test('km: 4 km/px = 4000 m/px', () => {
    expect(metersPerPixelFromFmg({ distanceScale: 4, distanceUnit: 'km' })).toBe(4000);
  });

  test('returns null for non-positive distanceScale', () => {
    expect(metersPerPixelFromFmg({ distanceScale: 0, distanceUnit: 'mi' })).toBeNull();
    expect(metersPerPixelFromFmg({ distanceScale: -1, distanceUnit: 'mi' })).toBeNull();
    expect(metersPerPixelFromFmg({ distanceScale: 'abc', distanceUnit: 'mi' })).toBeNull();
  });

  test('returns null for unrecognised unit', () => {
    expect(metersPerPixelFromFmg({ distanceScale: 5, distanceUnit: 'custom_name' })).toBeNull();
    expect(metersPerPixelFromFmg({ distanceScale: 5, distanceUnit: 'parsec' })).toBeNull();
  });

  test('coerces numeric strings (FMG sometimes serialises as string)', () => {
    expect(metersPerPixelFromFmg({ distanceScale: '5', distanceUnit: 'mi' }))
      .toBeCloseTo(5 * METERS_PER_MILE, 6);
  });
});
