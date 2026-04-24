import { classifyRouteKind } from './route-classifier.js';
import { bearingToNearestWaterCentroid, loadCoastlineGeometry } from './coastline-loader.js';

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

// Loads the previously-ingested sidecar (if any) so we can reuse its
// `diameter_local` as the coastline scale factor on re-ingest.
async function loadPriorDiameterLocal(client, burgId) {
  const { rows } = await client.query(
    `SELECT diameter_local
       FROM public.maps_burg_settlements
      WHERE burg_id = $1
      LIMIT 1`,
    [burgId],
  );
  return rows[0] ? Number(rows[0].diameter_local) : null;
}

function bearingFromBurgToSnap(burg, snap) {
  const dx = Number(snap.snap_x) - Number(burg.x_px);
  const dy = Number(snap.snap_y) - Number(burg.y_px);
  return ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
}

// Build the AzgaarBurgInput passed to `generateFromBurg`. The tile server AND
// the ingestor must go through this so they produce identical settlements —
// settlemaker's gate placement depends on `roadBearings` AND now
// `coastlineGeometry`, so a tile-server call without them produces different
// gates/harbours than the DB entrances written at ingestion time.
//
// Settlemaker 0.4.0 contract:
//   - `roadBearings` carries land/foot routes only. Sea routes drive
//     `harbourSize` + `oceanBearing` instead — passing them in both places
//     would double-count the harbour entrance.
//   - `coastlineGeometry` (when present) replaces the old half-plane ocean
//     heuristic with point-in-polygon classification against the actual
//     world coastline. Bays/coves/headlands then come through correctly.
export async function buildSettlemakerInput(client, burg, routes) {
  const seaRoute = routes.find((r) => classifyRouteKind(r.type) === 'sea');
  const landRoutes = routes.filter((r) => classifyRouteKind(r.type) !== 'sea');

  const roadBearings = landRoutes.map((r) => ({
    bearing_deg: bearingFromBurgToSnap(burg, r),
    route_id: r.route_id,
    kind: classifyRouteKind(r.type),
  })).sort((a, b) => a.bearing_deg - b.bearing_deg);

  const priorDiameterLocal = await loadPriorDiameterLocal(client, burg.id);
  const coastlineGeometry = await loadCoastlineGeometry(client, burg, {
    rLocal: priorDiameterLocal ?? undefined,
  });
  const hasCoastline = coastlineGeometry.length > 0;

  // Harbour: settlemaker only places one when `harbourSize` is set. Set it
  // for explicit FMG ports, for any burg with a sea route, OR for a coastal
  // burg the FMG just didn't flag (rare — kept conservative below).
  const wantsHarbour = Boolean(burg.port) || Boolean(seaRoute);
  const population = Number(burg.population) || 100;
  const harbourSize = wantsHarbour
    ? (population >= 10000 || seaRoute ? 'large' : 'small')
    : undefined;

  // Ocean bearing: prefer the centroid of the nearest water polygon (more
  // accurate than the route bearing for bays/inlets); fall back to the sea
  // route bearing; else undefined.
  let oceanBearing;
  if (wantsHarbour && hasCoastline) {
    oceanBearing = bearingToNearestWaterCentroid(coastlineGeometry);
  }
  if (oceanBearing == null && seaRoute) {
    oceanBearing = bearingFromBurgToSnap(burg, seaRoute);
  }

  return {
    name: burg.name ?? 'Unnamed',
    population,
    port: Boolean(burg.port),
    citadel: Boolean(burg.citadel),
    walls: Boolean(burg.walls),
    plaza: Boolean(burg.plaza),
    temple: Boolean(burg.temple),
    shanty: Boolean(burg.shanty),
    capital: Boolean(burg.capital),
    roadBearings,
    coastlineGeometry: hasCoastline ? coastlineGeometry : undefined,
    oceanBearing,
    harbourSize,
  };
}
