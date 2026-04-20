const COMPASS = [
  'North', 'Northeast', 'East', 'Southeast',
  'South', 'Southwest', 'West', 'Northwest',
];

/**
 * Map a compass bearing (0..360, 0=N, clockwise) to an 8-point cardinal
 * suffix. Used when settlemaker doesn't emit a gate name.
 *
 * Bearings outside [0,360) are normalised. The 45° sectors are centred on
 * the cardinal so `bearing=22.4` is "North" and `bearing=22.5` flips to
 * "Northeast".
 */
export function cardinalGateName(bearingDeg) {
  const b = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.floor(((b + 22.5) % 360) / 45);
  return `${COMPASS[idx]} Gate`;
}
