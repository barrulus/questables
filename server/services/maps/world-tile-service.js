import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { logError, logInfo } from '../../utils/logger.js';

const TILE_SIZE = 256;
const SVG_CACHE_CAPACITY = 2;

// Resolved per-call so tests can point the service at a temp directory.
function mapDataRoot() {
  return process.env.QUESTABLES_MAP_DATA_DIR || 'map_data';
}

export function worldSvgPath(worldId) {
  return path.resolve(mapDataRoot(), 'world-svg', `${worldId}.svg`);
}

export function worldTilesDir(worldId) {
  return path.resolve(mapDataRoot(), 'world-tiles', worldId);
}

/**
 * Spec zoom rule: ceil(log2(max(w, h) / 256)) + 2. The +2 over native
 * resolution stays crisp because the source is vector.
 */
export function computeMaxZoom(widthPixels, heightPixels) {
  const w = Number(widthPixels);
  const h = Number(heightPixels);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return Math.max(0, Math.ceil(Math.log2(Math.max(w, h) / TILE_SIZE))) + 2;
}

/** Light-weight root-tag parse (same approach as utils/tile-svg.mjs). */
export function parseSvgDimensions(svgText) {
  const tagMatch = String(svgText).match(/<svg[^>]*>/i);
  if (!tagMatch) return null;
  const tag = tagMatch[0];
  const attr = (name) => {
    const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i'));
    return m ? m[1] : null;
  };
  const vb = attr('viewBox');
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length >= 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }
  const w = Number(String(attr('width') ?? '').replace(/[^\d.]/g, ''));
  const h = Number(String(attr('height') ?? '').replace(/[^\d.]/g, ''));
  if (w > 0 && h > 0) return { x: 0, y: 0, width: w, height: h };
  return null;
}

/**
 * Square crop region for tile (z, x, y), matching the OL TileGrid built by
 * components/maps/questables-tile-source.ts: square tiles of side width/2^z
 * anchored at the viewBox origin, ceil(height/side) rows. The legacy
 * utils/tile-svg.mjs rounded the row count and stretched tiles vertically;
 * the OL grid is the alignment authority, so we use ceil.
 */
export function tileViewBox(dims, z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || x < 0 || y < 0) return null;
  const cols = 2 ** z;
  const side = dims.width / cols;
  const rows = Math.ceil(dims.height / side);
  if (x >= cols || y >= rows) return null;
  return { x: dims.x + x * side, y: dims.y + y * side, size: side };
}

/** Rewrite the root <svg> tag to crop to `vb` and output at tileSize px. */
export function buildTileSvg(svgText, vb, tileSize = TILE_SIZE) {
  const tagMatch = svgText.match(/<svg[^>]*>/i);
  if (!tagMatch) throw new Error('SVG root tag not found');
  const tag = tagMatch[0];
  let newTag = tag;
  const setAttr = (name, value) => {
    const re = new RegExp(`${name}\\s*=\\s*"[^"]*"`, 'i');
    if (re.test(newTag)) {
      newTag = newTag.replace(re, `${name}="${value}"`);
    } else {
      newTag = newTag.replace(/<svg/i, `<svg ${name}="${value}"`);
    }
  };
  setAttr('viewBox', `${vb.x} ${vb.y} ${vb.size} ${vb.size}`);
  setAttr('width', String(tileSize));
  setAttr('height', String(tileSize));
  // Function replacement so `$` sequences in attribute values stay literal.
  return svgText.replace(tag, () => newTag);
}

/**
 * In-memory LRU of parsed world SVGs: worldId → { svg, dims, maxZoom }.
 * Capacity 2 — a world SVG can be tens of MB; two covers the active world
 * plus one being compared/replaced.
 */
const svgCache = new Map();

function getCachedSvg(worldId) {
  const entry = svgCache.get(worldId);
  if (entry) {
    // Refresh recency (Map preserves insertion order).
    svgCache.delete(worldId);
    svgCache.set(worldId, entry);
  }
  return entry;
}

function putCachedSvg(worldId, entry) {
  svgCache.delete(worldId);
  svgCache.set(worldId, entry);
  while (svgCache.size > SVG_CACHE_CAPACITY) {
    svgCache.delete(svgCache.keys().next().value);
  }
}

export function evictWorldSvg(worldId) {
  svgCache.delete(worldId);
}

/**
 * FMG groups whose subtrees are removed before rasterization. Burg icons and
 * anchors (#icons) are drawn as <symbol width="1em"> sized by the group's
 * font-size — librsvg resolves that em against the default font size instead
 * of the 0.5px the browser uses, rendering every icon ~30-90x too large. The
 * app draws its own interactive burg layer, so the base map drops FMG's.
 */
const STRIPPED_GROUP_IDS = ['icons'];

/**
 * Remove a <g id="..."> subtree from the SVG, matching nested <g> tags so the
 * close tag is balanced. Returns the input unchanged when the group is absent
 * or the markup is unbalanced (never corrupt the document).
 */
export function stripSvgGroup(svgText, groupId) {
  const open = new RegExp(`<g\\b[^>]*\\bid="${groupId}"[^>]*>`, 'i').exec(svgText);
  if (!open) return svgText;
  if (open[0].endsWith('/>')) {
    return svgText.slice(0, open.index) + svgText.slice(open.index + open[0].length);
  }
  const tagRe = /<\/?g\b[^>]*>/gi;
  tagRe.lastIndex = open.index + open[0].length;
  let depth = 1;
  let tag;
  while (depth > 0 && (tag = tagRe.exec(svgText))) {
    if (tag[0][1] === '/') depth -= 1;
    else if (!tag[0].endsWith('/>')) depth += 1;
  }
  if (depth !== 0) return svgText;
  return svgText.slice(0, open.index) + svgText.slice(tagRe.lastIndex);
}

async function ensureWorldSvg(worldId) {
  const cached = getCachedSvg(worldId);
  if (cached) return cached;

  let svg;
  try {
    svg = await fs.promises.readFile(worldSvgPath(worldId), 'utf8');
  } catch {
    const err = new Error('World has no base map SVG');
    err.status = 404;
    err.code = 'no_base_map';
    throw err;
  }

  const dims = parseSvgDimensions(svg);
  if (!dims) {
    const err = new Error('Stored base map SVG has no readable dimensions');
    err.status = 500;
    err.code = 'invalid_base_map_svg';
    throw err;
  }

  for (const groupId of STRIPPED_GROUP_IDS) {
    svg = stripSvgGroup(svg, groupId);
  }

  const entry = { svg, dims, maxZoom: computeMaxZoom(dims.width, dims.height) };
  putCachedSvg(worldId, entry);
  logInfo('World base map SVG loaded', {
    telemetryEvent: 'world_tiles.svg_loaded',
    worldId,
    maxZoom: entry.maxZoom,
  });
  return entry;
}

/** In-flight dedupe: tileKey → Promise<Buffer|null>. */
const inflight = new Map();

export function _inflightCount() {
  return inflight.size;
}

async function renderWorldTile(worldId, z, x, y, tilePath) {
  const entry = await ensureWorldSvg(worldId);
  if (z > entry.maxZoom) return null;

  const vb = tileViewBox(entry.dims, z, x, y);
  if (!vb) return null;

  const tileSvg = buildTileSvg(entry.svg, vb);
  let pngBuffer;
  try {
    pngBuffer = await sharp(Buffer.from(tileSvg))
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    logError('World tile rasterization failed', err, { worldId, z, x, y });
    pngBuffer = await sharp({
      create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  }

  try {
    fs.mkdirSync(path.dirname(tilePath), { recursive: true });
    fs.writeFileSync(tilePath, pngBuffer);
  } catch (err) {
    logError('World tile disk cache write failed', err, { tilePath });
  }

  return pngBuffer;
}

/**
 * Get one base-map tile as a PNG buffer. Resolves null for tiles outside the
 * grid or beyond max zoom (→ 204). Throws { status: 404, code: 'no_base_map' }
 * when the world has no stored SVG.
 *
 * Deliberately NOT an async function: the disk-cache check and in-flight
 * registration run synchronously, so two concurrent calls for the same
 * uncached tile share one render.
 */
export function getWorldTile(worldId, z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || x < 0 || y < 0) {
    return Promise.resolve(null);
  }

  const tilePath = path.join(worldTilesDir(worldId), String(z), String(x), `${y}.png`);
  try {
    const cached = fs.readFileSync(tilePath);
    if (cached.length > 0) return Promise.resolve(cached);
  } catch {
    // Not cached — render.
  }

  const key = `${worldId}/${z}/${x}/${y}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderWorldTile(worldId, z, x, y, tilePath).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * Persist an uploaded SVG as the world's base map: move the staged multer
 * file into place (overwrite), evict the memory cache, purge the tile cache.
 */
export async function saveWorldSvg(worldId, stagedPath) {
  const dest = worldSvgPath(worldId);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.promises.rename(stagedPath, dest);
  } catch {
    // Cross-device fallback.
    await fs.promises.copyFile(stagedPath, dest);
    await fs.promises.unlink(stagedPath).catch(() => {});
  }
  evictWorldSvg(worldId);
  await fs.promises.rm(worldTilesDir(worldId), { recursive: true, force: true }).catch((err) => {
    logError('World tile cache purge failed', err, { worldId });
  });
}

/** Best-effort cleanup on world delete / base-map removal. Idempotent. */
export async function removeWorldBaseMap(worldId) {
  evictWorldSvg(worldId);
  await fs.promises.unlink(worldSvgPath(worldId)).catch(() => {});
  await fs.promises.rm(worldTilesDir(worldId), { recursive: true, force: true }).catch(() => {});
}
