/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import {
  getWorldTile,
  saveWorldSvg,
  removeWorldBaseMap,
  worldSvgPath,
  worldTilesDir,
  _inflightCount,
} from '../../../server/services/maps/world-tile-service.js';

// The service resolves QUESTABLES_MAP_DATA_DIR per call (not at import time),
// so setting it here — after the static import but before any test runs —
// safely points every path at a scratch root.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'world-tiles-test-'));
process.env.QUESTABLES_MAP_DATA_DIR = TMP_ROOT;

const WORLD_A = '11111111-1111-4111-8111-111111111111';
const WORLD_B = '22222222-2222-4222-8222-222222222222';
const WORLD_MISSING = '33333333-3333-4333-8333-333333333333';

// 512x256 red canvas → maxZoom = computeMaxZoom(512,256) = 3
const RED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256" width="512" height="256">' +
  '<rect x="0" y="0" width="512" height="256" fill="#ff0000"/></svg>';

function writeWorldSvg(worldId, svg) {
  const p = worldSvgPath(worldId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, svg);
}

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('getWorldTile', () => {
  test('renders a 256x256 PNG on cache miss and writes the disk cache', async () => {
    writeWorldSvg(WORLD_A, RED_SVG);
    const buf = await getWorldTile(WORLD_A, 0, 0, 0);
    expect(buf).toBeInstanceOf(Buffer);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    const cachePath = path.join(worldTilesDir(WORLD_A), '0', '0', '0.png');
    expect(fs.existsSync(cachePath)).toBe(true);
  });

  test('serves the disk cache without re-rendering', async () => {
    const sentinel = Buffer.from('sentinel-not-a-real-png');
    const cachePath = path.join(worldTilesDir(WORLD_A), '1', '0', '0.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, sentinel);
    const buf = await getWorldTile(WORLD_A, 1, 0, 0);
    expect(buf.equals(sentinel)).toBe(true);
  });

  test('missing SVG → throws 404 no_base_map', async () => {
    await expect(getWorldTile(WORLD_MISSING, 0, 0, 0)).rejects.toMatchObject({
      status: 404,
      code: 'no_base_map',
    });
  });

  test('outside grid or beyond max zoom → null (route sends 204)', async () => {
    writeWorldSvg(WORLD_A, RED_SVG);
    expect(await getWorldTile(WORLD_A, 0, 1, 0)).toBeNull(); // x outside
    expect(await getWorldTile(WORLD_A, 1, 0, 1)).toBeNull(); // y outside (1 row at z=1)
    expect(await getWorldTile(WORLD_A, 4, 0, 0)).toBeNull(); // beyond maxZoom 3
  });

  test('rasterization failure yields a transparent 256x256 tile', async () => {
    // Parses dims but is malformed XML → sharp throws → transparent fallback.
    writeWorldSvg(WORLD_B, '<svg viewBox="0 0 64 64"><');
    const buf = await getWorldTile(WORLD_B, 0, 0, 0);
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    const stats = await sharp(buf).stats();
    // Alpha channel is uniformly 0.
    expect(stats.channels[3].max).toBe(0);
  });

  test('concurrent requests for one uncached tile render once (in-flight dedupe)', async () => {
    writeWorldSvg(WORLD_A, RED_SVG);
    fs.rmSync(worldTilesDir(WORLD_A), { recursive: true, force: true });
    const p1 = getWorldTile(WORLD_A, 2, 1, 0);
    const p2 = getWorldTile(WORLD_A, 2, 1, 0);
    expect(_inflightCount()).toBe(1);
    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1.equals(b2)).toBe(true);
    expect(_inflightCount()).toBe(0);
  });
});

describe('saveWorldSvg / removeWorldBaseMap', () => {
  test('saveWorldSvg moves the staged file, purges tiles, evicts memory cache', async () => {
    writeWorldSvg(WORLD_A, RED_SVG);
    await getWorldTile(WORLD_A, 0, 0, 0); // warm disk + memory caches
    expect(fs.existsSync(worldTilesDir(WORLD_A))).toBe(true);

    const staged = path.join(TMP_ROOT, 'staged.svg');
    const BLUE_SVG = RED_SVG.replace('#ff0000', '#0000ff');
    fs.writeFileSync(staged, BLUE_SVG);

    await saveWorldSvg(WORLD_A, staged);

    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.readFileSync(worldSvgPath(WORLD_A), 'utf8')).toBe(BLUE_SVG);
    expect(fs.existsSync(worldTilesDir(WORLD_A))).toBe(false);

    // Re-render must use the NEW svg (memory cache evicted): blue-ish pixel.
    const buf = await getWorldTile(WORLD_A, 0, 0, 0);
    const stats = await sharp(buf).stats();
    expect(stats.channels[2].max).toBeGreaterThan(200); // blue
    expect(stats.channels[0].max).toBeLessThan(50); // no red left
  });

  test('removeWorldBaseMap deletes svg + tiles and is idempotent', async () => {
    await removeWorldBaseMap(WORLD_A);
    expect(fs.existsSync(worldSvgPath(WORLD_A))).toBe(false);
    expect(fs.existsSync(worldTilesDir(WORLD_A))).toBe(false);
    await expect(removeWorldBaseMap(WORLD_A)).resolves.toBeUndefined();
  });
});
