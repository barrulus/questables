# Lazy World Base-Map Tiles — Design

**Date:** 2026-08-09
**Status:** Approved (brainstormed with CD 2026-08-09)
**Prerequisite:** FMG Full JSON Import Plans A + B (merged to main 2026-08-09)

## Problem

Worlds imported through the Full JSON wizard have no rendered base map: the
polity/terrain vector layers float over a blank background. The legacy path
required running `utils/tile-svg.mjs` by hand for every style export and
committing/serving the output as static files — nothing a Campaign Director
can do from the app.

Two adjacent defects fold into this work:

1. `POST /api/upload/map/:worldId/svg` currently stores the uploaded file's
   path in `maps_world.geojson_url`, then deletes the file — the wizard's SVG
   step is a no-op.
2. `tile_sets` has no world linkage, so every world's tileset dropdown shows
   every tileset (Jolliariana offers snoopia's "Provinces").

## Decision summary

- **One SVG = one base map per world.** Multiple styled tilesets per world are
  explicitly out of scope; the six polity vector layers (Plan B) replace the
  old states/provinces/religions tileset workaround.
- **Fully lazy rendering** (option A of three considered): tiles are
  rasterized from the stored SVG on first request and disk-cached. No
  pre-generation job. This mirrors the proven settlement-tile pipeline
  (`getSettlementTile` in `server/services/maps/settlement-service.js`).

## Architecture

### Storage & data model

- Uploaded SVG persists at `server/map_data/world-svg/<worldId>.svg`
  (sibling of the existing `map_data/settlements` cache; NOT under the
  publicly served `/uploads` static root). One file per world; replacement
  overwrites.
- Tile disk cache at `server/map_data/world-tiles/<worldId>/<z>/<x>/<y>.png`.
- **Migration 019**: `ALTER TABLE tile_sets ADD COLUMN world_id UUID
  REFERENCES public.maps_world(id) ON DELETE CASCADE` (nullable) + a partial
  unique index `ON tile_sets(world_id) WHERE world_id IS NOT NULL` (one base
  map per world; also what the upsert's `ON CONFLICT` targets). Legacy rows
  stay `NULL` (= global). Rollback file drops both. `database/schema.sql`
  updated to match.
- On SVG upload, upsert exactly one `tile_sets` row per world:
  `name='Base map'`, `base_url='/api/maps/<worldId>/tiles'`, `format='png'`,
  `tile_size=256`, `min_zoom=0`, `max_zoom` per the zoom rule below,
  `is_active=true`, `world_id=<worldId>`.
- `maps_world.geojson_url` is no longer written by the SVG route. The
  world-scoped `tile_sets` row is the sole indicator that a world has a base
  map.

### Tile endpoint

`GET /api/maps/:worldId/tiles/:z/:x/:y.png` — public (no auth), like
settlement tiles. Backed by a new `server/services/maps/world-tile-service.js`
mirroring `getSettlementTile`:

1. Validate `z/x/y` are non-negative integers inside the grid; outside the
   grid or beyond max zoom → `204`.
2. Disk-cache hit → serve.
3. Miss → load the world SVG (per-world in-memory LRU, capacity 2, holding
   the SVG string + parsed dimensions), crop to the tile's viewBox using the
   **same square-padded-extent grid math as `utils/tile-svg.mjs`** so tiles
   align with the OL view and legacy tilesets.
4. Rasterize 256×256 via sharp (`fit: 'fill'`, png compression 9).
5. Write cache (mkdir -p, best effort), serve with
   `Cache-Control: public, max-age=31536000, immutable`.
6. Rasterization error → transparent 256×256 tile (map never breaks);
   missing SVG → `404 {error:'no_base_map'}`.
7. In-flight dedupe: module-level `Map<tileKey, Promise<Buffer>>` so
   concurrent requests for one uncached tile render once; entry removed when
   settled.

**Zoom rule:** `max_zoom = ceil(log2(max(width_pixels, height_pixels) / 256)) + 2`.
The +2 over native resolution stays crisp because the source is vector.
Requests deeper than `max_zoom` return 204 and OL upscales (same UX as the
settlement viewer's `EXTRA_ZOOM` ceiling). Example: Jolliariana (2133×1103)
→ max_zoom 6; worst-case full cache ~5.5k tiles / tens of MB, and lazy means
reality is a fraction of that.

### Upload & replace flow

`POST /api/upload/map/:worldId/svg` (existing route, existing `uploadSvg`
multer + auth) becomes real:

1. Validate the world exists (404 otherwise).
2. Move staged file to `map_data/world-svg/<worldId>.svg` (overwrite).
3. Purge `map_data/world-tiles/<worldId>/` (best-effort recursive rm).
4. Upsert the world's `tile_sets` row (computing `max_zoom` from
   `maps_world.width_pixels/height_pixels`).
5. Return `{ tileset: <row> }`.

Replacement is the same call. The wizard's `SvgAttachStep` already POSTs
here; its copy gains one honest line: "Used as the rendered base map — tiles
are generated on demand as you view the map."

**Add-it-later**: the Maps tab world card gets a small "Add base map" /
"Replace base map" action (per whether the world has a scoped tileset) that
opens a file picker and POSTs to the same route, reusing `SvgAttachStep`'s
form logic in a lightweight component.

### Frontend

- `GET /api/maps/tilesets` gains optional `?worldId=`: returns that world's
  scoped rows, plus legacy global (`world_id IS NULL`) rows **only when the
  world has no scoped tileset** (backward compat for snoopia). No param =
  current behavior.
- `openlayers-map.tsx` fetches the tileset list with the selected world's id
  (re-fetch on world change; the Maps tab triggers a refresh after SVG
  upload). `base_url` feeds the existing XYZ template unchanged — no new
  layer code.
- A world with no tileset renders exactly as today (vector layers over blank
  background).

### Lifecycle

- **World delete** (`DELETE /api/upload/map/:worldId`): tile_sets row dies by
  FK cascade; route additionally best-effort removes
  `map_data/world-svg/<worldId>.svg` and `map_data/world-tiles/<worldId>/`
  (same pattern as the staged-upload unlink).
- **Cache invalidation** happens only on SVG replace and world delete —
  consistent with the immutable cache headers.

## Error handling summary

| Case | Behavior |
|---|---|
| Tile request, no SVG stored | 404 `no_base_map` |
| Tile outside grid / beyond max_zoom | 204 |
| sharp rasterization failure | transparent tile, logged |
| SVG upload for missing world | 404 |
| Non-SVG upload | 415 (existing multer filter) |
| Oversize upload | 413 (existing 50MB SVG limit — FMG SVG canvases are well under) |

## Testing

- Unit: grid/viewBox cropping math cross-checked against known
  `utils/tile-svg.mjs` outputs for the same inputs; cache hit/miss, in-flight
  dedupe, 204/404/transparent-tile paths with a tiny fixture SVG.
- DB-gated: tileset upsert (insert then replace keeps one row, max_zoom
  computed), `?worldId=` filter semantics including legacy-global fallback.
- Manual browser pass: upload SVG to Jolliariana through the wizard step,
  confirm tiles appear lazily, replace the SVG, confirm cache purge, delete a
  scratch world, confirm file/dir cleanup.

## Out of scope

- Multiple named tilesets per world (obsoleted by Plan B vector layers).
- Pre-generation/warmup jobs and progress UI.
- Retiring the legacy global tilesets or migrating snoopia's static tiles.
- Any raster fallback for worlds without an SVG.
- rucio nginx `client_max_body_size` (deployment config, tracked separately).
