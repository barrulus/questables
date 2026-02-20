/**
 * Region trigger service — checks if a position falls within campaign map regions.
 * Called after successful player movement.
 */

import { logInfo } from '../../utils/logger.js';

/**
 * Check which campaign map regions contain a given point.
 *
 * @returns {Array<{id, name, category, metadata}>}
 */
export const checkRegionTriggers = async (client, { campaignId, worldMapId, x, y }) => {
  const { rows } = await client.query(
    `SELECT id, name, category, metadata
       FROM public.campaign_map_regions
      WHERE campaign_id = $1
        AND ($2::uuid IS NULL OR world_map_id = $2)
        AND ST_Within(
              ST_SetSRID(ST_MakePoint($3, $4), 0),
              region
            )`,
    [campaignId, worldMapId ?? null, x, y],
  );

  if (rows.length > 0) {
    logInfo('Region triggers detected', {
      telemetryEvent: 'region.triggers_detected',
      campaignId,
      x,
      y,
      count: rows.length,
      regions: rows.map((r) => ({ id: r.id, name: r.name, category: r.category })),
    });
  }

  return rows;
};
