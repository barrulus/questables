import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  generateFromBurg,
  parseSvgViewBox,
  computeTileInfo,
  cropSvgToTile,
} from 'settlemaker';
import { getBurgById } from './service.js';
import { logError, logInfo } from '../../utils/logger.js';

const TILE_SIZE = 256;
const EXTRA_ZOOM = 4;
const CACHE_DIR = path.resolve('map_data', 'settlements');

/** In-memory cache: burgId → { svg, tileInfo } */
const settlementCache = new Map();

/**
 * Ensure the settlement SVG is generated and cached in memory.
 * Returns { svg, tileInfo } or throws.
 */
async function ensureSettlement(burgId) {
  const cached = settlementCache.get(burgId);
  if (cached) return cached;

  const burg = await getBurgById(burgId);
  if (!burg) {
    const err = new Error('Burg not found');
    err.status = 404;
    err.code = 'burg_not_found';
    throw err;
  }

  const burgInput = {
    name: burg.name,
    population: Number(burg.population) || 100,
    port: Boolean(burg.port),
    citadel: Boolean(burg.citadel),
    walls: Boolean(burg.walls),
    plaza: Boolean(burg.plaza),
    temple: Boolean(burg.temple),
    shanty: Boolean(burg.shanty),
    capital: Boolean(burg.capital),
    culture: burg.culture ?? undefined,
    elevation: burg.elevation != null ? Number(burg.elevation) : undefined,
    temperature: burg.temperature != null ? Number(burg.temperature) : undefined,
  };

  const result = generateFromBurg(burgInput);
  const viewBox = parseSvgViewBox(result.svg);
  if (!viewBox) {
    throw new Error('Generated SVG has no viewBox');
  }

  const tileInfo = computeTileInfo(viewBox, burgInput.population);

  const entry = { svg: result.svg, tileInfo, name: burg.name, population: burgInput.population };
  settlementCache.set(burgId, entry);

  logInfo('Settlement SVG generated', {
    telemetryEvent: 'settlement.generated',
    burgId,
    burgName: burg.name,
    maxZoom: tileInfo.maxZoom,
  });

  return entry;
}

/**
 * Get settlement info (metadata) for a burg.
 */
export async function getSettlementInfo(burgId) {
  const entry = await ensureSettlement(burgId);
  return {
    burgId,
    name: entry.name,
    population: entry.population,
    maxZoom: entry.tileInfo.maxZoom + EXTRA_ZOOM,
    tileSize: TILE_SIZE,
  };
}

/**
 * Get a single settlement tile as a PNG buffer.
 * Returns null for out-of-range tiles.
 */
export async function getSettlementTile(burgId, z, x, y) {
  const nTiles = Math.pow(2, z);
  if (x < 0 || y < 0 || x >= nTiles || y >= nTiles) {
    return null;
  }

  // Check disk cache first
  const tilePath = path.join(CACHE_DIR, burgId, String(z), String(x), `${y}.png`);
  try {
    const cached = fs.readFileSync(tilePath);
    if (cached.length > 0) return cached;
  } catch {
    // Not cached — generate
  }

  const entry = await ensureSettlement(burgId);

  if (z > entry.tileInfo.maxZoom + EXTRA_ZOOM) {
    return null;
  }

  const tileSvg = cropSvgToTile(entry.svg, entry.tileInfo, z, x, y, TILE_SIZE);

  let pngBuffer;
  try {
    pngBuffer = await sharp(Buffer.from(tileSvg))
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    logError('Settlement tile rasterization failed', err, { burgId, z, x, y });
    // Return a transparent tile on error
    pngBuffer = await sharp({
      create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  }

  // Write to disk cache
  try {
    const dir = path.dirname(tilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tilePath, pngBuffer);
  } catch (err) {
    logError('Settlement tile disk cache write failed', err, { tilePath });
  }

  return pngBuffer;
}
