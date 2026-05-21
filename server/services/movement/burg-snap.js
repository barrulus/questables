/**
 * Coordinate-to-burg arrival snap.
 *
 * When the LLM emits a move_player outcome with destination.kind === 'coordinate'
 * (rather than 'burg'), the gate-picker bails out and the player lands at the
 * raw coordinates — typically a few kilometres short of any settlement. From
 * the user's perspective the narration says "you approach Balur" but the map
 * never flips to the settlement view because `inside_burg_id` stays NULL.
 *
 * This module patches that failure mode by finding the nearest burg to the
 * target coordinates and promoting the destination to a burg when the target
 * is plausibly "approaching" that burg — defined as within
 * `max(burg.diameter_meters * 10, world.meters_per_pixel)` of the burg
 * centroid. Both numbers are in the world's coord-space units (SRID 0).
 *
 * The radius scales with the burg: a 5km-diameter city snaps from further out
 * than a 200m hamlet. The `meters_per_pixel` floor ensures even tiny burgs on
 * coarse maps still have a sensible catchment.
 */

const APPROACH_DIAMETER_MULTIPLIER = 10;

/**
 * @param {object} client - DB client
 * @param {{ worldId: string|null, x: number, y: number }} args
 * @returns {Promise<{ burgId: string, x: number, y: number, resolvedName: string, distance: number }|null>}
 */
export async function snapCoordToNearbyBurg(client, { worldId, x, y }) {
  if (!worldId || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const { rows } = await client.query(
    `SELECT
       b.id,
       b.name,
       ST_X(b.geom) AS x,
       ST_Y(b.geom) AS y,
       ST_Distance(b.geom, ST_SetSRID(ST_MakePoint($2, $3), 0)) AS distance,
       mbs.diameter_meters,
       w.meters_per_pixel
     FROM public.maps_burgs b
     JOIN public.maps_world w ON w.id = b.world_id
     LEFT JOIN public.maps_burg_settlements mbs ON mbs.burg_id = b.id
     WHERE b.world_id = $1
     ORDER BY b.geom <-> ST_SetSRID(ST_MakePoint($2, $3), 0)
     LIMIT 1`,
    [worldId, x, y],
  );

  const row = rows[0];
  if (!row) return null;

  const diameter = Number(row.diameter_meters);
  const mpp = Number(row.meters_per_pixel);
  const candidates = [];
  if (Number.isFinite(diameter) && diameter > 0) {
    candidates.push(diameter * APPROACH_DIAMETER_MULTIPLIER);
  }
  if (Number.isFinite(mpp) && mpp > 0) {
    candidates.push(mpp);
  }
  const approachRadius = candidates.length > 0 ? Math.max(...candidates) : 0;

  const distance = Number(row.distance);
  if (!Number.isFinite(distance) || distance > approachRadius) return null;

  return {
    burgId: row.id,
    x: Number(row.x),
    y: Number(row.y),
    resolvedName: row.name,
    distance,
  };
}
