import { logWarn } from '../../utils/logger.js';

/**
 * Fallback scale factor (world-pixels per settlement-unit) for worlds that
 * have no `meters_per_pixel` calibration. Chosen so a ~300-unit wall radius
 * for a pop-5000 town maps to ~30 pixels — roughly the size of a burg icon
 * on the world map at default zoom. Tuned by inspection.
 */
const FALLBACK_PIXELS_PER_SETTLEMENT_UNIT = 0.1;

/**
 * Settlemaker's population → diameter heuristic. Mirrors
 * `computeSettlementScale` from settlemaker/src/output/settlement-tiler.ts so
 * questables can derive the same diameterMeters without needing the function
 * exported.
 */
function diameterMetersForPopulation(population) {
  return 200 * Math.pow(Math.max(population, 1) / 100, 0.4);
}

/**
 * Return the largest Euclidean distance from the origin over all vertices of
 * a GeoJSON Polygon. Used to measure the wall's local-coord radius so we can
 * set up a scale factor from local to world pixels.
 */
export function maxRadiusFromOrigin(polygon) {
  if (!polygon || !Array.isArray(polygon.coordinates)) return 0;
  let max = 0;
  for (const ring of polygon.coordinates) {
    for (const [x, y] of ring) {
      const r = Math.hypot(x, y);
      if (r > max) max = r;
    }
  }
  return max;
}

/**
 * Pixels-per-settlement-unit scale factor.
 *
 * Derivation: diameterMeters from population → radius in world pixels via
 * metersPerPixel. Divide by the wall polygon's local-coord radius to get
 * pixels-per-unit.
 *
 * When metersPerPixel is null/zero, falls back to a deterministic constant
 * so uncalibrated worlds still produce plausible gate placements.
 */
export function computeLocalToWorldScale({ population, wallRadiusLocal, metersPerPixel }) {
  if (!(wallRadiusLocal > 0)) return 0;
  if (metersPerPixel == null || !(metersPerPixel > 0)) {
    return FALLBACK_PIXELS_PER_SETTLEMENT_UNIT;
  }
  const diameterMeters = diameterMetersForPopulation(population);
  const radiusPixels = (diameterMeters / 2) / metersPerPixel;
  return radiusPixels / wallRadiusLocal;
}

/**
 * Translate a settlement-local point (origin near centroid, Y-down) to
 * world-pixel coordinates. Both coordinate systems are Y-down so no flip.
 */
export function translateLocalToWorldPx({ localPoint, burgCentroidPx, scale }) {
  return {
    x: burgCentroidPx.x + localPoint.x * scale,
    y: burgCentroidPx.y + localPoint.y * scale,
  };
}

/**
 * Reverse of translateLocalToWorldPx: convert a world-pixel point to
 * settlement-local coordinates. Both spaces are Y-down so no flip.
 *
 * `worldMetersPerPixel` comes straight from `maps_world.meters_per_pixel`.
 * `burgWorldCenterPx` comes from `maps_burgs`, and the sidecar row supplies
 * `metersPerUnit` and `localBounds`.
 *
 * If the translated point falls outside `localBounds`, a warning is logged
 * once via logWarn. The coordinates are returned unconditionally —
 * out-of-bounds is a data-drift signal, not an error this function should
 * paper over.
 */
export function translateWorldPixelToSettlementLocal({
  playerWorldPx,
  burgWorldCenterPx,
  worldMetersPerPixel,
  sidecar,
  burgId,
}) {
  const pixelsPerSettlementUnit = sidecar.metersPerUnit / worldMetersPerPixel;
  if (!Number.isFinite(pixelsPerSettlementUnit) || pixelsPerSettlementUnit <= 0) {
    logWarn('non-positive pixels_per_settlement_unit; returning origin', {
      burgId: burgId ?? null,
      metersPerUnit: sidecar.metersPerUnit,
      worldMetersPerPixel,
    });
    return { x: 0, y: 0 };
  }
  const x = (playerWorldPx.x - burgWorldCenterPx.x) / pixelsPerSettlementUnit;
  const y = (playerWorldPx.y - burgWorldCenterPx.y) / pixelsPerSettlementUnit;

  const b = sidecar.localBounds;
  if (x < b.min_x || x > b.max_x || y < b.min_y || y > b.max_y) {
    logWarn('out-of-bounds settlement-local translation', {
      burgId: burgId ?? null,
      x,
      y,
      bounds: b,
    });
  }
  return { x, y };
}
