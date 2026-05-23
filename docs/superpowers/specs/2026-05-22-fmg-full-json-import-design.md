# FMG Full JSON Import — Design

**Date:** 2026-05-22
**Status:** Approved (brainstorming)
**Author:** brainstorm session with Claude

## Problem

Questables currently imports FMG (Azgaar's Fantasy Map Generator) maps via a
6-step wizard that takes one SVG canvas plus five pre-converted GeoJSON layers
(cells, burgs, routes, rivers, markers). The user must run external tooling to
convert FMG's outputs into GeoJSON before upload.

This flow imports a small subset of what FMG produces. The unused data includes:

- **Military**: 484 regiments across 25 states, 104 historical campaigns, full
  state-vs-state diplomacy matrix, coats of arms.
- **Polity polygons**: states (26), provinces (580), cultures (15), religions
  (21), zones (13).
- **Lore**: 1,296 free-form FMG notes attached to entities.
- **Reference data**: biomesData lookup, river basin/parent/discharge, burg
  flags (isLargePort, settlementType, group, basePopulation), feature
  landmass/lake polygons.

The current importer in fact already accepts FMG Full JSON files on the SVG
endpoint, but only extracts `info.width/height/version` and discards the rest.

## Goal

Replace the per-layer GeoJSON wizard with a single Full JSON ingest that
imports everything FMG exports (excluding raw `grid` heightmap/climate, which
is deferred). New maps will populate ~13 new tables plus enrichments on
existing ones; existing pre-cutover maps are left alone.

## Decisions (locked in brainstorm)

1. **Clean cutover.** Replace the 6-step wizard; delete the per-layer
   `/api/upload/map/:worldId/layer` endpoint.
2. **No backfill.** Existing maps keep working with the data they have. Only
   newly-uploaded Full JSON maps get the new tables populated.
3. **Server-side polygon derivation** from `pack.cells[].v[]` +
   `pack.vertices[].p[x,y]`. No client-side preprocessing, no external tooling.
4. **Full scope this migration**: states, provinces, military
   (regiments + campaigns + diplomacy + COA), cultures, religions, zones,
   notes, biomesData, plus burg/river/route/cell enrichments.
5. **Notes stored raw only.** No auto-seeding into the existing LLM lore
   system; lore continues to emerge from play.
6. **SVG still uploaded separately** for rendered base-map display. Two files
   total: Full JSON (data) + SVG (image).

## Architecture

```
                        ┌────────────────────────────────────────┐
   Browser              │  POST /api/upload/map/full-json        │
   ┌─────────┐  Full    │   (Full JSON multipart, ~70MB)         │
   │ wizard  │───JSON──▶│                                        │
   │ (new)   │          │  POST /api/upload/map/:worldId/svg     │
   └─────────┘  + SVG──▶│   (rendered SVG, unchanged endpoint)   │
                        └─────────────────┬──────────────────────┘
                                          │
                                          ▼
                        ┌────────────────────────────────────────┐
                        │  fmg-full-json-ingester  (new service) │
                        │                                        │
                        │  parse → derive polygons → bulk insert │
                        │   in one PG transaction, in order:     │
                        │                                        │
                        │   world → biomesData → cultures →      │
                        │   religions → features → cells →       │
                        │   states → provinces → burgs →         │
                        │   rivers → routes → markers →          │
                        │   regiments → campaigns → diplomacy →  │
                        │   coa → zones → notes                  │
                        └─────────────────┬──────────────────────┘
                                          │
                                          ▼
                        ┌────────────────────────────────────────┐
                        │  existing settlemaker auto-trigger     │
                        │  (fires after burgs + routes land)     │
                        └────────────────────────────────────────┘
```

The new flow is a single `fmg-full-json-ingester` service that the new
endpoint dispatches to. Runs the whole ingest in one PG transaction; on
failure the world is rolled back and the upload reports which stage failed.
Settlemaker's auto-trigger is preserved as-is — once burgs + routes are
committed it runs in the same post-commit hook it does today.

## Data model

**13 new tables.** All `SRID 0` pixel-space, all scoped by `world_id`, all
keyed by `(world_id, <fmg_id>)` for upsert idempotency.

### Geometry-bearing (built server-side from cells+vertices)

```sql
maps_states          id, world_id, state_id, name, full_name, form, form_name,
                     color, type, culture, religion, capital_burg_id,
                     expansionism, urban, rural, area, neighbors INT[],
                     center_x, center_y, pole_x, pole_y,
                     geom geometry(MultiPolygon,0)

maps_provinces       id, world_id, province_id, name, full_name, form_name,
                     color, state_id, burg_id, center_x, center_y,
                     geom geometry(MultiPolygon,0)

maps_cultures        id, world_id, culture_id, name, code, color, type,
                     base, expansionism, center_cell,
                     geom geometry(MultiPolygon,0)

maps_religions       id, world_id, religion_id, name, code, color, type, form,
                     deity, culture, expansion, expansionism,
                     center_cell, origins INT[],
                     geom geometry(MultiPolygon,0)

maps_features        id, world_id, feature_id, name, type, group_name,
                     land BOOLEAN, area, height, flux, temp, evaporation,
                     first_cell, outlet,
                     geom geometry(MultiPolygon,0),         -- landmass/lake polygon
                     shoreline_geom geometry(MultiLineString,0)

maps_zones           id, world_id, zone_id, name, type, color, cells INT[],
                     geom geometry(MultiPolygon,0)
```

### Military / political (point + scalar)

```sql
maps_regiments       id, world_id, regiment_id, state_id, name, icon,
                     cell, x_px, y_px, base_x, base_y,
                     total_men n, attack_value a,
                     u_infantry, u_archers, u_cavalry, u_artillery, u_fleet,
                     geom geometry(Point,0)

maps_campaigns       id, world_id, state_id, campaign_index, name,
                     start_year, end_year, attacker, defender
                     -- COMMENT: FMG historical war record; NOT the Questables
                     -- RPG-campaign concept. Table is intentionally namespaced
                     -- with the maps_ prefix to make this distinction obvious.

maps_diplomacy       world_id, state_a_id, state_b_id, status
                     PK (world_id, state_a_id, state_b_id)
                     -- e.g. 'Ally','Friendly','Neutral','Suspicion','Rival','Enemy','Unknown'

maps_coats_of_arms   id, world_id, owner_kind ('state'|'province'|'burg'),
                     owner_id, shield, t1, division JSONB,
                     ordinaries JSONB, charges JSONB
                     -- existing maps_burgs.emblem JSONB is migrated here and
                     -- dropped on cutover
```

### Reference / lore

```sql
maps_biomes          world_id, biome_id, name, color, habitability, icons_csv,
                     biomes_martin TEXT, cost INT
                     PK (world_id, biome_id)
                     -- one row per FMG biome, world-scoped because FMG users
                     -- can tune biome props per export

maps_notes           id, world_id, target_kind, target_id, name, legend
                     -- target_kind: 'burg','state','province','marker','river',
                     --              'culture','religion','zone'
                     -- target_id: FMG id within that kind (joined via world_id+id)
                     -- stored raw; LLM lore system does NOT auto-ingest
```

### Enrichments to existing tables (ALTER TABLE)

```sql
maps_burgs   + type TEXT, is_large_port BOOLEAN, is_regional_center BOOLEAN,
               settlement_type TEXT, base_population INT, "group" TEXT,
               feature INT
             - emblem JSONB        -- DROPPED; migrate into maps_coats_of_arms

maps_cells   + flux INT, confluence INT, river_id INT,
               haven INT, harbor INT, pop NUMERIC

maps_rivers  + parent INT, basin INT, source_width NUMERIC,
               width_factor NUMERIC

maps_routes  + group_name TEXT
```

### What we are NOT doing

- No `maps_vertices` table — vertices consumed at import time and discarded.
- No "FMG grid" table — `grid` (raw pre-pack heightmap/climate) is dropped on
  the floor; deferred to a future regional-context spec.
- No backfill onto existing pre-cutover maps.
- No auto-lore-seeding from `maps_notes`.

### Naming notes

- **maps_campaigns** collides with the Questables RPG-campaign concept. SQL
  COMMENT on the table makes the distinction explicit. Application code that
  reads from it MUST use the fully qualified table name to avoid confusion.
- **`group`** is a reserved SQL identifier — quoted as `"group"` in
  `maps_burgs`.

## Ingest pipeline

### Module layout

```
server/services/maps/fmg-full-json/
  index.js                  // public: ingestFullJson(worldId, jsonBuffer)
  parser.js                 // streaming JSON parse (clarinet / JSONStream)
  geometry-builder.js       // cells+vertices → cell polygons + aggregates
  ingesters/
    world.js                // info + mapCoordinates + settings → maps_world
    biomes.js               // biomesData → maps_biomes
    cultures.js
    religions.js
    features.js
    cells.js                // bulk COPY into maps_cells + geometry
    states.js               // ST_Union of state cells → state polygon
    provinces.js            // ST_Union of province cells → province polygon
    burgs.js
    rivers.js
    routes.js
    markers.js
    regiments.js
    campaigns.js
    diplomacy.js
    coats.js                // states.coa + provinces.coa + burgs (emblem)
    zones.js
    notes.js
  validators.js             // schema sanity checks before transaction opens
```

`index.js` is the orchestrator — opens the transaction, dispatches in order,
commits or rolls back, returns a per-stage report.

### Transaction & ordering

One Postgres transaction, all-or-nothing. Order dictated by FKs:

```
world → biomes → features → cultures → religions → cells
      → states → provinces → coats(state,province) → burgs → coats(burg)
      → rivers → routes → markers → regiments → campaigns → diplomacy → zones → notes
```

The `coats` split is awkward but necessary: state/province COA arrive nested
on `states[]`/`provinces[]` and need to be insertable as soon as those rows
exist; burg emblems must wait until burgs exist. We migrate the existing
`maps_burgs.emblem` JSONB into `maps_coats_of_arms` as part of the cutover and
drop the JSONB column.

### Geometry derivation algorithm

```js
// 1. Build vertex lookup — O(V) once
const vert = new Float64Array(vertices.length * 2);
for (const v of vertices) {
  vert[v.i * 2]     = v.p[0];
  vert[v.i * 2 + 1] = v.p[1];
}

// 2. For each cell, emit WKT polygon from v[] indices
const cellWkt = cells.map(c => {
  const pts = c.v.map(i => `${vert[i*2]} ${vert[i*2+1]}`).join(',');
  return `POLYGON((${pts},${first_point}))`;   // close ring
});

// 3. Binary COPY-stream into maps_cells (ST_GeomFromText with SRID 0)

// 4. Aggregate polygons via SQL (no app-side union):
INSERT INTO maps_states (..., geom)
SELECT s.state_id, ..., ST_Multi(ST_Union(c.geom))
FROM staging_states s
JOIN maps_cells c ON c.world_id = $1 AND c.state = s.state_id
GROUP BY s.state_id, ...;
-- same pattern for provinces, cultures, religions, biomes, zones
```

Performance moves: **binary COPY** for the 66k cell rows (~20× faster than
INSERT batches); **ST_Union in SQL** rather than Node. Expected: cell-polygon
emit <1s in Node; ST_Union per state 1–3s on a 26-state map.

### Sync vs async

For 70MB files the request would borderline-timeout. Approach:

- HTTP request returns **202** with an `import_job_id` immediately after the
  file is staged.
- A short-lived worker (in-process `setImmediate` queue, no new infra) runs
  the ingest.
- Wizard polls `GET /api/upload/map/jobs/:id` for stage-by-stage progress:
  `{stage: "states", percent: 64, message: "Unioning 26 state polygons…"}`.
- Failure rolls back the transaction; the job row records `status='failed'`
  plus the offending stage + error message.

This avoids the request timeout problem (which the current per-layer wizard
sidesteps by splitting work) without standing up Redis/BullMQ.

### Validation

A pre-transaction pass (`validators.js`) checks:

- `info.version` is a known FMG version range
- Top-level keys `pack.cells`, `pack.vertices`, `info`, `settings` all present
- ID density looks right (cells count > 1000, vertices > 2× cells)
- No orphan references (e.g. burg.state references unknown state_id)

A bad file is rejected before opening the transaction.

## API + UI

### Endpoints

```
POST   /api/upload/map/full-json          // multipart Full JSON; {worldId, jobId}
POST   /api/upload/map/:worldId/svg        // unchanged; uploads rendered SVG
GET    /api/upload/map/jobs/:jobId         // {status, stage, percent, message, error?}
DELETE /api/upload/map/:worldId            // rolls back a partially-uploaded world
```

**Deleted:** `POST /api/upload/map/:worldId/layer` and its dispatcher.

### Wizard

The current 6-step wizard
(`components/map-upload-wizard/map-upload-wizard.tsx`) collapses to 3 steps:

```
Step 1: Upload Full JSON    → POST /full-json
                             ↓ poll jobs/:id
                             ▼ stage-by-stage progress bar
Step 2: Upload SVG canvas   → POST /:worldId/svg
Step 3: Review & activate   → set is_active=true, optional name/description edit
```

Stage progress in Step 1 shows the ingest order from §3 as a checklist —
concrete feedback ("Cultures done, importing 26 states (12/26)…") rather than
an opaque spinner.

### Files removed (clean cutover)

- 5 of the 6 wizard step components (only Full JSON + SVG + review remain).
- `ingestCells/Burgs/Routes/Rivers/Markers` in `ingestion-service.js` —
  replaced by `fmg-full-json/ingesters/*` modules.
- The `ingestLayer()` dispatcher in `ingestion-service.js`.

`ingestion-service.js` itself stays — keeps `createOrUpdateWorld()` and the
settlemaker auto-trigger hook (`ingestBurgEntrancesForWorldIfReady()`), both
invoked from the new pipeline.

## Migration plan

### Build order (each step independently testable)

1. **DB migrations** — 13 new tables + ALTER on burgs/cells/rivers/routes,
   migrate `maps_burgs.emblem` JSONB → `maps_coats_of_arms`, drop the JSONB
   column.
2. **Geometry builder** — pure function `(cells, vertices) → WKT[]`.
   Unit-testable in isolation against the Jolliariana fixture.
3. **Per-entity ingesters** — built in FK order (world → biomes → cultures →
   … → notes). Each lands with a focused test that ingests just that section
   of the fixture.
4. **Orchestrator + transaction + job table** — wires the ingesters
   together, adds `import_jobs` table for progress polling.
5. **HTTP endpoints + job poller**.
6. **Wizard rewrite** — only after the API works end-to-end against the
   Jolliariana fixture.
7. **Delete the old per-layer endpoints + 5 wizard step components**.
8. **Layer rendering updates** — new OpenLayers layers for
   states/provinces/cultures/religions/zones polygons; new regiment marker
   layer. The existing `components/layers/*.ts` factory pattern accommodates
   these without restructuring.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Transaction holds too long on 70MB file → DB locks bite | Dedicated PG connection from a small pool; estimated worst case ~30s on the Jolliariana fixture (66k cells + 26 ST_Union ops). Bench before deploying. |
| Memory blow-up parsing 70MB JSON | Streaming parser (`clarinet`/`JSONStream`); keep only the entity-array being processed in memory. Vertices stay resident in a `Float64Array` (~2MB) for the cell polygon pass. |
| Settlemaker re-fires for every burg on every re-import | Already idempotent via burg_id uniqueness; add a `skip_settlemaker` flag if the user wants to defer initial gate generation. |
| Existing maps' UI breaks because new layers expect new tables | New OpenLayers layers degrade gracefully when their API returns empty (existing layer-visibility ref pattern). |
| Invalid `\uXXXX` surrogate in FMG JSON (e.g. the one observed in our Jolliariana fixture) | Streaming parser tolerates with replacement char; logged as warning, doesn't abort the import. |
| Null bytes (U+0000) in note text | Sanitize before storing in `maps_notes.legend` (Postgres TEXT rejects null bytes). |

### Out of scope, captured for later

- **Grid (raw heightmap/climate)** — flagged for future regional-context
  spec. User noted this may be desired later but is not in scope here.
- **Re-import / patch existing maps** — flagged as a separate future feature.
- **Auto-seeding `maps_notes` into the LLM lore system** — explicitly
  decided against; future maintainers should not silently change this without
  re-discussing with the Campaign Director.
- **Lon/lat reprojection via `mapCoordinates`** — we store `mapCoordinates`
  on `maps_world` so a future spec can add lon/lat columns without re-ingest.

## Testing

- **End-to-end** against the Jolliariana fixture
  (`Jolliariana Full 2026-05-22-20-48.json`): import, then assert counts on
  each table match the jq-confirmed numbers (26 states, 580 provinces,
  19,475 burgs, 484 regiments, 104 campaigns, 1,296 notes, 11,718 routes,
  952 rivers, 1,285 markers, 13 zones, 15 cultures, 21 religions, 201
  features, 66,321 cells).
- **Per-ingester unit tests** with hand-crafted small JSON fragments.
- **Regression test** that the existing settlemaker auto-trigger still fires
  after burgs+routes land.
- **Geometry sanity**: pick three known burgs, assert their position is
  inside the polygon of their owning state, province, culture, religion.

## Acceptance criteria

- A new Full JSON upload through the rewritten wizard yields a complete map:
  all 13 new tables populated, plus existing tables enriched with the new
  columns.
- The Jolliariana fixture imports cleanly without manual intervention.
- Failure at any stage rolls back to an empty world (no orphan rows).
- Existing pre-cutover maps continue to load and render in the world map
  view without modification.
- The old per-layer endpoints return 410 Gone (or are removed entirely from
  routing).
