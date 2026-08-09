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
