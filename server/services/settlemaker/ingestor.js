import { generateFromBurg, SETTLEMAKER_VERSION } from 'settlemaker';
import { classifyRouteKind } from './route-classifier.js';
import {
  computeLocalToWorldScale,
  maxRadiusFromOrigin,
  translateLocalToWorldPx,
} from './coordinate-translator.js';
import {
  distinctVersionForBurg,
  deleteForBurg,
  insertMany,
} from '../maps/burg-entrances-service.js';
import { logInfo, logWarn } from '../../utils/logger.js';

async function loadBurgRow(client, burgId) {
  // maps_burgs carries legacy `xpixel`/`ypixel` column names in production
  // DBs; alias to x_px/y_px so downstream code stays uniform across tables.
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

async function loadPixelsPerMile(client, worldId) {
  const { rows } = await client.query(
    `SELECT pixels_per_mile FROM public.maps_world WHERE id = $1 LIMIT 1`,
    [worldId],
  );
  return rows[0]?.pixels_per_mile ?? null;
}

async function loadApproachingRoutes(client, burg, thresholdPx = 50) {
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

function wallRadiusFromFc(fc) {
  const wall = fc.features.find((f) => f?.properties?.layer === 'wall');
  if (!wall) return 0;
  return maxRadiusFromOrigin(wall.geometry);
}

function buildRows({ fc, burg, centroidPx, scale, settlemakerVersion }) {
  const version = fc.metadata.settlement_generation_version;
  const out = [];
  for (const f of fc.features) {
    if (f?.properties?.layer !== 'gate') continue;
    const p = f.properties;
    const [lx, ly] = f.geometry.coordinates;
    const world = translateLocalToWorldPx({
      localPoint: { x: lx, y: ly },
      burgCentroidPx: centroidPx,
      scale,
    });
    out.push({
      burg_id: burg.id,
      gate_id: p.gate_id,
      route_id: p.matched_route_id ?? null,
      x_px: world.x,
      y_px: world.y,
      bearing_deg: Number(p.bearing_deg),
      bearing_match_delta_deg: p.bearing_match_delta_deg ?? null,
      kind: p.kind,
      sub_kind: p.sub_kind,
      wall_vertex_index: Number(p.wall_vertex_index),
      prev_gate_id: p.prev_gate_id ?? null,
      next_gate_id: p.next_gate_id ?? null,
      name: p.name ?? null,
      settlement_generation_version: version,
      settlemaker_version: settlemakerVersion,
    });
  }
  return out;
}

function computeOceanBearing(burg, routes) {
  const sea = routes.find((r) => classifyRouteKind(r.type) === 'sea');
  if (!sea) return undefined;
  return bearingFromBurgToSnap(burg, sea);
}

function buildInput(burg, routes) {
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

export async function ingestBurg(client, { burgId }) {
  const burg = await loadBurgRow(client, burgId);
  if (!burg) {
    const err = new Error(`Burg ${burgId} not found`);
    err.status = 404;
    err.code = 'burg_not_found';
    throw err;
  }
  const routes = await loadApproachingRoutes(client, burg);
  const input = buildInput(burg, routes);

  const { geojson } = generateFromBurg(input);
  const newVersion = geojson.metadata.settlement_generation_version;

  const existingVersion = await distinctVersionForBurg(client, burgId);
  if (existingVersion === newVersion) {
    return { updated: false, count: 0 };
  }

  const pixelsPerMile = await loadPixelsPerMile(client, burg.world_id);
  const wallRadiusLocal = wallRadiusFromFc(geojson);
  const scale = computeLocalToWorldScale({
    population: Number(burg.population) || 100,
    wallRadiusLocal,
    pixelsPerMile,
  });

  const centroidPx = { x: Number(burg.x_px), y: Number(burg.y_px) };
  const rows = buildRows({
    fc: geojson,
    burg,
    centroidPx,
    scale,
    settlemakerVersion: geojson.metadata.settlemaker_version ?? SETTLEMAKER_VERSION,
  });

  await client.query('BEGIN');
  try {
    await deleteForBurg(client, burgId);
    if (rows.length > 0) await insertMany(client, rows);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logWarn('settlemaker ingestor rollback', { burgId, error: err?.message });
    throw err;
  }

  logInfo('settlemaker ingest complete', {
    telemetryEvent: 'settlemaker.ingested',
    burgId, gateCount: rows.length, version: newVersion,
  });
  return { updated: true, count: rows.length };
}

export async function ensureEntrancesFresh(client, { burgId }) {
  return ingestBurg(client, { burgId });
}
