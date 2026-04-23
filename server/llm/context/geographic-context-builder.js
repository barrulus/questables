/**
 * GeographicContextBuilder — queries PostGIS for map data surrounding a position.
 *
 * Provides the LLM with rich geographic awareness: nearby settlements, terrain,
 * trade routes, rivers, points of interest, and campaign regions. This transforms
 * the LLM from a generic chatbot into a DM with real world knowledge.
 */

import { query } from '../../db/pool.js';
import { logError } from '../../utils/logger.js';

const MAX_NEARBY_BURGS = 8;
const MAX_NEARBY_MARKERS = 10;
const MAX_NEARBY_ROUTES = 6;
const MAX_NEARBY_RIVERS = 6;

/**
 * Build geographic context for a position on the world map.
 *
 * @param {object} opts
 * @param {string} opts.worldMapId - The world map UUID
 * @param {number} opts.x - X pixel coordinate
 * @param {number} opts.y - Y pixel coordinate
 * @param {string} [opts.campaignId] - Campaign UUID for region lookups
 * @param {string} [opts.insideBurgId] - If player is inside a settlement
 * @param {number} [opts.radiusPx] - Search radius in pixels (default 200)
 * @returns {Promise<object>} Geographic context object
 */
export async function buildGeographicContext({
  worldMapId,
  x,
  y,
  campaignId = null,
  insideBurgId = null,
}) {
  if (!worldMapId || x == null || y == null) {
    return null;
  }

  const pointWkt = `ST_SetSRID(ST_MakePoint(${Number(x)}, ${Number(y)}), 0)`;

  try {
    const [
      worldMeta,
      nearbyBurgs,
      nearbyMarkers,
      nearbyRoutes,
      nearbyRivers,
      terrainCell,
      campaignRegions,
      settlementDetail,
    ] = await Promise.all([
      queryWorldMeta(worldMapId),
      queryNearbyBurgs(worldMapId, pointWkt),
      queryNearbyMarkers(worldMapId, pointWkt),
      queryNearbyRoutes(worldMapId, pointWkt),
      queryNearbyRivers(worldMapId, pointWkt),
      queryTerrainCell(worldMapId, pointWkt),
      campaignId ? queryCampaignRegions(campaignId, pointWkt) : Promise.resolve([]),
      insideBurgId ? querySettlementDetail(insideBurgId) : Promise.resolve(null),
    ]);

    // If inside a settlement, also load NPCs and shops linked to this burg
    let settlementNpcs = [];
    let settlementShops = [];
    if (insideBurgId && campaignId) {
      [settlementNpcs, settlementShops] = await Promise.all([
        querySettlementNpcs(campaignId, insideBurgId),
        querySettlementShops(campaignId, insideBurgId),
      ]);
    }

    const metersPerPixel = worldMeta?.meters_per_pixel ?? null;

    return {
      position: { x, y },
      worldMapId,
      metersPerPixel,
      insideBurgId,
      isInsideSettlement: !!insideBurgId,
      terrain: terrainCell,
      nearbyBurgs: nearbyBurgs.map((b) => ({
        ...b,
        distanceKm: metersPerPixel ? Math.round((b.distance_px * metersPerPixel) / 100) / 10 : null,
      })),
      nearbyMarkers: nearbyMarkers.map((m) => ({
        ...m,
        distanceKm: metersPerPixel ? Math.round((m.distance_px * metersPerPixel) / 100) / 10 : null,
      })),
      nearbyRoutes,
      nearbyRivers,
      campaignRegions,
      settlement: settlementDetail,
      settlementNpcs,
      settlementShops,
    };
  } catch (error) {
    logError('GeographicContextBuilder failed', {
      worldMapId, x, y,
      error: error.message,
    });
    return null;
  }
}

// ── Query helpers ─────────────────────────────────────────────────────────────

async function queryWorldMeta(worldMapId) {
  const { rows } = await query(
    `SELECT meters_per_pixel, width_pixels, height_pixels
       FROM public.maps_world WHERE id = $1`,
    [worldMapId],
    { label: 'geo-ctx.world-meta' },
  );
  return rows[0] ?? null;
}

async function queryNearbyBurgs(worldMapId, pointWkt) {
  const { rows } = await query(
    `SELECT
       name, statefull, provincefull, culture, religion,
       population, elevation, temperature,
       capital, port, citadel, walls, plaza, temple, shanty,
       ST_Distance(geom, ${pointWkt}) AS distance_px,
       ST_X(geom) AS x_px, ST_Y(geom) AS y_px
     FROM public.maps_burgs
     WHERE world_id = $1
     ORDER BY geom <-> ${pointWkt}
     LIMIT $2`,
    [worldMapId, MAX_NEARBY_BURGS],
    { label: 'geo-ctx.nearby-burgs' },
  );
  return rows;
}

async function queryNearbyMarkers(worldMapId, pointWkt) {
  const { rows } = await query(
    `SELECT
       type, icon, note,
       ST_Distance(geom, ${pointWkt}) AS distance_px
     FROM public.maps_markers
     WHERE world_id = $1
     ORDER BY geom <-> ${pointWkt}
     LIMIT $2`,
    [worldMapId, MAX_NEARBY_MARKERS],
    { label: 'geo-ctx.nearby-markers' },
  );
  return rows;
}

async function queryNearbyRoutes(worldMapId, pointWkt) {
  const { rows } = await query(
    `SELECT name, type,
       ST_Distance(geom, ${pointWkt}) AS distance_px
     FROM public.maps_routes
     WHERE world_id = $1 AND name IS NOT NULL
     ORDER BY geom <-> ${pointWkt}
     LIMIT $2`,
    [worldMapId, MAX_NEARBY_ROUTES],
    { label: 'geo-ctx.nearby-routes' },
  );
  return rows;
}

async function queryNearbyRivers(worldMapId, pointWkt) {
  const { rows } = await query(
    `SELECT name, type, width,
       ST_Distance(geom, ${pointWkt}) AS distance_px
     FROM public.maps_rivers
     WHERE world_id = $1 AND name IS NOT NULL
     ORDER BY geom <-> ${pointWkt}
     LIMIT $2`,
    [worldMapId, MAX_NEARBY_RIVERS],
    { label: 'geo-ctx.nearby-rivers' },
  );
  return rows;
}

async function queryTerrainCell(worldMapId, pointWkt) {
  const { rows } = await query(
    `SELECT biome, type, height, state, culture, religion
     FROM public.maps_cells
     WHERE world_id = $1
       AND ST_Contains(geom, ${pointWkt})
     LIMIT 1`,
    [worldMapId],
    { label: 'geo-ctx.terrain-cell' },
  );
  return rows[0] ?? null;
}

async function queryCampaignRegions(campaignId, pointWkt) {
  const { rows } = await query(
    `SELECT name, description, category
     FROM public.campaign_map_regions
     WHERE campaign_id = $1
       AND ST_Contains(region, ${pointWkt})`,
    [campaignId],
    { label: 'geo-ctx.campaign-regions' },
  );
  return rows;
}

async function querySettlementDetail(burgId) {
  const { rows } = await query(
    `SELECT
       name, statefull, provincefull, culture, religion,
       population, elevation, temperature,
       capital, port, citadel, walls, plaza, temple, shanty
     FROM public.maps_burgs
     WHERE id = $1`,
    [burgId],
    { label: 'geo-ctx.settlement-detail' },
  );
  return rows[0] ?? null;
}

async function querySettlementNpcs(campaignId, burgId) {
  const { rows } = await query(
    `SELECT name, race, occupation, personality, motivations
       FROM public.npcs
      WHERE campaign_id = $1 AND linked_burg_id = $2
      LIMIT 10`,
    [campaignId, burgId],
    { label: 'geo-ctx.settlement-npcs' },
  );
  return rows;
}

async function querySettlementShops(campaignId, burgId) {
  const { rows } = await query(
    `SELECT s.name, s.shop_type, s.description
       FROM public.npc_shops s
       LEFT JOIN public.npcs n ON s.npc_id = n.id
      WHERE s.campaign_id = $1 AND n.linked_burg_id = $2
      LIMIT 5`,
    [campaignId, burgId],
    { label: 'geo-ctx.settlement-shops' },
  );
  return rows;
}
