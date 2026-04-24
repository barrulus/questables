import { generateFromBurg, SETTLEMAKER_VERSION, computeTileInfo } from 'settlemaker';
import {
  computeLocalToWorldScale,
  maxRadiusFromOrigin,
  translateLocalToWorldPx,
} from './coordinate-translator.js';
import {
  buildSettlemakerInput,
  loadApproachingRoutes,
  loadBurgForSettlemaker,
} from './burg-input-builder.js';
import {
  deleteForBurg as deleteEntrances,
  insertEntranceRoutes,
  insertMany as insertEntrances,
} from '../maps/burg-entrances-service.js';
import {
  getByBurg as getSettlement,
  upsert as upsertSettlement,
} from '../maps/burg-settlements-service.js';
import { logInfo, logWarn } from '../../utils/logger.js';

const EXPECTED_SCHEMA_VERSION = 3;

async function loadMetersPerPixel(client, worldId) {
  const { rows } = await client.query(
    `SELECT meters_per_pixel FROM public.maps_world WHERE id = $1 LIMIT 1`,
    [worldId],
  );
  return rows[0]?.meters_per_pixel ?? null;
}

function wallRadiusFromFc(fc) {
  const wall = fc.features.find((f) => f?.properties?.layer === 'wall');
  if (!wall) return 0;
  return maxRadiusFromOrigin(wall.geometry);
}

// Returns { entranceRows, joinSpecs } where joinSpecs[i] is the array of
// per-route detail entries that belong to entranceRows[i] — the caller
// links them after the entrance row's id is known (post-INSERT).
function buildEntranceRows({ fc, burg, centroidPx, scale, settlemakerVersion }) {
  const version = fc.metadata.settlement_generation_version;
  const entranceRows = [];
  const joinSpecs = [];
  for (const f of fc.features) {
    if (f?.properties?.layer !== 'entrance') continue;
    const p = f.properties;
    const [lx, ly] = f.geometry.coordinates;
    const world = translateLocalToWorldPx({
      localPoint: { x: lx, y: ly },
      burgCentroidPx: centroidPx,
      scale,
    });
    // Settlemaker 0.4.0: matched_route_ids is the canonical multi-route
    // list; matched_route_id (singular, legacy) equals matched_route_ids[0].
    // We persist matched_route_ids[0] as the denormalized scalar primary
    // and write the full list to maps_burg_entrance_routes via joinSpecs.
    const routeIds = Array.isArray(p.matched_route_ids)
      ? p.matched_route_ids.filter((id) => typeof id === 'string' && id.length > 0)
      : (p.matched_route_id ? [p.matched_route_id] : []);
    const routeDetail = Array.isArray(p.matched_routes) ? p.matched_routes : [];

    entranceRows.push({
      burg_id: burg.id,
      gate_id: p.entrance_id,                       // column name unchanged
      route_id: routeIds[0] ?? null,
      x_px: world.x,
      y_px: world.y,
      bearing_deg: Number(p.bearing_deg),
      bearing_match_delta_deg: p.bearing_match_delta_deg ?? null,
      kind: p.kind,
      sub_kind: p.sub_kind,
      wall_vertex_index: Number(p.wall_vertex_index),
      prev_gate_id: p.prev_entrance_id ?? null,
      next_gate_id: p.next_entrance_id ?? null,
      name: p.name ?? null,
      arrival_local: Array.isArray(p.arrival_local) ? p.arrival_local : null,
      settlement_generation_version: version,
      settlemaker_version: settlemakerVersion,
    });

    // Build join-table specs for this entrance. matched_routes carries the
    // per-edge attributes; if the library only emitted matched_route_ids
    // (or only the legacy scalar), fall back to a minimal record.
    const detailByRouteId = new Map();
    for (const d of routeDetail) {
      if (d?.route_id) detailByRouteId.set(d.route_id, d);
    }
    const specs = routeIds.map((rid) => {
      const d = detailByRouteId.get(rid);
      return {
        route_id: rid,
        kind: d?.kind ?? null,
        requested_bearing_deg: d?.requested_bearing_deg ?? null,
        match_delta_deg: d?.match_delta_deg ?? null,
      };
    });
    joinSpecs.push(specs);
  }
  return { entranceRows, joinSpecs };
}

function extractSidecarPayload(fc, input) {
  const m = fc.metadata;
  const hasHarbour = fc.features.some(
    (f) => f?.properties?.layer === 'entrance' && f.properties.sub_kind === 'harbour',
  );
  const viewBox = {
    x: m.local_bounds.min_x,
    y: m.local_bounds.min_y,
    width: m.local_bounds.max_x - m.local_bounds.min_x,
    height: m.local_bounds.max_y - m.local_bounds.min_y,
  };
  const tileInfo = computeTileInfo(viewBox, input.population);
  const TILE_SIZE = 256;
  const tileExtentPx = TILE_SIZE * Math.pow(2, tileInfo.maxZoom);
  return {
    meters_per_unit: m.scale.meters_per_unit,
    diameter_meters: m.scale.diameter_meters,
    diameter_local: m.scale.diameter_local,
    scale_source: m.scale.source,
    local_bounds: m.local_bounds,
    max_zoom: tileInfo.maxZoom,
    tile_extent_px: tileExtentPx,
    svg_viewbox: viewBox,
    has_harbour: hasHarbour,
    ocean_bearing_deg: input.oceanBearing != null ? Math.round(input.oceanBearing) : null,
    degraded_flags: Array.isArray(m.degraded_flags) ? m.degraded_flags : [],
    settlement_generation_version: m.settlement_generation_version,
    settlemaker_version: m.settlemaker_version ?? SETTLEMAKER_VERSION,
  };
}

export async function ingestBurg(client, { burgId, force = false }) {
  const burg = await loadBurgForSettlemaker(client, burgId);
  if (!burg) {
    const err = new Error(`Burg ${burgId} not found`);
    err.status = 404;
    err.code = 'burg_not_found';
    throw err;
  }
  const routes = await loadApproachingRoutes(client, burg);
  const input = await buildSettlemakerInput(client, burg, routes);

  const { geojson } = generateFromBurg(input);

  if (geojson.metadata.schema_version !== EXPECTED_SCHEMA_VERSION) {
    const err = new Error(
      `Settlemaker schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, got ${geojson.metadata.schema_version}`,
    );
    err.code = 'settlemaker_schema_mismatch';
    err.status = 500;
    throw err;
  }

  const newVersion = geojson.metadata.settlement_generation_version;
  const settlemakerVersion = geojson.metadata.settlemaker_version ?? SETTLEMAKER_VERSION;

  if (!force) {
    const existing = await getSettlement(client, burgId);
    if (
      existing &&
      existing.settlement_generation_version === newVersion &&
      existing.settlemaker_version === settlemakerVersion
    ) {
      return { updated: false, count: 0 };
    }
  }

  const metersPerPixel = await loadMetersPerPixel(client, burg.world_id);
  const wallRadiusLocal = wallRadiusFromFc(geojson);
  const scale = computeLocalToWorldScale({
    population: Number(burg.population) || 100,
    wallRadiusLocal,
    metersPerPixel,
  });

  const centroidPx = { x: Number(burg.x_px), y: Number(burg.y_px) };
  const { entranceRows, joinSpecs } = buildEntranceRows({
    fc: geojson,
    burg,
    centroidPx,
    scale,
    settlemakerVersion,
  });
  const sidecar = extractSidecarPayload(geojson, input);

  await client.query('BEGIN');
  try {
    await deleteEntrances(client, burgId);
    await upsertSettlement(client, burgId, sidecar);
    let inserted = [];
    if (entranceRows.length > 0) {
      inserted = await insertEntrances(client, entranceRows);
      const joinRows = [];
      inserted.forEach((row, i) => {
        for (const spec of joinSpecs[i]) {
          joinRows.push({ entrance_id: row.id, ...spec });
        }
      });
      if (joinRows.length > 0) await insertEntranceRoutes(client, joinRows);
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logWarn('settlemaker ingestor rollback itself failed', {
        burgId,
        rollbackError: rbErr?.message,
      });
    }
    logWarn('settlemaker ingestor rollback', { burgId, error: err?.message });
    throw err;
  }

  logInfo('settlemaker ingest complete', {
    telemetryEvent: 'settlemaker.ingested',
    burgId, gateCount: entranceRows.length, version: newVersion,
  });
  return { updated: true, count: entranceRows.length };
}

export async function ensureEntrancesFresh(client, { burgId }) {
  return ingestBurg(client, { burgId });
}
