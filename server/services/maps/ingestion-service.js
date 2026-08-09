import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../db/pool.js';
import { logInfo, logWarn } from '../../utils/logger.js';
import { ingestBurg } from '../settlemaker/ingestor.js';

export { extractMetersPerPixel } from './fmg-scale.js';

// --- Helpers (ported from afmg_geojson_importer.mjs) ---

const parseNumeric = (value) => {
  if (value === undefined || value === null) return null;
  const match = /^-?\d+(?:\.\d+)?/.exec(String(value).trim());
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
};

// --- SVG Parsing ---

export const parseSvgDimensions = (svgString) => {
  const tagMatch = svgString.match(/<svg[^>]*>/i);
  if (!tagMatch) {
    throw new Error('Unable to find root <svg> element');
  }

  const attributes = {};
  const attributeRegex = /([^\s=]+)\s*=\s*(['"])(.*?)\2/g;
  let match = attributeRegex.exec(tagMatch[0]);
  while (match) {
    attributes[match[1]] = match[3];
    match = attributeRegex.exec(tagMatch[0]);
  }

  let width = parseNumeric(attributes.width);
  let height = parseNumeric(attributes.height);

  if (width === null || height === null) {
    const viewBox = attributes.viewBox ?? attributes.viewbox;
    if (viewBox) {
      const parts = viewBox.trim().split(/\s+/);
      if (parts.length === 4) {
        width = parseNumeric(parts[2]);
        height = parseNumeric(parts[3]);
      }
    }
  }

  if (width === null || height === null) {
    throw new Error('Unable to determine SVG dimensions: missing width/height and no valid viewBox');
  }

  return { width: Math.round(width), height: Math.round(height) };
};

// --- Metadata Extraction ---
// `extractMetersPerPixel` lives in ./fmg-scale.js so it can be unit-tested
// without pulling in the settlemaker import chain. This module re-exports it
// for callers that already import from ingestion-service.

// --- World Creation/Update ---

export const createOrUpdateWorld = async ({
  name,
  description,
  widthPixels,
  heightPixels,
  metersPerPixel,
  uploadedBy,
}) => {
  const mpp = metersPerPixel ?? 1;
  const bounds = {
    north: 0,
    south: -heightPixels * mpp,
    east: widthPixels * mpp,
    west: 0,
    width_pixels: widthPixels,
    height_pixels: heightPixels,
    meters_per_pixel: mpp,
  };

  // Check if world exists by name
  const { rows: existing } = await query(
    'SELECT id FROM maps_world WHERE name = $1',
    [name],
    { label: 'ingestion.world.check' },
  );

  if (existing.length > 0) {
    const worldId = String(existing[0].id);
    await query(
      `UPDATE maps_world
          SET description = $2,
              bounds = $3,
              width_pixels = $4,
              height_pixels = $5,
              meters_per_pixel = $6,
              uploaded_by = COALESCE($7, uploaded_by),
              updated_at = NOW()
        WHERE id = $1`,
      [
        worldId,
        description ?? `Imported world map: ${name}`,
        JSON.stringify(bounds),
        Math.trunc(widthPixels),
        Math.trunc(heightPixels),
        mpp,
        uploadedBy ?? null,
      ],
      { label: 'ingestion.world.update' },
    );
    logInfo('Updated existing world', { worldId, name });
    return worldId;
  }

  const worldId = randomUUID();
  await query(
    `INSERT INTO maps_world (id, name, description, bounds, width_pixels, height_pixels, meters_per_pixel, uploaded_by, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
    [
      worldId,
      name,
      description ?? `Imported world map: ${name}`,
      JSON.stringify(bounds),
      Math.trunc(widthPixels),
      Math.trunc(heightPixels),
      mpp,
      uploadedBy ?? null,
    ],
    { label: 'ingestion.world.create' },
  );
  logInfo('Created new world', { worldId, name });
  return worldId;
};

// --- Burg Entrances ---

export async function ingestBurgEntrancesForWorldIfReady(worldId) {
  const status = await getWorldIngestionStatus(worldId);
  if (!(status.burgs > 0 && status.routes > 0)) return;
  let ingestedCount = 0;
  let failedCount = 0;
  await withTransaction(
    async (client) => {
      const { rows: allBurgs } = await client.query(
        `SELECT id FROM public.maps_burgs WHERE world_id = $1`,
        [worldId],
      );
      for (const b of allBurgs) {
        try {
          const result = await ingestBurg(client, { burgId: b.id });
          if (result.updated) ingestedCount += 1;
        } catch (err) {
          failedCount += 1;
          logWarn('settlemaker ingest failed for burg (continuing)', {
            worldId, burgId: b.id, error: err?.message,
          });
        }
      }
    },
    { label: 'ingestion.burg_entrances' },
  );
  logInfo('Burg entrances ingestion summary', {
    telemetryEvent: 'settlemaker.ingested.world',
    worldId, ingestedCount, failedCount,
  });
}

// --- Status ---

export const getWorldIngestionStatus = async (worldId) => {
  const tables = ['maps_cells', 'maps_burgs', 'maps_routes', 'maps_rivers', 'maps_markers'];
  const keys = ['cells', 'burgs', 'routes', 'rivers', 'markers'];

  const counts = await Promise.all(
    tables.map((table) =>
      query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE world_id = $1`, [worldId], {
        label: `ingestion.status.${table}`,
      }),
    ),
  );

  const status = {};
  keys.forEach((key, i) => {
    status[key] = counts[i].rows[0]?.count ?? 0;
  });
  return status;
};

export const updateWorldMetersPerPixel = async (worldId, metersPerPixel) => {
  const { rows } = await query(
    'SELECT width_pixels, height_pixels FROM maps_world WHERE id = $1',
    [worldId],
    { label: 'ingestion.world.fetchDims' },
  );
  if (rows.length === 0) return;

  const { width_pixels: w, height_pixels: h } = rows[0];
  const bounds = {
    north: 0,
    south: -h * metersPerPixel,
    east: w * metersPerPixel,
    west: 0,
    width_pixels: w,
    height_pixels: h,
    meters_per_pixel: metersPerPixel,
  };

  await query(
    `UPDATE maps_world SET meters_per_pixel = $2, bounds = $3, updated_at = NOW() WHERE id = $1`,
    [worldId, metersPerPixel, JSON.stringify(bounds)],
    { label: 'ingestion.world.updateMpp' },
  );
};
