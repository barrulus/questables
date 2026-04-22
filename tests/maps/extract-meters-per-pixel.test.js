import { extractMetersPerPixel } from '../../server/services/maps/fmg-scale.js';

describe('extractMetersPerPixel', () => {
  test('prefers settings.distanceScale + distanceUnit (canonical FMG)', () => {
    const mpp = extractMetersPerPixel({
      settings: { distanceScale: 5, distanceUnit: 'mi' },
      metadata: { scale: { meters_per_pixel: 99999 } },
    });
    expect(mpp).toBeCloseTo(5 * 1609.344, 6);
  });

  test('falls back to metadata.scale.meters_per_pixel when settings absent', () => {
    expect(extractMetersPerPixel({
      metadata: { scale: { meters_per_pixel: 12345 } },
    })).toBe(12345);
  });

  test('falls back to metadata.scale.metersPerPixel (camelCase variant)', () => {
    expect(extractMetersPerPixel({
      metadata: { scale: { metersPerPixel: '6789' } },
    })).toBe(6789);
  });

  test('returns null when neither path yields a value', () => {
    expect(extractMetersPerPixel({})).toBeNull();
    expect(extractMetersPerPixel({ settings: {} })).toBeNull();
    expect(extractMetersPerPixel({ metadata: {} })).toBeNull();
  });

  test('skips settings path when distanceUnit is custom_name; falls through to metadata', () => {
    const mpp = extractMetersPerPixel({
      settings: { distanceScale: 5, distanceUnit: 'custom_name' },
      metadata: { scale: { meters_per_pixel: 8000 } },
    });
    expect(mpp).toBe(8000);
  });
});
