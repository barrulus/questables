# Plan 3b — Settlement-View Auto-Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-swap the OpenLayers map between world view and settlement view on every `inside_burg_id` transition, and render the player token at the server-translated settlement-local position. Consume the new settlemaker 0.3.0-rc.1 contract (schema v2, `local_bounds`, `scale.meters_per_unit`, `arrival_local`, `entrance` layer).

**Architecture:** New sidecar table `maps_burg_settlements` stores per-burg scale + bounds + cached tile info. Ingester is rewritten to hard-require schema v2 and write both the sidecar and `maps_burg_entrances` in one transaction. Server translates world-pixel → settlement-local on the existing `GET /players/visible` endpoint; client switches between `<WorldMap>` and a new `<SettlementMap>` based on the returned `insideBurgId`. One-shot backfill script re-runs the ingester against every burg so the hard-require doesn't trip on stale v1 data.

**Tech Stack:** PostgreSQL + PostGIS, Node.js (ESM), Express, React + OpenLayers, Jest (with `--experimental-vm-modules`).

**Spec:** `docs/superpowers/specs/2026-04-21-plan3b-settlement-view-design.md`

---

## File structure

**Create:**
- `database/migrations/009_plan3b_sidecar.sql` — create `maps_burg_settlements`, add `maps_burg_entrances.arrival_local`
- `database/migrations/009_plan3b_sidecar.rollback.sql` — reverse migration
- `server/services/maps/burg-settlements-service.js` — CRUD on the sidecar table
- `server/scripts/backfill-plan3b.js` — one-shot re-ingest of every burg with `force: true`
- `tests/plan3b/ingestor-settlement.integration.test.js` — one real-DB integration test
- `tests/fixtures/settlemaker/v2-sample-burg.geojson` — v2 FeatureCollection used by unit + integration tests
- `hooks/useVisiblePlayers.tsx` — extracted fetch hook shared by `<WorldMap>` and the new `<SettlementMap>`
- `components/maps/settlement-map.tsx` — dedicated OL Map for settlement tiles + token + entrance markers
- `components/maps/map-root.tsx` — swap decider; renders `<WorldMap>` or `<SettlementMap>` based on `insideBurgId`

**Modify:**
- `server/services/settlemaker/ingestor.js` — hard-require schema v2, filter `entrance` instead of `gate`, write sidecar, per-burg transaction, `force` option, carry `arrival_local`
- `server/services/settlemaker/coordinate-translator.js` — add `translateWorldPixelToSettlementLocal`
- `server/services/maps/burg-entrances-service.js` — include `arrival_local` in SELECT + INSERT column lists
- `server/routes/campaigns.routes.js` — extend `GET /players/visible` with `insideBurgId`, `mapLevel`, `settlementLocal`; include `insideBurgId` in the manual-move broadcast (line ~932)
- `tests/settlemaker/ingestor.test.js` — replace v1 fixture with v2; add schema-mismatch test + sidecar-upsert assertion
- `tests/settlemaker/coordinate-translator.test.js` — add cases for the new reverse function
- `components/openlayers-map.tsx` — swap inline `loadVisiblePlayers` for `useVisiblePlayers` hook; no rename
- App entry point that mounts the map — switch from `<OpenlayersMap>` to `<MapRoot>` (exact file discovered during Task 12)

**Untouched (intentionally, for this PR):**
- `hooks/useWebSocket.tsx` — already buffers `player-moved`
- `server/services/movement/narrative-movement.js` — already emits `insideBurgId`
- `FALLBACK_PIXELS_PER_SETTLEMENT_UNIT` in `coordinate-translator.js` — will be dead after backfill; remove in a follow-up PR

---

## Task 1: Add migration 009 — sidecar table + `arrival_local` column

**Files:**
- Create: `database/migrations/009_plan3b_sidecar.sql`
- Create: `database/migrations/009_plan3b_sidecar.rollback.sql`

- [ ] **Step 1: Write the forward migration**

Create `database/migrations/009_plan3b_sidecar.sql`:

```sql
-- 009_plan3b_sidecar.sql
--
-- Adds per-burg settlement metadata (sidecar to maps_burgs) and an
-- arrival_local column on maps_burg_entrances. Consumed by Plan 3b.
--
-- Idempotent: safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.maps_burg_settlements (
    burg_id UUID PRIMARY KEY REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    meters_per_unit NUMERIC NOT NULL,
    diameter_meters NUMERIC NOT NULL,
    diameter_local NUMERIC NOT NULL,
    scale_source TEXT NOT NULL,
    local_bounds JSONB NOT NULL,
    max_zoom INTEGER NOT NULL,
    tile_extent_px INTEGER NOT NULL,
    svg_viewbox JSONB NOT NULL,
    has_harbour BOOLEAN NOT NULL,
    ocean_bearing_deg INTEGER,
    settlement_generation_version TEXT NOT NULL,
    settlemaker_version TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burg_entrances'
      AND column_name = 'arrival_local'
  ) THEN
    ALTER TABLE public.maps_burg_entrances
      ADD COLUMN arrival_local JSONB;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Write the rollback migration**

Create `database/migrations/009_plan3b_sidecar.rollback.sql`:

```sql
-- 009_plan3b_sidecar.rollback.sql
--
-- Reverse of 009_plan3b_sidecar.sql. Drops the sidecar table and removes
-- the arrival_local column. Sidecar data is lost; arrival_local data is
-- lost. Run only if the forward migration failed or the feature is being
-- rolled back before the code consuming these is live.

BEGIN;

DROP TABLE IF EXISTS public.maps_burg_settlements;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burg_entrances'
      AND column_name = 'arrival_local'
  ) THEN
    ALTER TABLE public.maps_burg_entrances DROP COLUMN arrival_local;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 3: Apply the migration against the local dev DB**

Run: `psql -d dnd_app -f database/migrations/009_plan3b_sidecar.sql`
Expected: `BEGIN`, `CREATE TABLE`, `DO`, `COMMIT` with no errors.

Verify: `psql -d dnd_app -c "\d maps_burg_settlements"` shows the 14 columns.
Verify: `psql -d dnd_app -c "\d maps_burg_entrances"` shows the new `arrival_local jsonb` column.

- [ ] **Step 4: Sanity-check the rollback**

Run: `psql -d dnd_app -f database/migrations/009_plan3b_sidecar.rollback.sql`
Then re-apply the forward migration.
Expected: both run clean; final state is post-forward.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/009_plan3b_sidecar.sql database/migrations/009_plan3b_sidecar.rollback.sql
git commit -m "db(plan3b): add maps_burg_settlements + arrival_local column"
```

---

## Task 2: Create `burg-settlements-service.js` (thin CRUD)

**Files:**
- Create: `server/services/maps/burg-settlements-service.js`
- Test: `tests/settlemaker/burg-settlements-service.test.js` (NEW; unit, mocked client)

- [ ] **Step 1: Write the failing test**

Create `tests/settlemaker/burg-settlements-service.test.js`:

```js
import { jest } from '@jest/globals';

const { getByBurg, upsert, deleteForBurg } = await import(
  '../../server/services/maps/burg-settlements-service.js'
);

function makeClient(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('burg-settlements-service', () => {
  test('getByBurg returns the row or null', async () => {
    const row = {
      burg_id: 'b-1', meters_per_unit: 8.1, diameter_meters: 1200,
      diameter_local: 147, scale_source: 'population_heuristic_v1',
      local_bounds: { min_x: -200, min_y: -200, max_x: 200, max_y: 200 },
      max_zoom: 4, tile_extent_px: 4096,
      svg_viewbox: { x: -200, y: -200, width: 400, height: 400 },
      has_harbour: false, ocean_bearing_deg: null,
      settlement_generation_version: 'v-hash',
      settlemaker_version: '0.3.0-rc.1',
      ingested_at: new Date('2026-04-21T00:00:00Z'),
    };
    const client = makeClient(async () => ({ rows: [row] }));
    const got = await getByBurg(client, 'b-1');
    expect(got).toEqual(row);

    const empty = makeClient(async () => ({ rows: [] }));
    expect(await getByBurg(empty, 'b-nope')).toBeNull();
  });

  test('upsert issues INSERT ... ON CONFLICT DO UPDATE', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await upsert(client, 'b-1', {
      meters_per_unit: 8.1,
      diameter_meters: 1200,
      diameter_local: 147,
      scale_source: 'population_heuristic_v1',
      local_bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 },
      max_zoom: 3,
      tile_extent_px: 2048,
      svg_viewbox: { x: 0, y: 0, width: 1, height: 1 },
      has_harbour: true,
      ocean_bearing_deg: 180,
      settlement_generation_version: 'v2',
      settlemaker_version: '0.3.0-rc.1',
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.maps_burg_settlements/);
    expect(sql).toMatch(/ON CONFLICT \(burg_id\) DO UPDATE/);
    expect(params[0]).toBe('b-1');
    expect(params).toHaveLength(13); // burg_id + 12 payload columns
  });

  test('deleteForBurg issues DELETE', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await deleteForBurg(client, 'b-1');
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM public\.maps_burg_settlements/);
    expect(params).toEqual(['b-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settlemaker/burg-settlements-service.test.js`
Expected: FAIL — `Cannot find module 'burg-settlements-service.js'`.

- [ ] **Step 3: Write the service**

Create `server/services/maps/burg-settlements-service.js`:

```js
const SELECT_COLUMNS = [
  'burg_id', 'meters_per_unit', 'diameter_meters', 'diameter_local',
  'scale_source', 'local_bounds', 'max_zoom', 'tile_extent_px',
  'svg_viewbox', 'has_harbour', 'ocean_bearing_deg',
  'settlement_generation_version', 'settlemaker_version', 'ingested_at',
];

const SELECT_LIST = SELECT_COLUMNS.join(', ');

export async function getByBurg(client, burgId) {
  const { rows } = await client.query(
    `SELECT ${SELECT_LIST} FROM public.maps_burg_settlements WHERE burg_id = $1`,
    [burgId],
  );
  return rows[0] ?? null;
}

export async function upsert(client, burgId, payload) {
  await client.query(
    `INSERT INTO public.maps_burg_settlements
       (burg_id, meters_per_unit, diameter_meters, diameter_local,
        scale_source, local_bounds, max_zoom, tile_extent_px,
        svg_viewbox, has_harbour, ocean_bearing_deg,
        settlement_generation_version, settlemaker_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (burg_id) DO UPDATE SET
       meters_per_unit = EXCLUDED.meters_per_unit,
       diameter_meters = EXCLUDED.diameter_meters,
       diameter_local = EXCLUDED.diameter_local,
       scale_source = EXCLUDED.scale_source,
       local_bounds = EXCLUDED.local_bounds,
       max_zoom = EXCLUDED.max_zoom,
       tile_extent_px = EXCLUDED.tile_extent_px,
       svg_viewbox = EXCLUDED.svg_viewbox,
       has_harbour = EXCLUDED.has_harbour,
       ocean_bearing_deg = EXCLUDED.ocean_bearing_deg,
       settlement_generation_version = EXCLUDED.settlement_generation_version,
       settlemaker_version = EXCLUDED.settlemaker_version,
       ingested_at = now()`,
    [
      burgId,
      payload.meters_per_unit,
      payload.diameter_meters,
      payload.diameter_local,
      payload.scale_source,
      JSON.stringify(payload.local_bounds),
      payload.max_zoom,
      payload.tile_extent_px,
      JSON.stringify(payload.svg_viewbox),
      payload.has_harbour,
      payload.ocean_bearing_deg ?? null,
      payload.settlement_generation_version,
      payload.settlemaker_version,
    ],
  );
}

export async function deleteForBurg(client, burgId) {
  await client.query(
    `DELETE FROM public.maps_burg_settlements WHERE burg_id = $1`,
    [burgId],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settlemaker/burg-settlements-service.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/maps/burg-settlements-service.js tests/settlemaker/burg-settlements-service.test.js
git commit -m "feat(maps): add burg-settlements data-access service"
```

---

## Task 3: Extend `burg-entrances-service.js` to carry `arrival_local`

**Files:**
- Modify: `server/services/maps/burg-entrances-service.js`
- Modify: `tests/settlemaker/ingestor.test.js` (if existing tests break on INSERT arity — adjust mocks)

- [ ] **Step 1: Add `arrival_local` to SELECT + INSERT column lists**

Edit `server/services/maps/burg-entrances-service.js`. Add `'arrival_local'` to `SELECT_COLUMNS`:

```js
const SELECT_COLUMNS = [
  'id', 'burg_id', 'gate_id', 'route_id', 'x_px', 'y_px', 'bearing_deg',
  'bearing_match_delta_deg', 'kind', 'sub_kind', 'wall_vertex_index',
  'prev_gate_id', 'next_gate_id', 'name',
  'arrival_local',
  'settlement_generation_version', 'settlemaker_version',
];
```

Update `insertMany` to include `arrival_local`:

```js
export async function insertMany(client, rows) {
  if (rows.length === 0) return;
  for (const r of rows) {
    await client.query(
      `INSERT INTO public.maps_burg_entrances
         (burg_id, gate_id, route_id, x_px, y_px, bearing_deg,
          bearing_match_delta_deg, kind, sub_kind, wall_vertex_index,
          prev_gate_id, next_gate_id, name, arrival_local,
          settlement_generation_version, settlemaker_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        r.burg_id, r.gate_id, r.route_id, r.x_px, r.y_px, r.bearing_deg,
        r.bearing_match_delta_deg, r.kind, r.sub_kind, r.wall_vertex_index,
        r.prev_gate_id, r.next_gate_id, r.name,
        r.arrival_local != null ? JSON.stringify(r.arrival_local) : null,
        r.settlement_generation_version, r.settlemaker_version,
      ],
    );
  }
}
```

Leave `distinctVersionForBurg`, `deleteForBurg`, `listByBurg`, `listByWorld` unchanged in logic; they pick up the new SELECT column automatically.

- [ ] **Step 2: Run existing tests to confirm nothing else breaks**

Run: `npm test -- tests/settlemaker/`
Expected: some ingestor tests still pass; the ingest-produces-v1-rows tests may still pass if their mocks match-object on only a subset. If an insert test fails on column-count mismatch, note the failure — it'll be fixed in Task 5 when the ingester populates `arrival_local`.

- [ ] **Step 3: Commit**

```bash
git add server/services/maps/burg-entrances-service.js
git commit -m "feat(maps): carry arrival_local through burg-entrances service"
```

---

## Task 4: Add reverse translator to `coordinate-translator.js`

**Files:**
- Modify: `server/services/settlemaker/coordinate-translator.js`
- Modify: `tests/settlemaker/coordinate-translator.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/settlemaker/coordinate-translator.test.js`:

```js
import { translateWorldPixelToSettlementLocal } from '../../server/services/settlemaker/coordinate-translator.js';

describe('translateWorldPixelToSettlementLocal', () => {
  const BASE = {
    burgWorldCenterPx: { x: 1000, y: 2000 },
    worldMetersPerPixel: 1609.344 / 50, // pixels_per_mile = 50
    sidecar: {
      metersPerUnit: 8,
      localBounds: { min_x: -200, min_y: -200, max_x: 200, max_y: 200 },
    },
  };

  test('at burg center returns origin', () => {
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      playerWorldPx: { x: 1000, y: 2000 },
    });
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.y).toBeCloseTo(0, 6);
  });

  test('translates a small offset in proportion to pixels_per_settlement_unit', () => {
    const pixelsPerUnit = BASE.sidecar.metersPerUnit / BASE.worldMetersPerPixel;
    // move 50 pixels east of center → 50 / pixelsPerUnit units
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      playerWorldPx: { x: 1050, y: 2000 },
    });
    expect(local.x).toBeCloseTo(50 / pixelsPerUnit, 6);
    expect(local.y).toBeCloseTo(0, 6);
  });

  test('out-of-bounds logs a warn but still returns coords', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const local = translateWorldPixelToSettlementLocal({
      ...BASE,
      playerWorldPx: { x: 1000000, y: 2000000 },
      burgId: 'test-burg',
    });
    expect(Number.isFinite(local.x)).toBe(true);
    expect(Number.isFinite(local.y)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

If `jest` globals aren't importable here, copy the existing file's import style (e.g. `import { jest } from '@jest/globals'` at the top).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settlemaker/coordinate-translator.test.js`
Expected: FAIL on the new suite — `translateWorldPixelToSettlementLocal is not a function`.

- [ ] **Step 3: Implement the reverse translator**

Append to `server/services/settlemaker/coordinate-translator.js`:

```js
/**
 * Reverse of translateLocalToWorldPx: convert a world-pixel point to
 * settlement-local coordinates. Both spaces are Y-down so no flip.
 *
 * The caller supplies `worldMetersPerPixel` (= 1609.344 / pixels_per_mile)
 * from the `maps_world` row, `burgWorldCenterPx` from `maps_burgs`, and the
 * sidecar row (for `metersPerUnit` and `localBounds`).
 *
 * If the translated point falls outside `localBounds`, a warning is logged
 * once via console.warn. The coordinates are returned unconditionally —
 * out-of-bounds is a data-drift signal, not an error this function should
 * paper over.
 */
export function translateWorldPixelToSettlementLocal({
  playerWorldPx,
  burgWorldCenterPx,
  worldMetersPerPixel,
  sidecar,
  burgId,
}) {
  const pixelsPerSettlementUnit = sidecar.metersPerUnit / worldMetersPerPixel;
  const x = (playerWorldPx.x - burgWorldCenterPx.x) / pixelsPerSettlementUnit;
  const y = (playerWorldPx.y - burgWorldCenterPx.y) / pixelsPerSettlementUnit;

  const b = sidecar.localBounds;
  if (x < b.min_x || x > b.max_x || y < b.min_y || y > b.max_y) {
    // eslint-disable-next-line no-console
    console.warn(
      `out-of-bounds settlement-local translation for burg ${burgId ?? '(unknown)'}: (${x.toFixed(2)}, ${y.toFixed(2)}) outside bounds`,
    );
  }
  return { x, y };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/settlemaker/coordinate-translator.test.js`
Expected: PASS including the new 3 cases.

- [ ] **Step 5: Commit**

```bash
git add server/services/settlemaker/coordinate-translator.js tests/settlemaker/coordinate-translator.test.js
git commit -m "feat(translator): add world-pixel → settlement-local reverse"
```

---

## Task 5: Write the v2 sample fixture

**Files:**
- Create: `tests/fixtures/settlemaker/v2-sample-burg.geojson`

- [ ] **Step 1: Generate a real settlemaker v2 fixture**

Run a one-off generation against local settlemaker. From the settlemaker repo (`~/dev/settlemaker`):

```bash
node --experimental-strip-types -e '
import { generateFromBurg } from "./src/index.ts";
const input = {
  name: "FixtureBurg", population: 5000, port: false, citadel: false,
  walls: true, plaza: true, temple: false, shanty: false, capital: false,
  roadBearings: [{ bearing_deg: 90, route_id: "east", kind: "road" }],
};
const { geojson } = generateFromBurg(input, { seed: 42 });
console.log(JSON.stringify(geojson, null, 2));
' > /tmp/v2-sample-burg.geojson
```

If `--experimental-strip-types` is unavailable, use `npx tsx -e ...` with the same body.

Copy the output into the questables repo:

```bash
mkdir -p /home/barrulus/dev/questables/tests/fixtures/settlemaker
cp /tmp/v2-sample-burg.geojson /home/barrulus/dev/questables/tests/fixtures/settlemaker/
```

- [ ] **Step 2: Sanity-check the fixture**

Run: `jq '.metadata.schema_version, .metadata.scale, .metadata.local_bounds' tests/fixtures/settlemaker/v2-sample-burg.geojson`
Expected: `2`, then an object with `meters_per_unit / diameter_meters / diameter_local / source`, then a bounds object.

Run: `jq '[.features[] | select(.properties.layer == "entrance")] | length' tests/fixtures/settlemaker/v2-sample-burg.geojson`
Expected: a non-zero integer (~2–4).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/settlemaker/v2-sample-burg.geojson
git commit -m "test(plan3b): add settlemaker v2 sample fixture"
```

---

## Task 6: Rewrite ingester — v2 gate, sidecar write, per-burg txn, `force` option

**Files:**
- Modify: `server/services/settlemaker/ingestor.js`
- Modify: `tests/settlemaker/ingestor.test.js`

- [ ] **Step 1: Update the ingester test fixture to v2**

Open `tests/settlemaker/ingestor.test.js`. Replace the `FAKE_FC` constant with a minimal v2 FeatureCollection. Also swap the mocked `SETTLEMAKER_VERSION` to `'0.3.0-rc.1'`:

```js
jest.unstable_mockModule('settlemaker', () => ({
  generateFromBurg: jest.fn(),
  SETTLEMAKER_VERSION: '0.3.0-rc.1',
  computeSettlementScale: jest.fn((pop) => ({
    diameterMeters: 200 * Math.pow(pop / 100, 0.4),
    maxZoom: 3,
  })),
  computeTileInfo: jest.fn(() => ({ maxZoom: 3, tileExtentPx: 2048 })),
}));
jest.unstable_mockModule('../../server/services/maps/burg-entrances-service.js', () => ({
  distinctVersionForBurg: jest.fn(),
  deleteForBurg:          jest.fn(),
  insertMany:             jest.fn(),
  listByBurg:             jest.fn(),
  listByWorld:            jest.fn(),
}));
jest.unstable_mockModule('../../server/services/maps/burg-settlements-service.js', () => ({
  getByBurg:      jest.fn(),
  upsert:         jest.fn(),
  deleteForBurg:  jest.fn(),
}));
```

Replace `FAKE_FC`:

```js
const FAKE_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { layer: 'wall', wallType: 'city_wall' },
      geometry: { type: 'Polygon', coordinates: [[[200,0],[0,200],[-200,0],[0,-200],[200,0]]] },
    },
    {
      type: 'Feature',
      properties: {
        layer: 'entrance',
        entrance_id: 'g5',
        kind: 'land', sub_kind: 'road',
        bearing_deg: 90,
        wall_vertex_index: 5,
        matched_route_id: 'route-east',
        bearing_match_delta_deg: 3,
        prev_entrance_id: 'g3',
        next_entrance_id: 'g7',
        arrival_local: [180, 0],
      },
      geometry: { type: 'Point', coordinates: [200, 0] },
    },
  ],
  metadata: {
    schema_version: 2,
    settlemaker_version: '0.3.0-rc.1',
    settlement_generation_version: 'v2hash',
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: '2026-04-21T00:00:00Z',
    local_bounds: { min_x: -220, min_y: -220, max_x: 220, max_y: 220 },
    scale: {
      meters_per_unit: 8,
      diameter_meters: 400,
      diameter_local: 50,
      source: 'population_heuristic_v1',
    },
  },
};
```

Update the existing assertions in the "full rebuild when version differs" test to use `entrance_id`, `prev_entrance_id`, `next_entrance_id`. Add a new test before "unwalled burg with zero gates":

```js
test('hard-requires schema v2; throws SettlemakerSchemaMismatch on v1', async () => {
  const v1Fc = { ...FAKE_FC, metadata: { ...FAKE_FC.metadata, schema_version: 1 } };
  settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: v1Fc });
  const client = makeClient(
    { id: 'burg-old', world_id: 'w1', name: 'Old', population: 5000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 100, y_px: 100 },
    [],
  );
  await expect(ingestBurg(client, { burgId: 'burg-old' }))
    .rejects.toMatchObject({ code: 'settlemaker_schema_mismatch' });
});

test('writes sidecar row + entrance rows in one logical transaction', async () => {
  settlementsService.getByBurg.mockResolvedValue(null);
  settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
  const client = makeClient(
    { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
    [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
  );
  const result = await ingestBurg(client, { burgId: 'burg-1' });
  expect(result.updated).toBe(true);
  expect(settlementsService.upsert).toHaveBeenCalledTimes(1);
  const [, burgId, payload] = settlementsService.upsert.mock.calls[0];
  expect(burgId).toBe('burg-1');
  expect(payload.meters_per_unit).toBe(8);
  expect(payload.local_bounds).toEqual({ min_x: -220, min_y: -220, max_x: 220, max_y: 220 });
  expect(payload.settlement_generation_version).toBe('v2hash');
});
```

Near the top of the test file, add the new mocked-module reference:

```js
const settlementsService = await import('../../server/services/maps/burg-settlements-service.js');
```

Update the idempotency test to read from the sidecar, not the entrances service:

```js
test('idempotent: noop when sidecar version triplet matches', async () => {
  settlementsService.getByBurg.mockResolvedValue({
    schema_version: 2,
    settlement_generation_version: 'v2hash',
    settlemaker_version: '0.3.0-rc.1',
  });
  settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
  const client = makeClient(
    { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
    [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
  );
  const result = await ingestBurg(client, { burgId: 'burg-1' });
  expect(result.updated).toBe(false);
  expect(entrancesService.deleteForBurg).not.toHaveBeenCalled();
  expect(entrancesService.insertMany).not.toHaveBeenCalled();
  expect(settlementsService.upsert).not.toHaveBeenCalled();
});

test('force: true bypasses the triplet check', async () => {
  settlementsService.getByBurg.mockResolvedValue({
    schema_version: 2,
    settlement_generation_version: 'v2hash',
    settlemaker_version: '0.3.0-rc.1',
  });
  settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
  const client = makeClient(
    { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
    [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
  );
  const result = await ingestBurg(client, { burgId: 'burg-1', force: true });
  expect(result.updated).toBe(true);
  expect(settlementsService.upsert).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/settlemaker/ingestor.test.js`
Expected: FAIL on most or all cases. The ingester still consumes `layer: 'gate'` and writes no sidecar row.

- [ ] **Step 3: Rewrite `ingestBurg`**

Open `server/services/settlemaker/ingestor.js`. Replace the imports + entire `ingestBurg` + supporting `buildRows` function with:

```js
import { generateFromBurg, SETTLEMAKER_VERSION, computeSettlementScale, computeTileInfo } from 'settlemaker';
import { classifyRouteKind } from './route-classifier.js';
import {
  computeLocalToWorldScale,
  maxRadiusFromOrigin,
  translateLocalToWorldPx,
} from './coordinate-translator.js';
import {
  deleteForBurg as deleteEntrances,
  insertMany as insertEntrances,
} from '../maps/burg-entrances-service.js';
import {
  getByBurg as getSettlement,
  upsert as upsertSettlement,
} from '../maps/burg-settlements-service.js';
import { logInfo, logWarn } from '../../utils/logger.js';

// keep existing loadBurgRow / loadPixelsPerMile / loadApproachingRoutes /
// bearingFromBurgToSnap / computeOceanBearing / buildInput unchanged

const EXPECTED_SCHEMA_VERSION = 2;

function buildEntranceRows({ fc, burg, centroidPx, scale, settlemakerVersion }) {
  const version = fc.metadata.settlement_generation_version;
  const out = [];
  for (const f of fc.features) {
    if (f?.properties?.layer !== 'entrance') continue;
    const p = f.properties;
    const [lx, ly] = f.geometry.coordinates;
    const world = translateLocalToWorldPx({
      localPoint: { x: lx, y: ly },
      burgCentroidPx: centroidPx,
      scale,
    });
    out.push({
      burg_id: burg.id,
      gate_id: p.entrance_id,                       // column name unchanged for back-compat
      route_id: p.matched_route_id ?? null,
      x_px: world.x,
      y_px: world.y,
      bearing_deg: Number(p.bearing_deg),
      bearing_match_delta_deg: p.bearing_match_delta_deg ?? null,
      kind: p.kind,
      sub_kind: p.sub_kind,
      wall_vertex_index: Number(p.wall_vertex_index),
      prev_gate_id: p.prev_entrance_id ?? null,     // column name unchanged
      next_gate_id: p.next_entrance_id ?? null,
      name: p.name ?? null,
      arrival_local: Array.isArray(p.arrival_local) ? p.arrival_local : null,
      settlement_generation_version: version,
      settlemaker_version: settlemakerVersion,
    });
  }
  return out;
}

function extractSidecarPayload(fc, input) {
  const m = fc.metadata;
  const hasHarbour = fc.features.some(
    (f) => f?.properties?.layer === 'entrance' && f.properties.sub_kind === 'harbour',
  );
  const tileInfo = computeTileInfo(input.population);
  return {
    meters_per_unit: m.scale.meters_per_unit,
    diameter_meters: m.scale.diameter_meters,
    diameter_local: m.scale.diameter_local,
    scale_source: m.scale.source,
    local_bounds: m.local_bounds,
    max_zoom: tileInfo.maxZoom,
    tile_extent_px: tileInfo.tileExtentPx ?? (256 * Math.pow(2, tileInfo.maxZoom)),
    svg_viewbox: {
      x: m.local_bounds.min_x,
      y: m.local_bounds.min_y,
      width: m.local_bounds.max_x - m.local_bounds.min_x,
      height: m.local_bounds.max_y - m.local_bounds.min_y,
    },
    has_harbour: hasHarbour,
    ocean_bearing_deg: input.oceanBearing != null ? Math.round(input.oceanBearing) : null,
    settlement_generation_version: m.settlement_generation_version,
    settlemaker_version: m.settlemaker_version ?? SETTLEMAKER_VERSION,
  };
}

export async function ingestBurg(client, { burgId, force = false }) {
  const burg = await loadBurgRow(client, burgId);
  if (!burg) {
    const err = new Error(`Burg ${burgId} not found`);
    err.status = 404;
    err.code = 'burg_not_found';
    throw err;
  }
  const routes = await loadApproachingRoutes(client, burg);
  const input = buildInput(burg, routes);

  const { geojson } = generateFromBurg(input);

  if (geojson.metadata.schema_version !== EXPECTED_SCHEMA_VERSION) {
    const err = new Error(
      `Settlemaker schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, got ${geojson.metadata.schema_version}`,
    );
    err.code = 'settlemaker_schema_mismatch';
    err.status = 500;
    throw err;
  }

  const newVersion = geojson.metadata.settlement_generation_version;
  const settlemakerVersion = geojson.metadata.settlemaker_version ?? SETTLEMAKER_VERSION;

  if (!force) {
    const existing = await getSettlement(client, burgId);
    if (
      existing &&
      existing.schema_version === EXPECTED_SCHEMA_VERSION &&
      existing.settlement_generation_version === newVersion &&
      existing.settlemaker_version === settlemakerVersion
    ) {
      return { updated: false, count: 0 };
    }
  }

  const pixelsPerMile = await loadPixelsPerMile(client, burg.world_id);
  const wallRadiusLocal = wallRadiusFromFc(geojson);
  const scale = computeLocalToWorldScale({
    population: Number(burg.population) || 100,
    wallRadiusLocal,
    pixelsPerMile,
  });

  const centroidPx = { x: Number(burg.x_px), y: Number(burg.y_px) };
  const rows = buildEntranceRows({
    fc: geojson,
    burg,
    centroidPx,
    scale,
    settlemakerVersion,
  });
  const sidecar = extractSidecarPayload(geojson, input);

  await client.query('BEGIN');
  try {
    await deleteEntrances(client, burgId);
    await upsertSettlement(client, burgId, sidecar);
    if (rows.length > 0) await insertEntrances(client, rows);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logWarn('settlemaker ingestor rollback', { burgId, error: err?.message });
    throw err;
  }

  logInfo('settlemaker ingest complete', {
    telemetryEvent: 'settlemaker.ingested',
    burgId, gateCount: rows.length, version: newVersion,
  });
  return { updated: true, count: rows.length };
}

export async function ensureEntrancesFresh(client, { burgId }) {
  return ingestBurg(client, { burgId });
}
```

Note: the existing SELECT in sidecar `getByBurg` does not return `schema_version`. We'll rely on the column-triplet check having the same strength — since the sidecar row would only have been written by this v2 code, `schema_version` is implicitly 2. Add an explicit field only if a future migration ever writes a v3-authored row. Until then, the `existing.schema_version === EXPECTED_SCHEMA_VERSION` guard treats `undefined !== 2` as "need to rewrite," which is safe: the first post-upgrade run always writes, subsequent runs match on the other two and still skip because the strict-equality fails on the missing field. **To make the idempotency actually skip, treat a missing schema_version on the row as "matches" — adjust below.**

Replace the skip guard with:

```js
if (
  existing &&
  (existing.schema_version == null || existing.schema_version === EXPECTED_SCHEMA_VERSION) &&
  existing.settlement_generation_version === newVersion &&
  existing.settlemaker_version === settlemakerVersion
) {
  return { updated: false, count: 0 };
}
```

(If you later add a `schema_version` column to the sidecar, flip the null check to strict equality.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/settlemaker/ingestor.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/settlemaker/ingestor.js tests/settlemaker/ingestor.test.js
git commit -m "feat(ingestor): consume settlemaker schema v2 + write sidecar"
```

---

## Task 7: Add backfill script

**Files:**
- Create: `server/scripts/backfill-plan3b.js`

- [ ] **Step 1: Write the script**

Create `server/scripts/backfill-plan3b.js`:

```js
#!/usr/bin/env node
// One-shot backfill for Plan 3b. Iterates every burg in maps_burgs and
// re-runs the settlemaker ingester with { force: true }. Each burg runs
// in its own transaction. Exits non-zero if any burg errors.
//
// Usage:  node server/scripts/backfill-plan3b.js
//
// Safe to re-run.

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ingestBurg } from '../services/settlemaker/ingestor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
for (const f of [
  join(__dirname, '..', '.env.local'),
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '.env.local'),
  join(__dirname, '..', '..', '.env'),
]) {
  if (existsSync(f)) dotenv.config({ path: f, override: true });
}

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME || process.env.PGDATABASE,
  user: process.env.DATABASE_USER || process.env.PGUSER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  let burgIds;
  try {
    const { rows } = await client.query(`SELECT id FROM public.maps_burgs ORDER BY id`);
    burgIds = rows.map((r) => r.id);
  } finally {
    client.release();
  }

  console.log(`[plan3b-backfill] ${burgIds.length} burgs to process`);
  let written = 0;
  let errored = 0;

  for (const burgId of burgIds) {
    const txClient = await pool.connect();
    try {
      const result = await ingestBurg(txClient, { burgId, force: true });
      console.log(`[plan3b-backfill] ${burgId}: written (count=${result.count})`);
      written += 1;
    } catch (err) {
      console.error(`[plan3b-backfill] ${burgId}: ERROR ${err.code ?? ''} ${err.message}`);
      errored += 1;
    } finally {
      txClient.release();
    }
  }

  console.log(`[plan3b-backfill] done — written=${written}, errored=${errored}`);
  await pool.end();
  if (errored > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[plan3b-backfill] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run the script against the local DB (if a dev DB has burgs)**

Run: `node server/scripts/backfill-plan3b.js`
Expected (if dev DB has burgs): per-burg log lines ending with `done — written=N, errored=0`.
Expected (if dev DB has no burgs): `0 burgs to process` then `done`.

If this dev DB has v1-ingested burgs from before today's session, this is the run that upgrades them.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/backfill-plan3b.js
git commit -m "feat(plan3b): backfill script re-ingests every burg with force=true"
```

---

## Task 8: Extend `GET /players/visible` with `insideBurgId`, `mapLevel`, `settlementLocal`

**Files:**
- Modify: `server/routes/campaigns.routes.js` (around line 2181 and line 932)

- [ ] **Step 1: Read the current handler and identify the SQL**

Open `server/routes/campaigns.routes.js`. Find `visible_player_positions` near line 2181.

- [ ] **Step 2: Extend the SQL to join in sidecar + audit arrival gate data**

Replace the query block with:

```js
const { rows } = await client.query(
  `SELECT vp.player_id, vp.user_id, vp.character_id, vp.role,
          vp.visibility_state,
          ST_AsGeoJSON(vp.loc)::json AS geometry,
          vp.can_view_history,
          cp.inside_burg_id,
          CASE WHEN cp.inside_burg_id IS NULL THEN 'world' ELSE 'settlement' END AS map_level_raw,
          b.xpixel AS burg_x_px, b.ypixel AS burg_y_px,
          mbs.meters_per_unit, mbs.local_bounds,
          w.pixels_per_mile,
          (SELECT mbe.arrival_local
             FROM public.player_movement_audit pma
             JOIN public.maps_burg_entrances mbe ON mbe.id = pma.arrival_gate_entrance_id
            WHERE pma.campaign_id = $1
              AND pma.player_id = vp.player_id
              AND pma.arrival_gate_entrance_id IS NOT NULL
            ORDER BY pma.created_at DESC
            LIMIT 1) AS arrival_local
     FROM visible_player_positions($1, $2, $3) vp
     JOIN public.campaign_players cp ON cp.player_id = vp.player_id
     LEFT JOIN public.maps_burgs b ON b.id = cp.inside_burg_id
     LEFT JOIN public.maps_burg_settlements mbs ON mbs.burg_id = cp.inside_burg_id
     LEFT JOIN public.maps_world w ON w.id = b.world_id`,
  [campaignId, req.user.id, radius]
);
```

The column `campaign_players.player_id` may or may not be the join key — verify by reading the `campaign_players` schema. If the correct join column is `id` or `character_id`, adjust the `ON cp.xxx = vp.player_id` predicate.

- [ ] **Step 3: Compute `settlementLocal` in the response mapper**

Import at the top of the route file:

```js
import { translateWorldPixelToSettlementLocal } from '../services/settlemaker/coordinate-translator.js';
```

Replace the `features` mapper:

```js
const METERS_PER_MILE = 1609.344;

const features = rows.map((row) => {
  let insideBurgId = row.inside_burg_id ?? null;
  let mapLevel = row.map_level_raw ?? 'world';
  let settlementLocal = null;

  if (insideBurgId && row.meters_per_unit != null && row.local_bounds && row.pixels_per_mile) {
    if (row.arrival_local && Array.isArray(row.arrival_local)) {
      settlementLocal = { x: Number(row.arrival_local[0]), y: Number(row.arrival_local[1]) };
    } else if (row.geometry?.coordinates) {
      const [wx, wy] = row.geometry.coordinates;
      settlementLocal = translateWorldPixelToSettlementLocal({
        playerWorldPx: { x: Number(wx), y: Number(wy) },
        burgWorldCenterPx: { x: Number(row.burg_x_px), y: Number(row.burg_y_px) },
        worldMetersPerPixel: METERS_PER_MILE / Number(row.pixels_per_mile),
        sidecar: {
          metersPerUnit: Number(row.meters_per_unit),
          localBounds: row.local_bounds,
        },
        burgId: insideBurgId,
      });
    }
  } else if (insideBurgId) {
    // sidecar missing — only possible during backfill window; stay on world view
    mapLevel = 'world';
    settlementLocal = null;
  }

  return {
    type: 'Feature',
    geometry: row.geometry,
    properties: {
      playerId: row.player_id,
      userId: row.user_id,
      characterId: row.character_id,
      role: row.role,
      visibilityState: row.visibility_state,
      canViewHistory: row.can_view_history,
      insideBurgId,
      mapLevel,
      settlementLocal,
    },
  };
});
```

- [ ] **Step 4: Fix the manual-move broadcast at line ~932**

Search in the same file for the `broadcast` or `player-moved` payload near line 932. Add `insideBurgId: <source>` to match the shape already emitted by `narrative-movement.js` (so the broadcast event payload is consistent across call sites). Exact source column to read depends on what the surrounding handler already has; if `campaign_players.inside_burg_id` isn't already loaded there, leave a `TODO: plan3b task-14` comment and defer the full fix to Task 14 (which is the task that finalises this broadcast payload). Do NOT let this block Task 8; the main consumer (Step 3) reads from fetch, not broadcast.

- [ ] **Step 5: Smoke-test the endpoint locally**

Run: `npm run db:dev` (in one shell) + `curl` the endpoint for a dev campaign:

```bash
curl -s -H "Authorization: Bearer <dev-token>" \
  http://localhost:PORT/api/campaigns/<campaign-id>/players/visible | jq '.features[0].properties'
```

Expected fields: `insideBurgId`, `mapLevel`, `settlementLocal`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/campaigns.routes.js
git commit -m "feat(api): add insideBurgId, mapLevel, settlementLocal to /players/visible"
```

---

## Task 9: Add the real-DB integration test

**Files:**
- Create: `tests/plan3b/ingestor-settlement.integration.test.js`

- [ ] **Step 1: Scaffold the test using the narrative-movement harness as a template**

Read `tests/movement/narrative-movement.e2e.test.js` first to copy the DB setup conventions (env vars, pool wiring, cleanup).

Create `tests/plan3b/ingestor-settlement.integration.test.js`:

```js
import { jest } from '@jest/globals';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from 'pg';
import { ingestBurg } from '../../server/services/settlemaker/ingestor.js';
import { getByBurg as getSettlement } from '../../server/services/maps/burg-settlements-service.js';
import { listByBurg as listEntrances } from '../../server/services/maps/burg-entrances-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = JSON.parse(
  fs.readFileSync(join(__dirname, '..', 'fixtures', 'settlemaker', 'v2-sample-burg.geojson'), 'utf8'),
);

// Require these env vars to be set (the test skips if unset).
const REQUIRED = ['TEST_DATABASE_URL', 'TEST_WORLD_ID', 'TEST_BURG_ID'];
const MISSING = REQUIRED.filter((k) => !process.env[k]);

(MISSING.length ? describe.skip : describe)('ingestor-settlement (real DB)', () => {
  let pool;
  let client;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  test('ingestBurg writes sidecar + entrances with arrival_local', async () => {
    // Mock the settlemaker generator so the test is deterministic.
    jest.unstable_mockModule('settlemaker', () => ({
      generateFromBurg: () => ({ model: {}, svg: '', geojson: FIXTURE }),
      SETTLEMAKER_VERSION: FIXTURE.metadata.settlemaker_version,
      computeSettlementScale: (pop) => ({
        diameterMeters: 200 * Math.pow(pop / 100, 0.4),
        maxZoom: 3,
      }),
      computeTileInfo: () => ({ maxZoom: 3, tileExtentPx: 2048 }),
    }));

    const result = await ingestBurg(client, { burgId: process.env.TEST_BURG_ID, force: true });
    expect(result.updated).toBe(true);

    const sidecar = await getSettlement(client, process.env.TEST_BURG_ID);
    expect(sidecar).not.toBeNull();
    expect(Number(sidecar.meters_per_unit)).toBeCloseTo(FIXTURE.metadata.scale.meters_per_unit, 6);
    expect(sidecar.local_bounds).toEqual(FIXTURE.metadata.local_bounds);

    const entrances = await listEntrances(client, process.env.TEST_BURG_ID);
    expect(entrances.length).toBeGreaterThan(0);
    const withArrival = entrances.filter((e) => e.arrival_local != null);
    expect(withArrival.length).toBe(entrances.length);
  }, 30_000);
});
```

- [ ] **Step 2: Run locally with env vars set (if you have a dev DB seeded)**

Run:
```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/dnd_app_test \
TEST_WORLD_ID=<seeded-world> \
TEST_BURG_ID=<seeded-burg> \
npm test -- tests/plan3b/
```
Expected: PASS. If envs aren't set, the test `describe.skip`s cleanly so CI on a machine without a seeded DB won't break.

- [ ] **Step 3: Commit**

```bash
git add tests/plan3b/ingestor-settlement.integration.test.js
git commit -m "test(plan3b): real-DB integration test for ingest + sidecar"
```

---

## Task 10: Extract `useVisiblePlayers` hook

**Files:**
- Create: `hooks/useVisiblePlayers.tsx`
- Modify: `components/openlayers-map.tsx` (swap the inline fetch for the hook)

- [ ] **Step 1: Write the hook**

Create `hooks/useVisiblePlayers.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';

export interface VisiblePlayer {
  playerId: string;
  userId: string;
  characterId: string;
  role: string;
  visibilityState: string;
  canViewHistory: boolean;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  insideBurgId: string | null;
  mapLevel: 'world' | 'settlement';
  settlementLocal: { x: number; y: number } | null;
}

interface Response {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: VisiblePlayer['geometry'];
    properties: Omit<VisiblePlayer, 'geometry'>;
  }>;
  metadata: { radius: number; viewerRole: string };
}

export function useVisiblePlayers(campaignId: string | null, radiusOverride?: number | null) {
  const [players, setPlayers] = useState<VisiblePlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const radiusQuery = radiusOverride != null ? `?radius=${radiusOverride}` : '';
      const res = await fetch(
        `/api/campaigns/${campaignId}/players/visible${radiusQuery}`,
        { signal: ctrl.signal, credentials: 'include' },
      );
      if (!res.ok) throw new Error(`visible-players ${res.status}`);
      const body = (await res.json()) as Response;
      const next: VisiblePlayer[] = body.features.map((f) => ({
        ...f.properties,
        geometry: f.geometry,
      } as VisiblePlayer));
      setPlayers(next);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.warn('useVisiblePlayers refresh failed', err);
      }
    } finally {
      setLoading(false);
    }
  }, [campaignId, radiusOverride]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { players, loading, refresh };
}
```

- [ ] **Step 2: Swap the inline fetch in `openlayers-map.tsx`**

Locate `loadVisiblePlayers` around line 1054. Its body builds the same request — replace the component's usage with the hook and remove the inline definition.

Concretely: import at the top —

```tsx
import { useVisiblePlayers } from '../hooks/useVisiblePlayers';
```

Near the component body (existing state/hook cluster), add:

```tsx
const { players: visiblePlayers, refresh: refreshVisiblePlayers } = useVisiblePlayers(activeCampaignId);
```

Replace every call to `loadVisiblePlayers(activeCampaignId)` with `refreshVisiblePlayers()`. Delete the `loadVisiblePlayers` definition and any state it managed (the hook owns the array). Wherever existing code consumed the old `PlayerToken`-shaped list, adapt to read from `visiblePlayers` (map to the old shape inline if faster than chasing the type through the file).

This is the largest churn step in the plan. Expected diff: ~60–120 lines removed, ~30 added. If the existing consumer pattern is deeply entangled (many callbacks captured in refs), keep the inline `loadVisiblePlayers` as a thin wrapper that just calls `refreshVisiblePlayers()` and reads from `visiblePlayers`. Don't over-refactor; the goal is that the hook is the single fetch site.

- [ ] **Step 3: Run the type-check and tests**

Run: `npm run build` (or `npx tsc --noEmit` if available)
Expected: no new errors.

Run: `npm test`
Expected: all prior tests still pass.

- [ ] **Step 4: Commit**

```bash
git add hooks/useVisiblePlayers.tsx components/openlayers-map.tsx
git commit -m "refactor(map): extract useVisiblePlayers hook"
```

---

## Task 11: Create `<SettlementMap>` component

**Files:**
- Create: `components/maps/settlement-map.tsx`

- [ ] **Step 1: Write the component**

Create `components/maps/settlement-map.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import { createSettlementTileSource } from './settlement-tile-source';
import { questablesProjection } from '../map-projection';
import { getApiBaseUrl } from '../../utils/api-client';
import type { VisiblePlayer } from '../../hooks/useVisiblePlayers';

export interface SettlementSidecar {
  meters_per_unit: number;
  max_zoom: number;
  local_bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  svg_viewbox: { x: number; y: number; width: number; height: number };
}

interface Props {
  burgId: string;
  sidecar: SettlementSidecar;
  players: VisiblePlayer[];
  onDismiss: () => void;
}

export function SettlementMap({ burgId, sidecar, players, onDismiss }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const playerLayerRef = useRef<VectorSource | null>(null);
  const entranceLayerRef = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const source = createSettlementTileSource(burgId, sidecar.max_zoom);
    const tileLayer = new TileLayer({ source });

    const playerSource = new VectorSource();
    playerLayerRef.current = playerSource;
    const playerLayer = new VectorLayer({
      source: playerSource,
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#2563eb' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      }),
    });

    const entranceSource = new VectorSource();
    entranceLayerRef.current = entranceSource;
    const entranceLayer = new VectorLayer({
      source: entranceSource,
      style: new Style({
        image: new CircleStyle({
          radius: 4,
          fill: new Fill({ color: '#f59e0b' }),
          stroke: new Stroke({ color: '#78350f', width: 1 }),
        }),
      }),
    });

    const extent: [number, number, number, number] = [
      sidecar.local_bounds.min_x,
      sidecar.local_bounds.min_y,
      sidecar.local_bounds.max_x,
      sidecar.local_bounds.max_y,
    ];
    const view = new View({
      projection: questablesProjection,
      center: [
        (extent[0] + extent[2]) / 2,
        (extent[1] + extent[3]) / 2,
      ],
      maxZoom: sidecar.max_zoom,
    });

    const map = new Map({
      target: containerRef.current,
      layers: [tileLayer, entranceLayer, playerLayer],
      view,
    });
    mapRef.current = map;

    view.fit(extent, { maxZoom: sidecar.max_zoom });

    // Fetch entrances for this burg once; MVP has no refresh logic
    void (async () => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/maps/burgs/${burgId}/entrances`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const fc = (await res.json()) as {
          features: Array<{ properties: { x_px: number; y_px: number; arrival_local?: [number, number] | null } }>;
        };
        for (const f of fc.features) {
          // Prefer arrival_local (settlement-local) if present; else fall back to an offset 0,0
          const pt: [number, number] =
            Array.isArray(f.properties.arrival_local)
              ? [f.properties.arrival_local[0], f.properties.arrival_local[1]]
              : [0, 0];
          entranceSource.addFeature(new Feature(new Point(pt)));
        }
      } catch {
        /* ignore; entrance paint is nice-to-have */
      }
    })();

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [burgId, sidecar.local_bounds.max_x, sidecar.local_bounds.max_y, sidecar.local_bounds.min_x, sidecar.local_bounds.min_y, sidecar.max_zoom]);

  // Player tokens — re-run on players change
  useEffect(() => {
    const src = playerLayerRef.current;
    if (!src) return;
    src.clear();
    for (const p of players) {
      if (p.insideBurgId !== burgId) continue;
      if (!p.settlementLocal) continue;
      src.addFeature(new Feature(new Point([p.settlementLocal.x, p.settlementLocal.y])));
    }
  }, [players, burgId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button
        type="button"
        onClick={onDismiss}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
      >
        View world
      </button>
    </div>
  );
}
```

The endpoint `GET /api/maps/burgs/:burgId/entrances` existed in Plan 3a (`ab01389 feat(api): add GET /:worldId/burg-entrances endpoint`) — if the URL shape differs slightly (e.g. keyed on worldId not burgId), adjust this fetch call to match.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no new TS errors. If `ol/...` imports don't match the installed version, match the existing `openlayers-map.tsx` import style.

- [ ] **Step 3: Commit**

```bash
git add components/maps/settlement-map.tsx
git commit -m "feat(map): add SettlementMap component"
```

---

## Task 12: Create `<MapRoot>` — swap decider

**Files:**
- Create: `components/maps/map-root.tsx`

- [ ] **Step 1: Write MapRoot**

Create `components/maps/map-root.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { SettlementMap, type SettlementSidecar } from './settlement-map';
import OpenlayersMap from '../openlayers-map';
import { useVisiblePlayers } from '../../hooks/useVisiblePlayers';
import { getApiBaseUrl } from '../../utils/api-client';

interface Props {
  activeCampaignId: string | null;
  activeCharacterId: string | null;
  // pass through any props openlayers-map already takes
  [key: string]: unknown;
}

export function MapRoot({ activeCampaignId, activeCharacterId, ...rest }: Props) {
  const { players, refresh } = useVisiblePlayers(activeCampaignId);
  const [manualWorldOverride, setManualWorldOverride] = useState(false);
  const [sidecar, setSidecar] = useState<SettlementSidecar | null>(null);

  const followed = useMemo(
    () => players.find((p) => p.characterId === activeCharacterId) ?? null,
    [players, activeCharacterId],
  );
  const currentBurgId = followed?.insideBurgId ?? null;

  // Reset the override on any transition
  const prevBurgRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevBurgRef.current !== currentBurgId) {
      setManualWorldOverride(false);
      prevBurgRef.current = currentBurgId;
    }
  }, [currentBurgId]);

  // Fetch the sidecar when currentBurgId changes
  useEffect(() => {
    if (!currentBurgId) {
      setSidecar(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/maps/burgs/${currentBurgId}/settlement`,
          { credentials: 'include' },
        );
        if (!res.ok) { setSidecar(null); return; }
        const body = (await res.json()) as SettlementSidecar;
        if (!cancelled) setSidecar(body);
      } catch {
        if (!cancelled) setSidecar(null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentBurgId]);

  const showSettlement =
    currentBurgId != null &&
    !manualWorldOverride &&
    sidecar != null &&
    followed?.settlementLocal != null;

  if (showSettlement && currentBurgId && sidecar) {
    return (
      <SettlementMap
        burgId={currentBurgId}
        sidecar={sidecar}
        players={players}
        onDismiss={() => setManualWorldOverride(true)}
      />
    );
  }

  return (
    <OpenlayersMap
      activeCampaignId={activeCampaignId}
      activeCharacterId={activeCharacterId}
      {...rest}
    />
  );
}

export default MapRoot;
```

- [ ] **Step 2: Add the sidecar-fetch endpoint**

`GET /api/maps/burgs/:burgId/settlement` doesn't exist yet. Add it in `server/routes/maps.routes.js` (or wherever `maps` endpoints are registered — grep for `burg-entrances` route registration to find the file):

```js
router.get('/burgs/:burgId/settlement', async (req, res) => {
  const client = await getClient();
  try {
    const { rows } = await client.query(
      `SELECT meters_per_unit, diameter_meters, diameter_local, scale_source,
              local_bounds, max_zoom, tile_extent_px, svg_viewbox,
              has_harbour, ocean_bearing_deg,
              settlement_generation_version, settlemaker_version
         FROM public.maps_burg_settlements
        WHERE burg_id = $1`,
      [req.params.burgId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'no settlement sidecar' });
    res.json(rows[0]);
  } finally {
    client.release();
  }
});
```

If the maps router has auth middleware, mount this under the same middleware as the other read-only burg endpoints.

- [ ] **Step 3: Verify it compiles + tests pass**

Run: `npm run build && npm test`
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add components/maps/map-root.tsx server/routes/maps.routes.js
git commit -m "feat(map): MapRoot swap decider + /settlement sidecar endpoint"
```

---

## Task 13: Wire `<MapRoot>` into the app

**Files:**
- Modify: the file that currently mounts `<OpenlayersMap>` (discovered by grep)

- [ ] **Step 1: Locate the mount point**

Run: `grep -rn "OpenlayersMap\|openlayers-map" /home/barrulus/dev/questables/components /home/barrulus/dev/questables/App.tsx /home/barrulus/dev/questables/pages 2>/dev/null | grep -v '^Binary' | head -20`

Expected output points to the parent component. There may be one mount (`App.tsx`) or several (e.g. one for campaign view, one for prep view).

- [ ] **Step 2: Swap the import + JSX**

For each mount site, replace:

```tsx
import OpenlayersMap from './components/openlayers-map';
// ...
<OpenlayersMap {...props} />
```

with:

```tsx
import { MapRoot } from './components/maps/map-root';
// ...
<MapRoot {...props} />
```

Do NOT touch `campaign-prep-map.tsx` (separate map mode; Plan 3b does not affect the prep flow).

- [ ] **Step 3: Manual smoke-test**

Start the app: `npm run dev:local`

In a browser:
1. Log in, open a campaign that has at least one burg with Plan 3b sidecar populated.
2. Move a player inside the burg (via DM action or narrative move).
3. Expect: map swaps to the settlement tile view; player token renders at translated local position.
4. Click "View world" button. Expect: map returns to world view while the player is still inside the burg.
5. Move the player to another burg. Expect: map re-arms and swaps to the new settlement view.

If any step fails, capture the console errors and the `GET /players/visible` response for debugging.

- [ ] **Step 4: Commit**

```bash
git add <file-paths-from-step-1> App.tsx # or whatever was changed
git commit -m "feat(map): mount MapRoot at app map sites"
```

---

## Task 14: Include `insideBurgId` in manual-move broadcast

**Files:**
- Modify: `server/routes/campaigns.routes.js` (around line 932)

- [ ] **Step 1: Locate the broadcast**

Open `server/routes/campaigns.routes.js`. Search for the `player-moved` broadcast near line 932.

- [ ] **Step 2: Add `insideBurgId` to the payload**

Ensure the broadcast payload matches the narrative-movement version. If the handler already has the player's row loaded, read `insideBurgId` from it:

```js
broadcast(campaignId, {
  type: 'player-moved',
  playerId,
  // ... existing fields ...
  insideBurgId: playerRow.inside_burg_id ?? null,
  mapLevel: playerRow.inside_burg_id ? 'settlement' : 'world',
});
```

If the row isn't already loaded, add a `SELECT inside_burg_id FROM campaign_players WHERE player_id = $1` before the broadcast call.

- [ ] **Step 3: Verify + commit**

Run: `npm run build && npm test`
Expected: passes.

```bash
git add server/routes/campaigns.routes.js
git commit -m "feat(api): include insideBurgId in manual-move broadcast"
```

---

## Task 15: Final validation — tests, typecheck, lint

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 warnings, 0 errors.

- [ ] **Step 4: End-to-end runbook dry-run on dev DB**

Document (in the PR description) the deploy runbook:

```
1. psql -d dnd_app -f database/migrations/009_plan3b_sidecar.sql
2. node server/scripts/backfill-plan3b.js
3. restart app (kill existing, `npm run db:dev`)
```

Execute it against the local dev DB. Expected: step 1 reports a couple of BEGIN/CREATE/DO/COMMIT lines. Step 2 reports per-burg `written` lines and ends with `errored=0`. Step 3: app comes up clean, no `settlemaker_schema_mismatch` errors in the logs.

- [ ] **Step 5: Final commit + PR open**

If any stray fix-ups came out of the dry-run:

```bash
git add -p
git commit -m "fix(plan3b): <whatever-came-up>"
```

Open the PR with the runbook in the description. Link the spec.

---

## Self-review

Against `docs/superpowers/specs/2026-04-21-plan3b-settlement-view-design.md`:

- ✅ §2 sidecar table: Task 1 (migration), Task 2 (service), Task 6 (written from ingester). All 14 columns covered.
- ✅ §2 ingester rewrite: Task 6 (hard-require v2, entrance filter, sidecar write, per-burg txn, force option).
- ✅ §2 `arrival_local` on entrances: Task 1 (migration), Task 3 (service layer), Task 6 (ingester populates).
- ✅ §2 backfill script: Task 7.
- ✅ §3 extended `GET /players/visible`: Task 8.
- ✅ §3 gate-arrival short-circuit: Task 8 Step 3 (reads `arrival_local` from audit-joined row).
- ✅ §3 reverse translator: Task 4.
- ✅ §3 `<SettlementMap>` + `<MapRoot>`: Tasks 11, 12, 13.
- ✅ §3 soft dismiss toggle: Task 11 (button), Task 12 (override state).
- ✅ §3 fit-all with max_zoom clamp: Task 11 (`view.fit(extent, { maxZoom })`).
- ✅ §3 manual-move broadcast payload: Task 14.
- ✅ §4 unit + integration test split: Task 6 (unit), Task 4 (unit translator), Task 9 (integration).
- ✅ §4 deploy runbook, no feature flag: Task 15 Step 4 (documents the runbook).

No placeholders, no TBDs, no unreferenced types. `MapRoot`, `SettlementMap`, `useVisiblePlayers`, `translateWorldPixelToSettlementLocal`, `getSettlement`/`upsertSettlement` names used consistently across tasks.
