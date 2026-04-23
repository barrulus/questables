import { classifyRouteKind } from './route-classifier.js';

// Fields required to reproduce a settlemaker generation: basic flags +
// x_px/y_px for road-bearing math + world_id for the route lookup. Aliases
// the legacy `xpixel`/`ypixel` columns.
export async function loadBurgForSettlemaker(client, burgId) {
  const { rows } = await client.query(
    `SELECT id, world_id, name, population, port, citadel, walls, plaza,
            temple, shanty, capital,
            xpixel AS x_px, ypixel AS y_px
       FROM public.maps_burgs
      WHERE id = $1
      LIMIT 1`,
    [burgId],
  );
  return rows[0] ?? null;
}

export async function loadApproachingRoutes(client, burg, thresholdPx = 50) {
  const { rows } = await client.query(
    `WITH b AS (SELECT geom FROM public.maps_burgs WHERE id = $1)
     SELECT r.id AS route_id,
            r.type AS type,
            ST_X(ST_ClosestPoint(r.geom, b.geom)) AS snap_x,
            ST_Y(ST_ClosestPoint(r.geom, b.geom)) AS snap_y
       FROM public.maps_routes r, b
      WHERE r.world_id = $2
        AND ST_Distance(r.geom, b.geom) < $3`,
    [burg.id, burg.world_id, thresholdPx],
  );
  return rows;
}

function bearingFromBurgToSnap(burg, snap) {
  const dx = Number(snap.snap_x) - Number(burg.x_px);
  const dy = Number(snap.snap_y) - Number(burg.y_px);
  return ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
}

function computeOceanBearing(burg, routes) {
  const sea = routes.find((r) => classifyRouteKind(r.type) === 'sea');
  if (!sea) return undefined;
  return bearingFromBurgToSnap(burg, sea);
}

// Build the AzgaarBurgInput passed to `generateFromBurg`. The tile server AND
// the ingestor must go through this so they produce identical settlements —
// settlemaker's gate placement depends on `roadBearings`, so a tile-server
// call without them produces different gates than the DB entrances that were
// written at ingestion time.
export function buildSettlemakerInput(burg, routes) {
  const roadBearings = routes.map((r) => ({
    bearing_deg: bearingFromBurgToSnap(burg, r),
    route_id: r.route_id,
    kind: classifyRouteKind(r.type),
  })).sort((a, b) => a.bearing_deg - b.bearing_deg);

  return {
    name: burg.name ?? 'Unnamed',
    population: Number(burg.population) || 100,
    port: Boolean(burg.port),
    citadel: Boolean(burg.citadel),
    walls: Boolean(burg.walls),
    plaza: Boolean(burg.plaza),
    temple: Boolean(burg.temple),
    shanty: Boolean(burg.shanty),
    capital: Boolean(burg.capital),
    roadBearings,
    oceanBearing: burg.port ? computeOceanBearing(burg, routes) : undefined,
    harbourSize: burg.port ? (Number(burg.population) >= 15000 ? 'large' : 'small') : undefined,
  };
}
