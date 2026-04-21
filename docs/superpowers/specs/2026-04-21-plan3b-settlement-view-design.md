# Plan 3b — Settlement-View Auto-Swap & Translated Token — Design Spec

**Status:** Design draft, awaiting review
**Predecessors:** Plan 3a (burg entrances, merged 2026-04-20), settlemaker 0.3.0-rc.1 contract (shipped 2026-04-21)
**Scope:** `docs/superpowers/plans/2026-04-21-plan3b-settlement-view-plan.md` (to be written)

---

## Goal

Auto-swap the OpenLayers map between world view and settlement view whenever a player's `inside_burg_id` changes, and render that player's token inside the settlement view at its translated local position. Same behaviour for narrative arrivals, DM drags, and session-start (page refresh with a player already inside a burg).

No destination routing into specific buildings. That's Plan 3c.

## Non-goals

- Rendering NPCs, inns, boats, shops, or any non-player entity inside settlement view. The scaffolding in this plan (a generic "visible entities at this burg" data path) is built such that 3c can drop points in, but Plan 3b ships only players.
- DM-initiated peek at a burg that no player is in. View is always driven by a player's `inside_burg_id`.
- Shared fog-of-war rules for settlement interiors. Whatever the server's existing `visibilityState` says is what the client renders.
- Animation / transition polish on swap. Hard cut for MVP; revisit if it feels jarring.

## Architecture — the three coordinate spaces (already agreed 2026-04-20)

| Space | Units | Origin | Lives in |
|---|---|---|---|
| world-pixel | 1 px per world `meters_per_pixel` | world top-left | `campaign_players.loc_current`, `maps_burgs.xpixel/ypixel` |
| settlement-local | settlement units (scalar from settlemaker) | near settlement centroid, Y-down | settlemaker GeoJSON coords, sidecar `local_bounds` |
| tile-pixel | 1 tile-px | tile grid `[0,0]` | settlement view render target |

Plan 3a has forward world ← local. Plan 3b needs reverse local ← world and a generic local ↔ tile that OL handles natively once the projection and extent are wired.

**Translation math (server-side):**

```
meters_per_pixel = 1609.344 / world.pixels_per_mile
pixels_per_settlement_unit = meters_per_unit / meters_per_pixel
settlement_local_x = (player_world_px.x - burg_world_center.x) / pixels_per_settlement_unit
settlement_local_y = (player_world_px.y - burg_world_center.y) / pixels_per_settlement_unit
```

No Y flip: both spaces are Y-down.

**Gate-arrival short-circuit:** when the player's most recent arrival landed at a gate (entrance row carries `arrival_local`), server returns that value verbatim instead of translating. Exact, cheaper, avoids rounding drift.

## Section 2 — persistence + ingestion

### New table: `maps_burg_settlements`

One row per burg. Sidecar to `maps_burgs`, authoritative source for every settlement-view math input.

| Column | Type | Notes |
|---|---|---|
| `burg_id` | `uuid PRIMARY KEY REFERENCES maps_burgs(id) ON DELETE CASCADE` | |
| `meters_per_unit` | `numeric NOT NULL` | From `metadata.scale.meters_per_unit` |
| `diameter_meters` | `numeric NOT NULL` | From `metadata.scale.diameter_meters` |
| `diameter_local` | `numeric NOT NULL` | From `metadata.scale.diameter_local` |
| `scale_source` | `text NOT NULL` | e.g. `'population_heuristic_v1'` |
| `local_bounds` | `jsonb NOT NULL` | `{min_x, min_y, max_x, max_y}` |
| `max_zoom` | `int NOT NULL` | Cached from `computeTileInfo(population).maxZoom` |
| `tile_extent_px` | `int NOT NULL` | Cached tile-grid extent |
| `svg_viewbox` | `jsonb NOT NULL` | `{x, y, width, height}` — should match `local_bounds` within 0.1 (settlemaker invariant) |
| `has_harbour` | `boolean NOT NULL` | Derived: any ingested entrance has `sub_kind = 'harbour'` |
| `ocean_bearing_deg` | `int` | Nullable. Pulled from the same `oceanBearing` passed to settlemaker at ingest |
| `settlement_generation_version` | `text NOT NULL` | Authoritative per-burg version (mirrors `maps_burg_entrances`) |
| `settlemaker_version` | `text NOT NULL` | e.g. `'0.3.0-rc.1'` |
| `ingested_at` | `timestamptz NOT NULL DEFAULT now()` | |

PK on `burg_id` only. No secondary indexes.

### Ingester changes — `server/services/settlemaker/ingestor.js`

- Hard-require schema v2. On `metadata.schema_version !== 2`, throw `SettlemakerSchemaMismatch` with the observed and expected versions.
- Feature filter: `layer !== 'entrance'` → skip (was `'gate'`).
- Property renames: `gate_id` → `entrance_id`, `prev_gate_id` → `prev_entrance_id`, `next_gate_id` → `next_entrance_id` when writing to `maps_burg_entrances`. Carry `arrival_local` into a new column (see migration below).
- Read `metadata.local_bounds` and `metadata.scale.*` for the sidecar row.
- Compute `has_harbour` by scanning post-filter entrance features for `sub_kind === 'harbour'`. Compute `ocean_bearing_deg` from the params already available at ingest time.
- Wrap the whole per-burg body in a transaction:
  1. Look up existing sidecar row by `burg_id`.
  2. Idempotency check: if `(schema_version, settlement_generation_version, settlemaker_version)` all match, return early.
  3. `DELETE FROM maps_burg_entrances WHERE burg_id = $1`.
  4. `INSERT ... ON CONFLICT (burg_id) DO UPDATE` on sidecar with full row.
  5. Bulk INSERT fresh entrance rows.
  6. Commit.

### `maps_burg_entrances` — add `arrival_local`

```sql
ALTER TABLE maps_burg_entrances ADD COLUMN arrival_local jsonb;
```

Stores `[x, y]` as a two-element JSON array. Nullable — old rows backfilled by the script below; any row ingested post-merge will have it populated by the ingester.

### Backfill script: `scripts/backfill-plan3b.js`

One-shot, idempotent. Iterates every row in `maps_burgs`, re-invokes `ingestBurg(client, { burgId, force: true })` inside its own transaction. `force: true` is a new option on the ingester that bypasses the version-triplet check and unconditionally replaces the sidecar row + entrance rows, even if all three version values match. Use only during backfill. Post-merge, any normal ingest with a matching triplet exits early as before.

Run order during deploy (see §4): `npm run migrate` → `node scripts/backfill-plan3b.js` → restart app. Code consuming the sidecar cannot come up until the backfill has populated every burg, otherwise the ingester's hard-require triggers on the next ambient ingest of a v1 world.

### New data-access service: `server/services/maps/burg-settlements-service.js`

Thin CRUD wrapper mirroring `burg-entrances-service.js`:
- `getByBurg(burgId)` → sidecar row or `null`
- `upsert(burgId, payload)` → called only from the ingester
- `deleteForBurg(burgId)` → used by rollback script and possibly admin tooling

## Section 3 — frontend subscriber + view swap

### Source of truth: `GET /api/campaigns/:id/players/visible`

Existing endpoint at `server/routes/campaigns.routes.js:2181-2200`. Extend the row shape from:

```json
{ "playerId", "userId", "characterId", "role", "visibilityState", "geometry" }
```

to:

```json
{
  "playerId", "userId", "characterId", "role", "visibilityState", "geometry",
  "insideBurgId": "uuid | null",
  "mapLevel":     "'world' | 'settlement'",
  "settlementLocal": { "x": number, "y": number } | null
}
```

`settlementLocal` is computed server-side using the reverse translator below. When `insideBurgId` is non-null but sidecar is missing for that burg (only possible during the backfill window), `settlementLocal` is `null` and `mapLevel` is `'world'`; the client treats that as "translation unavailable, stay on world view".

When the player's most recent arrival was a gate, server reads `arrival_local` from the matching `maps_burg_entrances` row and returns it verbatim instead of computing. Detection: the `player_movement_audit.arrival_gate_entrance_id` pointer set by Plan 3a.

### Server translator: `server/services/settlemaker/coordinate-translator.js`

Existing file has forward (local → world). Add:

```ts
function translateWorldPixelToSettlementLocal({
  playerWorldPx: { x, y },
  burgWorldCenterPx: { x, y },
  worldMetersPerPixel: number,
  sidecar: { metersPerUnit, localBounds, ... },
}): { x: number, y: number }
```

Caller obtains `worldMetersPerPixel` by querying the world row: `1609.344 / world.pixels_per_mile`. Today the server's `coordinate-translator.js` already loads that input for the forward direction; Plan 3b reuses the same derivation path.

Returns the translated point unconditionally. If the result falls outside `localBounds`, log a warning (`'out-of-bounds settlement-local translation for burg X: (x,y) outside bounds'`) but still return it. Out-of-bounds suggests a data drift elsewhere — the translator is not the place to paper over it.

`FALLBACK_PIXELS_PER_SETTLEMENT_UNIT` becomes unreachable once the backfill completes. Leave the constant and its one call site in place for this PR so the diff stays legible; remove in a follow-up cleanup commit.

### Frontend — split into `<WorldMap>` + `<SettlementMap>`

Today `components/openlayers-map.tsx` is a single Map that serves the world view. Plan 3b lifts the view-swap decision above it and creates a sibling component for settlement view.

**New files:**
- `components/maps/map-root.tsx` — the swap decider. Reads visible-players (via the existing hook / refactored hook). Derives `currentBurgId` and `manualWorldOverride`. Renders `<WorldMap>` or `<SettlementMap burgId={currentBurgId} />`.
- `components/maps/settlement-map.tsx` — owns a dedicated OL `Map` instance. Tile source from `components/maps/settlement-tile-source.ts` (already exists, currently unused). Projection configured from sidecar `local_bounds`. Initial view = fit-all on swap-in.

**Modified:**
- `components/openlayers-map.tsx` renamed to `components/maps/world-map.tsx`. Burg-selection state lifted to `map-root.tsx` if it lives inside today. (Verified during implementation; cheap refactor either way.)

**Swap trigger — client-side state machine:**

```
  ┌──────────┐  currentBurgId changes to non-null        ┌──────────────┐
  │  world   │ ─────────────────────────────────────────▶│  settlement  │
  │  view    │                                            │     view     │
  └──────────┘◀──── currentBurgId becomes null ────────── └──────────────┘
       ▲              OR user clicks "view world" toggle          │
       │                                                           │
       └───────────────── manualWorldOverride = true ──────────────┘

  manualWorldOverride resets to false whenever currentBurgId changes from one
  value to another — null → non-null, non-null → null, or non-null → different non-null.
```

**Initial view-framing on swap-in:** `view.fit(sidecar.local_bounds)` — fit the entire `local_bounds` into the viewport, then clamp the resulting zoom level so it never exceeds `max_zoom`. For very small settlements where the fit would otherwise over-zoom, this caps to tile-clean pixel alignment. CD pans / zooms from there.

**Dismissal:** `<SettlementMap>` renders a "View world" toggle button. Click sets `manualWorldOverride = true`; `map-root` re-renders `<WorldMap>`. The override clears on the next `currentBurgId` transition (e.g. player leaves burg, then re-enters).

### Rendered layers inside `<SettlementMap>`

1. **Tile backdrop.** From `settlement-tile-source.ts`.
2. **Player tokens.** For every visible player whose `insideBurgId === burgId` AND `settlementLocal` non-null, render a token. Style same as the world-view player marker, no per-space differentiation.
3. **Entrance markers.** One glyph per `maps_burg_entrances` row, no styling variation across `kind` / `bearing_deg`. No click handler, no tooltip. MVP ships them as static informational paint; styling differentiation defers to a follow-up.

Visibility filter: the visible-players endpoint already applies server-side filtering. Client treats the returned list as the complete set.

## Section 4 — testing + rollout

### Test coverage (Test-A2)

**Unit:**
- `coordinate-translator.test.js`: existing forward tests + new `translateWorldPixelToSettlementLocal` cases (in-bounds, out-of-bounds with warn-spy, zero-denominator guard).
- `ingestor.test.js`: existing mocked-fixture tests + a new case for `SettlemakerSchemaMismatch` on v1 input, plus a v2 fixture that asserts the sidecar upsert call.

**Integration — one test, real Postgres:**
- `tests/plan3b/ingestor-settlement.integration.test.js`.
- Seeds a minimal world + one burg with known world-pixel coords.
- Calls `ingestBurg` against a v2 settlemaker GeoJSON fixture committed under `tests/fixtures/settlemaker/`.
- Asserts: sidecar row exists with expected scale values; `maps_burg_entrances` has N rows with `arrival_local` populated; calling the extended visible-players endpoint for a player whose `loc_current` is within the burg returns `settlementLocal` correctly (within 0.1 settlement units).
- Follows the same harness pattern as `tests/movement/narrative-movement.e2e.test.js`.

No Playwright / DOM end-to-end for this plan. If the repo gains Playwright in the future, a follow-up can layer a swap-flow smoke test on top.

### Deployment order (Seq-2) — single PR, documented runbook

PR lands with all three artifacts: migration 009, backfill script, code change. Deploy runbook in the PR description:

1. `npm run migrate` — applies `009_plan3b_sidecar.sql`, creates empty sidecar + adds `arrival_local` column.
2. `node scripts/backfill-plan3b.js` — iterates every burg, re-invokes `ingestBurg(... { force: true })`. Logs `{ burgId, skipped | written | error }` per burg. Exits non-zero if any burg errored.
3. Restart app — new ingester code path is now hard-requiring schema v2 (safe: every burg now has v2 data). Frontend new components come up and begin consuming the extended visible-players response.

Rollback path:
- If code mis-behaves post-deploy: `git revert` the PR, restart. Sidecar stays populated, harmless. `arrival_local` column on `maps_burg_entrances` stays populated too — previous ingester ignores the extra column.
- If migration itself fails: `ALTER TABLE maps_burg_entrances DROP COLUMN arrival_local; DROP TABLE maps_burg_settlements;` shipped as `009_plan3b_sidecar.rollback.sql`.

### No feature flag

Single deploy target; no staged rollout. Revert-on-failure is the whole safety story.

## Files touched (summary)

**New:**
- `database/migrations/009_plan3b_sidecar.sql`
- `database/migrations/009_plan3b_sidecar.rollback.sql`
- `scripts/backfill-plan3b.js`
- `server/services/maps/burg-settlements-service.js`
- `components/maps/map-root.tsx`
- `components/maps/settlement-map.tsx`
- `tests/plan3b/ingestor-settlement.integration.test.js`
- `tests/fixtures/settlemaker/v2-sample-burg.geojson`

**Modified:**
- `server/services/settlemaker/ingestor.js` — schema-version gate, entrance filter, sidecar write, per-burg txn, `force` option, `arrival_local` carry.
- `server/services/settlemaker/coordinate-translator.js` — add `translateWorldPixelToSettlementLocal`.
- `server/routes/campaigns.routes.js` — extend `GET /players/visible` response; also backfill `insideBurgId` into the manual-move broadcast at line 932 for future-proofing.
- `server/services/movement/narrative-movement.js` — no change (already emits `insideBurgId`).
- `components/openlayers-map.tsx` → renamed `components/maps/world-map.tsx`, burg-selection state lifted if needed.
- `hooks/useWebSocket.tsx` — no change (already buffers `player-moved`).

**Removed (follow-up PR, not this one):**
- `FALLBACK_PIXELS_PER_SETTLEMENT_UNIT` + its single call site.

## Open questions (to resolve during plan writing, not blocking)

- Does `components/openlayers-map.tsx` own burg-selection state today? If yes, quantify the lift.
- Is there any non-campaign caller of `GET /players/visible` that the shape change would break?
- Exact glyph design for entrance markers — defer to implementation; SVG data URIs or OL built-in icon styles both work.
