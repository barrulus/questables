# FMG Full JSON Import — Plan A: Backend Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-layer GeoJSON wizard with a single Full JSON ingest backend that imports everything FMG exports (~13 new tables + enrichments) into Postgres in one transaction, behind an async job-polling API.

**Architecture:** New `server/services/maps/fmg-full-json/` module: streaming JSON parser → server-side polygon derivation from `pack.cells[].v[]` + `pack.vertices[].p[]` → per-entity ingesters dispatched in FK order under one `withTransaction` → `import_jobs` row tracks per-stage progress. HTTP layer returns 202 + jobId; in-process `setImmediate` worker runs the ingest; client polls. Settlemaker auto-trigger stays as-is.

**Tech Stack:** Node.js + Express, PostgreSQL/PostGIS (`SRID 0` pixel-space), `pg` (already in `server/db/pool.js`), `stream-json` (new dep) for streaming parse, Jest for tests.

**Spec:** [`docs/superpowers/specs/2026-05-22-fmg-full-json-import-design.md`](../specs/2026-05-22-fmg-full-json-import-design.md)

**Companion plan:** Plan B (frontend + cleanup + new layers) — `docs/superpowers/plans/2026-05-23-fmg-full-json-import-plan-b-frontend.md`

---

## File structure

**New files (server):**

```
server/services/maps/fmg-full-json/
  index.js                  // ingestFullJson(worldId, jsonPath, onProgress)
  parser.js                 // stream-json wrapper → { info, settings, mapCoordinates, biomesData, pack, notes }
  geometry-builder.js       // (cells, vertices) → WKT polygon strings
  validators.js             // pre-transaction schema sanity checks
  job-runner.js             // in-process setImmediate queue + import_jobs writes
  ingesters/
    world.js
    biomes.js
    features.js
    cultures.js
    religions.js
    cells.js
    states.js
    provinces.js
    burgs.js
    rivers.js
    routes.js
    markers.js
    regiments.js
    campaigns.js
    diplomacy.js
    coats.js
    zones.js
    notes.js
```

**New SQL migrations (`database/migrations/`):**

- `016_fmg_full_json_schema.sql` (+ `.rollback.sql`)

**Modified server files:**

- `server/routes/uploads.routes.js` — add full-json endpoint, jobs endpoint, DELETE endpoint; modify SVG endpoint signature.
- `server/services/maps/ingestion-service.js` — keep `createOrUpdateWorld()` and `ingestBurgEntrancesForWorldIfReady()`; everything else (`ingestLayer`, `INGESTERS`, per-layer ingesters) becomes unused by the new flow but stays in place until Plan B deletes it.
- `server/package.json` — add `stream-json` dep.

**New test files:**

- `tests/maps/fmg-full-json/geometry-builder.test.js`
- `tests/maps/fmg-full-json/validators.test.js`
- `tests/maps/fmg-full-json/parser.test.js`
- `tests/maps/fmg-full-json/ingester-shape.test.js` (per-ingester SQL shape against a tiny synthetic fixture)
- `tests/maps/fmg-full-json/e2e-jolliariana.test.js` (skipped by default; requires DB + fixture)

**Fixtures:**

- `tests/fixtures/fmg-full-json/tiny.json` — hand-crafted minimal fixture (3 cells, 6 vertices, 1 state, 1 burg, 1 culture, 1 religion, 1 feature, 1 zone, 1 regiment, 1 campaign, 1 note, 1 river, 1 route, 1 marker, 1 biome).
- The real fixture lives at the repo root: `Jolliariana Full 2026-05-22-20-48.json` (70 MB, gitignored — already present in working tree).

---

## Conventions used in this plan

- All new tables are SRID 0 pixel-space and keyed by `(world_id, <fmg_id>)` UNIQUE for upsert idempotency.
- All ingester functions take `(client, worldId, parsed, log)` where `client` is a `pg` client in an open transaction, `parsed` is the relevant entity array from the FMG file, and `log` is a stage-progress callback `(percent, message) => void`.
- All SQL writes use parametrised queries; bulk inserts use `pg-copy-streams` for `maps_cells` (already a server dep — verify in T2) or `UNNEST` for medium-sized arrays.
- Commit cadence: one commit per task unless a task explicitly says otherwise. Commit message style follows the existing repo convention (see `git log --oneline -20`): `feat(maps): ...`, `feat(db): ...`, `test(maps): ...`.
- Tests use Jest. New tests live under `tests/maps/fmg-full-json/`. The project requires `--experimental-vm-modules` for ESM, so always run with `npm test -- tests/maps/fmg-full-json/<file>.test.js` (NOT `npx jest <path>` — that route fails with "Cannot use import statement outside a module").
- Type-check with `npx tsc --noEmit` (per memory).

---

## Production schema reality (read before any ingester task)

The pre-cutover `maps_*` tables have a few quirks that the spec did not anticipate. Every ingester targeting an existing table must respect these. **Confirmed by `\d` against the live DB on 2026-05-23.**

- **`maps_burgs`** column names: `xpixel`, `ypixel` (NOT `x_px`/`y_px`). `state`, `province`, `culture`, `religion` columns are **TEXT name strings** (not integer FK ids). `capital`, `port`, `citadel`, `walls`, `plaza`, `temple`, `shanty` are **BOOLEAN** (FMG ships these as numbers — cast). `population` is **INTEGER** (FMG ships float — `Math.round`). `elevation` is **INTEGER** (round). `geom` is `geometry(Point)` (no SRID constraint).
- **`maps_cells.type`** is **TEXT** (FMG `c.t` is an integer — pg auto-binds int→text but if a pg coercion error appears, `String(c.t)`). `geom` is `geometry(MultiPolygon)` — the per-cell polygon WKT must be wrapped with `ST_Multi(ST_GeomFromText(wkt, 0))` to coerce a single POLYGON to a MULTIPOLYGON before insert.
- **`maps_rivers.geom`** is `geometry(MultiLineString)` — wrap LineString WKT with `ST_Multi(...)`.
- **`maps_routes.geom`** is `geometry(MultiLineString)` — wrap LineString WKT with `ST_Multi(...)`.
- **`maps_markers`** is fine as-spec (`x_px`/`y_px` already match, `geom geometry(Point)`).
- The legacy text columns on `maps_burgs` (`statefull`, `provincefull`, `temperaturelikeness`, `populationraw`, `xworld`, `yworld`, `settlement_generation_version`, `temperature`) all allow NULL — leave them NULL from this ingest, they're remnants of the old GeoJSON ingester.

The text-name lookups for `maps_burgs.state` / `.province` / `.culture` / `.religion`: resolve from `parsed.pack.states[id]?.name` etc. The order of stages already places states/provinces/cultures/religions BEFORE burgs in the orchestrator (Task 27), so by the time burgs run, the parsed entity arrays are in scope on the `parsed` object — read names directly from `parsed.pack.states[b.state]?.name`, not from a DB SELECT.

---

### Task 1: Schema migration — new tables + ALTERs

**Files:**
- Create: `database/migrations/016_fmg_full_json_schema.sql`
- Create: `database/migrations/016_fmg_full_json_schema.rollback.sql`

Adds the 13 new tables, ALTERs existing `maps_*` tables, migrates existing `maps_burgs.emblem` JSONB into `maps_coats_of_arms`, then drops the emblem column. Idempotent (uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

- [ ] **Step 1: Write the up-migration**

Write to `database/migrations/016_fmg_full_json_schema.sql`:

```sql
-- 016_fmg_full_json_schema.sql
-- Adds full FMG ingest schema: states, provinces, cultures, religions,
-- features, zones, regiments, campaigns, diplomacy, coats-of-arms,
-- biomes, notes, import_jobs. ALTERs maps_burgs/cells/rivers/routes/world
-- with new columns. Migrates existing maps_burgs.emblem JSONB into
-- maps_coats_of_arms and drops the emblem column.
--
-- Idempotent: safe to re-apply.

BEGIN;

-- =====================================================================
-- Polygon-bearing tables (geometry built from cells+vertices at ingest)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_states (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  state_id INTEGER NOT NULL,
  name TEXT,
  full_name TEXT,
  form TEXT,
  form_name TEXT,
  color TEXT,
  type TEXT,
  culture INTEGER,
  religion INTEGER,
  capital_burg_id INTEGER,
  expansionism NUMERIC,
  urban NUMERIC,
  rural NUMERIC,
  area NUMERIC,
  neighbors INTEGER[],
  center_x DOUBLE PRECISION,
  center_y DOUBLE PRECISION,
  pole_x DOUBLE PRECISION,
  pole_y DOUBLE PRECISION,
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, state_id)
);
CREATE INDEX IF NOT EXISTS maps_states_geom_gix ON public.maps_states USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_states_world_idx ON public.maps_states (world_id);

CREATE TABLE IF NOT EXISTS public.maps_provinces (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  province_id INTEGER NOT NULL,
  name TEXT,
  full_name TEXT,
  form_name TEXT,
  color TEXT,
  state_id INTEGER,
  burg_id INTEGER,
  center_x DOUBLE PRECISION,
  center_y DOUBLE PRECISION,
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, province_id)
);
CREATE INDEX IF NOT EXISTS maps_provinces_geom_gix ON public.maps_provinces USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_provinces_world_idx ON public.maps_provinces (world_id);

CREATE TABLE IF NOT EXISTS public.maps_cultures (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  culture_id INTEGER NOT NULL,
  name TEXT,
  code TEXT,
  color TEXT,
  type TEXT,
  base INTEGER,
  expansionism NUMERIC,
  center_cell INTEGER,
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, culture_id)
);
CREATE INDEX IF NOT EXISTS maps_cultures_geom_gix ON public.maps_cultures USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_cultures_world_idx ON public.maps_cultures (world_id);

CREATE TABLE IF NOT EXISTS public.maps_religions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  religion_id INTEGER NOT NULL,
  name TEXT,
  code TEXT,
  color TEXT,
  type TEXT,
  form TEXT,
  deity TEXT,
  culture INTEGER,
  expansion TEXT,
  expansionism NUMERIC,
  center_cell INTEGER,
  origins INTEGER[],
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, religion_id)
);
CREATE INDEX IF NOT EXISTS maps_religions_geom_gix ON public.maps_religions USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_religions_world_idx ON public.maps_religions (world_id);

CREATE TABLE IF NOT EXISTS public.maps_features (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  group_name TEXT,
  land BOOLEAN,
  area NUMERIC,
  height NUMERIC,
  flux NUMERIC,
  temp NUMERIC,
  evaporation NUMERIC,
  first_cell INTEGER,
  outlet INTEGER,
  geom geometry(MultiPolygon, 0),
  shoreline_geom geometry(MultiLineString, 0),
  UNIQUE (world_id, feature_id)
);
CREATE INDEX IF NOT EXISTS maps_features_geom_gix ON public.maps_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_features_world_idx ON public.maps_features (world_id);

CREATE TABLE IF NOT EXISTS public.maps_zones (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  color TEXT,
  cells INTEGER[],
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, zone_id)
);
CREATE INDEX IF NOT EXISTS maps_zones_geom_gix ON public.maps_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_zones_world_idx ON public.maps_zones (world_id);

-- =====================================================================
-- Military + political (point + scalar)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_regiments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  regiment_id INTEGER NOT NULL,
  state_id INTEGER NOT NULL,
  name TEXT,
  icon TEXT,
  cell INTEGER,
  x_px DOUBLE PRECISION,
  y_px DOUBLE PRECISION,
  base_x DOUBLE PRECISION,
  base_y DOUBLE PRECISION,
  total_men INTEGER,
  attack_value NUMERIC,
  u_infantry INTEGER,
  u_archers INTEGER,
  u_cavalry INTEGER,
  u_artillery INTEGER,
  u_fleet INTEGER,
  geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED,
  UNIQUE (world_id, state_id, regiment_id)
);
CREATE INDEX IF NOT EXISTS maps_regiments_geom_gix ON public.maps_regiments USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_regiments_world_idx ON public.maps_regiments (world_id);

CREATE TABLE IF NOT EXISTS public.maps_campaigns (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  state_id INTEGER NOT NULL,
  campaign_index INTEGER NOT NULL,
  name TEXT,
  start_year INTEGER,
  end_year INTEGER,
  attacker TEXT,
  defender TEXT,
  UNIQUE (world_id, state_id, campaign_index)
);
COMMENT ON TABLE public.maps_campaigns IS
  'FMG historical war record nested on pack.states[].campaigns[]. NOT the Questables RPG-campaign concept (see public.campaigns). Application code MUST use the fully qualified table name to avoid confusion.';
CREATE INDEX IF NOT EXISTS maps_campaigns_world_idx ON public.maps_campaigns (world_id);

CREATE TABLE IF NOT EXISTS public.maps_diplomacy (
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  state_a_id INTEGER NOT NULL,
  state_b_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (world_id, state_a_id, state_b_id)
);
CREATE INDEX IF NOT EXISTS maps_diplomacy_world_idx ON public.maps_diplomacy (world_id);

CREATE TABLE IF NOT EXISTS public.maps_coats_of_arms (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('state','province','burg')),
  owner_id INTEGER NOT NULL,
  shield TEXT,
  t1 TEXT,
  division JSONB,
  ordinaries JSONB,
  charges JSONB,
  UNIQUE (world_id, owner_kind, owner_id)
);
CREATE INDEX IF NOT EXISTS maps_coats_world_idx ON public.maps_coats_of_arms (world_id);

-- =====================================================================
-- Reference / lore
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_biomes (
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  biome_id INTEGER NOT NULL,
  name TEXT,
  color TEXT,
  habitability NUMERIC,
  icons_csv TEXT,
  biomes_martin TEXT,
  cost INTEGER,
  PRIMARY KEY (world_id, biome_id)
);

CREATE TABLE IF NOT EXISTS public.maps_notes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  name TEXT,
  legend TEXT,
  UNIQUE (world_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS maps_notes_world_idx ON public.maps_notes (world_id);
CREATE INDEX IF NOT EXISTS maps_notes_target_idx ON public.maps_notes (world_id, target_kind, target_id);

-- =====================================================================
-- Import job tracking
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_import_jobs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  stage TEXT,
  percent INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  file_path TEXT,
  file_size_bytes BIGINT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS maps_import_jobs_status_idx ON public.maps_import_jobs (status);
CREATE INDEX IF NOT EXISTS maps_import_jobs_world_idx ON public.maps_import_jobs (world_id);

-- =====================================================================
-- ALTERs on existing maps_* tables
-- =====================================================================

ALTER TABLE public.maps_world
  ADD COLUMN IF NOT EXISTS map_coordinates JSONB,
  ADD COLUMN IF NOT EXISTS fmg_version TEXT,
  ADD COLUMN IF NOT EXISTS fmg_map_id BIGINT,
  ADD COLUMN IF NOT EXISTS fmg_seed TEXT;

ALTER TABLE public.maps_burgs
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS is_large_port BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_regional_center BOOLEAN,
  ADD COLUMN IF NOT EXISTS settlement_type TEXT,
  ADD COLUMN IF NOT EXISTS base_population NUMERIC,
  ADD COLUMN IF NOT EXISTS "group" TEXT,
  ADD COLUMN IF NOT EXISTS feature INTEGER;

ALTER TABLE public.maps_cells
  ADD COLUMN IF NOT EXISTS flux INTEGER,
  ADD COLUMN IF NOT EXISTS confluence INTEGER,
  ADD COLUMN IF NOT EXISTS river_id INTEGER,
  ADD COLUMN IF NOT EXISTS haven INTEGER,
  ADD COLUMN IF NOT EXISTS harbor INTEGER,
  ADD COLUMN IF NOT EXISTS pop NUMERIC,
  ADD COLUMN IF NOT EXISTS province INTEGER,
  ADD COLUMN IF NOT EXISTS feature INTEGER,
  ADD COLUMN IF NOT EXISTS area NUMERIC,
  ADD COLUMN IF NOT EXISTS temperature NUMERIC;

ALTER TABLE public.maps_rivers
  ADD COLUMN IF NOT EXISTS parent INTEGER,
  ADD COLUMN IF NOT EXISTS basin INTEGER,
  ADD COLUMN IF NOT EXISTS source_width NUMERIC,
  ADD COLUMN IF NOT EXISTS width_factor NUMERIC;

ALTER TABLE public.maps_routes
  ADD COLUMN IF NOT EXISTS group_name TEXT;

-- =====================================================================
-- Migrate maps_burgs.emblem → maps_coats_of_arms, then drop emblem
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burgs'
      AND column_name = 'emblem'
  ) THEN
    INSERT INTO public.maps_coats_of_arms
      (world_id, owner_kind, owner_id, shield, t1, division, ordinaries, charges)
    SELECT
      b.world_id,
      'burg',
      b.burg_id,
      b.emblem->>'shield',
      b.emblem->>'t1',
      b.emblem->'division',
      b.emblem->'ordinaries',
      b.emblem->'charges'
    FROM public.maps_burgs b
    WHERE b.emblem IS NOT NULL
    ON CONFLICT (world_id, owner_kind, owner_id) DO NOTHING;

    ALTER TABLE public.maps_burgs DROP COLUMN emblem;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Write the rollback**

Write to `database/migrations/016_fmg_full_json_schema.rollback.sql`:

```sql
-- Rollback for 016_fmg_full_json_schema.sql
-- Re-adds maps_burgs.emblem (data NOT restored — coats moved to maps_coats_of_arms)
-- and drops new tables + new columns.

BEGIN;

ALTER TABLE public.maps_burgs ADD COLUMN IF NOT EXISTS emblem JSONB;

ALTER TABLE public.maps_routes DROP COLUMN IF EXISTS group_name;
ALTER TABLE public.maps_rivers
  DROP COLUMN IF EXISTS width_factor,
  DROP COLUMN IF EXISTS source_width,
  DROP COLUMN IF EXISTS basin,
  DROP COLUMN IF EXISTS parent;
ALTER TABLE public.maps_cells
  DROP COLUMN IF EXISTS temperature,
  DROP COLUMN IF EXISTS area,
  DROP COLUMN IF EXISTS feature,
  DROP COLUMN IF EXISTS province,
  DROP COLUMN IF EXISTS pop,
  DROP COLUMN IF EXISTS harbor,
  DROP COLUMN IF EXISTS haven,
  DROP COLUMN IF EXISTS river_id,
  DROP COLUMN IF EXISTS confluence,
  DROP COLUMN IF EXISTS flux;
ALTER TABLE public.maps_burgs
  DROP COLUMN IF EXISTS feature,
  DROP COLUMN IF EXISTS "group",
  DROP COLUMN IF EXISTS base_population,
  DROP COLUMN IF EXISTS settlement_type,
  DROP COLUMN IF EXISTS is_regional_center,
  DROP COLUMN IF EXISTS is_large_port,
  DROP COLUMN IF EXISTS type;
ALTER TABLE public.maps_world
  DROP COLUMN IF EXISTS fmg_seed,
  DROP COLUMN IF EXISTS fmg_map_id,
  DROP COLUMN IF EXISTS fmg_version,
  DROP COLUMN IF EXISTS map_coordinates;

DROP TABLE IF EXISTS public.maps_import_jobs;
DROP TABLE IF EXISTS public.maps_notes;
DROP TABLE IF EXISTS public.maps_biomes;
DROP TABLE IF EXISTS public.maps_coats_of_arms;
DROP TABLE IF EXISTS public.maps_diplomacy;
DROP TABLE IF EXISTS public.maps_campaigns;
DROP TABLE IF EXISTS public.maps_regiments;
DROP TABLE IF EXISTS public.maps_zones;
DROP TABLE IF EXISTS public.maps_features;
DROP TABLE IF EXISTS public.maps_religions;
DROP TABLE IF EXISTS public.maps_cultures;
DROP TABLE IF EXISTS public.maps_provinces;
DROP TABLE IF EXISTS public.maps_states;

COMMIT;
```

- [ ] **Step 3: Apply the migration**

Run:
```bash
psql -U barrulus -d questables -f database/migrations/016_fmg_full_json_schema.sql
```
Expected: `BEGIN`, multiple `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` notices, `COMMIT`. No errors.

- [ ] **Step 4: Verify schema**

Run:
```bash
psql -U barrulus -d questables -c "\dt public.maps_*" | grep -E "states|provinces|cultures|religions|features|zones|regiments|campaigns|diplomacy|coats|biomes|notes|import_jobs"
psql -U barrulus -d questables -c "\d public.maps_burgs" | grep -E "type|is_large_port|settlement_type|group|emblem"
```
Expected: All 13 new tables present; `maps_burgs` shows new columns and NO `emblem` row.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/016_fmg_full_json_schema.sql database/migrations/016_fmg_full_json_schema.rollback.sql
git commit -m "feat(db): add FMG full JSON import schema (13 tables + ALTERs)"
```

---

### Task 2: Add streaming-parse and pg-copy-streams deps

**Files:**
- Modify: `server/package.json`

We need `stream-json` for the streaming JSON parser, and `pg-copy-streams` for the binary COPY into `maps_cells` (66k rows).

- [ ] **Step 1: Install deps**

Run from the repo root:
```bash
cd server && npm install stream-json pg-copy-streams && cd ..
```
Expected: both packages added; lockfile updated.

- [ ] **Step 2: Confirm installation**

Run:
```bash
node -e "console.log(require('stream-json/package.json').version); console.log(require('pg-copy-streams/package.json').version);" --experimental-vm-modules 2>&1 || (cd server && node -e "console.log(require('stream-json/package.json').version); console.log(require('pg-copy-streams/package.json').version);")
```
Expected: two version strings printed.

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "build(server): add stream-json and pg-copy-streams"
```

---

### Task 3: Tiny test fixture for unit tests

**Files:**
- Create: `tests/fixtures/fmg-full-json/tiny.json`

A 3-cell, 6-vertex synthetic FMG file. Used by every per-ingester unit test in this plan. Keep it minimal — every section has exactly one entity unless an FK relationship needs two.

- [ ] **Step 1: Write the fixture**

Write to `tests/fixtures/fmg-full-json/tiny.json`:

```json
{
  "info": {
    "version": "1.122.3",
    "exportedAt": "2026-05-23T00:00:00.000Z",
    "mapName": "Tiny",
    "width": 100,
    "height": 100,
    "seed": "42",
    "mapId": 1
  },
  "settings": {"distanceUnit": "mi", "distanceScale": "5", "areaUnit": "square"},
  "mapCoordinates": {"latT": 60, "latN": 30, "latS": -30, "lonT": 60, "lonW": -30, "lonE": 30},
  "biomesData": {
    "i": [0, 1],
    "name": ["Marine", "Hot desert"],
    "color": ["#466eab", "#fbe79f"],
    "habitability": [0, 4],
    "iconsDensity": [0, 10],
    "icons": [[], ["dune"]],
    "cost": [10, 200]
  },
  "pack": {
    "vertices": [
      {"i": 0, "p": [0, 0],   "v": [-1, -1, -1], "c": [0, -1, -1]},
      {"i": 1, "p": [10, 0],  "v": [-1, -1, -1], "c": [0, 1, -1]},
      {"i": 2, "p": [10, 10], "v": [-1, -1, -1], "c": [0, 1, 2]},
      {"i": 3, "p": [0, 10],  "v": [-1, -1, -1], "c": [0, 2, -1]},
      {"i": 4, "p": [20, 0],  "v": [-1, -1, -1], "c": [1, -1, -1]},
      {"i": 5, "p": [20, 10], "v": [-1, -1, -1], "c": [1, 2, -1]}
    ],
    "cells": [
      {"i": 0, "v": [0, 1, 2, 3], "c": [1], "p": [5, 5],   "g": 1, "h": 20, "area": 100, "f": 1, "t": 1, "haven": 0, "harbor": 0, "fl": 0, "r": 0, "conf": 0, "biome": 1, "s": 0, "pop": 1.0, "culture": 1, "burg": 1, "state": 1, "religion": 1, "province": 1},
      {"i": 1, "v": [1, 4, 5, 2], "c": [0, 2], "p": [15, 5], "g": 1, "h": 18, "area": 100, "f": 1, "t": 1, "haven": 0, "harbor": 0, "fl": 0, "r": 0, "conf": 0, "biome": 1, "s": 0, "pop": 0.5, "culture": 1, "burg": 0, "state": 1, "religion": 1, "province": 1},
      {"i": 2, "v": [2, 5, 3],    "c": [1],    "p": [10, 12], "g": 2, "h": 5, "area": 50, "f": 2, "t": -1, "haven": 0, "harbor": 0, "fl": 0, "r": 0, "conf": 0, "biome": 0, "s": 0, "pop": 0,   "culture": 0, "burg": 0, "state": 0, "religion": 0, "province": 0}
    ],
    "features": [
      {"i": 0, "type": "ocean", "land": false, "border": true, "cells": 0, "firstCell": 0, "vertices": [], "area": 0, "shoreline": [], "height": 0},
      {"i": 1, "type": "island", "land": true, "border": false, "cells": 2, "firstCell": 0, "vertices": [], "area": 200, "shoreline": [], "height": 19, "name": "Tinyland"},
      {"i": 2, "type": "lake", "land": false, "group": "freshwater", "cells": 1, "firstCell": 2, "vertices": [], "area": 50, "shoreline": [], "height": 5, "flux": 1, "temp": 15, "evaporation": 1, "name": "Tinylake", "outlet": null}
    ],
    "cultures": [
      {"name": "Wildlands", "i": 0, "base": 0, "shield": "fantasy2", "center": 0, "color": "#cccccc", "type": "Generic", "expansionism": 0, "code": "Wi"},
      {"name": "Tinyfolk", "i": 1, "base": 1, "shield": "fantasy2", "center": 0, "color": "#aff05b", "type": "Generic", "expansionism": 1.1, "origins": [0], "code": "Ti"}
    ],
    "religions": [
      {"name": "No religion", "i": 0, "type": "None", "form": "Non-theism", "culture": 0, "center": 0, "color": "#cccccc", "code": "No", "expansion": "culture", "expansionism": 0},
      {"name": "Tinyfaith", "i": 1, "type": "Folk", "form": "Polytheism", "culture": 1, "center": 0, "deity": "Tinyx, The Small", "color": "#aff05b", "code": "Tf", "expansion": "state", "expansionism": 0, "origins": [0]}
    ],
    "burgs": [
      {"i": 0},
      {"i": 1, "cell": 0, "x": 5, "y": 5, "name": "Tinytown", "state": 1, "culture": 1, "feature": 1, "capital": 1, "population": 2.5, "basePopulation": 2.0, "type": "Generic", "settlementType": "capital", "group": "capital", "citadel": 1, "plaza": 1, "walls": 1, "shanty": 0, "temple": 0, "port": 0, "coa": {"t1": "or", "shield": "vesicaPiscis", "ordinaries": [], "charges": []}}
    ],
    "states": [
      {"i": 0, "name": "Neutrals"},
      {"i": 1, "name": "Tinystate", "fullName": "Republic of Tinystate", "form": "Republic", "formName": "Republic", "expansionism": 1.0, "capital": 1, "type": "Generic", "center": 0, "culture": 1, "religion": 1, "color": "#66c2a5", "pole": [5, 5], "neighbors": [], "urban": 2.5, "rural": 0.5, "area": 200, "coa": {"t1": "gules", "shield": "vesicaPiscis", "charges": []}, "campaigns": [{"name": "Tinywar", "start": 1500, "end": 1505}], "diplomacy": ["x", "x"], "military": [{"i": 0, "a": 100, "cell": 0, "x": 5, "y": 5, "bx": 5, "by": 5, "u": {"infantry": 50, "archers": 30, "cavalry": 15, "artillery": 5}, "n": 0, "name": "1st Tiny Regiment", "state": 1, "icon": "⚔️"}]}
    ],
    "provinces": [
      0,
      {"i": 1, "state": 1, "center": 0, "burg": 1, "name": "Tinyprov", "formName": "Province", "fullName": "Tinyprov Province", "color": "#6dc4c3", "pole": [5, 5], "coa": {"t1": "sable", "shield": "vesicaPiscis"}}
    ],
    "rivers": [
      {"i": 1, "source": 2, "mouth": 0, "discharge": 10, "length": 5.0, "width": 0.5, "widthFactor": 1.0, "sourceWidth": 0.1, "parent": 1, "cells": [2, 1, 0], "basin": 1, "name": "Tinyriver", "type": "Stream"}
    ],
    "routes": [
      {"i": 0, "group": "roads", "type": "trail", "feature": 1, "points": [[5, 5, 0], [15, 5, 1]]}
    ],
    "markers": [
      {"i": 0, "icon": "🌋", "type": "volcanoes", "x": 12, "y": 5, "cell": 1, "dx": 50, "px": 13}
    ],
    "zones": [
      {"i": 0, "name": "Tinyzone", "type": "Invasion", "cells": [0, 1], "color": "url(#hatch1)"}
    ]
  },
  "notes": [
    {"id": "burg1", "name": "Tinytown", "legend": "Founded in 1100."},
    {"id": "regiment1-0", "name": "1st Tiny Regiment", "legend": "Composition: 50/30/15/5."}
  ],
  "nameBases": []
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/fmg-full-json/tiny.json
git commit -m "test(maps): add tiny FMG fixture for unit tests"
```

---

### Task 4: Geometry builder — pure function, fully unit-tested

**Files:**
- Create: `server/services/maps/fmg-full-json/geometry-builder.js`
- Test: `tests/maps/fmg-full-json/geometry-builder.test.js`

Pure function `(cells, vertices) → string[]` producing well-formed WKT POLYGONs (one per cell). Vertices flattened into a `Float64Array` once for O(1) lookup. Cell rings are closed by repeating the first vertex.

- [ ] **Step 1: Write the failing test**

Write to `tests/maps/fmg-full-json/geometry-builder.test.js`:

```js
import { buildCellPolygonsWkt } from '../../../server/services/maps/fmg-full-json/geometry-builder.js';

describe('buildCellPolygonsWkt', () => {
  const vertices = [
    { i: 0, p: [0, 0] },
    { i: 1, p: [10, 0] },
    { i: 2, p: [10, 10] },
    { i: 3, p: [0, 10] },
  ];

  test('emits a closed POLYGON for a quad cell', () => {
    const cells = [{ i: 0, v: [0, 1, 2, 3] }];
    const wkt = buildCellPolygonsWkt(cells, vertices);
    expect(wkt).toEqual(['POLYGON((0 0,10 0,10 10,0 10,0 0))']);
  });

  test('emits one polygon per cell in input order', () => {
    const cells = [
      { i: 0, v: [0, 1, 2] },
      { i: 1, v: [1, 2, 3] },
    ];
    const wkt = buildCellPolygonsWkt(cells, vertices);
    expect(wkt).toHaveLength(2);
    expect(wkt[0]).toBe('POLYGON((0 0,10 0,10 10,0 0))');
    expect(wkt[1]).toBe('POLYGON((10 0,10 10,0 10,10 0))');
  });

  test('handles non-zero vertex indices via lookup', () => {
    const sparseVerts = [
      { i: 100, p: [0, 0] },
      { i: 200, p: [5, 0] },
      { i: 300, p: [5, 5] },
    ];
    const cells = [{ i: 0, v: [100, 200, 300] }];
    const wkt = buildCellPolygonsWkt(cells, sparseVerts);
    expect(wkt).toEqual(['POLYGON((0 0,5 0,5 5,0 0))']);
  });

  test('throws when a cell references an unknown vertex index', () => {
    const cells = [{ i: 0, v: [0, 999] }];
    expect(() => buildCellPolygonsWkt(cells, vertices)).toThrow(/vertex 999/);
  });

  test('skips degenerate cells with < 3 vertices', () => {
    const cells = [
      { i: 0, v: [0, 1] },
      { i: 1, v: [0, 1, 2] },
    ];
    const wkt = buildCellPolygonsWkt(cells, vertices);
    expect(wkt[0]).toBeNull();
    expect(wkt[1]).toBe('POLYGON((0 0,10 0,10 10,0 0))');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/maps/fmg-full-json/geometry-builder.test.js`
Expected: FAIL with `Cannot find module .../geometry-builder.js`.

- [ ] **Step 3: Write the implementation**

Write to `server/services/maps/fmg-full-json/geometry-builder.js`:

```js
// Pure geometry builder: turns FMG pack.cells[].v[] + pack.vertices[].p[] into
// closed WKT POLYGONs ready for ST_GeomFromText with SRID 0.
//
// Vertex lookup is built once as a Float64Array of (x, y) pairs indexed by
// vertex.i. FMG indices can be sparse (any non-negative integer), so we size
// the array to maxIndex+1 and use NaN as a sentinel for "no vertex here".

export function buildVertexLookup(vertices) {
  let maxIdx = -1;
  for (const v of vertices) if (v.i > maxIdx) maxIdx = v.i;
  const lookup = new Float64Array((maxIdx + 1) * 2);
  lookup.fill(Number.NaN);
  for (const v of vertices) {
    lookup[v.i * 2] = v.p[0];
    lookup[v.i * 2 + 1] = v.p[1];
  }
  return lookup;
}

export function buildCellPolygonsWkt(cells, vertices) {
  const lookup = buildVertexLookup(vertices);
  const result = new Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c.v || c.v.length < 3) { result[i] = null; continue; }
    const parts = [];
    for (let j = 0; j < c.v.length; j++) {
      const vi = c.v[j];
      const x = lookup[vi * 2];
      const y = lookup[vi * 2 + 1];
      if (Number.isNaN(x)) throw new Error(`vertex ${vi} not found (cell ${c.i})`);
      parts.push(`${x} ${y}`);
    }
    // close ring
    parts.push(parts[0]);
    result[i] = `POLYGON((${parts.join(',')}))`;
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/maps/fmg-full-json/geometry-builder.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/fmg-full-json/geometry-builder.js tests/maps/fmg-full-json/geometry-builder.test.js
git commit -m "feat(maps): add geometry builder for FMG cell polygons"
```

---

### Task 5: Pre-transaction validators

**Files:**
- Create: `server/services/maps/fmg-full-json/validators.js`
- Test: `tests/maps/fmg-full-json/validators.test.js`

Cheap sanity checks that run before opening the transaction. Reject obviously-bad files early. NOT a deep schema validator — just guards that catch the common corruption modes.

- [ ] **Step 1: Write the failing test**

Write to `tests/maps/fmg-full-json/validators.test.js`:

```js
import { validateParsedFmg } from '../../../server/services/maps/fmg-full-json/validators.js';

const minimal = () => ({
  info: { version: '1.122.3', width: 100, height: 100 },
  settings: {},
  pack: {
    cells: Array.from({ length: 1200 }, (_, i) => ({ i, v: [0, 1, 2] })),
    vertices: Array.from({ length: 2500 }, (_, i) => ({ i, p: [i, i] })),
    features: [{ i: 0 }],
    states: [{ i: 0 }],
    burgs: [{ i: 0 }],
  },
});

describe('validateParsedFmg', () => {
  test('accepts a minimally valid file', () => {
    expect(() => validateParsedFmg(minimal())).not.toThrow();
  });

  test('rejects missing top-level keys', () => {
    const j = minimal(); delete j.pack;
    expect(() => validateParsedFmg(j)).toThrow(/pack/);
  });

  test('rejects missing pack subkeys', () => {
    const j = minimal(); delete j.pack.cells;
    expect(() => validateParsedFmg(j)).toThrow(/pack\.cells/);
  });

  test('rejects fewer than 1000 cells', () => {
    const j = minimal(); j.pack.cells = j.pack.cells.slice(0, 500);
    expect(() => validateParsedFmg(j)).toThrow(/cell count/);
  });

  test('rejects vertex count less than 2x cell count', () => {
    const j = minimal(); j.pack.vertices = j.pack.vertices.slice(0, 100);
    expect(() => validateParsedFmg(j)).toThrow(/vertex count/);
  });

  test('rejects unknown FMG major version', () => {
    const j = minimal(); j.info.version = '0.9.0';
    expect(() => validateParsedFmg(j)).toThrow(/version/);
  });

  test('rejects orphan burg.state references', () => {
    const j = minimal();
    j.pack.burgs = [{ i: 0 }, { i: 1, state: 99 }];
    expect(() => validateParsedFmg(j)).toThrow(/burg 1.*state 99/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/maps/fmg-full-json/validators.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the implementation**

Write to `server/services/maps/fmg-full-json/validators.js`:

```js
const REQUIRED_TOP_LEVEL = ['info', 'settings', 'pack'];
const REQUIRED_PACK = ['cells', 'vertices', 'features', 'states', 'burgs'];
const SUPPORTED_VERSIONS = /^1\.(1[0-9]|[2-9][0-9])\./;  // 1.10.x through 1.99.x

export function validateParsedFmg(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('parsed JSON is not an object');

  for (const k of REQUIRED_TOP_LEVEL) {
    if (!(k in parsed)) throw new Error(`missing top-level key: ${k}`);
  }
  for (const k of REQUIRED_PACK) {
    if (!Array.isArray(parsed.pack[k])) throw new Error(`missing or non-array pack.${k}`);
  }

  const version = parsed.info?.version || '';
  if (!SUPPORTED_VERSIONS.test(version)) {
    throw new Error(`unsupported FMG version: ${version} (expected 1.10.x–1.99.x)`);
  }

  const cellCount = parsed.pack.cells.length;
  const vertexCount = parsed.pack.vertices.length;
  if (cellCount < 1000) throw new Error(`cell count too low: ${cellCount} (min 1000)`);
  if (vertexCount < cellCount * 2) {
    throw new Error(`vertex count too low: ${vertexCount} (expected >= ${cellCount * 2})`);
  }

  // FK sanity: burg.state must reference a known state.i
  const stateIds = new Set(parsed.pack.states.map((s) => s?.i).filter((i) => i !== undefined));
  for (const b of parsed.pack.burgs) {
    if (!b || b.i === 0) continue; // slot 0 is the FMG sentinel
    if (b.state !== undefined && !stateIds.has(b.state)) {
      throw new Error(`burg ${b.i} references unknown state ${b.state}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/maps/fmg-full-json/validators.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/fmg-full-json/validators.js tests/maps/fmg-full-json/validators.test.js
git commit -m "feat(maps): add pre-transaction validators for FMG full JSON"
```

---

### Task 6: JSON parser wrapper

**Files:**
- Create: `server/services/maps/fmg-full-json/parser.js`
- Test: `tests/maps/fmg-full-json/parser.test.js`

A thin wrapper over `JSON.parse` (for files that comfortably fit in memory — Node's `JSON.parse` handled the 70 MB Jolliariana fixture without issue in spec-time profiling) with a fallback to `stream-json` for files above a size threshold. Returns the same shape from both paths so callers don't branch.

The decision to use plain `JSON.parse` first is deliberate: `JSON.parse` is ~5× faster than `stream-json` for files in this size class, and we already pay an `O(file)` read cost. The streaming path stays in the codebase for the rare 200+ MB future export.

- [ ] **Step 1: Write the failing test**

Write to `tests/maps/fmg-full-json/parser.test.js`:

```js
import path from 'node:path';
import { parseFmgFile } from '../../../server/services/maps/fmg-full-json/parser.js';

const TINY = path.join(__dirname, '../../fixtures/fmg-full-json/tiny.json');

describe('parseFmgFile', () => {
  test('parses tiny fixture and exposes top-level keys', async () => {
    const parsed = await parseFmgFile(TINY);
    expect(parsed.info.version).toBe('1.122.3');
    expect(parsed.pack.cells).toHaveLength(3);
    expect(parsed.pack.vertices).toHaveLength(6);
    expect(parsed.biomesData.name).toContain('Marine');
  });

  test('streaming path returns the same shape as in-memory path', async () => {
    const a = await parseFmgFile(TINY, { forceStreaming: false });
    const b = await parseFmgFile(TINY, { forceStreaming: true });
    expect(a.info).toEqual(b.info);
    expect(a.pack.cells.length).toEqual(b.pack.cells.length);
    expect(a.pack.states.length).toEqual(b.pack.states.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/maps/fmg-full-json/parser.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the implementation**

Write to `server/services/maps/fmg-full-json/parser.js`:

```js
import { promises as fs, createReadStream } from 'node:fs';
import { parser as streamParser } from 'stream-json/Parser.js';
import { Assembler } from 'stream-json/Assembler.js';

const STREAMING_THRESHOLD_BYTES = 150 * 1024 * 1024;  // 150 MB

export async function parseFmgFile(filePath, { forceStreaming = false } = {}) {
  const stat = await fs.stat(filePath);
  if (!forceStreaming && stat.size < STREAMING_THRESHOLD_BYTES) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
  return await parseStreaming(filePath);
}

function parseStreaming(filePath) {
  return new Promise((resolve, reject) => {
    const pipeline = createReadStream(filePath).pipe(streamParser());
    const asm = Assembler.connectTo(pipeline);
    asm.on('done', (a) => resolve(a.current));
    pipeline.on('error', reject);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/maps/fmg-full-json/parser.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/fmg-full-json/parser.js tests/maps/fmg-full-json/parser.test.js
git commit -m "feat(maps): add FMG JSON parser (in-memory + streaming fallback)"
```

---

## Ingester conventions

Every ingester module exports a single async function with this signature:

```js
export async function ingestXxx(client, worldId, parsed, log) {
  // client: pg.PoolClient inside an open transaction
  // worldId: UUID of the world we're ingesting into
  // parsed:  the full parsed FMG object (each ingester reads what it needs)
  // log:     (percent, message) => void — write progress for the orchestrator
  // returns: { rowCount }
}
```

The orchestrator (Task 22) wires `log` to update `maps_import_jobs.percent / .stage / .message`. Each ingester reports its own 0→100% internally; the orchestrator scales them across stages.

Test pattern for every ingester:
1. Open a transaction in a `beforeAll`.
2. Insert a `maps_world` row.
3. Call the ingester with the tiny fixture.
4. SELECT from the new table, assert shape + count.
5. ROLLBACK in `afterAll` to keep the DB clean.

These tests require a live DB. They're under `tests/maps/fmg-full-json/ingesters/` and are skipped automatically if `process.env.PGUSER`/`DATABASE_URL` is unset (helper in Task 7).

**Every ingester test file MUST start with the `@jest-environment node` docblock** — `pg` uses webcrypto APIs (`TextEncoder` etc.) that are absent in Jest's default `jsdom` environment, so tests without the docblock fail with `TextEncoder is not defined`:

```js
/** @jest-environment node */
import { describeWithDb, ... } from '../db-harness.js';
// rest of the test
```

Run the tests with `PGUSER=barrulus npm test -- <path>`.

---

### Task 7: DB test harness for ingester tests

**Files:**
- Create: `tests/maps/fmg-full-json/db-harness.js`

A small helper that opens a transaction against the dev DB and rolls back at the end of each test file. Tests that import this helper auto-skip when `DATABASE_URL`/PGUSER isn't configured for tests.

- [ ] **Step 1: Write the harness**

Write to `tests/maps/fmg-full-json/db-harness.js`:

```js
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs/promises';

const { Client } = pg;

export const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/fmg-full-json/tiny.json'
);

export async function loadTinyFixture() {
  return JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf8'));
}

export function describeWithDb(name, fn) {
  const canRun = !!(process.env.PGUSER || process.env.DATABASE_URL || process.env.PGDATABASE);
  const d = canRun ? describe : describe.skip;
  d(name, fn);
}

export async function openTxClient() {
  const client = new Client();
  await client.connect();
  await client.query('BEGIN');
  return client;
}

export async function rollbackAndClose(client) {
  if (!client) return;
  try { await client.query('ROLLBACK'); } catch {}
  await client.end();
}

export async function seedWorld(client, { name = 'Tiny test world' } = {}) {
  const { rows } = await client.query(
    `INSERT INTO public.maps_world (name, width_pixels, height_pixels)
     VALUES ($1, 100, 100) RETURNING id`,
    [name],
  );
  return rows[0].id;
}
```

- [ ] **Step 2: Verify harness loads**

Run: `node --experimental-vm-modules -e "import('./tests/maps/fmg-full-json/db-harness.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `['FIXTURE_PATH', 'loadTinyFixture', 'describeWithDb', 'openTxClient', 'rollbackAndClose', 'seedWorld']`.

- [ ] **Step 3: Commit**

```bash
git add tests/maps/fmg-full-json/db-harness.js
git commit -m "test(maps): add DB harness for FMG ingester tests"
```

---

### Task 8: Ingester — world (`maps_world` enrichment)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/world.js`
- Test: `tests/maps/fmg-full-json/ingesters/world.test.js`

Writes `info.version`, `info.mapId`, `info.seed`, and `mapCoordinates` into the existing `maps_world` row. Does NOT create the world — caller already did via `createOrUpdateWorld()`.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/world.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestWorld } from '../../../../server/services/maps/fmg-full-json/ingesters/world.js';

describeWithDb('ingestWorld', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('stores info + mapCoordinates onto maps_world', async () => {
    await ingestWorld(client, worldId, parsed, () => {});
    const { rows } = await client.query(
      `SELECT fmg_version, fmg_map_id, fmg_seed, map_coordinates
       FROM public.maps_world WHERE id = $1`,
      [worldId],
    );
    expect(rows[0].fmg_version).toBe('1.122.3');
    expect(rows[0].fmg_map_id).toBe('1');
    expect(rows[0].fmg_seed).toBe('42');
    expect(rows[0].map_coordinates.latT).toBe(60);
  });
});
```

- [ ] **Step 2: Run test (fail expected)**

Run: `npx jest tests/maps/fmg-full-json/ingesters/world.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/world.js`:

```js
export async function ingestWorld(client, worldId, parsed, log) {
  log(0, 'World metadata');
  const info = parsed.info || {};
  await client.query(
    `UPDATE public.maps_world
        SET fmg_version = $2,
            fmg_map_id = $3,
            fmg_seed = $4,
            map_coordinates = $5,
            updated_at = now()
      WHERE id = $1`,
    [
      worldId,
      info.version || null,
      info.mapId != null ? String(info.mapId) : null,
      info.seed || null,
      parsed.mapCoordinates ? JSON.stringify(parsed.mapCoordinates) : null,
    ],
  );
  log(100, 'World metadata done');
  return { rowCount: 1 };
}
```

- [ ] **Step 4: Run test (pass expected)**

Run: `npx jest tests/maps/fmg-full-json/ingesters/world.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/fmg-full-json/ingesters/world.js tests/maps/fmg-full-json/ingesters/world.test.js
git commit -m "feat(maps): add world metadata ingester for FMG full JSON"
```

---

### Task 9: Ingester — biomes

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/biomes.js`
- Test: `tests/maps/fmg-full-json/ingesters/biomes.test.js`

FMG `biomesData` is a parallel-array layout (`{i: [...], name: [...], color: [...], ...}`). Pivot to rows and insert into `maps_biomes`.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/biomes.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestBiomes } from '../../../../server/services/maps/fmg-full-json/ingesters/biomes.js';

describeWithDb('ingestBiomes', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes one row per biome', async () => {
    const { rowCount } = await ingestBiomes(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT biome_id, name, cost FROM public.maps_biomes
       WHERE world_id = $1 ORDER BY biome_id`,
      [worldId],
    );
    expect(rows).toEqual([
      { biome_id: 0, name: 'Marine', cost: 10 },
      { biome_id: 1, name: 'Hot desert', cost: 200 },
    ]);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/biomes.js`:

```js
export async function ingestBiomes(client, worldId, parsed, log) {
  log(0, 'Biomes');
  const bd = parsed.biomesData;
  if (!bd || !Array.isArray(bd.i)) {
    log(100, 'No biomesData');
    return { rowCount: 0 };
  }
  const values = [];
  const params = [];
  let p = 1;
  for (let idx = 0; idx < bd.i.length; idx++) {
    const iconArr = Array.isArray(bd.icons?.[idx]) ? bd.icons[idx] : [];
    values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
    params.push(
      worldId,
      bd.i[idx],
      bd.name?.[idx] ?? null,
      bd.color?.[idx] ?? null,
      bd.habitability?.[idx] ?? null,
      iconArr.join(','),
      bd.biomesMartin?.[idx] ?? null,
      bd.cost?.[idx] ?? null,
    );
  }
  const sql =
    `INSERT INTO public.maps_biomes
      (world_id, biome_id, name, color, habitability, icons_csv, biomes_martin, cost)
    VALUES ${values.join(',')}
    ON CONFLICT (world_id, biome_id) DO UPDATE SET
      name = EXCLUDED.name, color = EXCLUDED.color,
      habitability = EXCLUDED.habitability, icons_csv = EXCLUDED.icons_csv,
      biomes_martin = EXCLUDED.biomes_martin, cost = EXCLUDED.cost`;
  await client.query(sql, params);
  log(100, `${bd.i.length} biomes`);
  return { rowCount: bd.i.length };
}
```

- [ ] **Step 3: Run test (pass expected)**

Run: `npx jest tests/maps/fmg-full-json/ingesters/biomes.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/maps/fmg-full-json/ingesters/biomes.js tests/maps/fmg-full-json/ingesters/biomes.test.js
git commit -m "feat(maps): add biomes ingester for FMG full JSON"
```

---

### Task 10: Ingester — features (landmass/lake polygons, scalars only this task)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/features.js`
- Test: `tests/maps/fmg-full-json/ingesters/features.test.js`

Insert one row per feature, scalars only. Polygon geometry is filled in by Task 14 (states/cultures use the same ST_Union-over-cells pattern; features will too, keyed by `cells.f`). This task lays the scaffolding so cells (Task 13) and burgs (Task 16) can FK to features.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/features.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestFeatures } from '../../../../server/services/maps/fmg-full-json/ingesters/features.js';

describeWithDb('ingestFeatures', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts features with land/type/name', async () => {
    const { rowCount } = await ingestFeatures(client, worldId, parsed, () => {});
    expect(rowCount).toBe(3);
    const { rows } = await client.query(
      `SELECT feature_id, name, type, land FROM public.maps_features
       WHERE world_id = $1 ORDER BY feature_id`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ feature_id: 0, type: 'ocean', land: false });
    expect(rows[1]).toMatchObject({ feature_id: 1, type: 'island', land: true, name: 'Tinyland' });
    expect(rows[2]).toMatchObject({ feature_id: 2, type: 'lake', land: false, name: 'Tinylake' });
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/features.js`:

```js
export async function ingestFeatures(client, worldId, parsed, log) {
  log(0, 'Features');
  const features = (parsed.pack?.features || []).filter((f) => f && typeof f === 'object');
  if (features.length === 0) { log(100, 'No features'); return { rowCount: 0 }; }
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    await client.query(
      `INSERT INTO public.maps_features
        (world_id, feature_id, name, type, group_name, land, area, height,
         flux, temp, evaporation, first_cell, outlet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (world_id, feature_id) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, group_name = EXCLUDED.group_name,
         land = EXCLUDED.land, area = EXCLUDED.area, height = EXCLUDED.height,
         flux = EXCLUDED.flux, temp = EXCLUDED.temp, evaporation = EXCLUDED.evaporation,
         first_cell = EXCLUDED.first_cell, outlet = EXCLUDED.outlet`,
      [
        worldId, f.i, f.name ?? null, f.type ?? null, f.group ?? null,
        f.land ?? null, f.area ?? null, f.height ?? null, f.flux ?? null,
        f.temp ?? null, f.evaporation ?? null, f.firstCell ?? null, f.outlet ?? null,
      ],
    );
    if (i % 50 === 0) log(Math.floor((i / features.length) * 100), `features ${i}/${features.length}`);
  }
  log(100, `${features.length} features`);
  return { rowCount: features.length };
}
```

- [ ] **Step 3: Run test (pass expected)**

Run: `npx jest tests/maps/fmg-full-json/ingesters/features.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/maps/fmg-full-json/ingesters/features.js tests/maps/fmg-full-json/ingesters/features.test.js
git commit -m "feat(maps): add features ingester for FMG full JSON"
```

---

### Task 11: Ingester — cultures (scalars + center)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/cultures.js`
- Test: `tests/maps/fmg-full-json/ingesters/cultures.test.js`

Scalars only; polygon geometry filled by Task 15 via ST_Union over cells where `cells.culture = culture_id`.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/cultures.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestCultures } from '../../../../server/services/maps/fmg-full-json/ingesters/cultures.js';

describeWithDb('ingestCultures', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts all cultures including Wildlands (i=0)', async () => {
    const { rowCount } = await ingestCultures(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT culture_id, name, code, center_cell FROM public.maps_cultures
       WHERE world_id = $1 ORDER BY culture_id`,
      [worldId],
    );
    expect(rows[1]).toMatchObject({ culture_id: 1, name: 'Tinyfolk', code: 'Ti', center_cell: 0 });
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/cultures.js`:

```js
export async function ingestCultures(client, worldId, parsed, log) {
  log(0, 'Cultures');
  const cultures = (parsed.pack?.cultures || []).filter((c) => c && typeof c === 'object');
  if (cultures.length === 0) { log(100, 'No cultures'); return { rowCount: 0 }; }
  for (let i = 0; i < cultures.length; i++) {
    const c = cultures[i];
    await client.query(
      `INSERT INTO public.maps_cultures
        (world_id, culture_id, name, code, color, type, base, expansionism, center_cell)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (world_id, culture_id) DO UPDATE SET
         name = EXCLUDED.name, code = EXCLUDED.code, color = EXCLUDED.color,
         type = EXCLUDED.type, base = EXCLUDED.base,
         expansionism = EXCLUDED.expansionism, center_cell = EXCLUDED.center_cell`,
      [
        worldId, c.i, c.name ?? null, c.code ?? null, c.color ?? null,
        c.type ?? null, c.base ?? null, c.expansionism ?? null, c.center ?? null,
      ],
    );
  }
  log(100, `${cultures.length} cultures`);
  return { rowCount: cultures.length };
}
```

- [ ] **Step 3: Run test (pass expected)**

Run: `npx jest tests/maps/fmg-full-json/ingesters/cultures.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/maps/fmg-full-json/ingesters/cultures.js tests/maps/fmg-full-json/ingesters/cultures.test.js
git commit -m "feat(maps): add cultures ingester for FMG full JSON"
```

---

### Task 12: Ingester — religions (scalars + center)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/religions.js`
- Test: `tests/maps/fmg-full-json/ingesters/religions.test.js`

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/religions.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestReligions } from '../../../../server/services/maps/fmg-full-json/ingesters/religions.js';

describeWithDb('ingestReligions', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts religions including deity + origins[]', async () => {
    const { rowCount } = await ingestReligions(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT religion_id, name, deity, origins FROM public.maps_religions
       WHERE world_id = $1 AND religion_id = 1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ name: 'Tinyfaith', deity: 'Tinyx, The Small' });
    expect(rows[0].origins).toEqual([0]);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/religions.js`:

```js
export async function ingestReligions(client, worldId, parsed, log) {
  log(0, 'Religions');
  const religions = (parsed.pack?.religions || []).filter((r) => r && typeof r === 'object');
  if (religions.length === 0) { log(100, 'No religions'); return { rowCount: 0 }; }
  for (const r of religions) {
    await client.query(
      `INSERT INTO public.maps_religions
        (world_id, religion_id, name, code, color, type, form, deity,
         culture, expansion, expansionism, center_cell, origins)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (world_id, religion_id) DO UPDATE SET
         name=EXCLUDED.name, code=EXCLUDED.code, color=EXCLUDED.color,
         type=EXCLUDED.type, form=EXCLUDED.form, deity=EXCLUDED.deity,
         culture=EXCLUDED.culture, expansion=EXCLUDED.expansion,
         expansionism=EXCLUDED.expansionism, center_cell=EXCLUDED.center_cell,
         origins=EXCLUDED.origins`,
      [
        worldId, r.i, r.name ?? null, r.code ?? null, r.color ?? null,
        r.type ?? null, r.form ?? null, r.deity ?? null, r.culture ?? null,
        r.expansion ?? null, r.expansionism ?? null, r.center ?? null,
        Array.isArray(r.origins) ? r.origins : null,
      ],
    );
  }
  log(100, `${religions.length} religions`);
  return { rowCount: religions.length };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/religions.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/religions.js tests/maps/fmg-full-json/ingesters/religions.test.js
git commit -m "feat(maps): add religions ingester for FMG full JSON"
```

---

### Task 13: Ingester — cells (bulk COPY + cell polygons)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/cells.js`
- Test: `tests/maps/fmg-full-json/ingesters/cells.test.js`

The big one. 66k cells with geometry. Build WKT polygons from Task 4's helper, then `COPY ... FROM STDIN` via `pg-copy-streams` for the bulk insert. Geometry stored as text first, then `ALTER`'d? No — simpler: copy into a temp table, then `INSERT INTO maps_cells SELECT ..., ST_GeomFromText(wkt, 0) FROM temp` in one query. This keeps the binary-COPY speed without making PostGIS parse 66k WKTs over the wire.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/cells.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestCells', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes cells with geometry + scalars + ALTERed columns', async () => {
    const { rowCount } = await ingestCells(client, worldId, parsed, () => {});
    expect(rowCount).toBe(3);

    const { rows } = await client.query(
      `SELECT cell_id, state, culture, religion, province, biome, pop,
              ST_AsText(geom) AS wkt
         FROM public.maps_cells
        WHERE world_id = $1 ORDER BY cell_id`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      cell_id: 0, state: 1, culture: 1, religion: 1, province: 1, biome: 1,
    });
    expect(Number(rows[0].pop)).toBeCloseTo(1.0);
    expect(rows[0].wkt).toMatch(/^MULTIPOLYGON\(\(\(0 0,/);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/cells.js`:

```js
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { buildCellPolygonsWkt } from '../geometry-builder.js';

// COPY format: tab-separated, NULL = \N. We escape backslashes and tabs to
// keep WKT and any future text columns safe.
function pgCopyEscape(v) {
  if (v === null || v === undefined) return '\\N';
  if (typeof v === 'boolean') return v ? 't' : 'f';
  const s = String(v);
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

const COLUMNS = [
  'world_id', 'cell_id', 'biome', 'type', 'population', 'state',
  'culture', 'religion', 'height', 'flux', 'confluence', 'river_id',
  'haven', 'harbor', 'pop', 'province', 'feature', 'area', 'temperature',
  'geom_wkt',
];

export async function ingestCells(client, worldId, parsed, log) {
  log(0, 'Cells');
  const cells = parsed.pack?.cells || [];
  const vertices = parsed.pack?.vertices || [];
  if (cells.length === 0) { log(100, 'No cells'); return { rowCount: 0 }; }

  log(5, `Building ${cells.length} cell polygons`);
  const wktList = buildCellPolygonsWkt(cells, vertices);

  log(15, 'Creating staging table');
  await client.query(
    `CREATE TEMP TABLE _ingest_cells (
       world_id UUID, cell_id INTEGER, biome INTEGER, type INTEGER,
       population NUMERIC, state INTEGER, culture INTEGER, religion INTEGER,
       height NUMERIC, flux INTEGER, confluence INTEGER, river_id INTEGER,
       haven INTEGER, harbor INTEGER, pop NUMERIC, province INTEGER,
       feature INTEGER, area NUMERIC, temperature NUMERIC, geom_wkt TEXT
     ) ON COMMIT DROP`,
  );

  log(20, `COPY ${cells.length} cells into staging`);
  const copyStream = client.query(
    copyFrom(`COPY _ingest_cells (${COLUMNS.join(',')}) FROM STDIN`),
  );

  async function* genLines() {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const row = [
        worldId, c.i, c.biome ?? null, c.t ?? null, null /* population */,
        c.state ?? null, c.culture ?? null, c.religion ?? null, c.h ?? null,
        c.fl ?? null, c.conf ?? null, c.r ?? null, c.haven ?? null,
        c.harbor ?? null, c.pop ?? null, c.province ?? null, c.f ?? null,
        c.area ?? null, null /* temperature */, wktList[i],
      ];
      yield row.map(pgCopyEscape).join('\t') + '\n';
    }
  }
  await pipeline(Readable.from(genLines()), copyStream);

  log(80, 'Promoting staging → maps_cells');
  await client.query(
    `INSERT INTO public.maps_cells
       (world_id, cell_id, biome, type, population, state, culture, religion,
        height, flux, confluence, river_id, haven, harbor, pop, province,
        feature, area, temperature, geom)
     SELECT world_id, cell_id, biome, type::text, population, state, culture, religion,
            height, flux, confluence, river_id, haven, harbor, pop, province,
            feature, area, temperature,
            CASE WHEN geom_wkt IS NULL THEN NULL
                 ELSE ST_Multi(ST_GeomFromText(geom_wkt, 0)) END
       FROM _ingest_cells`,
  );

  log(100, `${cells.length} cells`);
  return { rowCount: cells.length };
}
```

- [ ] **Step 3: Run test (pass expected)**

Run: `npx jest tests/maps/fmg-full-json/ingesters/cells.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/maps/fmg-full-json/ingesters/cells.js tests/maps/fmg-full-json/ingesters/cells.test.js
git commit -m "feat(maps): add cells ingester with bulk COPY for FMG full JSON"
```

---

### Task 14: Polygon aggregation — features

**Files:**
- Modify: `server/services/maps/fmg-full-json/ingesters/features.js`
- Test: `tests/maps/fmg-full-json/ingesters/features.test.js`

After cells exist (Task 13), backfill `maps_features.geom` via `ST_Union` over cells where `cells.feature = feature_id`. Done as a second function `aggregateFeatureGeometry()` exported from the same module — the orchestrator calls it after cells in Task 22.

- [ ] **Step 1: Add a test that exercises both phases**

Append to `tests/maps/fmg-full-json/ingesters/features.test.js`:

```js
import { aggregateFeatureGeometry } from '../../../../server/services/maps/fmg-full-json/ingesters/features.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('aggregateFeatureGeometry', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestFeatures(client, worldId, parsed, () => {});
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('unions cell polygons into each feature.geom', async () => {
    await aggregateFeatureGeometry(client, worldId, () => {});
    const { rows } = await client.query(
      `SELECT feature_id,
              CASE WHEN geom IS NULL THEN 0 ELSE ST_NumGeometries(geom) END AS ngeom
         FROM public.maps_features WHERE world_id = $1 ORDER BY feature_id`,
      [worldId],
    );
    expect(rows.find((r) => r.feature_id === 1).ngeom).toBeGreaterThan(0);
    expect(rows.find((r) => r.feature_id === 2).ngeom).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Extend the implementation**

Append to `server/services/maps/fmg-full-json/ingesters/features.js`:

```js
export async function aggregateFeatureGeometry(client, worldId, log) {
  log(0, 'Feature geometry');
  await client.query(
    `UPDATE public.maps_features f
        SET geom = sub.geom
       FROM (
         SELECT feature AS feature_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND feature IS NOT NULL
          GROUP BY feature
       ) sub
      WHERE f.world_id = $1 AND f.feature_id = sub.feature_id`,
    [worldId],
  );
  log(100, 'Feature geometry done');
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/features.test.js`
Expected: PASS (both blocks).

```bash
git add server/services/maps/fmg-full-json/ingesters/features.js tests/maps/fmg-full-json/ingesters/features.test.js
git commit -m "feat(maps): aggregate feature polygons from cells"
```

---

### Task 15: Polygon aggregation — cultures + religions + zones

**Files:**
- Modify: `server/services/maps/fmg-full-json/ingesters/cultures.js`
- Modify: `server/services/maps/fmg-full-json/ingesters/religions.js`
- Create: `server/services/maps/fmg-full-json/ingesters/zones.js`
- Test: `tests/maps/fmg-full-json/ingesters/zones.test.js`

Same ST_Union-over-cells pattern. Zones get scalars + geom in one ingester since they ship a `cells[]` array directly.

- [ ] **Step 1: Append `aggregateCultureGeometry` to cultures.js**

Append to `server/services/maps/fmg-full-json/ingesters/cultures.js`:

```js
export async function aggregateCultureGeometry(client, worldId, log) {
  log(0, 'Culture geometry');
  await client.query(
    `UPDATE public.maps_cultures c
        SET geom = sub.geom
       FROM (
         SELECT culture AS culture_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND culture IS NOT NULL
          GROUP BY culture
       ) sub
      WHERE c.world_id = $1 AND c.culture_id = sub.culture_id`,
    [worldId],
  );
  log(100, 'Culture geometry done');
}
```

- [ ] **Step 2: Append `aggregateReligionGeometry` to religions.js**

Append to `server/services/maps/fmg-full-json/ingesters/religions.js`:

```js
export async function aggregateReligionGeometry(client, worldId, log) {
  log(0, 'Religion geometry');
  await client.query(
    `UPDATE public.maps_religions r
        SET geom = sub.geom
       FROM (
         SELECT religion AS religion_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND religion IS NOT NULL
          GROUP BY religion
       ) sub
      WHERE r.world_id = $1 AND r.religion_id = sub.religion_id`,
    [worldId],
  );
  log(100, 'Religion geometry done');
}
```

- [ ] **Step 3: Write zones ingester + test**

Write to `tests/maps/fmg-full-json/ingesters/zones.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestZones } from '../../../../server/services/maps/fmg-full-json/ingesters/zones.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestZones', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts zone with cells[] and unioned geom', async () => {
    const { rowCount } = await ingestZones(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT zone_id, name, type, cells,
              CASE WHEN geom IS NULL THEN 0 ELSE ST_NumGeometries(geom) END AS ngeom
         FROM public.maps_zones WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ zone_id: 0, name: 'Tinyzone', type: 'Invasion' });
    expect(rows[0].cells).toEqual([0, 1]);
    expect(rows[0].ngeom).toBeGreaterThan(0);
  });
});
```

Write to `server/services/maps/fmg-full-json/ingesters/zones.js`:

```js
export async function ingestZones(client, worldId, parsed, log) {
  log(0, 'Zones');
  const zones = (parsed.pack?.zones || []).filter((z) => z && typeof z === 'object');
  if (zones.length === 0) { log(100, 'No zones'); return { rowCount: 0 }; }
  for (const z of zones) {
    const cellIds = Array.isArray(z.cells) ? z.cells : [];
    await client.query(
      `INSERT INTO public.maps_zones
        (world_id, zone_id, name, type, color, cells, geom)
       SELECT $1, $2, $3, $4, $5, $6,
              CASE WHEN $6::int[] = '{}' THEN NULL
                   ELSE (SELECT ST_Multi(ST_Union(geom)) FROM public.maps_cells
                          WHERE world_id = $1 AND cell_id = ANY($6::int[])) END
       ON CONFLICT (world_id, zone_id) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, color = EXCLUDED.color,
         cells = EXCLUDED.cells, geom = EXCLUDED.geom`,
      [worldId, z.i, z.name ?? null, z.type ?? null, z.color ?? null, cellIds],
    );
  }
  log(100, `${zones.length} zones`);
  return { rowCount: zones.length };
}
```

- [ ] **Step 4: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/zones.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/cultures.js server/services/maps/fmg-full-json/ingesters/religions.js server/services/maps/fmg-full-json/ingesters/zones.js tests/maps/fmg-full-json/ingesters/zones.test.js
git commit -m "feat(maps): aggregate culture/religion polygons; add zones ingester"
```

---

### Task 16: Ingester — states (scalars + COA-nested + campaigns + diplomacy + military)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/states.js`
- Test: `tests/maps/fmg-full-json/ingesters/states.test.js`

States are the heaviest entity — they nest `coa`, `campaigns`, `military`, `diplomacy`. The ingester writes the row + COA. Separate ingesters consume `campaigns` (Task 19), `diplomacy` (Task 20), `regiments` (Task 18). All read from `parsed.pack.states`.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/states.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestStates, aggregateStateGeometry } from '../../../../server/services/maps/fmg-full-json/ingesters/states.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestStates', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('writes state row + COA row', async () => {
    const { rowCount } = await ingestStates(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows: s } = await client.query(
      `SELECT state_id, name, full_name, type, pole_x, pole_y
         FROM public.maps_states WHERE world_id = $1 AND state_id = 1`,
      [worldId],
    );
    expect(s[0]).toMatchObject({
      name: 'Tinystate', full_name: 'Republic of Tinystate',
      type: 'Generic', pole_x: 5, pole_y: 5,
    });
    const { rows: coa } = await client.query(
      `SELECT owner_kind, owner_id, t1 FROM public.maps_coats_of_arms
        WHERE world_id = $1 AND owner_kind = 'state' AND owner_id = 1`,
      [worldId],
    );
    expect(coa[0]).toMatchObject({ owner_kind: 'state', owner_id: 1, t1: 'gules' });
  });

  test('aggregateStateGeometry unions cells per state', async () => {
    await aggregateStateGeometry(client, worldId, () => {});
    const { rows } = await client.query(
      `SELECT state_id, ST_NumGeometries(geom) AS n
         FROM public.maps_states WHERE world_id = $1 AND state_id = 1`,
      [worldId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/states.js`:

```js
import { upsertCoa } from './coats.js';

export async function ingestStates(client, worldId, parsed, log) {
  log(0, 'States');
  const states = (parsed.pack?.states || []).filter((s) => s && typeof s === 'object');
  if (states.length === 0) { log(100, 'No states'); return { rowCount: 0 }; }

  for (let idx = 0; idx < states.length; idx++) {
    const s = states[idx];
    const pole = Array.isArray(s.pole) ? s.pole : [null, null];
    const center = Array.isArray(s.center) ? s.center : null;
    await client.query(
      `INSERT INTO public.maps_states
        (world_id, state_id, name, full_name, form, form_name, color, type,
         culture, religion, capital_burg_id, expansionism, urban, rural, area,
         neighbors, center_x, center_y, pole_x, pole_y)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (world_id, state_id) DO UPDATE SET
         name=EXCLUDED.name, full_name=EXCLUDED.full_name, form=EXCLUDED.form,
         form_name=EXCLUDED.form_name, color=EXCLUDED.color, type=EXCLUDED.type,
         culture=EXCLUDED.culture, religion=EXCLUDED.religion,
         capital_burg_id=EXCLUDED.capital_burg_id, expansionism=EXCLUDED.expansionism,
         urban=EXCLUDED.urban, rural=EXCLUDED.rural, area=EXCLUDED.area,
         neighbors=EXCLUDED.neighbors, center_x=EXCLUDED.center_x, center_y=EXCLUDED.center_y,
         pole_x=EXCLUDED.pole_x, pole_y=EXCLUDED.pole_y`,
      [
        worldId, s.i, s.name ?? null, s.fullName ?? null, s.form ?? null,
        s.formName ?? null, s.color ?? null, s.type ?? null, s.culture ?? null,
        s.religion ?? null, s.capital ?? null, s.expansionism ?? null,
        s.urban ?? null, s.rural ?? null, s.area ?? null,
        Array.isArray(s.neighbors) ? s.neighbors : null,
        center?.[0] ?? null, center?.[1] ?? null, pole[0] ?? null, pole[1] ?? null,
      ],
    );
    if (s.coa) await upsertCoa(client, worldId, 'state', s.i, s.coa);
  }
  log(100, `${states.length} states`);
  return { rowCount: states.length };
}

export async function aggregateStateGeometry(client, worldId, log) {
  log(0, 'State geometry');
  await client.query(
    `UPDATE public.maps_states st
        SET geom = sub.geom
       FROM (
         SELECT state AS state_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND state IS NOT NULL AND state > 0
          GROUP BY state
       ) sub
      WHERE st.world_id = $1 AND st.state_id = sub.state_id`,
    [worldId],
  );
  log(100, 'State geometry done');
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/states.test.js`
Expected: FAIL on the COA import — `upsertCoa` doesn't exist yet. That's intentional; Task 17 implements it. Move on to Task 17 and circle back to re-run.

Commit the scaffolding:

```bash
git add server/services/maps/fmg-full-json/ingesters/states.js tests/maps/fmg-full-json/ingesters/states.test.js
git commit -m "feat(maps): add states ingester + geometry aggregation (COA hook TBD)"
```

---

### Task 17: Ingester — coats of arms helper

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/coats.js`
- Test: `tests/maps/fmg-full-json/ingesters/coats.test.js`

Shared helper used by states (Task 16), provinces (Task 21), and burgs (Task 23). Upserts a single COA row given owner kind + id + raw `coa` object.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/coats.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld } from '../db-harness.js';
import { upsertCoa } from '../../../../server/services/maps/fmg-full-json/ingesters/coats.js';

describeWithDb('upsertCoa', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); });
  afterAll(() => rollbackAndClose(client));

  test('inserts then updates a coat for same (kind, id)', async () => {
    await upsertCoa(client, worldId, 'state', 1, {
      shield: 'vesicaPiscis', t1: 'gules',
      charges: [{ charge: 'palmTree', t: 'or' }],
    });
    let { rows } = await client.query(
      `SELECT t1, charges FROM public.maps_coats_of_arms
        WHERE world_id=$1 AND owner_kind='state' AND owner_id=1`,
      [worldId],
    );
    expect(rows[0].t1).toBe('gules');

    await upsertCoa(client, worldId, 'state', 1, { shield: 'fantasy', t1: 'azure' });
    ({ rows } = await client.query(
      `SELECT t1 FROM public.maps_coats_of_arms
        WHERE world_id=$1 AND owner_kind='state' AND owner_id=1`,
      [worldId],
    ));
    expect(rows[0].t1).toBe('azure');
  });

  test('rejects unknown owner_kind', async () => {
    await expect(upsertCoa(client, worldId, 'banana', 1, {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/coats.js`:

```js
const VALID_KINDS = new Set(['state', 'province', 'burg']);

export async function upsertCoa(client, worldId, ownerKind, ownerId, coa) {
  if (!VALID_KINDS.has(ownerKind)) throw new Error(`invalid owner_kind: ${ownerKind}`);
  if (!coa || typeof coa !== 'object') return;
  await client.query(
    `INSERT INTO public.maps_coats_of_arms
       (world_id, owner_kind, owner_id, shield, t1, division, ordinaries, charges)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (world_id, owner_kind, owner_id) DO UPDATE SET
       shield = EXCLUDED.shield, t1 = EXCLUDED.t1,
       division = EXCLUDED.division, ordinaries = EXCLUDED.ordinaries,
       charges = EXCLUDED.charges`,
    [
      worldId, ownerKind, ownerId,
      coa.shield ?? null, coa.t1 ?? null,
      coa.division ? JSON.stringify(coa.division) : null,
      Array.isArray(coa.ordinaries) ? JSON.stringify(coa.ordinaries) : null,
      Array.isArray(coa.charges) ? JSON.stringify(coa.charges) : null,
    ],
  );
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/coats.test.js tests/maps/fmg-full-json/ingesters/states.test.js`
Expected: both PASS now.

```bash
git add server/services/maps/fmg-full-json/ingesters/coats.js tests/maps/fmg-full-json/ingesters/coats.test.js
git commit -m "feat(maps): add coats-of-arms upsert helper"
```

---

### Task 18: Ingester — regiments (from states[].military)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/regiments.js`
- Test: `tests/maps/fmg-full-json/ingesters/regiments.test.js`

Walks `parsed.pack.states[].military[]`. Each regiment carries `n` (total men) and `u.{infantry,archers,cavalry,artillery,fleet}`. Note `regiment.i` is unique within a state, NOT globally — table PK is `(world_id, state_id, regiment_id)`.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/regiments.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestRegiments } from '../../../../server/services/maps/fmg-full-json/ingesters/regiments.js';

describeWithDb('ingestRegiments', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('flattens states[].military[] into rows', async () => {
    const { rowCount } = await ingestRegiments(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT regiment_id, state_id, name, total_men, u_infantry, u_archers, u_cavalry,
              ST_AsText(geom) AS wkt
         FROM public.maps_regiments WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      regiment_id: 0, state_id: 1, name: '1st Tiny Regiment',
      u_infantry: 50, u_archers: 30, u_cavalry: 15,
    });
    expect(rows[0].wkt).toBe('POINT(5 5)');
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/regiments.js`:

```js
export async function ingestRegiments(client, worldId, parsed, log) {
  log(0, 'Regiments');
  const states = parsed.pack?.states || [];
  let count = 0;
  for (const s of states) {
    if (!s || !Array.isArray(s.military)) continue;
    for (const r of s.military) {
      const u = r.u || {};
      await client.query(
        `INSERT INTO public.maps_regiments
          (world_id, regiment_id, state_id, name, icon, cell, x_px, y_px,
           base_x, base_y, total_men, attack_value,
           u_infantry, u_archers, u_cavalry, u_artillery, u_fleet)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (world_id, state_id, regiment_id) DO UPDATE SET
           name=EXCLUDED.name, icon=EXCLUDED.icon, cell=EXCLUDED.cell,
           x_px=EXCLUDED.x_px, y_px=EXCLUDED.y_px,
           base_x=EXCLUDED.base_x, base_y=EXCLUDED.base_y,
           total_men=EXCLUDED.total_men, attack_value=EXCLUDED.attack_value,
           u_infantry=EXCLUDED.u_infantry, u_archers=EXCLUDED.u_archers,
           u_cavalry=EXCLUDED.u_cavalry, u_artillery=EXCLUDED.u_artillery,
           u_fleet=EXCLUDED.u_fleet`,
        [
          worldId, r.i, s.i, r.name ?? null, r.icon ?? null, r.cell ?? null,
          r.x ?? null, r.y ?? null, r.bx ?? null, r.by ?? null,
          r.n ?? null, r.a ?? null,
          u.infantry ?? null, u.archers ?? null, u.cavalry ?? null,
          u.artillery ?? null, u.fleet ?? null,
        ],
      );
      count++;
    }
  }
  log(100, `${count} regiments`);
  return { rowCount: count };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/regiments.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/regiments.js tests/maps/fmg-full-json/ingesters/regiments.test.js
git commit -m "feat(maps): add regiments ingester (FMG states[].military)"
```

---

### Task 19: Ingester — campaigns (FMG historical wars)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/campaigns.js`
- Test: `tests/maps/fmg-full-json/ingesters/campaigns.test.js`

Walks `parsed.pack.states[].campaigns[]`. Keyed by `(world_id, state_id, campaign_index)` because FMG doesn't give each campaign its own id — its array position within its state is the only stable id.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/campaigns.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestCampaigns } from '../../../../server/services/maps/fmg-full-json/ingesters/campaigns.js';

describeWithDb('ingestCampaigns', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes one row per state campaign', async () => {
    const { rowCount } = await ingestCampaigns(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT state_id, campaign_index, name, start_year, end_year
         FROM public.maps_campaigns WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      state_id: 1, campaign_index: 0, name: 'Tinywar',
      start_year: 1500, end_year: 1505,
    });
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/campaigns.js`:

```js
export async function ingestCampaigns(client, worldId, parsed, log) {
  log(0, 'Campaigns');
  const states = parsed.pack?.states || [];
  let count = 0;
  for (const s of states) {
    if (!s || !Array.isArray(s.campaigns)) continue;
    for (let idx = 0; idx < s.campaigns.length; idx++) {
      const c = s.campaigns[idx];
      await client.query(
        `INSERT INTO public.maps_campaigns
          (world_id, state_id, campaign_index, name, start_year, end_year,
           attacker, defender)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (world_id, state_id, campaign_index) DO UPDATE SET
           name=EXCLUDED.name, start_year=EXCLUDED.start_year,
           end_year=EXCLUDED.end_year, attacker=EXCLUDED.attacker,
           defender=EXCLUDED.defender`,
        [
          worldId, s.i, idx, c.name ?? null,
          c.start ?? null, c.end ?? null,
          c.attacker ?? null, c.defender ?? null,
        ],
      );
      count++;
    }
  }
  log(100, `${count} campaigns`);
  return { rowCount: count };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/campaigns.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/campaigns.js tests/maps/fmg-full-json/ingesters/campaigns.test.js
git commit -m "feat(maps): add FMG historical campaigns ingester"
```

---

### Task 20: Ingester — diplomacy matrix

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/diplomacy.js`
- Test: `tests/maps/fmg-full-json/ingesters/diplomacy.test.js`

FMG ships a square `state.diplomacy` array per state where `state.diplomacy[k]` is the relation from state.i to state with id k. We unfold the matrix into rows. Skip "x" entries (FMG sentinel for self/unknown).

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/diplomacy.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld } from '../db-harness.js';
import { ingestDiplomacy } from '../../../../server/services/maps/fmg-full-json/ingesters/diplomacy.js';

describeWithDb('ingestDiplomacy', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); });
  afterAll(() => rollbackAndClose(client));

  test('unfolds NxN matrix, skips sentinel "x"', async () => {
    const parsed = {
      pack: { states: [
        { i: 0, diplomacy: ['x', 'x', 'x'] },
        { i: 1, diplomacy: ['x', 'x', 'Ally'] },
        { i: 2, diplomacy: ['x', 'Ally', 'x'] },
      ]},
    };
    const { rowCount } = await ingestDiplomacy(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT state_a_id, state_b_id, status FROM public.maps_diplomacy
        WHERE world_id = $1 ORDER BY state_a_id, state_b_id`,
      [worldId],
    );
    expect(rows).toEqual([
      { state_a_id: 1, state_b_id: 2, status: 'Ally' },
      { state_a_id: 2, state_b_id: 1, status: 'Ally' },
    ]);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/diplomacy.js`:

```js
export async function ingestDiplomacy(client, worldId, parsed, log) {
  log(0, 'Diplomacy');
  const states = parsed.pack?.states || [];
  let count = 0;
  for (const s of states) {
    if (!s || !Array.isArray(s.diplomacy)) continue;
    for (let b = 0; b < s.diplomacy.length; b++) {
      const status = s.diplomacy[b];
      if (!status || status === 'x') continue;
      await client.query(
        `INSERT INTO public.maps_diplomacy (world_id, state_a_id, state_b_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (world_id, state_a_id, state_b_id) DO UPDATE SET status = EXCLUDED.status`,
        [worldId, s.i, b, status],
      );
      count++;
    }
  }
  log(100, `${count} diplomacy edges`);
  return { rowCount: count };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/diplomacy.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/diplomacy.js tests/maps/fmg-full-json/ingesters/diplomacy.test.js
git commit -m "feat(maps): add diplomacy matrix ingester"
```

---

### Task 21: Ingester — provinces (scalars + COA + geom aggregation)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/provinces.js`
- Test: `tests/maps/fmg-full-json/ingesters/provinces.test.js`

Like states but lighter — no military, no campaigns, no diplomacy. Province slot 0 in FMG is the integer 0 (a sentinel, not an object) so we skip non-objects.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/provinces.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestProvinces, aggregateProvinceGeometry } from '../../../../server/services/maps/fmg-full-json/ingesters/provinces.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestProvinces', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('skips sentinel slot 0 and writes a row + COA for real provinces', async () => {
    const { rowCount } = await ingestProvinces(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT province_id, full_name, state_id FROM public.maps_provinces WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ province_id: 1, full_name: 'Tinyprov Province', state_id: 1 });
    const { rows: coa } = await client.query(
      `SELECT t1 FROM public.maps_coats_of_arms
        WHERE world_id = $1 AND owner_kind = 'province' AND owner_id = 1`,
      [worldId],
    );
    expect(coa[0].t1).toBe('sable');
  });

  test('aggregateProvinceGeometry unions cells per province', async () => {
    await aggregateProvinceGeometry(client, worldId, () => {});
    const { rows } = await client.query(
      `SELECT province_id, ST_NumGeometries(geom) AS n
         FROM public.maps_provinces WHERE world_id = $1 AND province_id = 1`,
      [worldId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/provinces.js`:

```js
import { upsertCoa } from './coats.js';

export async function ingestProvinces(client, worldId, parsed, log) {
  log(0, 'Provinces');
  const provinces = (parsed.pack?.provinces || []).filter((p) => p && typeof p === 'object');
  if (provinces.length === 0) { log(100, 'No provinces'); return { rowCount: 0 }; }
  for (const p of provinces) {
    const pole = Array.isArray(p.pole) ? p.pole : [null, null];
    await client.query(
      `INSERT INTO public.maps_provinces
        (world_id, province_id, name, full_name, form_name, color,
         state_id, burg_id, center_x, center_y)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (world_id, province_id) DO UPDATE SET
         name=EXCLUDED.name, full_name=EXCLUDED.full_name,
         form_name=EXCLUDED.form_name, color=EXCLUDED.color,
         state_id=EXCLUDED.state_id, burg_id=EXCLUDED.burg_id,
         center_x=EXCLUDED.center_x, center_y=EXCLUDED.center_y`,
      [
        worldId, p.i, p.name ?? null, p.fullName ?? null, p.formName ?? null,
        p.color ?? null, p.state ?? null, p.burg ?? null, pole[0] ?? null, pole[1] ?? null,
      ],
    );
    if (p.coa) await upsertCoa(client, worldId, 'province', p.i, p.coa);
  }
  log(100, `${provinces.length} provinces`);
  return { rowCount: provinces.length };
}

export async function aggregateProvinceGeometry(client, worldId, log) {
  log(0, 'Province geometry');
  await client.query(
    `UPDATE public.maps_provinces p
        SET geom = sub.geom
       FROM (
         SELECT province AS province_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND province IS NOT NULL AND province > 0
          GROUP BY province
       ) sub
      WHERE p.world_id = $1 AND p.province_id = sub.province_id`,
    [worldId],
  );
  log(100, 'Province geometry done');
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/provinces.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/provinces.js tests/maps/fmg-full-json/ingesters/provinces.test.js
git commit -m "feat(maps): add provinces ingester + geometry aggregation"
```

---

### Task 22: Ingester — burgs (full FMG fields + COA)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/burgs.js`
- Test: `tests/maps/fmg-full-json/ingesters/burgs.test.js`

Direct burg-array walk (no GeoJSON wrapping). Writes existing `maps_burgs` columns plus the new ones from Task 1 (`type`, `is_large_port`, `is_regional_center`, `settlement_type`, `base_population`, `"group"`, `feature`). Migrates `coa` into `maps_coats_of_arms`. Burg slot 0 is FMG's sentinel; skip it.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/burgs.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestBurgs } from '../../../../server/services/maps/fmg-full-json/ingesters/burgs.js';

describeWithDb('ingestBurgs', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('skips sentinel slot 0, writes burg + COA with new columns', async () => {
    const { rowCount } = await ingestBurgs(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT burg_id, name, xpixel, ypixel, type, settlement_type, "group",
              base_population, feature, state, culture, religion, province,
              capital, port, citadel, walls, plaza, temple, shanty,
              population, ST_AsText(geom) AS wkt
         FROM public.maps_burgs WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      burg_id: 1, name: 'Tinytown', xpixel: 5, ypixel: 5,
      type: 'Generic', settlement_type: 'capital',
      group: 'capital', feature: 1,
      state: 'Tinystate', culture: 'Tinyfolk', religion: 'Tinyfaith',
      capital: true, port: false, citadel: true, walls: true,
      plaza: true, temple: false, shanty: false,
      population: 3, // round of 2.5
    });
    expect(Number(rows[0].base_population)).toBeCloseTo(2.0);

    const { rows: coa } = await client.query(
      `SELECT t1 FROM public.maps_coats_of_arms
        WHERE world_id = $1 AND owner_kind = 'burg' AND owner_id = 1`,
      [worldId],
    );
    expect(coa[0].t1).toBe('or');
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/burgs.js`:

```js
import { upsertCoa } from './coats.js';

const PORT_THRESHOLD = 0.4;

function nameById(arr, id) {
  if (id == null) return null;
  const entity = Array.isArray(arr) ? arr[id] : null;
  if (!entity || typeof entity !== 'object') return null;
  return entity.name ?? null;
}

function intOrNull(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Math.round(Number(v));
}

export async function ingestBurgs(client, worldId, parsed, log) {
  log(0, 'Burgs');
  const burgs = (parsed.pack?.burgs || []).filter((b, i) => b && typeof b === 'object' && i > 0);
  if (burgs.length === 0) { log(100, 'No burgs'); return { rowCount: 0 }; }

  const states = parsed.pack?.states || [];
  const provinces = parsed.pack?.provinces || [];
  const cultures = parsed.pack?.cultures || [];
  const religions = parsed.pack?.religions || [];

  for (let idx = 0; idx < burgs.length; idx++) {
    const b = burgs[idx];
    await client.query(
      `INSERT INTO public.maps_burgs
        (world_id, burg_id, name, state, province, culture, religion,
         population, elevation, capital, port, citadel, walls, plaza,
         temple, shanty, xpixel, ypixel, cell, type, is_large_port,
         is_regional_center, settlement_type, base_population, "group", feature, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
               ST_SetSRID(ST_MakePoint($17, $18), 0))
       ON CONFLICT (world_id, burg_id) DO UPDATE SET
         name=EXCLUDED.name, state=EXCLUDED.state, province=EXCLUDED.province,
         culture=EXCLUDED.culture, religion=EXCLUDED.religion,
         population=EXCLUDED.population, elevation=EXCLUDED.elevation,
         capital=EXCLUDED.capital, port=EXCLUDED.port, citadel=EXCLUDED.citadel,
         walls=EXCLUDED.walls, plaza=EXCLUDED.plaza, temple=EXCLUDED.temple,
         shanty=EXCLUDED.shanty, xpixel=EXCLUDED.xpixel, ypixel=EXCLUDED.ypixel,
         cell=EXCLUDED.cell, type=EXCLUDED.type, is_large_port=EXCLUDED.is_large_port,
         is_regional_center=EXCLUDED.is_regional_center,
         settlement_type=EXCLUDED.settlement_type,
         base_population=EXCLUDED.base_population, "group"=EXCLUDED."group",
         feature=EXCLUDED.feature, geom=EXCLUDED.geom`,
      [
        worldId, b.i, b.name ?? null,
        nameById(states, b.state),
        nameById(provinces, b.province),
        nameById(cultures, b.culture),
        nameById(religions, b.religion),
        intOrNull(b.population),
        intOrNull(b.elevation),
        Boolean(b.capital),
        Boolean(b.port),
        Boolean(b.citadel),
        Boolean(b.walls),
        Boolean(b.plaza),
        Boolean(b.temple),
        Boolean(b.shanty),
        b.x ?? null, b.y ?? null,
        b.cell ?? null, b.type ?? null,
        b.port > PORT_THRESHOLD,
        Boolean(b.capital),
        b.settlementType ?? null, b.basePopulation ?? null,
        b.group ?? null, b.feature ?? null,
      ],
    );
    if (b.coa) await upsertCoa(client, worldId, 'burg', b.i, b.coa);
    if (idx % 200 === 0) log(Math.floor((idx / burgs.length) * 100), `burgs ${idx}/${burgs.length}`);
  }
  log(100, `${burgs.length} burgs`);
  return { rowCount: burgs.length };
}
```

The legacy text columns (`statefull`, `provincefull`, `temperature`, `temperaturelikeness`, `populationraw`, `xworld`, `yworld`, `settlement_generation_version`) all allow NULL — the INSERT omits them deliberately. They're remnants from the old GeoJSON ingester and remain in place for backward compatibility with pre-cutover rows.

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/burgs.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/burgs.js tests/maps/fmg-full-json/ingesters/burgs.test.js
git commit -m "feat(maps): add burgs ingester for FMG full JSON (with COA)"
```

---

### Task 23: Ingester — rivers (full FMG fields + LineString)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/rivers.js`
- Test: `tests/maps/fmg-full-json/ingesters/rivers.test.js`

FMG rivers carry `cells[]` (the cell ids forming the river path). Geometry: connect the cell centroids (`pack.cells[i].p`) along the path → LineString.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/rivers.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestRivers } from '../../../../server/services/maps/fmg-full-json/ingesters/rivers.js';

describeWithDb('ingestRivers', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes rivers with parent/basin/width factors', async () => {
    const { rowCount } = await ingestRivers(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT river_id, name, parent, basin, source_width, width_factor,
              ST_NPoints(geom) AS pts
         FROM public.maps_rivers WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      river_id: 1, name: 'Tinyriver', parent: 1, basin: 1,
    });
    expect(Number(rows[0].source_width)).toBeCloseTo(0.1);
    expect(rows[0].pts).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/rivers.js`:

```js
function lineWktFromCellCentroids(cellIds, cellsById) {
  const pts = [];
  for (const id of cellIds) {
    const c = cellsById.get(id);
    if (!c || !Array.isArray(c.p)) continue;
    pts.push(`${c.p[0]} ${c.p[1]}`);
  }
  if (pts.length < 2) return null;
  return `LINESTRING(${pts.join(',')})`;
}

export async function ingestRivers(client, worldId, parsed, log) {
  log(0, 'Rivers');
  const rivers = (parsed.pack?.rivers || []).filter((r) => r && typeof r === 'object');
  if (rivers.length === 0) { log(100, 'No rivers'); return { rowCount: 0 }; }

  const cellsById = new Map();
  for (const c of (parsed.pack?.cells || [])) cellsById.set(c.i, c);

  for (const r of rivers) {
    const wkt = lineWktFromCellCentroids(Array.isArray(r.cells) ? r.cells : [], cellsById);
    await client.query(
      `INSERT INTO public.maps_rivers
        (world_id, river_id, name, type, discharge, length, width,
         mouth, source, parent, basin, source_width, width_factor, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               CASE WHEN $14::text IS NULL THEN NULL
                    ELSE ST_Multi(ST_GeomFromText($14, 0)) END)
       ON CONFLICT (world_id, river_id) DO UPDATE SET
         name=EXCLUDED.name, type=EXCLUDED.type, discharge=EXCLUDED.discharge,
         length=EXCLUDED.length, width=EXCLUDED.width, mouth=EXCLUDED.mouth,
         source=EXCLUDED.source, parent=EXCLUDED.parent, basin=EXCLUDED.basin,
         source_width=EXCLUDED.source_width, width_factor=EXCLUDED.width_factor,
         geom=EXCLUDED.geom`,
      [
        worldId, r.i, r.name ?? null, r.type ?? null, r.discharge ?? null,
        r.length ?? null, r.width ?? null, r.mouth ?? null, r.source ?? null,
        r.parent ?? null, r.basin ?? null, r.sourceWidth ?? null,
        r.widthFactor ?? null, wkt,
      ],
    );
  }
  log(100, `${rivers.length} rivers`);
  return { rowCount: rivers.length };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/rivers.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/rivers.js tests/maps/fmg-full-json/ingesters/rivers.test.js
git commit -m "feat(maps): add rivers ingester for FMG full JSON"
```

---

### Task 24: Ingester — routes (group + type + LineString)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/routes.js`
- Test: `tests/maps/fmg-full-json/ingesters/routes.test.js`

FMG `route.points` is an array of `[x, y, cellId]` triples. We take the first two array elements as coordinates; the cell id is ignored at this layer.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/routes.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestRoutes } from '../../../../server/services/maps/fmg-full-json/ingesters/routes.js';

describeWithDb('ingestRoutes', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes route with group_name + linestring', async () => {
    const { rowCount } = await ingestRoutes(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT route_id, group_name, type, ST_AsText(geom) AS wkt
         FROM public.maps_routes WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ route_id: 0, group_name: 'roads', type: 'trail' });
    expect(rows[0].wkt).toBe('MULTILINESTRING((5 5,15 5))');
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/routes.js`:

```js
export async function ingestRoutes(client, worldId, parsed, log) {
  log(0, 'Routes');
  const routes = (parsed.pack?.routes || []).filter((r) => r && typeof r === 'object');
  if (routes.length === 0) { log(100, 'No routes'); return { rowCount: 0 }; }

  for (const r of routes) {
    if (!Array.isArray(r.points) || r.points.length < 2) continue;
    const wkt = `LINESTRING(${r.points.map((p) => `${p[0]} ${p[1]}`).join(',')})`;
    await client.query(
      `INSERT INTO public.maps_routes
        (world_id, route_id, name, type, feature, group_name, geom)
       VALUES ($1,$2,$3,$4,$5,$6, ST_Multi(ST_GeomFromText($7, 0)))
       ON CONFLICT (world_id, route_id) DO UPDATE SET
         name=EXCLUDED.name, type=EXCLUDED.type, feature=EXCLUDED.feature,
         group_name=EXCLUDED.group_name, geom=EXCLUDED.geom`,
      [worldId, r.i, r.name ?? null, r.type ?? null, r.feature ?? null, r.group ?? null, wkt],
    );
  }
  log(100, `${routes.length} routes`);
  return { rowCount: routes.length };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/routes.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/routes.js tests/maps/fmg-full-json/ingesters/routes.test.js
git commit -m "feat(maps): add routes ingester for FMG full JSON"
```

---

### Task 25: Ingester — markers (point only, no notes here)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/markers.js`
- Test: `tests/maps/fmg-full-json/ingesters/markers.test.js`

Direct point insert. Note text comes from `parsed.notes[]` and is linked via the notes ingester (Task 26) — markers themselves carry only icon + type + coords.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/markers.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestMarkers } from '../../../../server/services/maps/fmg-full-json/ingesters/markers.js';

describeWithDb('ingestMarkers', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes marker with icon + type + geom', async () => {
    const { rowCount } = await ingestMarkers(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT marker_id, icon, type, ST_AsText(geom) AS wkt
         FROM public.maps_markers WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ marker_id: 0, icon: 'V', type: 'volcanoes' });
    expect(rows[0].wkt).toBe('POINT(12 5)');
  });
});
```

(The test uses `'V'` in place of the volcano emoji to keep this plan file ASCII-safe — replace with the actual emoji from the fixture when implementing.)

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/markers.js`:

```js
export async function ingestMarkers(client, worldId, parsed, log) {
  log(0, 'Markers');
  const markers = (parsed.pack?.markers || []).filter((m) => m && typeof m === 'object');
  if (markers.length === 0) { log(100, 'No markers'); return { rowCount: 0 }; }

  for (const m of markers) {
    if (m.x == null || m.y == null) continue;
    await client.query(
      `INSERT INTO public.maps_markers
        (world_id, marker_id, type, icon, x_px, y_px, geom)
       VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_MakePoint($5, $6), 0))
       ON CONFLICT (world_id, marker_id) DO UPDATE SET
         type=EXCLUDED.type, icon=EXCLUDED.icon,
         x_px=EXCLUDED.x_px, y_px=EXCLUDED.y_px, geom=EXCLUDED.geom`,
      [worldId, m.i, m.type ?? null, m.icon ?? null, m.x, m.y],
    );
  }
  log(100, `${markers.length} markers`);
  return { rowCount: markers.length };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/markers.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/markers.js tests/maps/fmg-full-json/ingesters/markers.test.js
git commit -m "feat(maps): add markers ingester for FMG full JSON"
```

---

### Task 26: Ingester — notes (raw FMG legend text, no auto-lore)

**Files:**
- Create: `server/services/maps/fmg-full-json/ingesters/notes.js`
- Test: `tests/maps/fmg-full-json/ingesters/notes.test.js`

FMG note ids follow conventions: `"burg{id}"`, `"regiment{stateId}-{regimentId}"`, `"state{id}"`, `"river{id}"`, `"province{id}"`, `"culture{id}"`, `"religion{id}"`, `"zone{id}"`, `"marker{id}"`. We parse the prefix to set `target_kind` and `target_id`. Sanitize null bytes per spec risks table.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/ingesters/notes.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestNotes, parseNoteTarget } from '../../../../server/services/maps/fmg-full-json/ingesters/notes.js';

describe('parseNoteTarget', () => {
  test('extracts target kind + id from FMG conventions', () => {
    expect(parseNoteTarget('burg42')).toEqual({ kind: 'burg', id: '42' });
    expect(parseNoteTarget('regiment3-7')).toEqual({ kind: 'regiment', id: '3-7' });
    expect(parseNoteTarget('state12')).toEqual({ kind: 'state', id: '12' });
    expect(parseNoteTarget('province5')).toEqual({ kind: 'province', id: '5' });
    expect(parseNoteTarget('marker99')).toEqual({ kind: 'marker', id: '99' });
  });
  test('falls back to unknown kind', () => {
    expect(parseNoteTarget('foobar0')).toEqual({ kind: 'unknown', id: 'foobar0' });
  });
});

describeWithDb('ingestNotes', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes notes raw, no auto-lore', async () => {
    const { rowCount } = await ingestNotes(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT target_kind, target_id, name FROM public.maps_notes
        WHERE world_id = $1 ORDER BY target_kind, target_id`,
      [worldId],
    );
    expect(rows).toEqual([
      { target_kind: 'burg', target_id: '1', name: 'Tinytown' },
      { target_kind: 'regiment', target_id: '1-0', name: '1st Tiny Regiment' },
    ]);
  });

  test('strips null bytes from legend text', async () => {
    const dirty = { notes: [{ id: 'burg99', name: 'X', legend: 'a b' }] };
    await ingestNotes(client, worldId, dirty, () => {});
    const { rows } = await client.query(
      `SELECT legend FROM public.maps_notes
        WHERE world_id = $1 AND target_kind = 'burg' AND target_id = '99'`,
      [worldId],
    );
    expect(rows[0].legend).toBe('ab');
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/ingesters/notes.js`:

```js
const KIND_RE = /^(burg|regiment|state|province|culture|religion|zone|river|marker)(.+)$/;

export function parseNoteTarget(id) {
  if (typeof id !== 'string') return { kind: 'unknown', id: String(id ?? '') };
  const m = KIND_RE.exec(id);
  if (!m) return { kind: 'unknown', id };
  return { kind: m[1], id: m[2] };
}

function stripNullBytes(text) {
  if (text == null) return null;
  return String(text).replace(/ /g, '');
}

export async function ingestNotes(client, worldId, parsed, log) {
  log(0, 'Notes');
  const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
  if (notes.length === 0) { log(100, 'No notes'); return { rowCount: 0 }; }
  let count = 0;
  for (const n of notes) {
    if (!n || !n.id) continue;
    const { kind, id } = parseNoteTarget(n.id);
    await client.query(
      `INSERT INTO public.maps_notes (world_id, target_kind, target_id, name, legend)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (world_id, target_kind, target_id) DO UPDATE SET
         name = EXCLUDED.name, legend = EXCLUDED.legend`,
      [worldId, kind, id, stripNullBytes(n.name), stripNullBytes(n.legend)],
    );
    count++;
  }
  log(100, `${count} notes`);
  return { rowCount: count };
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/ingesters/notes.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/ingesters/notes.js tests/maps/fmg-full-json/ingesters/notes.test.js
git commit -m "feat(maps): add raw notes ingester (no auto-lore)"
```

---

### Task 27: Orchestrator — `index.js` (transaction + FK order + per-stage progress)

**Files:**
- Create: `server/services/maps/fmg-full-json/index.js`
- Test: `tests/maps/fmg-full-json/orchestrator.test.js`

Public entry point. Opens one transaction, runs every ingester in FK order, reports per-stage progress to the caller via the `onProgress` callback, calls the existing settlemaker auto-trigger after burgs + routes commit, returns a per-stage report.

Stage order (locked from spec §Ingest pipeline):

```
world → biomes → features → cultures → religions → cells →
states → provinces → coats(state,province baked in) → burgs →
rivers → routes → markers → regiments → campaigns → diplomacy →
zones → notes →
aggregate(feature, culture, religion, state, province geom)
```

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/orchestrator.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture, FIXTURE_PATH } from './db-harness.js';
import { ingestFullJson } from '../../../server/services/maps/fmg-full-json/index.js';
import * as pool from '../../../server/db/pool.js';

describeWithDb('ingestFullJson (orchestrator)', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); });
  afterAll(() => rollbackAndClose(client));

  test('runs every stage, reports progress, returns per-stage rowCounts', async () => {
    const stages = [];
    const report = await ingestFullJson(
      worldId,
      FIXTURE_PATH,
      { client, onProgress: (s) => stages.push(s.stage) },
    );
    expect(report.stages.cells.rowCount).toBe(3);
    expect(report.stages.states.rowCount).toBe(2);
    expect(report.stages.burgs.rowCount).toBe(1);
    expect(report.stages.notes.rowCount).toBe(2);
    expect(stages).toEqual(expect.arrayContaining([
      'world', 'biomes', 'features', 'cultures', 'religions', 'cells',
      'states', 'provinces', 'burgs', 'rivers', 'routes', 'markers',
      'regiments', 'campaigns', 'diplomacy', 'zones', 'notes',
    ]));
  });
});
```

The orchestrator accepts an optional `client` for tests that already have a transaction open. In production (Task 28), the orchestrator opens its own via `withTransaction`.

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/index.js`:

```js
import { withTransaction } from '../../../db/pool.js';
import { parseFmgFile } from './parser.js';
import { validateParsedFmg } from './validators.js';
import { ingestWorld } from './ingesters/world.js';
import { ingestBiomes } from './ingesters/biomes.js';
import { ingestFeatures, aggregateFeatureGeometry } from './ingesters/features.js';
import { ingestCultures, aggregateCultureGeometry } from './ingesters/cultures.js';
import { ingestReligions, aggregateReligionGeometry } from './ingesters/religions.js';
import { ingestCells } from './ingesters/cells.js';
import { ingestStates, aggregateStateGeometry } from './ingesters/states.js';
import { ingestProvinces, aggregateProvinceGeometry } from './ingesters/provinces.js';
import { ingestBurgs } from './ingesters/burgs.js';
import { ingestRivers } from './ingesters/rivers.js';
import { ingestRoutes } from './ingesters/routes.js';
import { ingestMarkers } from './ingesters/markers.js';
import { ingestRegiments } from './ingesters/regiments.js';
import { ingestCampaigns } from './ingesters/campaigns.js';
import { ingestDiplomacy } from './ingesters/diplomacy.js';
import { ingestZones } from './ingesters/zones.js';
import { ingestNotes } from './ingesters/notes.js';
import { ingestBurgEntrancesForWorldIfReady } from '../ingestion-service.js';

const STAGE_ORDER = [
  ['world', ingestWorld],
  ['biomes', ingestBiomes],
  ['features', ingestFeatures],
  ['cultures', ingestCultures],
  ['religions', ingestReligions],
  ['cells', ingestCells],
  ['states', ingestStates],
  ['provinces', ingestProvinces],
  ['burgs', ingestBurgs],
  ['rivers', ingestRivers],
  ['routes', ingestRoutes],
  ['markers', ingestMarkers],
  ['regiments', ingestRegiments],
  ['campaigns', ingestCampaigns],
  ['diplomacy', ingestDiplomacy],
  ['zones', ingestZones],
  ['notes', ingestNotes],
];

const AGGREGATIONS = [
  ['feature_geom', aggregateFeatureGeometry],
  ['culture_geom', aggregateCultureGeometry],
  ['religion_geom', aggregateReligionGeometry],
  ['state_geom', aggregateStateGeometry],
  ['province_geom', aggregateProvinceGeometry],
];

export async function ingestFullJson(worldId, filePath, options = {}) {
  const { client: externalClient, onProgress = () => {} } = options;
  const parsed = await parseFmgFile(filePath);
  validateParsedFmg(parsed);

  const run = async (client) => {
    const stages = {};
    const totalStages = STAGE_ORDER.length + AGGREGATIONS.length;
    let stageIdx = 0;

    for (const [name, fn] of STAGE_ORDER) {
      const log = (percent, message) => onProgress({
        stage: name,
        percent: Math.floor(((stageIdx + percent / 100) / totalStages) * 100),
        message: message || name,
      });
      stages[name] = await fn(client, worldId, parsed, log);
      stageIdx++;
    }

    for (const [name, fn] of AGGREGATIONS) {
      const log = (percent, message) => onProgress({
        stage: name,
        percent: Math.floor(((stageIdx + percent / 100) / totalStages) * 100),
        message: message || name,
      });
      await fn(client, worldId, log);
      stages[name] = { rowCount: null };
      stageIdx++;
    }

    return { worldId, stages };
  };

  let report;
  if (externalClient) {
    report = await run(externalClient);
  } else {
    report = await withTransaction(run, { label: 'fmg.full_json.ingest' });
    await ingestBurgEntrancesForWorldIfReady(worldId);
  }
  onProgress({ stage: 'done', percent: 100, message: 'Ingest complete' });
  return report;
}
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/orchestrator.test.js`
Expected: PASS.

```bash
git add server/services/maps/fmg-full-json/index.js tests/maps/fmg-full-json/orchestrator.test.js
git commit -m "feat(maps): orchestrate FMG full JSON ingest under one transaction"
```

---

### Task 28: Job runner — async setImmediate worker + import_jobs writes

**Files:**
- Create: `server/services/maps/fmg-full-json/job-runner.js`
- Test: `tests/maps/fmg-full-json/job-runner.test.js`

Returns a job id immediately, runs the ingest in the next tick, writes per-stage progress to `maps_import_jobs`. No external infra. If the orchestrator throws, the job row is marked `failed` and the error string is stored.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/job-runner.test.js`:

```js
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, FIXTURE_PATH } from './db-harness.js';
import { startImportJob, waitForJob } from '../../../server/services/maps/fmg-full-json/job-runner.js';

describeWithDb('job-runner', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); await client.query('COMMIT'); await client.query('BEGIN'); });
  afterAll(() => rollbackAndClose(client));

  test('startImportJob returns a job id, runs in background, completes', async () => {
    const { jobId } = await startImportJob({ worldId, filePath: FIXTURE_PATH, uploadedBy: null });
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    const final = await waitForJob(jobId, { timeoutMs: 15000 });
    expect(final.status).toBe('completed');
    expect(final.percent).toBe(100);
  });
});
```

- [ ] **Step 2: Implement**

Write to `server/services/maps/fmg-full-json/job-runner.js`:

```js
import { query, withClient } from '../../../db/pool.js';
import { ingestFullJson } from './index.js';

export async function startImportJob({ worldId, filePath, uploadedBy, fileSizeBytes }) {
  const { rows } = await query(
    `INSERT INTO public.maps_import_jobs
      (world_id, status, stage, percent, message, file_path, file_size_bytes, uploaded_by)
     VALUES ($1, 'queued', 'pending', 0, 'Queued', $2, $3, $4)
     RETURNING id`,
    [worldId, filePath, fileSizeBytes ?? null, uploadedBy ?? null],
    { label: 'fmg.job.create' },
  );
  const jobId = rows[0].id;

  setImmediate(() => { runJob(jobId, worldId, filePath).catch(() => {}); });
  return { jobId };
}

async function runJob(jobId, worldId, filePath) {
  await query(
    `UPDATE public.maps_import_jobs SET status = 'running', updated_at = now()
      WHERE id = $1`,
    [jobId],
    { label: 'fmg.job.start' },
  );
  try {
    await ingestFullJson(worldId, filePath, {
      onProgress: async ({ stage, percent, message }) => {
        await query(
          `UPDATE public.maps_import_jobs
              SET stage = $2, percent = $3, message = $4, updated_at = now()
            WHERE id = $1`,
          [jobId, stage, percent, message || null],
          { label: 'fmg.job.progress' },
        );
      },
    });
    await query(
      `UPDATE public.maps_import_jobs
          SET status = 'completed', stage = 'done', percent = 100,
              message = 'Ingest complete', completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [jobId],
      { label: 'fmg.job.complete' },
    );
  } catch (err) {
    await query(
      `UPDATE public.maps_import_jobs
          SET status = 'failed', error = $2, updated_at = now()
        WHERE id = $1`,
      [jobId, String(err?.stack || err?.message || err)],
      { label: 'fmg.job.fail' },
    );
  }
}

export async function getJobStatus(jobId) {
  const { rows } = await query(
    `SELECT id, world_id, status, stage, percent, message, error,
            created_at, updated_at, completed_at
       FROM public.maps_import_jobs WHERE id = $1`,
    [jobId],
    { label: 'fmg.job.status' },
  );
  return rows[0] || null;
}

export async function waitForJob(jobId, { timeoutMs = 60000, pollMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getJobStatus(jobId);
    if (!s) throw new Error('job not found');
    if (s.status === 'completed' || s.status === 'failed') return s;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('job did not complete within timeout');
}
```

Note on the test: the test commits the seed world BEFORE the job runs because the background `setImmediate` worker uses its own pool connection — it can't see uncommitted data from the test's transaction. The cleanup happens by deleting the world via `ON DELETE CASCADE` in `afterAll`. Add this cleanup to the test:

```js
afterAll(async () => {
  await client.query('ROLLBACK');
  await query(`DELETE FROM public.maps_world WHERE id = $1`, [worldId]);
  await client.end();
});
```

- [ ] **Step 3: Run + commit**

Run: `npx jest tests/maps/fmg-full-json/job-runner.test.js --runInBand`
Expected: PASS within ~15s.

```bash
git add server/services/maps/fmg-full-json/job-runner.js tests/maps/fmg-full-json/job-runner.test.js
git commit -m "feat(maps): async job runner for FMG full JSON ingest"
```

---

### Task 29: HTTP — POST /api/upload/map/full-json

**Files:**
- Modify: `server/routes/uploads.routes.js`
- Test: smoke test only (the orchestrator + job-runner tests cover the path); manual curl verification below

The new endpoint accepts a multipart upload (field name: `jsonFile`), stages it to disk, creates an inactive `maps_world` row via `createOrUpdateWorld()` (using `info.width/height` from a quick header parse), then calls `startImportJob`. Returns 202 with `{worldId, jobId}`.

We avoid parsing the entire 70 MB file twice. Approach: stream the upload to disk, do a `head -c 2MB` peek to extract `info.width/height/mapName` via a small targeted parse (FMG always emits `info` before `pack`), then start the job.

- [ ] **Step 1: Add a header-peek helper**

Write to `server/services/maps/fmg-full-json/peek-header.js`:

```js
import { createReadStream } from 'node:fs';

const HEADER_BYTES = 2 * 1024 * 1024;  // first 2 MB always contains info{} block

export async function peekFmgHeader(filePath) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const stream = createReadStream(filePath, { start: 0, end: HEADER_BYTES });
    stream.on('data', (chunk) => {
      chunks.push(chunk); total += chunk.length;
      if (total >= HEADER_BYTES) stream.destroy();
    });
    stream.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const infoMatch = /"info"\s*:\s*(\{[^}]+\})/.exec(text);
      if (!infoMatch) return reject(new Error('FMG header: info{} not found in first 2MB'));
      try { resolve(JSON.parse(infoMatch[1])); } catch (e) { reject(e); }
    });
    stream.on('error', reject);
  });
}
```

- [ ] **Step 2: Wire the route**

Modify `server/routes/uploads.routes.js`. Around line 225 (after the SVG route), add:

```js
router.post(
  '/api/upload/map/full-json',
  requireAuth,
  upload.single('jsonFile'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'jsonFile is required' });
    try {
      const { peekFmgHeader } = await import('../services/maps/fmg-full-json/peek-header.js');
      const { createOrUpdateWorld } = await import('../services/maps/ingestion-service.js');
      const { startImportJob } = await import('../services/maps/fmg-full-json/job-runner.js');

      const info = await peekFmgHeader(req.file.path);
      const worldName = (req.body?.worldName || info.mapName || 'Untitled FMG world').slice(0, 200);
      const worldId = await createOrUpdateWorld({
        name: worldName,
        description: req.body?.description || null,
        widthPixels: info.width,
        heightPixels: info.height,
        metersPerPixel: null,
        uploadedBy: req.user?.id ?? null,
      });
      const { jobId } = await startImportJob({
        worldId, filePath: req.file.path,
        uploadedBy: req.user?.id ?? null,
        fileSizeBytes: req.file.size,
      });
      res.status(202).json({ worldId, jobId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);
```

(Where `requireAuth` and the `upload` multer middleware are already in scope in this file — check the existing SVG route at line 179 for the exact import names and reuse them. Replace `requireAuth` with whatever the existing routes use.)

- [ ] **Step 3: Manual smoke test**

Run the server (`npm run dev` from repo root), then in another shell:
```bash
curl -X POST http://localhost:3001/api/upload/map/full-json \
  -H "Cookie: <your-auth-cookie>" \
  -F "jsonFile=@./Jolliariana Full 2026-05-22-20-48.json" \
  -F "worldName=Jolliariana"
```
Expected: 202 with `{"worldId":"…","jobId":"…"}`.

- [ ] **Step 4: Commit**

```bash
git add server/services/maps/fmg-full-json/peek-header.js server/routes/uploads.routes.js
git commit -m "feat(maps): POST /api/upload/map/full-json endpoint"
```

---

### Task 30: HTTP — GET /api/upload/map/jobs/:jobId

**Files:**
- Modify: `server/routes/uploads.routes.js`

Poll endpoint. Returns the current `maps_import_jobs` row.

- [ ] **Step 1: Wire the route**

Add to `server/routes/uploads.routes.js`:

```js
router.get(
  '/api/upload/map/jobs/:jobId',
  requireAuth,
  async (req, res) => {
    try {
      const { getJobStatus } = await import('../services/maps/fmg-full-json/job-runner.js');
      const status = await getJobStatus(req.params.jobId);
      if (!status) return res.status(404).json({ error: 'job not found' });
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);
```

- [ ] **Step 2: Smoke test**

After starting a job from Task 29:
```bash
curl http://localhost:3001/api/upload/map/jobs/<jobId> -H "Cookie: <your-auth-cookie>"
```
Expected: JSON with `status`, `stage`, `percent`, `message`.

- [ ] **Step 3: Commit**

```bash
git add server/routes/uploads.routes.js
git commit -m "feat(maps): GET /api/upload/map/jobs/:jobId poll endpoint"
```

---

### Task 31: HTTP — DELETE /api/upload/map/:worldId

**Files:**
- Modify: `server/routes/uploads.routes.js`

Rolls back a partially-uploaded world. Cascades via the existing FKs on every `maps_*` table.

- [ ] **Step 1: Wire the route**

Add to `server/routes/uploads.routes.js`:

```js
router.delete(
  '/api/upload/map/:worldId',
  requireAuth,
  async (req, res) => {
    try {
      const { query } = await import('../db/pool.js');
      const result = await query(
        `DELETE FROM public.maps_world WHERE id = $1`,
        [req.params.worldId],
        { label: 'fmg.world.delete' },
      );
      res.json({ deleted: result.rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);
```

- [ ] **Step 2: Smoke test**

```bash
curl -X DELETE http://localhost:3001/api/upload/map/<worldId> -H "Cookie: <your-auth-cookie>"
```
Expected: `{"deleted":1}`.

- [ ] **Step 3: Commit**

```bash
git add server/routes/uploads.routes.js
git commit -m "feat(maps): DELETE /api/upload/map/:worldId for rollback"
```

---

### Task 32: Modify POST /api/upload/map/:worldId/svg to attach to existing world

**Files:**
- Modify: `server/routes/uploads.routes.js`

Old behaviour (line 179–225): POST `/api/upload/map/svg` (no worldId) creates a new world from the SVG dimensions. New behaviour: SVG attaches to an existing world. The Full JSON endpoint (Task 29) is now the world creator.

- [ ] **Step 1: Add the new route alongside the old one**

In `server/routes/uploads.routes.js`, ADD (do not delete the old `/api/upload/map/svg` yet — Plan B deletes it):

```js
router.post(
  '/api/upload/map/:worldId/svg',
  requireAuth,
  uploadSvg.single('svgFile'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'svgFile is required' });
    try {
      const { query } = await import('../db/pool.js');
      // Optional: store the SVG path on the world row
      await query(
        `UPDATE public.maps_world
            SET geojson_url = $2, updated_at = now()
          WHERE id = $1`,
        [req.params.worldId, req.file.path],
        { label: 'fmg.svg.attach' },
      );
      res.json({ ok: true, worldId: req.params.worldId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);
```

(`geojson_url` is the existing TEXT column on `maps_world` — the name is legacy; we reuse it for the SVG path until a future migration renames it. Don't change it as part of this plan.)

- [ ] **Step 2: Commit**

```bash
git add server/routes/uploads.routes.js
git commit -m "feat(maps): POST /api/upload/map/:worldId/svg attaches to existing world"
```

---

### Task 33: End-to-end test against the Jolliariana fixture

**Files:**
- Create: `tests/maps/fmg-full-json/e2e-jolliariana.test.js`

Slow integration test, skipped unless `RUN_E2E=1` is set. Ingests the 70 MB fixture and asserts the row counts from the spec's "Testing" section.

- [ ] **Step 1: Write the test**

Write to `tests/maps/fmg-full-json/e2e-jolliariana.test.js`:

```js
import path from 'node:path';
import { Client } from 'pg';
import { ingestFullJson } from '../../../server/services/maps/fmg-full-json/index.js';

const FIXTURE = path.resolve(__dirname, '../../../Jolliariana Full 2026-05-22-20-48.json');
const EXPECTED = {
  maps_states: 26,
  maps_provinces: 580,
  maps_cultures: 15,
  maps_religions: 21,
  maps_features: 201,
  maps_zones: 13,
  maps_regiments: 484,
  maps_campaigns: 104,
  maps_notes: 1296,
  maps_burgs: 19475,
  maps_routes: 11718,
  maps_rivers: 952,
  maps_markers: 1285,
  maps_cells: 66321,
};

const RUN = process.env.RUN_E2E === '1';
(RUN ? describe : describe.skip)('E2E: ingest Jolliariana fixture', () => {
  let client, worldId;
  beforeAll(async () => {
    client = new Client();
    await client.connect();
    const { rows } = await client.query(
      `INSERT INTO public.maps_world (name, width_pixels, height_pixels)
       VALUES ('E2E Jolliariana', 2133, 1103) RETURNING id`,
    );
    worldId = rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (worldId) await client.query(`DELETE FROM public.maps_world WHERE id = $1`, [worldId]);
    await client.end();
  });

  test('ingests fixture and matches expected counts', async () => {
    await ingestFullJson(worldId, FIXTURE);
    for (const [table, expected] of Object.entries(EXPECTED)) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM public.${table} WHERE world_id = $1`,
        [worldId],
      );
      expect({ table, count: rows[0].c }).toEqual({ table, count: expected });
    }
  }, 600000);

  test('three known burgs sit inside their owning state polygon', async () => {
    const { rows } = await client.query(
      `SELECT b.burg_id, b.name,
              ST_Contains(s.geom, b.geom) AS inside
         FROM public.maps_burgs b
         JOIN public.maps_states s ON s.world_id = b.world_id AND s.state_id = b.state
        WHERE b.world_id = $1 AND b.burg_id IN (1, 100, 500)`,
      [worldId],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.inside).toBe(true);
  });
});
```

- [ ] **Step 2: Run the e2e**

Run:
```bash
RUN_E2E=1 npx jest tests/maps/fmg-full-json/e2e-jolliariana.test.js --runInBand
```
Expected: PASS within ~30–60s on the 70 MB fixture.

- [ ] **Step 3: Commit**

```bash
git add tests/maps/fmg-full-json/e2e-jolliariana.test.js
git commit -m "test(maps): E2E ingest of Jolliariana FMG full JSON fixture"
```

---

### Task 34: Verify settlemaker auto-trigger still fires

**Files:**
- (No new files — this is a verification step.)

The orchestrator calls `ingestBurgEntrancesForWorldIfReady(worldId)` after the main transaction commits. The settlemaker service is idempotent. We verify with a separate assertion.

- [ ] **Step 1: Append to the e2e test**

In `tests/maps/fmg-full-json/e2e-jolliariana.test.js`, add inside the `RUN_E2E` describe block:

```js
test('settlemaker auto-trigger ran (burg entrances populated)', async () => {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM public.maps_burg_entrances be
       JOIN public.maps_burgs b ON b.id = be.burg_id
      WHERE b.world_id = $1`,
    [worldId],
  );
  expect(rows[0].c).toBeGreaterThan(0);
}, 300000);
```

- [ ] **Step 2: Run**

```bash
RUN_E2E=1 npx jest tests/maps/fmg-full-json/e2e-jolliariana.test.js --runInBand
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/maps/fmg-full-json/e2e-jolliariana.test.js
git commit -m "test(maps): verify settlemaker auto-trigger after FMG ingest"
```

---

### Task 35: Push to remote and open a PR

- [ ] **Step 1: Push**

```bash
git push -u origin main
```

(Or push to a feature branch if you prefer review-then-merge — check current branch with `git branch --show-current`. The repo workflow per `git log` is direct-to-main with verified pushes.)

- [ ] **Step 2: Verify CI passes**

If a remote CI is configured, watch for green. Otherwise this plan is locally verified by the tests above.

---

## Self-review checklist

Run through these before considering Plan A done.

**Spec coverage:**
- ✅ §Data model — Task 1 creates all 13 new tables + ALTERs + emblem migration.
- ✅ §Ingest pipeline — Tasks 4–27 cover the module layout exactly as the spec defines.
- ✅ §Transaction & ordering — Task 27 (orchestrator) implements the FK-ordered stages.
- ✅ §Geometry derivation algorithm — Tasks 4 (cell polygons), 13 (COPY into cells), 14–15 + 21 (ST_Union aggregations).
- ✅ §Sync vs async — Task 28 (job runner) + Tasks 29–30 (endpoints).
- ✅ §Validation — Task 5 (validators).
- ✅ §API endpoints — Tasks 29 (full-json POST), 30 (jobs GET), 31 (world DELETE), 32 (SVG attach).
- ✅ §Acceptance criteria — Tasks 33–34 (e2e + settlemaker).
- ⚠ §Files removed — old per-layer endpoint + wizard step components stay until Plan B.

**Type / signature consistency:**
- All ingesters take `(client, worldId, parsed, log)` — checked across Tasks 8–26.
- All aggregators take `(client, worldId, log)` — checked across Tasks 14, 15, 16, 21.
- `upsertCoa(client, worldId, ownerKind, ownerId, coa)` — used identically in states, provinces, burgs.
- `startImportJob({ worldId, filePath, uploadedBy, fileSizeBytes })` — same shape in Tasks 28, 29.

**Placeholder scan:**
- No "TBD" / "implement later" / "similar to Task N" left.
- Every code step has runnable code or a runnable shell command with expected output.

---

## Out of scope (this plan)

- Wizard UI rewrite, deletion of old `LayerUploadStep`, new OpenLayers layers for states/provinces/cultures/religions/zones/regiments — **Plan B**.
- Deletion of the old `POST /api/upload/map/:worldId/layer` route and the per-layer ingesters in `ingestion-service.js` — **Plan B**.
- Returning 410 Gone on legacy endpoints — **Plan B**.
- Lon/lat reprojection (deferred per spec).
- `grid` raw heightmap/climate ingest (deferred per spec).
- Re-import / patch existing maps (deferred per spec).





