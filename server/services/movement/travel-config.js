/**
 * Travel configuration constants and env-var overrides.
 *
 * DAILY_MILES_PER_MODE — D&D-realistic miles per day per mode. Used when the
 * world has a pixels_per_mile calibration. `teleport` is Infinity (never a limit).
 *
 * FALLBACK_PIXELS_PER_DAY — used when the world has no pixels_per_mile set.
 * Pick values that make a typical cross-map journey feel about right for the
 * pixel-native map scale.
 */

function envNum(key, def) {
  const raw = process.env[key];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export const DAILY_MILES_PER_MODE = {
  walk:     envNum('QUESTABLES_DAILY_MILES_WALK',     24),
  ride:     envNum('QUESTABLES_DAILY_MILES_RIDE',     40),
  boat:     envNum('QUESTABLES_DAILY_MILES_BOAT',     48),
  fly:      envNum('QUESTABLES_DAILY_MILES_FLY',      80),
  teleport: Number.POSITIVE_INFINITY,
};

export const FALLBACK_PIXELS_PER_DAY = {
  walk:     envNum('QUESTABLES_FALLBACK_PX_DAY_WALK',     500),
  ride:     envNum('QUESTABLES_FALLBACK_PX_DAY_RIDE',     833),
  boat:     envNum('QUESTABLES_FALLBACK_PX_DAY_BOAT',    1000),
  fly:      envNum('QUESTABLES_FALLBACK_PX_DAY_FLY',     1667),
  teleport: Number.POSITIVE_INFINITY,
};

export const ROUTE_SNAP_THRESHOLD_PIXELS = envNum('QUESTABLES_ROUTE_SNAP_THRESHOLD_PIXELS', 40);

export const ANIMATION_DURATION_MS = envNum('QUESTABLES_ANIMATION_DURATION_MS', 2500);

export const SUPPORTED_MODES = Object.freeze(['walk', 'ride', 'boat', 'fly', 'teleport']);
export const SUPPORTED_VIA = Object.freeze(['roads', 'direct']);
