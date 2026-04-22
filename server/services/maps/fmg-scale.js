/**
 * FMG scale helpers. FMG's canonical pair is `settings.distanceScale` +
 * `settings.distanceUnit` (both visible in its .json export). `distanceScale`
 * is units-per-pixel at zoom 1, where the unit is whatever `distanceUnit` says.
 *
 * Everything in questables that cares about world scale should derive
 * `meters_per_pixel` from this pair and store only that on `maps_world`.
 * `pixels_per_mile` is redundant (= 1609.344 / meters_per_pixel) and has
 * been removed.
 */

export const METERS_PER_MILE = 1609.344;

/**
 * FMG's 7 distance units in `settings.distanceUnit`. Values are the number of
 * meters per unit. `custom_name` is user-defined; we treat it as unknown and
 * let the caller decide what to do (usually: warn and fall back).
 */
const UNIT_METERS = Object.freeze({
  mi: 1609.344,          // statute mile
  km: 1000,
  lg: 4828.032,          // league = 3 statute miles
  vr: 1066.8,            // verst = 500 sazhen ≈ 1066.8 m
  nmi: 1852,             // nautical mile
  nlg: 5556,             // nautical league = 3 nmi
});

/**
 * Meters per one FMG distance unit. Returns null for `custom_name` or unknown
 * units — caller should warn and pick a fallback rather than guess.
 */
export function unitToMeters(distanceUnit) {
  if (!distanceUnit) return null;
  return UNIT_METERS[distanceUnit] ?? null;
}

/**
 * Compute world meters_per_pixel from FMG's settings pair. Returns null if
 * `distanceScale` is non-positive or `distanceUnit` isn't recognised.
 */
export function metersPerPixelFromFmg({ distanceScale, distanceUnit }) {
  const scale = Number(distanceScale);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const metersPerUnit = unitToMeters(distanceUnit);
  if (metersPerUnit == null) return null;
  return scale * metersPerUnit;
}

/**
 * Derive the world's meters_per_pixel from a parsed FMG/settlemaker JSON
 * blob. Preference order:
 *   1. FMG canonical pair `settings.distanceScale` + `settings.distanceUnit`.
 *   2. Legacy `metadata.scale.meters_per_pixel` (or camelCase variant) used by
 *      settlemaker-enriched exports and older ingest paths.
 * Returns null when neither source yields a positive number.
 */
export function extractMetersPerPixel(geojsonObj) {
  const settings = geojsonObj?.settings;
  if (settings && typeof settings === 'object') {
    const mpp = metersPerPixelFromFmg({
      distanceScale: settings.distanceScale,
      distanceUnit: settings.distanceUnit,
    });
    if (mpp != null && mpp > 0) return mpp;
  }

  const metadata = geojsonObj?.metadata;
  const scale = metadata && typeof metadata === 'object' ? metadata.scale : null;
  const mpp = scale && typeof scale === 'object'
    ? scale.meters_per_pixel ?? scale.metersPerPixel
    : null;

  if (mpp === undefined || mpp === null) return null;
  const numeric = Number.parseFloat(mpp);
  return Number.isNaN(numeric) ? null : numeric;
}
