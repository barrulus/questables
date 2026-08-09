import { describe, expect, test } from '@jest/globals';
import { getPolityFeatureKind } from '../../components/maps/feature-tooltip';

/**
 * `getPolityFeatureKind` only ever calls `.get(key)` on the feature it is
 * given, so a plain object with a `get` method is a faithful stand-in for an
 * OpenLayers `Feature` here — no need to pull in `ol` at runtime (the real
 * `Feature`/`FeatureLike` imports in feature-tooltip.ts are type-only and are
 * erased by ts-jest, so this file never touches the `ol` package either).
 */
const fakeFeature = (props: Record<string, unknown>) => ({
  get: (key: string) => props[key],
});

describe('getPolityFeatureKind', () => {
  test('classifies a regiment (which also carries state_id) as regiment', () => {
    const feature = fakeFeature({
      regiment_id: 12,
      state_id: 3,
      name: '3rd Legion',
    });
    expect(getPolityFeatureKind(feature as never)).toBe('regiment');
  });

  test('classifies a province (which also carries state_id) as province, not state', () => {
    const feature = fakeFeature({
      province_id: 7,
      state_id: 3,
      form_name: 'Province',
      full_name: 'Duchy of Something',
    });
    expect(getPolityFeatureKind(feature as never)).toBe('province');
  });

  test('classifies a state as state', () => {
    const feature = fakeFeature({
      state_id: 3,
      full_name: 'Kingdom of Somewhere',
      form: 'Kingdom',
    });
    expect(getPolityFeatureKind(feature as never)).toBe('state');
  });

  test('classifies a culture as culture', () => {
    const feature = fakeFeature({
      culture_id: 9,
      name: 'Highlander',
    });
    expect(getPolityFeatureKind(feature as never)).toBe('culture');
  });

  test('classifies a religion as religion', () => {
    const feature = fakeFeature({
      religion_id: 4,
      name: 'The Old Faith',
      deity: 'The Mother',
    });
    expect(getPolityFeatureKind(feature as never)).toBe('religion');
  });

  test('classifies a zone as zone', () => {
    const feature = fakeFeature({
      zone_id: 1,
      name: 'Whispering Woods',
      type: 'mystical',
    });
    expect(getPolityFeatureKind(feature as never)).toBe('zone');
  });

  test('returns null for a feature with none of the polity id properties', () => {
    const feature = fakeFeature({ name: 'Some other feature' });
    expect(getPolityFeatureKind(feature as never)).toBeNull();
  });

  test('returns null for a null feature', () => {
    expect(getPolityFeatureKind(null)).toBeNull();
  });
});
