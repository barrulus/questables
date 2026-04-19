# Narrative Player Movement — Plan 3a (Burg Gates + Approach-Vector Picker) Design

**Date:** 2026-04-19
**Status:** Design draft, pending user approval → implementation plan
**Depends on:**
- Plan 1 MVP (merged `492549f`, 2026-04-17)
- Plan 2 Travel-Time (merged, 2026-04-17)
- Settlemaker P0 (gate emitter shipped 2026-04-19; `SETTLEMAKER_VERSION = '0.2.0'`, `GEOJSON_SCHEMA_VERSION = 1`)
**Blocks:** Plan 3b (settlement-view handoff), Plan 3c (building-to-building movement).

---

## Goal

Replace "arrive at burg centroid" with "arrive at a named gate." When the LLM moves the party to Harrowick along the King's Road, the system picks *the* gate on that road, places the player at the gate, and the LLM's next turn has enough context to narrate "The party reins in at the South Gate" instead of "The party arrives."

Gate placement is NOT computed in questables. Settlemaker owns placement; questables consumes settlemaker's per-burg GeoJSON output and picks which gate applies for each arrival.

## What the user experiences

1. LLM emits `mechanicalOutcome: {type: 'move_player', destination: {kind: 'burg', ref: 'Harrowick'}, via: 'roads', mode: 'ride'}`.
2. Travel planner (Plan 2) produces a polyline that terminates at Harrowick's centroid.
3. Gate-picker (NEW) inspects Harrowick's rows in `maps_burg_entrances`, picks the gate whose `route_id` matches the route the polyline snapped to (or, failing that, the gate whose outward bearing best matches the polyline's final segment), and retargets the polyline to the gate's world-pixel position.
4. Player token animates along the polyline and lands at the gate — visually *on the wall*, not inside it.
5. The `player-moved` broadcast includes `arrivalGate: {gateId, name, kind, subKind}`; the client shows a gate marker on the world map at arrival, and the next narrative turn's LLM context carries `arrival.gate.name` so the LLM names it.

## Non-goals

- **Procedural gate generation inside questables.** Zero placement logic; pure consumer.
- **Hand-tunable per-burg gate positions via UI.** Overrides are a follow-on if the need surfaces.
- **Settlement-level map rendering / tiles.** That's Plan 3b.
- **Gate names beyond simple fallback.** Until settlemaker emits a `name`, questables uses `"{cardinal} Gate"` derived from `bearing_deg`. When settlemaker ships a namer, the ingestion pipeline picks it up transparently.
- **Unwalled-burg "approach points."** Settlemaker P0 emits zero gates for unwalled burgs. Questables falls back to Plan 2 behavior (land at centroid) for those. Ingestion of P1 "approach points" lands automatically when settlemaker ships them — schema already permits zero-gate burgs.
- **Citadel gates.** Internal, not routable from world map.
- **Gate-picker for `fly` / `teleport`.** These land at centroid (no gate — party drops in from above or materializes).

---

## Architecture

Four coordinated pieces, all additive to Plan 1+2:

1. **`maps_burg_entrances` table.** Per-burg gate rows in world-pixel coordinates, keyed to `maps_burgs.id` and (optionally) `maps_routes.id`. Stable `gate_id` string from settlemaker enables idempotent upsert.

2. **Ingestion service `settlemaker-ingestor.js`.** Given a burg, invokes settlemaker (library import), receives a `FeatureCollection + metadata`, translates local-settlement coordinates to world pixels, and upserts rows. Triggered on burg creation + on `settlement_generation_version` change.

3. **Gate-picker `gate-picker.js`.** Pure function `(plan, destination, client) → arrivalGate | null`. Route-identity match is primary; outward-bearing dot-product against polyline's final segment is fallback.

4. **Integration into `applyNarrativeMove`.** After `planTravel`, before `performPlayerMovement`, call `pickArrivalGate`. Retarget `effectiveEnd` + truncate/extend `effectiveWaypoints` to land at the gate. Include gate metadata in the summary + broadcast payload.

Plus minor frontend work: render gate markers on the world map when a burg's entrances are loaded; show the arrival gate briefly during animation.

### Data flow

```
LLM emits move_player
        ↓
applyMechanicalOutcome
        ↓
applyNarrativeMove
        ├─ resolveDestination()                       Plan 1, unchanged
        ├─ loadPlayerPosition()                        existing
        ├─ planTravel()                                Plan 2
        ├─ pickArrivalGate(plan, resolved, client)     Plan 3a NEW
        ├─ retargetPlanToGate(plan, gate)              Plan 3a NEW
        ├─ walkCampsForEncounter()                     Plan 2
        ├─ performPlayerMovement(...)                  Plan 1+2
        └─ broadcast player-moved (now with arrivalGate)
```

Out-of-band:
```
Burg created / settlement_generation_version changed
        ↓
settlemakerIngestor.ingestBurg(burgId)
        ├─ call settlemaker.generateFromBurg(input)   imports settlemaker lib
        ├─ parse FeatureCollection (gates + metadata)
        ├─ translate settlement-local → world-pixel
        └─ upsert rows into maps_burg_entrances
```

Design property: gate-picker is a pure function over `(plan, maps_burg_entrances rows)`. Fully unit-testable with fixture rows, no network/DB beyond a single SELECT.

---

## Data model

One migration. One new table. No column additions to `maps_burgs`.

```sql
-- database/migrations/008_plan3a_burg_entrances.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.maps_burg_entrances (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    burg_id UUID NOT NULL REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    gate_id TEXT NOT NULL,                          -- stable settlemaker id, e.g. 'g18'
    route_id UUID REFERENCES public.maps_routes(id) ON DELETE SET NULL,
    x_px DOUBLE PRECISION NOT NULL,                  -- world-pixel coords (origin top-left, Y-down)
    y_px DOUBLE PRECISION NOT NULL,
    geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED,
    bearing_deg DOUBLE PRECISION NOT NULL,           -- outward, 0..360, 0=N clockwise
    bearing_match_delta_deg DOUBLE PRECISION,        -- settlemaker's delta from requested; null if unmatched
    kind TEXT NOT NULL CHECK (kind IN ('land', 'harbour')),
    sub_kind TEXT NOT NULL CHECK (sub_kind IN ('road', 'foot', 'harbour')),
    wall_vertex_index INTEGER NOT NULL,              -- from settlemaker; enables prev/next linkage
    prev_gate_id TEXT,                               -- neighbour on the wall (for patrol/tour narration)
    next_gate_id TEXT,
    name TEXT,                                       -- nullable; filled when settlemaker emits one
    settlement_generation_version TEXT NOT NULL,     -- settlemaker's content-hash; drives upsert invalidation
    settlemaker_version TEXT NOT NULL,               -- e.g. '0.2.0' — lets us reject obsolete rows
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (burg_id, gate_id)
);

CREATE INDEX IF NOT EXISTS maps_burg_entrances_geom_gix
  ON public.maps_burg_entrances USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_burg_entrances_burg_id_idx
  ON public.maps_burg_entrances (burg_id);
CREATE INDEX IF NOT EXISTS maps_burg_entrances_route_id_idx
  ON public.maps_burg_entrances (route_id)
  WHERE route_id IS NOT NULL;

COMMIT;
```

**Field rationale:**

- **`gate_id TEXT`** (not UUID): settlemaker emits `'g{wall_vertex_index}'` as a deterministic string. We store it verbatim so the upsert key stays stable across regenerations.
- **`(burg_id, gate_id) UNIQUE`**: the only natural key. Upserts target this.
- **`route_id` nullable**: gates with no matched route (settlemaker's `matched_route_id` absent) still exist — they just aren't route-addressable. Harbour gates often have no road route.
- **`bearing_match_delta_deg` nullable**: only meaningful when `route_id` is set. Quantifies how loosely settlemaker matched the requested bearing — informs gate-picker's confidence when route identity is ambiguous.
- **`wall_vertex_index`**: kept for debugging + enabling `prev_gate_id`/`next_gate_id` resolution on questables' side without joining back to settlemaker output.
- **`settlement_generation_version`**: on re-ingest, if this matches existing rows, skip upsert. If it differs, DELETE all rows for the burg then INSERT the new set (clean rebuild — no orphan gates from prior topologies).
- **No `layer: 'wall'` polygon column**: walls are rendered separately if/when needed (future). This table is gates-only.

**What's NOT here, deliberately:**

- No `x_local`, `y_local` (settlement-local coords). Questables only cares about world-pixel coords. Local coords are discarded after translation.
- No `tower_positions`. Not consumed by questables.
- No `world_id`. Reachable via `burg_id → maps_burgs.world_id`; duplicate would be a denormalization we don't need.

---

## Module: settlemaker integration

### Library vs service decision

**Settlemaker is imported as a library.** Reasoning:

- Settlemaker's public entry point is `generateFromBurg(burg, options)` returning `{model, svg, geojson}`. Synchronous. No I/O. Ideal for in-process use.
- Per-burg generation takes O(ms) on modern hardware. No need to cache on disk or run as a service.
- Version coupling is explicit in `package.json`, so `settlemaker_version` in rows matches what was running when they were ingested.

**Packaging path:** settlemaker lives at `/home/barrulus/dev/settlemaker` today. Options:

- **(a)** npm workspace inside questables monorepo (merge the repos).
- **(b)** published npm package (`@barrulus/settlemaker`), questables depends on a version.
- **(c)** file: dependency (`"settlemaker": "file:../settlemaker"`) for local dev until (a) or (b).

Spec picks **(c) short-term, (a) medium-term**. The ingestor imports from a single entry point, so swapping packaging later is a `package.json` change.

### Ingestor module

**Location:** `server/services/settlemaker/settlemaker-ingestor.js`

**Exports:**
- `ingestBurg(client, { burgId })` — idempotent: noop if `settlement_generation_version` unchanged.
- `ingestAllBurgs(client, { worldId })` — bulk helper for map import.
- `ensureEntrancesFresh(client, { burgId })` — called lazily by gate-picker if rows are missing for a burg (see Gate-picker below).

### Building the settlemaker input

For each burg:

```js
const burg = await loadBurgRow(client, burgId); // select * from maps_burgs where id = $1
const routes = await loadApproachingRoutes(client, burgId);
// For each route, compute bearing from route's nearest point-on-line to the burg
// centroid, and classify as road/foot/sea based on route.type.

const input = {
  name: burg.name,
  population: burg.population ?? 0,
  port: burg.port,
  citadel: burg.citadel,
  walls: burg.walls,
  plaza: burg.plaza,
  temple: burg.temple,
  shanty: burg.shanty,
  capital: burg.capital,
  roadBearings: routes.map(r => ({
    bearing_deg: r.bearingDeg,       // 0..360, 0=N clockwise
    route_id: r.id,                   // questables UUID; settlemaker echoes back as matched_route_id
    kind: r.kind,                     // 'road' | 'foot' | 'sea'
  })),
  oceanBearing: burg.port ? computeOceanBearing(burg) : undefined,
  harbourSize: burg.port && burg.population >= 15000 ? 'large' : burg.port ? 'small' : undefined,
};
```

**`loadApproachingRoutes`** query:

```sql
WITH nearby AS (
  SELECT r.id AS route_id,
         r.type,
         ST_ClosestPoint(r.geom, b.geom) AS snap_pt
    FROM public.maps_routes r
    JOIN public.maps_burgs b ON b.id = $1
   WHERE r.world_id = b.world_id
     AND ST_Distance(r.geom, b.geom) < $2  -- ROUTE_APPROACH_THRESHOLD_PIXELS, default 50
)
SELECT route_id, type, ST_X(snap_pt) AS snap_x, ST_Y(snap_pt) AS snap_y
  FROM nearby;
```

Bearing per route, computed in JS: `atan2(snap_x - burg.x_px, -(snap_y - burg.y_px)) * 180/π`, normalised to `[0, 360)`. (Y-down: "up" = north means negating dy.)

**Route kind classification** (to map to settlemaker's `RouteKind`):

- `maps_routes.type = 'searoute' | 'sea' | 'ship'` → `'sea'` (becomes `sub_kind: 'harbour'` via settlemaker's port logic).
- `maps_routes.type = 'trail' | 'footpath'` → `'foot'`.
- Otherwise → `'road'`.

The mapping lives in a small helper `classifyRouteKind(routeType)` so it can evolve as `maps_routes.type` vocabulary does.

### Coordinate translation: settlement-local → world-pixel

Settlemaker emits in **`coordinate_units: 'settlement_units'`** with `coordinate_system: 'local_origin_y_down'` — origin near the burg centroid, Y axis pointing DOWN.

Questables world pixels are also Y-down (FMG convention). So the translation is a uniform scale + translate:

```
world_px = (x_px_of_burg_centroid, y_px_of_burg_centroid) + (local_point - local_origin) * scale
```

where:
- `local_origin = [0, 0]` (settlemaker centers its output)
- `scale` = pixels-per-settlement-unit

**`scale` computation.** Settlemaker's `computeSettlementScale(population)` yields `diameterMeters`. The wall polygon's extent (max radius from origin) in local units comes straight from the `layer: 'wall'` Feature we also ingest. The world has `maps_world.pixels_per_mile` (Plan 2). Therefore:

```
const METERS_PER_MILE = 1609.344;
const wallRadiusLocal = maxDistanceFromOrigin(wallPolygonFeature.geometry);
const wallRadiusMiles = (diameterMeters / 2) / METERS_PER_MILE;
const scale = (wallRadiusMiles * pixels_per_mile) / wallRadiusLocal;
```

When `pixels_per_mile` is NULL (uncalibrated world), the ingestor falls back to a constant `FALLBACK_PIXELS_PER_SETTLEMENT_UNIT` that produces a plausible radius at typical burg sizes. This matches Plan 2's "uncalibrated worlds still work" discipline.

**Future simplification** (nice-to-have, flag to settlemaker): if settlemaker adds `suggested_pixels_per_meter` to its metadata block, questables' math collapses to one multiplication. Not blocking.

### Settlement_generation_version invalidation

The ingestor's upsert is:

```js
async function ingestBurg(client, { burgId }) {
  const input = await buildSettlemakerInput(client, burgId);
  const { geojson } = settlemaker.generateFromBurg(input);
  const newVersion = geojson.metadata.settlement_generation_version;

  await client.query('BEGIN');
  const existing = await client.query(
    `SELECT DISTINCT settlement_generation_version
       FROM public.maps_burg_entrances WHERE burg_id = $1`,
    [burgId],
  );
  if (existing.rows.length === 1 && existing.rows[0].settlement_generation_version === newVersion) {
    await client.query('COMMIT');
    return { updated: false };
  }

  await client.query(`DELETE FROM public.maps_burg_entrances WHERE burg_id = $1`, [burgId]);
  const rows = gatesToRows(geojson, input, burgCentroidPx, scale);
  for (const row of rows) await insertRow(client, row);
  await client.query('COMMIT');
  return { updated: true, count: rows.length };
}
```

**Zero-gate burgs** (unwalled in P0): `rows` is empty; the DELETE still runs, so any prior walls-flipped-to-false case is cleaned up. Downstream gate-picker handles the empty case (section below).

### When ingestion runs

- **On-demand, lazy.** Gate-picker calls `ensureEntrancesFresh(client, burgId)` before SELECTing rows. First call per burg per settlemaker-version pays the cost (~10ms); subsequent calls hit the idempotent early-exit.
- **On burg creation** (FMG world import). Part of the import pipeline — ingest entrances for every burg at ingest time so the first player move doesn't pay latency.
- **On burg update** (manual edits to walls/port/population via future DM tools). Same path — ingestor sees new `settlement_generation_version`, rebuilds.

**Not included:** no background job, no scheduled refresh. Content-hash invalidation means "nothing changed → no work."

---

## Module: gate-picker

**Location:** `server/services/movement/gate-picker.js`

**Single export:** `pickArrivalGate(client, { plan, destination })`

**Return shape:**

```ts
type ArrivalGate = {
  entranceId: string;     // maps_burg_entrances.id
  gateId:     string;     // settlemaker's 'g18'
  x:          number;
  y:          number;
  bearingDeg: number;
  kind:       'land' | 'harbour';
  subKind:    'road' | 'foot' | 'harbour';
  name:       string;     // resolved; falls back to '{Cardinal} Gate'
  matchedBy:  'route_id' | 'approach_vector' | 'single_option';
} | null;   // null when burg has no entrances (unwalled) or destination.kind !== 'burg'
```

### Algorithm

1. **Early outs:**
   - `destination.kind !== 'burg'` → return `null`.
   - `destination.burgId` null → return `null`.
   - `plan.effectiveVia === 'teleport' || plan.effectiveVia === 'fly'` (equiv to `plan.mode`) → return `null` (land at centroid).

2. **Ensure freshness:** `await ensureEntrancesFresh(client, destination.burgId)`.

3. **Load entrances:**
   ```sql
   SELECT id, gate_id, route_id, x_px, y_px, bearing_deg, kind, sub_kind, name
     FROM public.maps_burg_entrances
    WHERE burg_id = $1;
   ```

4. **If zero rows:** return `null` (burg is unwalled/no approach points; land at centroid — Plan 2 behavior).

5. **If one row:** return it with `matchedBy: 'single_option'`. No ambiguity to resolve.

6. **Route-identity match (primary):**
   - If `plan.effectiveVia` is a UUID (forced-route) OR snapping produced a known route:
     - Look at rows where `route_id === plan.effectiveVia`.
     - Zero matches → fall through to step 7.
     - One match → return with `matchedBy: 'route_id'`.
     - Multiple matches (rare: same route entering same burg at two spots — realistic for rivers+roads intersecting) → pick the one with smallest `bearing_match_delta_deg`. `matchedBy: 'route_id'`.
   - If `plan.effectiveVia === 'direct'` (fell back to direct line): skip to step 7.

7. **Approach-vector match (fallback):**
   - Compute the polyline's final-segment bearing (from `plan.waypoints[-2]` to `plan.waypoints[-1]`), as a compass-degree value `approachBearing` (0=N, clockwise). Equivalently: the bearing FROM the gate back out along the approach — so the gate's outward bearing should be `(approachBearing + 180) % 360`.
   - For each entrance, compute `delta = abs(normalize(entrance.bearing_deg - (approachBearing + 180)))` where `normalize` maps to `[-180, 180]`.
   - Pick the entrance with smallest `delta`. Tie-breaker: smaller `bearing_match_delta_deg` (looser settlemaker match loses), then stable sort on `gate_id`.
   - Return with `matchedBy: 'approach_vector'`.

8. **Name resolution:** if `row.name` is null, derive `"{Cardinal} Gate"` from `bearing_deg`:
   - `[337.5, 22.5) → 'North'`
   - `[22.5, 67.5) → 'Northeast'`
   - ... 8 compass directions.

### `retargetPlanToGate`

Pure function: `(plan, gate) → newPlan`. Replaces the last waypoint with the gate's `(x, y)`, recomputes `distancePixels`, keeps `effectiveVia`. Camp points stay unchanged (we're only nudging the end by <50px typically; camp-point positions were already distributed across the longer polyline, shifting them by that fraction is imperceptible and not worth recomputing).

Edge case: if the gate point is further from the previous waypoint than the original endpoint was (e.g., gate on the far side of the burg relative to approach), the last segment extends. If this exceeds `dailyPixels`, it could in principle add a day. Accepted as rare + cosmetic; not worth correcting in 3a.

---

## Integration into `applyNarrativeMove`

Inside `server/services/movement/narrative-movement.js`, between the `planTravel` call and `performPlayerMovement`:

```js
const arrivalGate = await pickArrivalGate(client, { plan, destination: resolved });
const gatedPlan = arrivalGate ? retargetPlanToGate(plan, arrivalGate) : plan;

// ... existing encounter-walk + truncation uses gatedPlan from here on
```

`gatedPlan.waypoints` flows into `performPlayerMovement` as before. `effectiveEnd` becomes the gate (or centroid when unwalled), so `campaign_players.loc_current` lands on the gate.

`summary` / broadcast payload gains:

```js
arrival: {
  gate: arrivalGate ? {
    id:        arrivalGate.entranceId,
    gateId:    arrivalGate.gateId,
    name:      arrivalGate.name,
    kind:      arrivalGate.kind,
    subKind:   arrivalGate.subKind,
    matchedBy: arrivalGate.matchedBy,
  } : null,
}
```

When `arrivalGate` is `null`, downstream code gets `arrival.gate = null` and behaves as Plan 2 (centroid landing, generic arrival narration).

---

## LLM prompt + context changes

### Prompt (action-prompt-builder.js)

Append to the existing `move_player` guidance:

> **Arrival context:** when the previous turn concluded with a `move_player` outcome, the `recentTravel` block may carry `arrival.gate.name` ("South Gate", "Harbour Gate", etc.). If present, weave it into your narration. If absent, the party entered an unwalled settlement or arrived by air/teleport — do not invent a gate.

### Context (context-manager.js)

Extend the `recentTravel` block introduced in Plan 2:

```js
recentTravel: {
  daysElapsed, distanceMiles, mode, effectiveVia, interrupted,
  arrival: {
    gate: {
      name: 'South Gate',
      kind: 'land',
      subKind: 'road',
    } | null,
  },
}
```

One additional DB read per context build: the `arrivalGate` that was saved with the most recent completed narrative-move's audit row.

**Storage for "which gate did they arrive at":** add `arrival_gate_entrance_id UUID REFERENCES public.maps_burg_entrances(id) ON DELETE SET NULL` column to `player_movement_audit`. Small, doesn't affect DM-drag path (NULL there). The migration is the same file (`008_plan3a_burg_entrances.sql`) so everything lands together.

### Schema (dm-response-schema.js)

No changes. LLM still emits `move_player` with same fields; gate is observed, not requested. (A future plan could let the LLM specify a preferred gate when the party is being strategic — out of scope here.)

---

## Frontend: world-map gate rendering

**Location:** `components/openlayers-map.tsx` + new layer helper `components/layers/burg-entrances.ts`.

**Source:** `/api/world-maps/:worldId/burg-entrances` (new endpoint) returning GeoJSON FeatureCollection of all entrances for the world. Layer is loaded alongside burgs/routes.

**Styling:**
- Gate: small arrow-head icon pointing outward along `bearing_deg`, color by `kind` (land=tan, harbour=cyan).
- Visible only at high zoom (same threshold as burg labels). At low zoom, burg icon alone represents the settlement.

**Arrival animation extension:** when `player-moved` carries `arrival.gate`, briefly pulse the gate's icon for ~1s after the token lands. Existing Plan 2 animation + trail machinery is unchanged; this is a sibling DOM overlay.

**Layer toggle:** under the existing layer-visibility UI, a new toggle "Burg Gates" (default: on at zoom ≥ N, off below). Wires through `MapDataLoader` like every other layer.

---

## Transaction safety

Ingestor transaction (settlemaker output → rows): self-contained `BEGIN / DELETE all for burg / INSERT N / COMMIT`. Failure leaves prior rows intact (DELETE rolled back).

Narrative-move transaction (Plan 1+2 existing) is unchanged. `pickArrivalGate` runs in the same transaction — a read-only SELECT + the in-memory retarget. If it errors, the whole move rolls back (same as any other step).

The new `ensureEntrancesFresh` inside gate-picker MUST be in a separate transaction from the move — settlemaker generation is ~10ms of pure compute + one DB roundtrip per burg, and we don't want a stale-row rebuild blocking the move path. Implementation: open a second short-lived client from the pool for ingestion, use the move's client for the SELECT.

---

## Testing approach

**Unit, `tests/movement/gate-picker.test.js`:**
- Zero entrances for burg → `null`.
- One entrance → `matchedBy: 'single_option'`, gate returned.
- `effectiveVia = <route_uuid>` matches one entrance → `matchedBy: 'route_id'`.
- `effectiveVia = <route_uuid>` matches two entrances → smaller `bearing_match_delta_deg` wins.
- `effectiveVia = 'direct'` with two entrances → approach-vector picks the one aligned with final polyline segment.
- `destination.kind = 'coordinate'` → `null`.
- `plan.mode = 'teleport'` → `null`.
- Name fallback: entrance with `bearing_deg = 180`, `name = null` → returned name = `'South Gate'`.

**Unit, `tests/settlemaker/settlemaker-ingestor.test.js`:**
- Fixture `AzgaarBurgInput` → stub `settlemaker.generateFromBurg` returning known FC → assert rows inserted with translated coordinates.
- Same input twice → second call is idempotent (row count unchanged, no re-INSERT).
- Input with changed `population` → settlement_generation_version differs → rows are replaced atomically.
- Zero-gate output (unwalled) → table has zero rows for burg, no error.
- Harbour-kind route → row has `kind='harbour'`, `sub_kind='harbour'`.
- Route UUID round-trips: input `route_id` comes back via `matched_route_id` → row's `route_id` matches.

**Integration, `tests/movement/narrative-movement.gate.integration.test.js`:**
- Seed: world + burg with walls + two routes + ingested entrances.
- Move via `route_id = A` → player lands at gate on route A; broadcast summary carries `arrival.gate.name`.
- Move with `via = 'direct'` cutting across from the north → approach-vector selects the north gate.
- Move to unwalled burg → `arrival.gate = null`, player lands at centroid, same as Plan 2.

**E2E smoke (extends Plan 2's):**
- Real settlemaker library call (not stubbed), real DB: the `player_movement_paths` row ends at a gate, not the centroid; `arrival_gate_entrance_id` in audit row is non-null.

**Frontend — manual:**
- Load a world with entrances ingested; gate markers appear at high zoom.
- Trigger a narrative move; arrival gate pulses briefly.
- `prefers-reduced-motion`: no pulse, gate still visible.

---

## Open follow-ons (explicitly NOT in this plan)

- **Settlemaker gate names.** Once settlemaker adds a namer, remove questables' cardinal-fallback (or keep it as second fallback when the name field is empty).
- **Settlemaker `suggested_pixels_per_meter`.** Would simplify coordinate translation; low priority.
- **Settlemaker P1 "approach points" for unwalled burgs.** Ingestor already handles zero-gate output; P1 just means more burgs have rows. No questables-side work needed.
- **DM hand-tuning of gate positions.** If the need surfaces, add an `override_x_px`, `override_y_px` pair and have gate-picker prefer them. Out of scope for 3a.
- **Plan 3b: settlement-view handoff.** When player enters a gate, transition world-map → settlement tile view. Uses `maps_burg_entrances.gate_id` as the anchor on settlemaker's tile grid. Large UI surface; its own plan.
- **Plan 3c: building-to-building movement.** Inside a settlement, move between wards/buildings. Requires settlement-view infrastructure from 3b.
- **Gate-picker confidence scoring.** Today we pick the best match unconditionally. Future: expose `confidence` in the summary so the LLM can narrate "the party approaches from an odd angle, arriving at the eastern gate by chance" when confidence is low.

---

## Assumptions and risks

- **Settlemaker's gate count matches questables' route count.** If settlemaker caps gates at `populationToMaxGates(pop)` (currently 2–6) and a metropolis has 8 incoming routes, some routes will share a gate — or worse, some gates will have no `matched_route_id`. Gate-picker handles "route_id absent" by falling through to approach-vector, so no crash, but narration may pick a geographically-plausible gate that doesn't semantically correspond to the route. **Mitigation:** post-merge monitoring of `matchedBy` distribution; if `approach_vector` dominates over `route_id`, raise settlemaker's cap or route-aggregation thresholds.

- **Coordinate translation scale.** The derivation `scale = (wallRadiusMiles * pixels_per_mile) / wallRadiusLocal` relies on settlemaker's `computeSettlementScale` being approximately correct. If it's significantly off, gates appear visibly outside the burg icon on the world map. **Mitigation:** a fixture-based unit test that asserts computed world-pixel gate positions fall within a sensible envelope around the burg centroid (`< 2 × burg-icon-radius` typically).

- **`settlement_generation_version` thrashing.** If any part of `buildSettlemakerInput` is nondeterministic (order of `roadBearings`, floating-point noise in bearing computation), the content hash churns and we re-delete/re-insert rows on every query. **Mitigation:** explicit `roadBearings.sort((a, b) => a.bearing_deg - b.bearing_deg)` before passing to settlemaker; round bearings to one decimal (settlemaker already does this in its hash).

- **Settlemaker version skew.** If a questables deployment upgrades settlemaker and ingested rows carry an older `settlemaker_version`, gate geometry can shift — existing trails and audit rows become inconsistent with current gate positions. **Mitigation:** `ensureEntrancesFresh` already re-runs on `settlement_generation_version` mismatch (which a settlemaker upgrade implicitly changes via the schema's `schema` field in the hash). Explicit backfill migration on major settlemaker upgrades is nice-to-have.

- **LLM over-commitment to gate names.** If the LLM sees `arrival.gate.name = 'South Gate'` in context, it may keep narrating that gate in later turns even after the party leaves. **Mitigation:** `recentTravel` only surfaces on the turn immediately following a move; one turn later it disappears. Same discipline as Plan 2's `daysElapsed` hint.
