# Lazy World Base-Map Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worlds imported through the Full JSON wizard get a rendered base map: the uploaded SVG is stored per-world and rasterized into 256px XYZ tiles lazily on first request, disk-cached, and exposed through a world-scoped `tile_sets` row.

**Architecture:** A new `server/services/maps/world-tile-service.js` mirrors the proven `getSettlementTile` pipeline (`server/services/maps/settlement-service.js`): SVG stored at `server/map_data/world-svg/<worldId>.svg`, tiles cached at `server/map_data/world-tiles/<worldId>/<z>/<x>/<y>.png`, rasterized with sharp by cropping the SVG viewBox. Migration 019 adds `tile_sets.world_id` (one base map per world, FK cascade). The existing `POST /api/upload/map/:worldId/svg` route becomes real (persist + upsert tileset), and the frontend fetches tilesets scoped by world.

**Tech Stack:** Express + PostgreSQL (server, plain ESM JS), sharp for rasterization, Jest for tests, React + OpenLayers frontend (TypeScript).

**Design spec:** `docs/superpowers/specs/2026-08-09-lazy-world-tiles-design.md`

## Global Constraints

- Do NOT add `Co-Authored-By` lines to commit messages (user preference).
- Commit message style: conventional commits with scope, e.g. `feat(maps): …`, `fix(upload): …` (see `git log --oneline`).
- One SVG = one base map per world. No multi-tileset-per-world support.
- Tile size is always `256`. Tile format is always `png`. `min_zoom` is always `0`.
- Zoom rule (verbatim from spec): `max_zoom = ceil(log2(max(width_pixels, height_pixels) / 256)) + 2`.
- Tile endpoint is public (no auth), like settlement tiles.
- Server runs with cwd = `server/`, so `path.resolve('map_data', …)` lands in `server/map_data/` (same convention as `settlement-service.js`).
- Server code is plain JavaScript ESM (`.js`, `import`), not TypeScript.
- Frontend type check: `npx tsc --noEmit` from repo root.
- Jest: `npm test -- <path>` from repo root (runs `node --experimental-vm-modules node_modules/jest/bin/jest.js`).
- DB-gated tests must skip cleanly when Postgres is unavailable (use `describeWithDb` from `tests/maps/fmg-full-json/db-harness.js`).

## Grid math decision (read before Task 2)

The frontend already renders world tilesets through `createQuestablesTileSource`
(`components/maps/questables-tile-source.ts`): a `TileGrid` with extent
`[0, -H·mpp, W·mpp, 0]`, origin at the top-left, `resolutions[z] = (W·mpp)/256/2^z`.
That means tile `(z, x, y)` covers a **square** region of side `s = width/2^z`
(in SVG pixel units), at offset `(x·s, y·s)` from the SVG's top-left. Columns:
`x < 2^z`. Rows: `y < ceil(height · 2^z / width)`.

The legacy `utils/tile-svg.mjs` approximated this with
`nTilesY = round(nTilesX / aspect)` and vertically **stretched** tiles
(`tileH = height/nTilesY`), which for some aspect ratios drops the bottom strip
(e.g. Jolliariana 2133×1103 at z=6: round gives 33 rows, the OL grid needs 34).
The spec's operative requirement is "tiles align with the OL view", so we
implement the OL TileGrid math exactly (square tiles, `ceil` rows). For clean
aspect ratios (e.g. 2048×1024) this is bit-identical to the legacy script,
which the tests cross-check.

---

### Task 1: Migration 019 — `tile_sets.world_id`

**Files:**
- Create: `database/migrations/019_tile_sets_world_id.sql`
- Create: `database/migrations/019_tile_sets_world_id.rollback.sql`
- Modify: `database/schema.sql` (the `tile_sets` block, around line 673)

**Interfaces:**
- Consumes: existing `public.tile_sets` and `public.maps_world` tables.
- Produces: nullable column `tile_sets.world_id UUID REFERENCES maps_world(id) ON DELETE CASCADE`; partial unique index `tile_sets_world_id_unique_idx ON tile_sets(world_id) WHERE world_id IS NOT NULL`. Tasks 4+ target this index with `ON CONFLICT (world_id) WHERE world_id IS NOT NULL`.

- [ ] **Step 1: Write the migration**

`database/migrations/019_tile_sets_world_id.sql`:

```sql
-- 019_tile_sets_world_id.sql
-- Lazy world base-map tiles (spec: docs/superpowers/specs/2026-08-09-lazy-world-tiles-design.md)
-- Link tile_sets rows to a world. NULL = legacy global tileset. At most one
-- world-scoped row per world (the world's base map) — enforced by a partial
-- unique index, which is also the ON CONFLICT target for the upload upsert.
--
-- Idempotent: safe to re-apply.

BEGIN;

ALTER TABLE public.tile_sets
  ADD COLUMN IF NOT EXISTS world_id UUID REFERENCES public.maps_world(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS tile_sets_world_id_unique_idx
  ON public.tile_sets (world_id)
  WHERE world_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 2: Write the rollback**

`database/migrations/019_tile_sets_world_id.rollback.sql`:

```sql
-- Rollback for 019_tile_sets_world_id.sql
BEGIN;

DROP INDEX IF EXISTS public.tile_sets_world_id_unique_idx;

ALTER TABLE public.tile_sets DROP COLUMN IF EXISTS world_id;

COMMIT;
```

- [ ] **Step 3: Update `database/schema.sql`**

In the `CREATE TABLE IF NOT EXISTS public.tile_sets` block, add after the `uploaded_by` line:

```sql
    world_id UUID REFERENCES public.maps_world(id) ON DELETE CASCADE,
```

and after the table definition (next to the `_touch_tile_sets` trigger), add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS tile_sets_world_id_unique_idx
  ON public.tile_sets (world_id)
  WHERE world_id IS NOT NULL;
```

NOTE: in `schema.sql` the `tile_sets` table currently appears BEFORE `maps_world`-dependent sections — verify `maps_world` is defined earlier in the file (it is, around line 130). If not, keep the column but add the FK via `ALTER TABLE` at the end of the file following whatever pattern the file already uses.

- [ ] **Step 4: Apply the migration**

Postgres must be running (peer auth). If `psql -U barrulus -d questables -c 'SELECT 1'` fails with "socket … failed", start Postgres first (`sudo systemctl start postgresql` or the user's usual mechanism — ask if unclear).

Run: `psql -U barrulus -d questables -f database/migrations/019_tile_sets_world_id.sql`
Expected: `BEGIN` / `ALTER TABLE` / `CREATE INDEX` / `COMMIT` with no errors.

- [ ] **Step 5: Verify**

Run: `psql -U barrulus -d questables -c '\d tile_sets'`
Expected: `world_id | uuid` column present; `tile_sets_world_id_unique_idx` listed under indexes with `WHERE (world_id IS NOT NULL)`; FK `tile_sets_world_id_fkey … ON DELETE CASCADE`.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/019_tile_sets_world_id.sql database/migrations/019_tile_sets_world_id.rollback.sql database/schema.sql
git commit -m "feat(db): add tile_sets.world_id with one-base-map-per-world unique index (migration 019)"
```

---

### Task 2: World-tile grid math (pure functions)

**Files:**
- Create: `server/services/maps/world-tile-service.js` (pure helpers only in this task)
- Create: `tests/maps/world-tiles/grid-math.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (exact exports, used by Tasks 3, 5, 6):
  - `computeMaxZoom(widthPixels, heightPixels) → number | null` — the spec zoom rule; `null` when inputs are not finite positive numbers.
  - `parseSvgDimensions(svgText) → { x, y, width, height } | null` — from root `<svg>` `viewBox`, falling back to `width`/`height` attributes (with `x=0, y=0`).
  - `tileViewBox(dims, z, x, y) → { x, y, size } | null` — square crop region for tile `(z,x,y)` in SVG units; `null` when outside the grid.
  - `buildTileSvg(svgText, vb, tileSize?) → string` — SVG with root viewBox replaced by the crop square and width/height forced to `tileSize`.

- [ ] **Step 1: Write the failing tests**

`tests/maps/world-tiles/grid-math.test.js`:

```js
/** @jest-environment node */
import {
  computeMaxZoom,
  parseSvgDimensions,
  tileViewBox,
  buildTileSvg,
} from '../../../server/services/maps/world-tile-service.js';

describe('computeMaxZoom', () => {
  test('Jolliariana 2133x1103 → 6 (spec example)', () => {
    expect(computeMaxZoom(2133, 1103)).toBe(6);
  });
  test('2048x1024 → 5', () => {
    // log2(2048/256) = 3, +2 = 5
    expect(computeMaxZoom(2048, 1024)).toBe(5);
  });
  test('tiny maps never go below +2 over a single tile', () => {
    expect(computeMaxZoom(100, 100)).toBe(2);
  });
  test('height-dominant maps use the larger dimension', () => {
    expect(computeMaxZoom(1024, 4096)).toBe(6);
  });
  test('invalid dimensions → null', () => {
    expect(computeMaxZoom(null, 1000)).toBeNull();
    expect(computeMaxZoom(0, 0)).toBeNull();
    expect(computeMaxZoom(NaN, 100)).toBeNull();
  });
});

describe('parseSvgDimensions', () => {
  test('reads the root viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"><rect/></svg>';
    expect(parseSvgDimensions(svg)).toEqual({ x: 0, y: 0, width: 512, height: 256 });
  });
  test('honours non-zero viewBox origin', () => {
    const svg = '<svg viewBox="-10 5 100 50"></svg>';
    expect(parseSvgDimensions(svg)).toEqual({ x: -10, y: 5, width: 100, height: 50 });
  });
  test('falls back to width/height attributes', () => {
    const svg = '<svg width="2133" height="1103px"></svg>';
    expect(parseSvgDimensions(svg)).toEqual({ x: 0, y: 0, width: 2133, height: 1103 });
  });
  test('no svg root → null; no usable dims → null', () => {
    expect(parseSvgDimensions('not svg at all')).toBeNull();
    expect(parseSvgDimensions('<svg data-foo="1"></svg>')).toBeNull();
  });
});

describe('tileViewBox — matches the OL TileGrid used by createQuestablesTileSource', () => {
  const dims = { x: 0, y: 0, width: 512, height: 256 };

  test('z=0 is one square tile spanning the full width', () => {
    expect(tileViewBox(dims, 0, 0, 0)).toEqual({ x: 0, y: 0, size: 512 });
    expect(tileViewBox(dims, 0, 1, 0)).toBeNull();
    expect(tileViewBox(dims, 0, 0, 1)).toBeNull();
  });

  test('z=1: 2 columns, 1 row (256px squares cover the 256px height)', () => {
    expect(tileViewBox(dims, 1, 1, 0)).toEqual({ x: 256, y: 0, size: 256 });
    expect(tileViewBox(dims, 1, 0, 1)).toBeNull();
  });

  test('clean 2:1 aspect matches legacy utils/tile-svg.mjs output exactly', () => {
    // tile-svg.mjs at z=2 for 2048x1024: nTilesX=4, nTilesY=round(4/2)=2,
    // tileW=512, tileH=512 → tile (x=3,y=1) viewBox = (1536, 512, 512, 512).
    const legacy = { x: 0, y: 0, width: 2048, height: 1024 };
    expect(tileViewBox(legacy, 2, 3, 1)).toEqual({ x: 1536, y: 512, size: 512 });
    expect(tileViewBox(legacy, 2, 0, 2)).toBeNull();
  });

  test('non-clean aspect uses ceil rows (OL alignment), not legacy round', () => {
    // Jolliariana at z=6: side = 2133/64 ≈ 33.328, rows = ceil(1103/33.328) = 34.
    // Legacy round() gave 33 and dropped the bottom strip — we keep row 33.
    const jolli = { x: 0, y: 0, width: 2133, height: 1103 };
    expect(tileViewBox(jolli, 6, 0, 33)).not.toBeNull();
    expect(tileViewBox(jolli, 6, 0, 34)).toBeNull();
    expect(tileViewBox(jolli, 6, 64, 0)).toBeNull();
  });

  test('height-dominant worlds allow more rows than columns', () => {
    const tall = { x: 0, y: 0, width: 256, height: 1024 };
    // z=0: side=256, rows=ceil(1024/256)=4
    expect(tileViewBox(tall, 0, 0, 3)).toEqual({ x: 0, y: 768, size: 256 });
    expect(tileViewBox(tall, 0, 0, 4)).toBeNull();
  });

  test('negative coords → null', () => {
    expect(tileViewBox(dims, 1, -1, 0)).toBeNull();
    expect(tileViewBox(dims, 1, 0, -1)).toBeNull();
  });
});

describe('buildTileSvg', () => {
  test('replaces root viewBox and forces 256px output size', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256" width="512" height="256"><rect/></svg>';
    const out = buildTileSvg(svg, { x: 256, y: 0, size: 256 });
    expect(out).toContain('viewBox="256 0 256 256"');
    expect(out).toContain('width="256"');
    expect(out).toContain('height="256"');
    expect(out).toContain('<rect/>');
  });

  test('injects viewBox/width/height when the root lacks them', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const out = buildTileSvg(svg, { x: 0, y: 0, size: 128 });
    expect(out).toContain('viewBox="0 0 128 128"');
    expect(out).toContain('width="256"');
    expect(out).toContain('height="256"');
  });

  test('does not touch a nested viewBox (only the root tag)', () => {
    const svg = '<svg viewBox="0 0 512 256"><symbol viewBox="0 0 10 10"/></svg>';
    const out = buildTileSvg(svg, { x: 0, y: 0, size: 512 });
    expect(out).toContain('<symbol viewBox="0 0 10 10"/>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/maps/world-tiles/grid-math.test.js`
Expected: FAIL — cannot find module `server/services/maps/world-tile-service.js`.

- [ ] **Step 3: Implement the pure helpers**

Create `server/services/maps/world-tile-service.js`:

```js
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
```

(`fs`, `sharp`, `logError`, `logInfo`, `SVG_CACHE_CAPACITY`, `worldSvgPath`, `worldTilesDir` are used by Task 3 — the unused-import window only lasts one task.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/maps/world-tiles/grid-math.test.js`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/world-tile-service.js tests/maps/world-tiles/grid-math.test.js
git commit -m "feat(maps): world base-map tile grid math aligned with the OL tile grid"
```

---

### Task 3: World-tile rendering, caching, and lifecycle

**Files:**
- Modify: `server/services/maps/world-tile-service.js`
- Test: `tests/maps/world-tiles/tile-service.test.js`

**Interfaces:**
- Consumes: Task 2 helpers; `sharp`; `logError`/`logInfo` from `server/utils/logger.js`.
- Produces (exact exports, used by Tasks 5, 6):
  - `getWorldTile(worldId, z, x, y) → Promise<Buffer | null>` — `null` means outside grid / beyond max zoom (route sends 204); throws `Error` with `.status = 404`, `.code = 'no_base_map'` when no SVG is stored. NOT async-declared: registers in-flight dedupe synchronously.
  - `saveWorldSvg(worldId, stagedPath) → Promise<void>` — move staged file into place, evict memory cache, purge tile dir.
  - `removeWorldBaseMap(worldId) → Promise<void>` — best-effort delete of SVG + tile dir + memory eviction.
  - `evictWorldSvg(worldId) → void` — drop the in-memory SVG cache entry.
  - `_inflightCount() → number` — test hook for the dedupe map.
  - Env hook: `QUESTABLES_MAP_DATA_DIR` overrides the `map_data` root (tests only).

- [ ] **Step 1: Write the failing tests**

`tests/maps/world-tiles/tile-service.test.js`:

```js
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
    writeWorldSvg(WORLD_B, '<svg viewBox="0 0 64 64"><rect fill=');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/maps/world-tiles/tile-service.test.js`
Expected: FAIL — `getWorldTile` etc. are not exported.

- [ ] **Step 3: Implement rendering + caching**

Append to `server/services/maps/world-tile-service.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/maps/world-tiles/tile-service.test.js tests/maps/world-tiles/grid-math.test.js`
Expected: PASS. If the "malformed XML" transparent-tile test does NOT throw inside sharp (librsvg can be lenient), make the fixture more broken (e.g. truncate to `'<svg viewBox="0 0 64 64"><'`) rather than weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/world-tile-service.js tests/maps/world-tiles/tile-service.test.js
git commit -m "feat(maps): lazy world base-map tile rendering with disk cache and in-flight dedupe"
```

---

### Task 4: DB layer — world-scoped tileset upsert + filtered listing

**Files:**
- Modify: `server/services/maps/service.js` (`listTileSets` around line 547; export `isUuid` near line 22)
- Test: `tests/maps/world-tiles/tileset-db.test.js`

**Interfaces:**
- Consumes: migration 019 (`tile_sets.world_id`, partial unique index); `query` from `server/db/pool.js`; existing private `isUuid` in `service.js`.
- Produces (used by Tasks 5, 6):
  - `export const isUuid = (value) => …` (change the existing `const isUuid` to `export const isUuid`).
  - `listTileSets(worldId = null, q = query) → Promise<rows>` — no `worldId` = current behavior (all active rows) but now including a `world_id` column in the payload; with `worldId` = that world's scoped rows, plus legacy global rows only when the world has no scoped row.
  - `upsertWorldTileset({ worldId, maxZoom, uploadedBy }, q = query) → Promise<row>` — exactly one row per world; `base_url` is the full XYZ template `/api/maps/<worldId>/tiles/{z}/{x}/{y}.png`.
- NOTE (spec deviation, intentional): the spec writes `base_url='/api/maps/<worldId>/tiles'`, but `createQuestablesTileSource` feeds `base_url` directly to OL's XYZ `url`, which needs `{z}/{x}/{y}` placeholders. Storing the full template is what makes "no new layer code" true. `/api` is Vite-proxied in dev and same-origin in prod, so a relative URL works.

- [ ] **Step 1: Write the failing tests**

`tests/maps/world-tiles/tileset-db.test.js`:

```js
/** @jest-environment node */
import {
  describeWithDb,
  openTxClient,
  rollbackAndClose,
  seedWorld,
} from '../../maps/fmg-full-json/db-harness.js';
import { listTileSets, upsertWorldTileset } from '../../../server/services/maps/service.js';

describeWithDb('world-scoped tile_sets', () => {
  let client;
  let q;
  let worldA;
  let worldB;

  beforeEach(async () => {
    client = await openTxClient();
    // Adapter: the pool `query` helper takes (text, params, opts); a pg Client
    // only takes (text, params). Drop opts inside the transaction.
    q = (text, params) => client.query(text, params);
    worldA = await seedWorld(client, { name: 'Tileset world A' });
    worldB = await seedWorld(client, { name: 'Tileset world B' });
  });

  afterEach(async () => {
    await rollbackAndClose(client);
  });

  test('upsert inserts one Base map row with the spec fields', async () => {
    const row = await upsertWorldTileset({ worldId: worldA, maxZoom: 6, uploadedBy: null }, q);
    expect(row).toMatchObject({
      name: 'Base map',
      base_url: `/api/maps/${worldA}/tiles/{z}/{x}/{y}.png`,
      format: 'png',
      tile_size: 256,
      min_zoom: 0,
      max_zoom: 6,
      is_active: true,
      world_id: worldA,
    });
  });

  test('re-upsert keeps exactly one row per world and updates max_zoom', async () => {
    const first = await upsertWorldTileset({ worldId: worldA, maxZoom: 5, uploadedBy: null }, q);
    const second = await upsertWorldTileset({ worldId: worldA, maxZoom: 7, uploadedBy: null }, q);
    expect(second.id).toBe(first.id);
    expect(second.max_zoom).toBe(7);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM tile_sets WHERE world_id = $1`,
      [worldA],
    );
    expect(rows[0].n).toBe(1);
  });

  test('listTileSets(worldId): scoped row wins; legacy global only as fallback', async () => {
    // A legacy global tileset (world_id NULL), like snoopia's.
    await client.query(
      `INSERT INTO tile_sets (name, base_url, format, is_active)
       VALUES ('Legacy global', '/tiles/{z}/{x}/{y}.png', 'png', true)`,
    );
    await upsertWorldTileset({ worldId: worldA, maxZoom: 6, uploadedBy: null }, q);

    const scoped = await listTileSets(worldA, q);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].world_id).toBe(worldA);

    // worldB has no scoped tileset → sees the legacy global rows.
    const fallback = await listTileSets(worldB, q);
    expect(fallback.length).toBeGreaterThanOrEqual(1);
    expect(fallback.every((r) => r.world_id === null)).toBe(true);
    expect(fallback.some((r) => r.name === 'Legacy global')).toBe(true);
  });

  test('listTileSets() without worldId keeps current behavior and exposes world_id', async () => {
    await upsertWorldTileset({ worldId: worldA, maxZoom: 6, uploadedBy: null }, q);
    const all = await listTileSets(null, q);
    const mine = all.find((r) => r.world_id === worldA);
    expect(mine).toBeDefined();
    expect(mine.is_active).toBe(true);
  });

  test('inactive scoped row does not shadow the global fallback', async () => {
    await client.query(
      `INSERT INTO tile_sets (name, base_url, format, is_active)
       VALUES ('Legacy global', '/tiles/{z}/{x}/{y}.png', 'png', true)`,
    );
    await client.query(
      `INSERT INTO tile_sets (name, base_url, format, is_active, world_id)
       VALUES ('Base map', '/api/x/{z}/{x}/{y}.png', 'png', false, $1)`,
      [worldA],
    );
    const rows = await listTileSets(worldA, q);
    expect(rows.every((r) => r.world_id === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/maps/world-tiles/tileset-db.test.js`
Expected: FAIL — `upsertWorldTileset` is not exported; `listTileSets` rejects the new arguments / returns no `world_id`. (If Postgres is down the suite skips — start Postgres, these tests must actually run at least once.)

- [ ] **Step 3: Implement**

In `server/services/maps/service.js`:

(a) Export the existing helper (line ~22): change
`const isUuid = (value) => …` to `export const isUuid = (value) => …`.

(b) Replace `listTileSets` (line ~547) with:

```js
const TILE_SET_COLUMNS = `
            id,
            name,
            description,
            base_url,
            format,
            min_zoom,
            max_zoom,
            tile_size,
            attribution,
            uploaded_by,
            world_id,
            created_at,
            updated_at`;

export const listTileSets = async (worldId = null, q = query) => {
  if (worldId) {
    // The world's scoped tileset(s); legacy global rows (world_id IS NULL)
    // only when the world has no active scoped tileset — backward compat
    // for pre-019 worlds like snoopia.
    const { rows } = await q(
      `SELECT ${TILE_SET_COLUMNS}
         FROM tile_sets
        WHERE is_active = true
          AND (world_id = $1
               OR (world_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM tile_sets s
                      WHERE s.world_id = $1 AND s.is_active = true)))
        ORDER BY name ASC`,
      [worldId],
      { label: 'maps.tilesets.list_world' },
    );
    return rows;
  }

  const { rows } = await q(
    `SELECT ${TILE_SET_COLUMNS}
       FROM tile_sets
      WHERE is_active = true
      ORDER BY name ASC`,
    [],
    { label: 'maps.tilesets.list' },
  );
  return rows;
};

/**
 * Upsert the single world-scoped "Base map" tileset row. Conflict target is
 * the partial unique index from migration 019.
 */
export const upsertWorldTileset = async ({ worldId, maxZoom, uploadedBy = null }, q = query) => {
  const { rows } = await q(
    `INSERT INTO tile_sets (name, base_url, format, min_zoom, max_zoom, tile_size, is_active, world_id, uploaded_by)
     VALUES ('Base map', $2, 'png', 0, $3, 256, true, $1, $4)
     ON CONFLICT (world_id) WHERE world_id IS NOT NULL
     DO UPDATE SET base_url = EXCLUDED.base_url,
                   max_zoom = EXCLUDED.max_zoom,
                   is_active = true,
                   name = EXCLUDED.name,
                   uploaded_by = COALESCE(EXCLUDED.uploaded_by, tile_sets.uploaded_by)
     RETURNING *`,
    [worldId, `/api/maps/${worldId}/tiles/{z}/{x}/{y}.png`, maxZoom, uploadedBy],
    { label: 'maps.tilesets.upsert_world' },
  );
  return rows[0];
};
```

Check that no other callers of `listTileSets` pass arguments (currently only `server/routes/maps.routes.js` calls it with none — the default `worldId = null` keeps it compatible).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/maps/world-tiles/tileset-db.test.js`
Expected: PASS (5 tests, actually running against the DB, not skipped).

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/service.js tests/maps/world-tiles/tileset-db.test.js
git commit -m "feat(maps): world-scoped tileset upsert and worldId-filtered tileset listing"
```

---

### Task 5: Routes — tile endpoint + `?worldId=` on /tilesets

**Files:**
- Modify: `server/routes/maps.routes.js` (tilesets handler at line ~126; new tile route immediately AFTER the `/settlements/:burgId/tiles/:z/:x/:y.png` handler that ends around line 421)

**Interfaces:**
- Consumes: `getWorldTile` (Task 3), `listTileSets`, `isUuid` (Task 4).
- Produces: `GET /api/maps/:worldId/tiles/:z/:x/:y.png` — public, 200 PNG with immutable cache headers / 204 outside grid / 404 `no_base_map` / 400 bad params. `GET /api/maps/tilesets?worldId=<uuid>` — filtered listing.

- [ ] **Step 1: Wire imports**

At the top of `server/routes/maps.routes.js`, extend the existing import from `../services/maps/service.js` with `isUuid` (it already imports `listTileSets` among others), and add:

```js
import { getWorldTile } from '../services/maps/world-tile-service.js';
```

- [ ] **Step 2: Extend the tilesets handler**

Replace the `router.get('/tilesets', …)` handler (line ~126) with:

```js
router.get('/tilesets', async (req, res) => {
  const worldId = typeof req.query.worldId === 'string' && req.query.worldId ? req.query.worldId : null;
  if (worldId && !isUuid(worldId)) {
    return res.status(400).json({ error: 'invalid_world_id', message: 'worldId must be a UUID' });
  }
  try {
    const tileSets = await listTileSets(worldId);
    return res.json(tileSets);
  } catch (error) {
    logError('Tile set listing failed', error, { worldId });
    return res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Add the world tile route**

Insert AFTER the `/settlements/:burgId/tiles/:z/:x/:y.png` handler (order matters: `settlements` would otherwise match `:worldId`; keeping the literal-prefix route first preserves it):

```js
// World base-map tiles — public like settlement tiles; rendered lazily from
// the stored world SVG and disk-cached (see world-tile-service.js).
router.get('/:worldId/tiles/:z/:x/:y.png', async (req, res) => {
  const { worldId } = req.params;
  // worldId feeds a filesystem path — reject anything that is not a UUID.
  if (!isUuid(worldId)) {
    return res.status(400).json({ error: 'invalid_world_id', message: 'worldId must be a UUID' });
  }
  const z = parseInt(req.params.z, 10);
  const x = parseInt(req.params.x, 10);
  const y = parseInt(req.params.y, 10);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || x < 0 || y < 0) {
    return res.status(400).json({ error: 'invalid_tile_coords', message: 'z, x, y must be non-negative integers' });
  }

  try {
    const png = await getWorldTile(worldId, z, x, y);
    if (!png) {
      return res.status(204).send();
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(png);
  } catch (error) {
    if (error.code !== 'no_base_map') {
      logError('World tile fetch failed', error, { worldId, z, x, y });
    }
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'world_tile_failed', message: error.message });
  }
});
```

- [ ] **Step 4: Verify — run server test suites and a live smoke check**

Run: `npm test -- tests/maps/world-tiles/`
Expected: PASS (no regressions in the service the route wraps).

Then start the API (`npm run db:dev` in one shell, or use an already-running dev server) and:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/maps/00000000-0000-4000-8000-000000000000/tiles/0/0/0.png   # expect 404 (no_base_map)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/maps/not-a-uuid/tiles/0/0/0.png                            # expect 400
curl -s 'http://localhost:3001/api/maps/tilesets?worldId=not-a-uuid' -o /dev/null -w '%{http_code}\n'                          # expect 400
curl -s 'http://localhost:3001/api/maps/tilesets' | head -c 200                                                                # expect JSON array
```

(Adjust the port to the dev server's actual port — check `server/database-server.js` / env if 3001 is wrong.)

- [ ] **Step 5: Commit**

```bash
git add server/routes/maps.routes.js
git commit -m "feat(maps): public lazy world tile endpoint and worldId-filtered tileset listing"
```

---

### Task 6: Upload & delete lifecycle

**Files:**
- Modify: `server/routes/uploads.routes.js` (SVG attach route at line ~278; world delete route at line ~229)

**Interfaces:**
- Consumes: `saveWorldSvg`, `removeWorldBaseMap`, `computeMaxZoom` (Tasks 2–3); `upsertWorldTileset`, `isUuid` (Task 4); existing `uploadSvg` multer (415 on bad mimetype, 50MB limit — untouched).
- Produces: `POST /api/upload/map/:worldId/svg` → `{ tileset: <row> }` (or 404 `world_not_found`, 422 `world_missing_dimensions`, 400 `invalid_world_id`). `DELETE /api/upload/map/:worldId` additionally removes `map_data/world-svg/<worldId>.svg` and `map_data/world-tiles/<worldId>/`. `maps_world.geojson_url` is no longer written.

- [ ] **Step 1: Add imports**

At the top of `server/routes/uploads.routes.js` add:

```js
import { saveWorldSvg, removeWorldBaseMap, computeMaxZoom } from '../services/maps/world-tile-service.js';
import { upsertWorldTileset, isUuid } from '../services/maps/service.js';
```

- [ ] **Step 2: Rewrite the SVG attach route**

Replace the whole `router.post('/upload/map/:worldId/svg', …)` handler (line ~278) with:

```js
  // --- FMG Full JSON import: attach the world's base-map SVG ---
  // Persists the SVG under map_data/world-svg/, purges any cached tiles, and
  // upserts the world's single "Base map" tile_sets row. Replacement is the
  // same call. Tiles render lazily via GET /api/maps/:worldId/tiles/....
  router.post('/upload/map/:worldId/svg', requireAuth, uploadSvg.single('svgFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'svgFile is required' });
    const { worldId } = req.params;
    try {
      // worldId feeds a filesystem path — reject anything that is not a UUID.
      if (!isUuid(worldId)) {
        return res.status(400).json({ error: 'invalid_world_id', message: 'worldId must be a UUID' });
      }
      const { query } = await import('../db/pool.js');
      const { rows } = await query(
        `SELECT id, width_pixels, height_pixels FROM public.maps_world WHERE id = $1`,
        [worldId],
        { label: 'fmg.svg.attach.world' },
      );
      if (rows.length === 0) return res.status(404).json({ error: 'world_not_found' });

      const maxZoom = computeMaxZoom(rows[0].width_pixels, rows[0].height_pixels);
      if (maxZoom == null) {
        return res.status(422).json({
          error: 'world_missing_dimensions',
          message: 'World has no width_pixels/height_pixels; re-import the Full JSON before attaching an SVG.',
        });
      }

      await saveWorldSvg(worldId, req.file.path);
      const tileset = await upsertWorldTileset({ worldId, maxZoom, uploadedBy: req.user?.id ?? null });

      logInfo('World base map SVG attached', {
        telemetryEvent: 'upload.map.svg_attach',
        worldId,
        userId: req.user?.id,
        maxZoom,
      });
      return res.json({ tileset });
    } catch (err) {
      logError('SVG attach failed', err, { worldId, filename: req.file?.filename });
      return res.status(500).json({ error: err.message });
    } finally {
      // saveWorldSvg moves the staged file on success; this only cleans up
      // the staged copy on the failure paths.
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    }
  });
```

Note what disappeared: the `UPDATE maps_world SET geojson_url = …` write. The world-scoped `tile_sets` row is now the sole indicator that a world has a base map. Do NOT add anything else that writes `geojson_url`.

- [ ] **Step 3: Extend the world delete route**

In `router.delete('/upload/map/:worldId', …)` (line ~229), after the `DELETE FROM public.maps_world` query succeeds and before `logInfo('World deleted', …)`, add:

```js
      // Base-map artifacts on disk (tile_sets row dies via FK cascade).
      await removeWorldBaseMap(req.params.worldId);
```

Also guard the top of the handler (before the first `query` call) with:

```js
      if (!isUuid(req.params.worldId)) {
        return res.status(400).json({ error: 'invalid_world_id', message: 'worldId must be a UUID' });
      }
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/maps/` (full maps suite — catches import errors in route files only if something imports them; the real check is next)

Run: `node --input-type=module -e "await import('./server/routes/uploads.routes.js'); console.log('uploads.routes ok'); await import('./server/routes/maps.routes.js'); console.log('maps.routes ok');"` from the `server/` directory... — if bare `node -e` import fails on missing env/config, instead just restart the dev server (`npm run db:dev`) and confirm it boots without import errors.

Live smoke (dev server running, replace `<worldId>` with a real world id from `psql -U barrulus -d questables -c "SELECT id, name, width_pixels FROM maps_world"` and use a real session/token the way the wizard does — or simply defer the authed-POST check to the Task 10 browser pass):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/api/upload/map/not-a-uuid/svg   # expect 401 (no auth) — auth runs first; the 400 path is exercised in the browser pass
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/uploads.routes.js
git commit -m "feat(upload): persist world base-map SVG, upsert scoped tileset, clean up on world delete"
```

---

### Task 7: Frontend API + data loader — worldId-aware tilesets

**Files:**
- Modify: `utils/api/maps.ts` (`listTileSets` at line ~136)
- Modify: `components/map-data-loader.tsx` (`tileSetCache` field at line 32, `loadTileSets` at line ~405)

**Interfaces:**
- Consumes: `GET /api/maps/tilesets?worldId=` (Task 5).
- Produces (used by Tasks 8, 9):
  - `listTileSets(worldId?: string, options?: ApiRequestOptions) → Promise<Record<string, unknown>[]>` (signature change — the old first param `options` moves to second; `map-data-loader.tsx` is the only caller, verify with grep).
  - `MapDataLoader.loadTileSets(worldId?: string) → Promise<Record<string, unknown>[]>` — cached per worldId (`''` key = unscoped).
  - `MapDataLoader.clearTileSetCache(): void` — invalidation hook for post-upload refresh.

- [ ] **Step 1: Update `utils/api/maps.ts`**

Replace `listTileSets` (line ~136) with:

```ts
export async function listTileSets(
  worldId?: string,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>[]> {
  const suffix = worldId ? `?worldId=${encodeURIComponent(worldId)}` : '';
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/maps/tilesets${suffix}`,
    { method: 'GET', signal: options.signal },
    'Failed to load tile sets',
  );

  return data ?? [];
}
```

Run `grep -rn "listTileSets(" utils/ components/ --include='*.ts*'` — the only call sites must be this definition and `map-data-loader.tsx`. If any other caller passes an options object as the first argument, update it.

- [ ] **Step 2: Update `components/map-data-loader.tsx`**

Change the cache field (line 32) from

```ts
  private tileSetCache: Record<string, unknown>[] | null = null;
```

to

```ts
  private tileSetCache = new Map<string, Record<string, unknown>[]>();
```

and replace `loadTileSets` (line ~405) with:

```ts
  async loadTileSets(worldId?: string): Promise<Record<string, unknown>[]> {
    const key = worldId ?? '';
    const cached = this.tileSetCache.get(key);
    if (cached) {
      return cached;
    }

    const tileSets = await listTileSets(worldId);
    this.tileSetCache.set(key, tileSets || []);
    return this.tileSetCache.get(key)!;
  }

  /** Drop cached tileset lists — call after a base-map upload so the next
   *  fetch sees the new/updated world-scoped row. */
  clearTileSetCache(): void {
    this.tileSetCache.clear();
  }
```

Search the file for any other reference to `tileSetCache` (e.g. a reset/clear method) and convert it to the Map API.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: clean (or only pre-existing errors — confirm against `git stash && npx tsc --noEmit` if unsure, then unstash).

- [ ] **Step 4: Commit**

```bash
git add utils/api/maps.ts components/map-data-loader.tsx
git commit -m "feat(map): worldId-aware tileset fetching with per-world cache"
```

---

### Task 8: openlayers-map — fetch tilesets per selected world

**Files:**
- Modify: `components/openlayers-map.tsx` (`loadInitialData` at line ~917; new effect near the tileset effects at line ~1797)

**Interfaces:**
- Consumes: `mapDataLoader.loadTileSets(worldId)` (Task 7).
- Produces: `tileSets` state always reflects the selected world's scoped rows (with legacy-global fallback handled server-side). No behavior change for worlds with no tileset: base layer source stays null, vector layers over blank background, and the old "No active tile sets" error toast is removed (an empty list is now a legitimate state, not a config error).

- [ ] **Step 1: Extract a row normalizer and de-tileset `loadInitialData`**

In `components/openlayers-map.tsx`, above the component (near other module-level helpers) add, reusing the existing `TileSetConfig` import:

```ts
const normalizeTileSetRows = (rows: Record<string, unknown>[]): TileSetConfig[] =>
  (rows || [])
    .filter((ts) => ts && ts.id && typeof ts.base_url === 'string')
    .map((ts) => ({
      id: String(ts.id),
      name: typeof ts.name === 'string' && ts.name.trim() ? ts.name : String(ts.id),
      base_url: String(ts.base_url),
      attribution: typeof ts.attribution === 'string' ? ts.attribution : undefined,
      min_zoom: typeof ts.min_zoom === 'number' && Number.isFinite(ts.min_zoom) ? ts.min_zoom : undefined,
      max_zoom: typeof ts.max_zoom === 'number' && Number.isFinite(ts.max_zoom) ? ts.max_zoom : undefined,
      tile_size: typeof ts.tile_size === 'number' && Number.isFinite(ts.tile_size) ? ts.tile_size : undefined,
      wrapX: Boolean(ts.wrapX),
    }));
```

Then edit `loadInitialData` (line ~917):
- Change the parallel fetch to worlds only: `const worldMapsData = await mapDataLoader.loadWorldMaps();` (drop `loadTileSets` from the `Promise.all`).
- Delete the `dbTileSets` mapping block and `setTileSets(dbTileSets)` (lines ~944–957).
- Delete the trailing `if (dbTileSets.length === 0) { … toast.error('No active tile sets are configured in the database.'); }` block (lines ~968–975) — clearing selection/source on an empty list is already handled by the effects at lines ~1797 and ~1816.
- Keep the world normalization + `setSelectedWorldMap`/`updateViewExtent` logic unchanged.

- [ ] **Step 2: Add the world-scoped tileset fetch effect**

Next to the tileset effects (immediately before the effect at line ~1797) add:

```ts
  // Fetch the tileset list for the selected world. The server returns the
  // world's scoped "Base map" row, or legacy global rows for pre-scoped
  // worlds; an empty list = no base map (vector layers over blank bg).
  useEffect(() => {
    if (!selectedWorldMap) {
      setTileSets([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await mapDataLoader.loadTileSets(selectedWorldMap);
        if (!cancelled) setTileSets(normalizeTileSetRows(rows));
      } catch {
        if (!cancelled) setTileSets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorldMap]);
```

The existing effects already complete the chain: empty `tileSets` → `selectedTileSetId` cleared (line ~1797) → `updateTileSource(null)` clears the base layer (line ~1816); non-empty → first tileset auto-selected.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: clean. If `toast` or other imports become unused, remove them only if actually unused elsewhere in the file (toast is used elsewhere — check before deleting the import).

- [ ] **Step 4: Commit**

```bash
git add components/openlayers-map.tsx
git commit -m "feat(map): load tilesets scoped to the selected world"
```

---

### Task 9: Wizard copy + "Add/Replace base map" on the Maps tab

**Files:**
- Modify: `components/map-upload-wizard/svg-attach-step.tsx`
- Create: `components/map-upload-wizard/base-map-button.tsx`
- Modify: `components/map-upload-wizard/map-list.tsx`

**Interfaces:**
- Consumes: `POST /api/upload/map/:worldId/svg` → `{ tileset }` (Task 6); `GET /api/maps/tilesets` rows now carrying `world_id` (Task 4); `mapDataLoader.clearTileSetCache()` (Task 7); `useAsync`'s `retry()` (`hooks/useAsync.ts`).
- Produces: `BaseMapButton({ worldId: string; hasBaseMap: boolean; onUploaded: () => void })` — file picker + POST + inline error; world cards show "Add base map" / "Replace base map".

- [ ] **Step 1: Update the wizard step copy + cache invalidation**

In `components/map-upload-wizard/svg-attach-step.tsx`:

Add the import:

```ts
import { mapDataLoader } from "../map-data-loader";
```

In `handleSubmit`, right before `onComplete();` add:

```ts
      mapDataLoader.clearTileSetCache();
```

Replace the description paragraph (lines 43–46) with:

```tsx
          <p className="text-sm text-muted-foreground">
            Export the SVG canvas from FMG. Used as the rendered base map —
            tiles are generated on demand as you view the map.
            You can skip this and add it later from the Maps tab.
          </p>
```

- [ ] **Step 2: Create `BaseMapButton`**

`components/map-upload-wizard/base-map-button.tsx`:

```tsx
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { apiFetch } from "../../utils/api-client";
import { mapDataLoader } from "../map-data-loader";

interface BaseMapButtonProps {
  worldId: string;
  hasBaseMap: boolean;
  onUploaded: () => void;
}

/**
 * "Add base map" / "Replace base map" action on a world card. POSTs the
 * picked SVG to the same route as the wizard's SvgAttachStep; the server
 * upserts the world's tileset row and purges stale tiles.
 */
export function BaseMapButton({ worldId, hasBaseMap, onUploaded }: BaseMapButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("svgFile", file);
      const res = await apiFetch(`/api/upload/map/${worldId}/svg`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.message || body.error || `Upload failed: ${res.status}`);
      }
      mapDataLoader.clearTileSetCache();
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading…" : hasBaseMap ? "Replace base map" : "Add base map"}
      </Button>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `MapList`**

In `components/map-upload-wizard/map-list.tsx`:

Add imports:

```ts
import { BaseMapButton } from "./base-map-button";
```

Extend the loader to also fetch tilesets (replace the existing `useAsync` block, lines 23–28):

```ts
  const { data, loading, error, retry } = useAsync<{ maps: WorldMap[]; baseMapWorldIds: Set<string> }>(
    async () => {
      const [mapsRes, tileSetsRes] = await Promise.all([
        apiFetch("/api/maps/world"),
        apiFetch("/api/maps/tilesets"),
      ]);
      if (!mapsRes.ok) throw new Error("Failed to load maps");
      const maps = await readJsonBody<WorldMap[]>(mapsRes);
      let baseMapWorldIds = new Set<string>();
      if (tileSetsRes.ok) {
        const tileSets = await readJsonBody<Array<{ world_id?: string | null }>>(tileSetsRes);
        baseMapWorldIds = new Set(
          (tileSets ?? [])
            .map((ts) => ts.world_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        );
      }
      return { maps, baseMapWorldIds };
    },
    [],
  );
  const maps = data?.maps ?? [];
  const baseMapWorldIds = data?.baseMapWorldIds ?? new Set<string>();
```

In the card render, after the `CardContent` metadata lines (after the `uploaded_by_username` block, line ~90), add:

```tsx
                <div className="pt-2">
                  <BaseMapButton
                    worldId={map.id}
                    hasBaseMap={baseMapWorldIds.has(map.id)}
                    onUploaded={retry}
                  />
                </div>
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/map-upload-wizard/svg-attach-step.tsx components/map-upload-wizard/base-map-button.tsx components/map-upload-wizard/map-list.tsx
git commit -m "feat(map): add/replace base map from the Maps tab; honest wizard SVG copy"
```

---

### Task 10: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full automated pass**

Run: `npm test -- tests/maps/` and `npx tsc --noEmit`
Expected: all green (DB-gated suites RUNNING, not skipped — Postgres up).

- [ ] **Step 2: Live tile smoke test**

With the dev stack running (`npm run dev:local`) and a world that has a base map (upload one via the wizard step or the Maps tab button if none exists yet):

```bash
WORLD=$(psql -U barrulus -d questables -tAc "SELECT world_id FROM tile_sets WHERE world_id IS NOT NULL LIMIT 1")
curl -s -o /tmp/t0.png -w '%{http_code} %{content_type}\n' "http://localhost:3001/api/maps/$WORLD/tiles/0/0/0.png"   # expect 200 image/png
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3001/api/maps/$WORLD/tiles/0/5/0.png"                    # expect 204 (outside grid)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3001/api/maps/$WORLD/tiles/99/0/0.png"                   # expect 204 (beyond max zoom)
ls server/map_data/world-tiles/$WORLD/0/0/   # expect 0.png (disk cache)
psql -U barrulus -d questables -c "SELECT name, base_url, max_zoom, world_id FROM tile_sets WHERE world_id = '$WORLD'"
```

- [ ] **Step 3: Manual browser checklist (from the spec — requires the Campaign Director in the loop; report results, don't skip)**

1. Upload an SVG to Jolliariana through the wizard's SVG step → wizard shows success; `tile_sets` gains one row scoped to the world with the computed `max_zoom` (6 for 2133×1103).
2. Open the world map → base map tiles appear lazily under the vector layers; the tileset dropdown shows only "Base map" for this world (no snoopia tilesets).
3. Switch to snoopia (no scoped tileset) → legacy global tilesets still appear (backward-compat fallback).
4. Replace the SVG from the Maps tab card ("Replace base map") → `server/map_data/world-tiles/<worldId>/` was purged, new tiles render on next view.
5. A world with no base map renders vector layers over a blank background with no error toast.
6. Delete a scratch world → its `tile_sets` row is gone (cascade) and `server/map_data/world-svg/<id>.svg` + `world-tiles/<id>/` are removed.

- [ ] **Step 4: Wrap up**

Use the superpowers:finishing-a-development-branch skill to decide on merge/push (note: repo work may be on `main` directly — follow the user's call).

---

## Self-review notes (spec → task mapping)

- Migration 019 + schema.sql + rollback → Task 1.
- Storage paths, LRU(2), grid math, sharp raster, disk cache, immutable headers, transparent-tile fallback, in-flight dedupe, 204/404 semantics → Tasks 2–3, route glue Task 5.
- Zoom rule (`+2`, 204 beyond max, OL upscales) → `computeMaxZoom` (Task 2), `z > maxZoom → null` (Task 3), `max_zoom` in upsert (Tasks 4, 6).
- Upload/replace flow (validate world, move, purge, upsert, `{tileset}` response), wizard copy, add-it-later card action → Tasks 6, 9.
- `?worldId=` listing with legacy-global fallback → Tasks 4, 5; frontend consumption + re-fetch on world change + Maps-tab-triggered refresh (via `clearTileSetCache` + `retry`) → Tasks 7–9.
- Lifecycle (world delete cleanup; invalidation only on replace/delete) → Tasks 3, 6.
- Error table: 404 no_base_map / 204 outside grid / transparent on sharp failure / 404 missing world / 415 + 413 via existing multer → Tasks 3, 5, 6 (415/413 untouched, verified existing).
- Known deviations from the spec text, both intentional and documented inline: (1) `base_url` stores the full `{z}/{x}/{y}.png` template (required by the existing XYZ layer code — spec's own "no new layer code" clause); (2) grid math follows the OL TileGrid (`ceil` rows) rather than the legacy script's `round`, per the spec's "align with the OL view" requirement; (3) added 400 `invalid_world_id` and 422 `world_missing_dimensions` guards not in the spec's error table (path-traversal safety and honest failure for dimensionless worlds).
