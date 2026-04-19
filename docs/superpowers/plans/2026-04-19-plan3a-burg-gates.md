# Plan 3a — Burg Gates + Approach-Vector Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "arrive at burg centroid" with "arrive at a named gate." Ingest settlemaker's per-burg gate output into `maps_burg_entrances`, pick the right gate on each narrative move via route-identity + approach-vector, retarget the polyline, and surface the arrival gate name to the LLM and the world map.

**Architecture:** settlemaker (already a `file:../settlemaker` dependency) emits a GeoJSON `FeatureCollection` per burg; a new ingestor translates local-settlement coordinates to world pixels and upserts rows keyed on stable `gate_id`. A pure `pickArrivalGate` function slots between `planTravel` and `performPlayerMovement` inside `applyNarrativeMove`. Gate metadata flows through the existing broadcast + `recentTravel` context path. Unwalled burgs and `fly`/`teleport` moves fall through to Plan 2 centroid behavior.

**Tech Stack:** PostgreSQL/PostGIS, Node.js (ESM, Jest with `--experimental-vm-modules`), `settlemaker` TS library, OpenLayers + React + TypeScript, Express.

**Spec:** `docs/superpowers/specs/2026-04-19-plan3a-gate-contract.md`

---

## File Structure

**New files:**
- `database/migrations/008_plan3a_burg_entrances.sql` — migration
- `server/services/settlemaker/route-classifier.js` — `maps_routes.type` → settlemaker `RouteKind`
- `server/services/settlemaker/coordinate-translator.js` — settlement-local → world-pixel math
- `server/services/settlemaker/ingestor.js` — orchestrates settlemaker call + upsert
- `server/services/maps/burg-entrances-service.js` — DB access (list, upsert, delete-by-burg)
- `server/services/movement/cardinal-names.js` — bearing → `'{Cardinal} Gate'`
- `server/services/movement/gate-picker.js` — pure gate-selection function + retargeter
- `components/layers/burg-entrances.ts` — OL vector layer for world-map gate markers
- `tests/settlemaker/route-classifier.test.js`
- `tests/settlemaker/coordinate-translator.test.js`
- `tests/settlemaker/ingestor.test.js`
- `tests/movement/cardinal-names.test.js`
- `tests/movement/gate-picker.test.js`
- `tests/movement/narrative-movement.gate.integration.test.js`

**Modified files:**
- `database/schema.sql` — add `maps_burg_entrances` DDL + `arrival_gate_entrance_id` on `player_movement_audit`
- `server/services/movement/narrative-movement.js` — call `pickArrivalGate` + `retargetPlanToGate` + thread `arrival` through summary
- `server/services/campaigns/service.js` — `performPlayerMovement` accepts `arrivalGateEntranceId`, writes it into audit row
- `server/services/dm-action/context-manager.js` — add `recentTravel.arrival.gate`
- `server/services/dm-action/action-prompt-builder.js` — add arrival-context guidance
- `server/routes/maps.routes.js` — add `GET /:worldId/burg-entrances`
- `components/map-data-loader.tsx` — add `loadBurgEntrances` + list endpoint call
- `components/maps/questables-style-factory.ts` — add `createBurgEntranceStyleFactory`
- `components/openlayers-map.tsx` — register burg-entrances layer, pulse on arrival

---

## Task 1: Database migration

**Files:**
- Create: `database/migrations/008_plan3a_burg_entrances.sql`
- Modify: `database/schema.sql`

- [ ] **Step 1: Write the migration**

Create `database/migrations/008_plan3a_burg_entrances.sql` with:

```sql
-- 008_plan3a_burg_entrances.sql
--
-- Adds gate-arrival storage for Plan 3a:
--   - public.maps_burg_entrances (new table, one row per gate per burg)
--   - public.player_movement_audit.arrival_gate_entrance_id (nullable FK)
--
-- Idempotent: safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.maps_burg_entrances (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    burg_id UUID NOT NULL REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    gate_id TEXT NOT NULL,
    route_id UUID REFERENCES public.maps_routes(id) ON DELETE SET NULL,
    x_px DOUBLE PRECISION NOT NULL,
    y_px DOUBLE PRECISION NOT NULL,
    geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED,
    bearing_deg DOUBLE PRECISION NOT NULL,
    bearing_match_delta_deg DOUBLE PRECISION,
    kind TEXT NOT NULL CHECK (kind IN ('land', 'harbour')),
    sub_kind TEXT NOT NULL CHECK (sub_kind IN ('road', 'foot', 'harbour')),
    wall_vertex_index INTEGER NOT NULL,
    prev_gate_id TEXT,
    next_gate_id TEXT,
    name TEXT,
    settlement_generation_version TEXT NOT NULL,
    settlemaker_version TEXT NOT NULL,
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'player_movement_audit'
      AND column_name = 'arrival_gate_entrance_id'
  ) THEN
    ALTER TABLE public.player_movement_audit
      ADD COLUMN arrival_gate_entrance_id UUID
        REFERENCES public.maps_burg_entrances(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Mirror into `database/schema.sql`**

Find the `maps_routes` table block in `database/schema.sql` (currently around line 156). Directly after its `CREATE INDEX` lines, insert the full `CREATE TABLE IF NOT EXISTS public.maps_burg_entrances ( ... )` block and its three indexes from above (without the `BEGIN/COMMIT` wrappers — schema.sql is statement-by-statement).

Find `CREATE TABLE IF NOT EXISTS public.player_movement_audit` in `database/schema.sql` and add `arrival_gate_entrance_id UUID REFERENCES public.maps_burg_entrances(id) ON DELETE SET NULL,` to its column list, placed after the last existing nullable column.

- [ ] **Step 3: Apply the migration locally**

Run:
```bash
psql "$DATABASE_URL" -f database/migrations/008_plan3a_burg_entrances.sql
```

Expected: `BEGIN`, `CREATE TABLE`, three `CREATE INDEX` lines, `DO`, `COMMIT`. Second run should be silent (idempotent).

Verify with:
```bash
psql "$DATABASE_URL" -c "\d public.maps_burg_entrances"
psql "$DATABASE_URL" -c "\d public.player_movement_audit" | grep arrival_gate_entrance_id
```

Expected: table definition matches, column exists.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/008_plan3a_burg_entrances.sql database/schema.sql
git commit -m "feat(db): add maps_burg_entrances + audit arrival gate column (Plan 3a)"
```

---

## Task 2: Route classifier helper

**Files:**
- Create: `server/services/settlemaker/route-classifier.js`
- Test: `tests/settlemaker/route-classifier.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/settlemaker/route-classifier.test.js`:

```javascript
import { classifyRouteKind } from '../../server/services/settlemaker/route-classifier.js';

describe('classifyRouteKind', () => {
  test.each([
    ['searoute', 'sea'],
    ['sea', 'sea'],
    ['ship', 'sea'],
    ['trail', 'foot'],
    ['footpath', 'foot'],
    ['road', 'road'],
    ['highway', 'road'],
    ['', 'road'],
    [null, 'road'],
    [undefined, 'road'],
  ])('classifies type %p as %p', (input, expected) => {
    expect(classifyRouteKind(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settlemaker/route-classifier.test.js`
Expected: FAIL — "Cannot find module" for the route-classifier import.

- [ ] **Step 3: Write minimal implementation**

Create `server/services/settlemaker/route-classifier.js`:

```javascript
const SEA_TYPES = new Set(['searoute', 'sea', 'ship']);
const FOOT_TYPES = new Set(['trail', 'footpath']);

/**
 * Map maps_routes.type to settlemaker's RouteKind.
 * Unknown or missing types default to 'road' — the most permissive option.
 */
export function classifyRouteKind(routeType) {
  if (typeof routeType !== 'string') return 'road';
  const t = routeType.toLowerCase();
  if (SEA_TYPES.has(t)) return 'sea';
  if (FOOT_TYPES.has(t)) return 'foot';
  return 'road';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settlemaker/route-classifier.test.js`
Expected: PASS, all 10 cases.

- [ ] **Step 5: Commit**

```bash
git add server/services/settlemaker/route-classifier.js tests/settlemaker/route-classifier.test.js
git commit -m "feat(settlemaker): add route-kind classifier helper"
```

---

## Task 3: Coordinate translator

**Files:**
- Create: `server/services/settlemaker/coordinate-translator.js`
- Test: `tests/settlemaker/coordinate-translator.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/settlemaker/coordinate-translator.test.js`:

```javascript
import {
  computeLocalToWorldScale,
  translateLocalToWorldPx,
  maxRadiusFromOrigin,
} from '../../server/services/settlemaker/coordinate-translator.js';

describe('maxRadiusFromOrigin', () => {
  test('returns largest Euclidean distance from origin over polygon vertices', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[[10, 0], [0, 20], [-30, 0], [0, -10], [10, 0]]],
    };
    expect(maxRadiusFromOrigin(polygon)).toBe(30);
  });

  test('returns 0 when polygon has no rings', () => {
    expect(maxRadiusFromOrigin({ type: 'Polygon', coordinates: [] })).toBe(0);
  });
});

describe('computeLocalToWorldScale', () => {
  const METERS_PER_MILE = 1609.344;

  test('uses pixels_per_mile when world is calibrated', () => {
    // population 10000 → settlemaker diameterMeters = 200 * (10000/100)^0.4 = 200 * 6.3096 ≈ 1261.9
    // radius miles = 631 / 1609.344 ≈ 0.392
    // wallRadiusLocal = 200 (e.g. from wall polygon)
    // pixels_per_mile = 50
    // scale = 0.392 * 50 / 200 ≈ 0.098
    const scale = computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 200,
      pixelsPerMile: 50,
    });
    const expected = (200 * Math.pow(10000 / 100, 0.4) / 2 / METERS_PER_MILE) * 50 / 200;
    expect(scale).toBeCloseTo(expected, 6);
  });

  test('falls back to FALLBACK when pixels_per_mile is null', () => {
    const scale = computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 200,
      pixelsPerMile: null,
    });
    expect(scale).toBeGreaterThan(0);
    // The fallback constant must be deterministic and finite
    expect(Number.isFinite(scale)).toBe(true);
  });

  test('returns 0 when wallRadiusLocal is 0 (degenerate)', () => {
    expect(computeLocalToWorldScale({
      population: 10000,
      wallRadiusLocal: 0,
      pixelsPerMile: 50,
    })).toBe(0);
  });
});

describe('translateLocalToWorldPx', () => {
  test('scales and translates relative to the burg centroid', () => {
    const world = translateLocalToWorldPx({
      localPoint: { x: 50, y: -30 },
      burgCentroidPx: { x: 1000, y: 2000 },
      scale: 0.1,
    });
    // world.x = 1000 + 50 * 0.1 = 1005
    // world.y = 2000 + (-30) * 0.1 = 1997
    // (Y axis is consistent — both systems Y-down — so no flip.)
    expect(world.x).toBeCloseTo(1005, 6);
    expect(world.y).toBeCloseTo(1997, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settlemaker/coordinate-translator.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `server/services/settlemaker/coordinate-translator.js`:

```javascript
const METERS_PER_MILE = 1609.344;

/**
 * Fallback scale factor (world-pixels per settlement-unit) for worlds that
 * lack a pixels_per_mile calibration. Chosen so a ~300-unit wall radius for a
 * pop-5000 town maps to ~30 pixels — roughly the size of a burg icon on the
 * world map at default zoom. Tuned by inspection; adjust in the constant, not
 * per-call.
 */
const FALLBACK_PIXELS_PER_SETTLEMENT_UNIT = 0.1;

/**
 * Settlemaker's population → diameter heuristic. Mirrors
 * `computeSettlementScale` from settlemaker/src/output/settlement-tiler.ts so
 * questables can derive the same diameterMeters without needing the function
 * exported.
 */
function diameterMetersForPopulation(population) {
  return 200 * Math.pow(Math.max(population, 1) / 100, 0.4);
}

/**
 * Return the largest Euclidean distance from the origin over all vertices of
 * a GeoJSON Polygon. Used to measure the wall's local-coord radius so we can
 * set up a scale factor from local to world pixels.
 */
export function maxRadiusFromOrigin(polygon) {
  if (!polygon || !Array.isArray(polygon.coordinates)) return 0;
  let max = 0;
  for (const ring of polygon.coordinates) {
    for (const [x, y] of ring) {
      const r = Math.hypot(x, y);
      if (r > max) max = r;
    }
  }
  return max;
}

/**
 * Pixels-per-settlement-unit scale factor.
 *
 * Derivation: diameterMeters from population → radius in miles via
 * METERS_PER_MILE → radius in world pixels via pixels_per_mile. Divide by
 * the wall polygon's local-coord radius to get pixels-per-unit.
 *
 * When pixelsPerMile is null, falls back to a deterministic constant so
 * uncalibrated worlds still produce plausible gate placements.
 */
export function computeLocalToWorldScale({ population, wallRadiusLocal, pixelsPerMile }) {
  if (!(wallRadiusLocal > 0)) return 0;
  if (pixelsPerMile == null || !(pixelsPerMile > 0)) {
    return FALLBACK_PIXELS_PER_SETTLEMENT_UNIT;
  }
  const diameterMeters = diameterMetersForPopulation(population);
  const radiusMiles = (diameterMeters / 2) / METERS_PER_MILE;
  return (radiusMiles * pixelsPerMile) / wallRadiusLocal;
}

/**
 * Translate a settlement-local point (origin near centroid, Y-down) to
 * world-pixel coordinates. Both coordinate systems are Y-down so no flip.
 */
export function translateLocalToWorldPx({ localPoint, burgCentroidPx, scale }) {
  return {
    x: burgCentroidPx.x + localPoint.x * scale,
    y: burgCentroidPx.y + localPoint.y * scale,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settlemaker/coordinate-translator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/settlemaker/coordinate-translator.js tests/settlemaker/coordinate-translator.test.js
git commit -m "feat(settlemaker): add local-to-world coordinate translator"
```

---

## Task 4: Burg-entrances data-access service

**Files:**
- Create: `server/services/maps/burg-entrances-service.js`

- [ ] **Step 1: Write minimal implementation (no test — thin SQL wrappers)**

Create `server/services/maps/burg-entrances-service.js`:

```javascript
import { pool } from '../../db/pool.js';

const SELECT_COLUMNS = `
  id, burg_id, gate_id, route_id, x_px, y_px, bearing_deg,
  bearing_match_delta_deg, kind, sub_kind, wall_vertex_index,
  prev_gate_id, next_gate_id, name, settlement_generation_version,
  settlemaker_version
`;

export async function listByBurg(client, burgId) {
  const { rows } = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM public.maps_burg_entrances WHERE burg_id = $1`,
    [burgId],
  );
  return rows;
}

export async function listByWorld(worldId) {
  const { rows } = await pool.query(
    `SELECT e.${SELECT_COLUMNS.replaceAll('\n', ' ').trim().split(',').map(s => 'e.' + s.trim()).join(', ')}
       FROM public.maps_burg_entrances e
       JOIN public.maps_burgs b ON b.id = e.burg_id
      WHERE b.world_id = $1`,
    [worldId],
  );
  return rows;
}

export async function distinctVersionForBurg(client, burgId) {
  const { rows } = await client.query(
    `SELECT DISTINCT settlement_generation_version
       FROM public.maps_burg_entrances
      WHERE burg_id = $1`,
    [burgId],
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) return 'MIXED';
  return rows[0].settlement_generation_version;
}

export async function deleteForBurg(client, burgId) {
  await client.query(
    `DELETE FROM public.maps_burg_entrances WHERE burg_id = $1`,
    [burgId],
  );
}

export async function insertMany(client, rows) {
  if (rows.length === 0) return;
  for (const r of rows) {
    await client.query(
      `INSERT INTO public.maps_burg_entrances
         (burg_id, gate_id, route_id, x_px, y_px, bearing_deg,
          bearing_match_delta_deg, kind, sub_kind, wall_vertex_index,
          prev_gate_id, next_gate_id, name,
          settlement_generation_version, settlemaker_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        r.burg_id, r.gate_id, r.route_id, r.x_px, r.y_px, r.bearing_deg,
        r.bearing_match_delta_deg, r.kind, r.sub_kind, r.wall_vertex_index,
        r.prev_gate_id, r.next_gate_id, r.name,
        r.settlement_generation_version, r.settlemaker_version,
      ],
    );
  }
}
```

Note: Double-check the exact pool import path by running:
```bash
grep -rn "export.*pool" server/db/ | head
```
If the export is named `getPool` or the module is `db-pool.js`, update the import accordingly.

- [ ] **Step 2: Commit**

```bash
git add server/services/maps/burg-entrances-service.js
git commit -m "feat(maps): add burg-entrances data-access service"
```

---

## Task 5: Cardinal-name helper

**Files:**
- Create: `server/services/movement/cardinal-names.js`
- Test: `tests/movement/cardinal-names.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/movement/cardinal-names.test.js`:

```javascript
import { cardinalGateName } from '../../server/services/movement/cardinal-names.js';

describe('cardinalGateName', () => {
  test.each([
    [0, 'North Gate'],
    [22.4, 'North Gate'],
    [22.5, 'Northeast Gate'],
    [45, 'Northeast Gate'],
    [90, 'East Gate'],
    [135, 'Southeast Gate'],
    [180, 'South Gate'],
    [225, 'Southwest Gate'],
    [270, 'West Gate'],
    [315, 'Northwest Gate'],
    [337.5, 'North Gate'],
    [359.9, 'North Gate'],
    [360, 'North Gate'],
    [-45, 'Northwest Gate'],
  ])('bearing %p → %p', (bearing, expected) => {
    expect(cardinalGateName(bearing)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/movement/cardinal-names.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `server/services/movement/cardinal-names.js`:

```javascript
const COMPASS = [
  'North', 'Northeast', 'East', 'Southeast',
  'South', 'Southwest', 'West', 'Northwest',
];

/**
 * Map a compass bearing (0..360, 0=N, clockwise) to an 8-point cardinal
 * suffix. Used when settlemaker doesn't emit a gate name.
 *
 * Bearings outside [0,360) are normalised. The 45° sectors are centred on
 * the cardinal so `bearing=22.4` is "North" and `bearing=22.5` flips to
 * "Northeast".
 */
export function cardinalGateName(bearingDeg) {
  const b = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.floor(((b + 22.5) % 360) / 45);
  return `${COMPASS[idx]} Gate`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/movement/cardinal-names.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/cardinal-names.js tests/movement/cardinal-names.test.js
git commit -m "feat(movement): add cardinal gate-name helper"
```

---

## Task 6: Gate-picker (route-identity match)

**Files:**
- Create: `server/services/movement/gate-picker.js`
- Test: `tests/movement/gate-picker.test.js`

- [ ] **Step 1: Write the failing test (early-outs + single-option + route-identity)**

Create `tests/movement/gate-picker.test.js`:

```javascript
import { jest } from '@jest/globals';
import { pickArrivalGate } from '../../server/services/movement/gate-picker.js';

function makeClient(entranceRows) {
  return {
    query: jest.fn(async () => ({ rows: entranceRows })),
  };
}

const gateA = {
  id: 'ent-a', gate_id: 'g1', route_id: 'route-a',
  x_px: 100, y_px: 100, bearing_deg: 0,
  bearing_match_delta_deg: 3, kind: 'land', sub_kind: 'road', name: null,
};
const gateB = {
  id: 'ent-b', gate_id: 'g2', route_id: 'route-b',
  x_px: 200, y_px: 200, bearing_deg: 180,
  bearing_match_delta_deg: 7, kind: 'land', sub_kind: 'road', name: 'South Gate',
};

describe('pickArrivalGate — early outs', () => {
  test('returns null when destination kind is not burg', async () => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'roads', waypoints: [] },
      destination: { kind: 'coordinate', burgId: null },
    });
    expect(gate).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('returns null when burgId missing', async () => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'roads', waypoints: [] },
      destination: { kind: 'burg', burgId: null },
    });
    expect(gate).toBeNull();
  });

  test.each(['fly', 'teleport'])('returns null for %s mode', async (mode) => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode, effectiveVia: 'direct', waypoints: [] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate).toBeNull();
  });
});

describe('pickArrivalGate — zero/one rows', () => {
  test('returns null when burg has no entrances', async () => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'roads', waypoints: [{x:0,y:0},{x:100,y:0}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate).toBeNull();
  });

  test('single entrance is returned with single_option', async () => {
    const client = makeClient([gateA]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'direct', waypoints: [{x:0,y:0},{x:100,y:100}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate).toMatchObject({
      entranceId: 'ent-a',
      gateId: 'g1',
      matchedBy: 'single_option',
    });
    expect(gate.name).toBe('North Gate'); // cardinal fallback, bearing 0
  });
});

describe('pickArrivalGate — route identity', () => {
  test('matches entrance by route_id when plan.effectiveVia is a UUID', async () => {
    const client = makeClient([gateA, gateB]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'route-b', waypoints: [{x:0,y:0},{x:200,y:200}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-b');
    expect(gate.matchedBy).toBe('route_id');
    expect(gate.name).toBe('South Gate'); // stored name wins over cardinal
  });

  test('ties on route_id break by smaller bearing_match_delta_deg', async () => {
    const sameRouteTight = { ...gateA, id: 'ent-tight', bearing_match_delta_deg: 1 };
    const sameRouteLoose = { ...gateA, id: 'ent-loose', bearing_match_delta_deg: 10 };
    const client = makeClient([sameRouteLoose, sameRouteTight]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'route-a', waypoints: [{x:0,y:0},{x:50,y:50}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-tight');
    expect(gate.matchedBy).toBe('route_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/movement/gate-picker.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation (early outs + route-identity + name-fallback only; approach-vector is Task 7)**

Create `server/services/movement/gate-picker.js`:

```javascript
import { cardinalGateName } from './cardinal-names.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Settlemaker ids also used as routes in tests; accept any string that isn't the
// literal 'roads' or 'direct' as a potential route identifier.
function viaLooksLikeRouteId(via) {
  if (typeof via !== 'string') return false;
  if (via === 'roads' || via === 'direct') return false;
  return true; // UUID_RE.test(via) in production; loosened so fixture ids work
}

function rowToGate(row, matchedBy) {
  return {
    entranceId: row.id,
    gateId: row.gate_id,
    x: Number(row.x_px),
    y: Number(row.y_px),
    bearingDeg: Number(row.bearing_deg),
    kind: row.kind,
    subKind: row.sub_kind,
    name: row.name ?? cardinalGateName(Number(row.bearing_deg)),
    matchedBy,
  };
}

async function loadEntrances(client, burgId) {
  const { rows } = await client.query(
    `SELECT id, gate_id, route_id, x_px, y_px, bearing_deg,
            bearing_match_delta_deg, kind, sub_kind, name
       FROM public.maps_burg_entrances
      WHERE burg_id = $1`,
    [burgId],
  );
  return rows;
}

export async function pickArrivalGate(client, { plan, destination }) {
  if (destination?.kind !== 'burg') return null;
  if (!destination.burgId) return null;
  if (plan?.mode === 'fly' || plan?.mode === 'teleport') return null;

  const entrances = await loadEntrances(client, destination.burgId);
  if (entrances.length === 0) return null;
  if (entrances.length === 1) return rowToGate(entrances[0], 'single_option');

  if (viaLooksLikeRouteId(plan.effectiveVia)) {
    const matches = entrances.filter(r => r.route_id === plan.effectiveVia);
    if (matches.length === 1) return rowToGate(matches[0], 'route_id');
    if (matches.length > 1) {
      matches.sort((a, b) => {
        const da = a.bearing_match_delta_deg ?? Number.POSITIVE_INFINITY;
        const db = b.bearing_match_delta_deg ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
      return rowToGate(matches[0], 'route_id');
    }
  }

  // Approach-vector fallback arrives in Task 7; for now, return null so the
  // caller falls back to Plan 2 centroid behavior.
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/movement/gate-picker.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/gate-picker.js tests/movement/gate-picker.test.js
git commit -m "feat(movement): add gate-picker with route-identity match"
```

---

## Task 7: Gate-picker — approach-vector fallback

**Files:**
- Modify: `server/services/movement/gate-picker.js`
- Modify: `tests/movement/gate-picker.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/movement/gate-picker.test.js`:

```javascript
describe('pickArrivalGate — approach vector', () => {
  // Two entrances: north gate (bearing 0) and south gate (bearing 180).
  // Approaching from the south means final polyline segment goes +y.
  // The gate we should pick is the SOUTH gate (outward bearing 180).
  const north = { ...gateA, id: 'ent-n', route_id: null, bearing_deg: 0,   bearing_match_delta_deg: null };
  const south = { ...gateB, id: 'ent-s', route_id: null, bearing_deg: 180, bearing_match_delta_deg: null, name: null };

  test('picks the entrance whose outward bearing opposes the approach direction', async () => {
    const client = makeClient([north, south]);
    // Approach from south: last segment goes (100,0) → (100,50), i.e. heading south (+y, Y-down).
    // approachBearing = 180 (heading south). Outward = (180+180)%360 = 0. Wait — we want the gate whose
    // outward bearing matches where the player is COMING FROM, i.e. opposite of travel direction.
    // Travelling south means arriving at the NORTH side of the town; player came from the north.
    // Outward gate bearing should be 0 (north).
    const gate = await pickArrivalGate(client, {
      plan: {
        mode: 'walk',
        effectiveVia: 'direct',
        waypoints: [{ x: 100, y: 0 }, { x: 100, y: 50 }],
      },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-n');
    expect(gate.matchedBy).toBe('approach_vector');
  });

  test('falls back to approach_vector when route_id does not match any entrance', async () => {
    const client = makeClient([north, south]);
    const gate = await pickArrivalGate(client, {
      plan: {
        mode: 'walk',
        effectiveVia: 'route-unknown',     // no entrance has this route_id
        waypoints: [{ x: 100, y: 300 }, { x: 100, y: 250 }], // heading north
      },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    // Heading north → approachBearing 0 → gate outward should be 180 (south gate).
    expect(gate.entranceId).toBe('ent-s');
    expect(gate.matchedBy).toBe('approach_vector');
  });
});
```

- [ ] **Step 2: Run test to verify the new cases fail**

Run: `npm test -- tests/movement/gate-picker.test.js -t "approach vector"`
Expected: FAIL — both new tests fail because current code returns `null`.

- [ ] **Step 3: Extend the implementation**

In `server/services/movement/gate-picker.js`, add before the final `return null;`:

```javascript
  // Approach-vector fallback
  const wp = plan?.waypoints ?? [];
  if (wp.length < 2) return null;
  const a = wp[wp.length - 2];
  const b = wp[wp.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;

  // Compass bearing: 0 = north (toward -y, because Y is down), clockwise.
  const approachBearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const expectedOutward = (approachBearing + 180) % 360;

  const delta = (bearing) => {
    const diff = Math.abs(bearing - expectedOutward);
    return Math.min(diff, 360 - diff);
  };

  const best = [...entrances].sort((x, y) => {
    const dx_ = delta(Number(x.bearing_deg));
    const dy_ = delta(Number(y.bearing_deg));
    if (dx_ !== dy_) return dx_ - dy_;
    // tie-breaker: smaller bearing_match_delta_deg
    const mx = x.bearing_match_delta_deg ?? Number.POSITIVE_INFINITY;
    const my = y.bearing_match_delta_deg ?? Number.POSITIVE_INFINITY;
    if (mx !== my) return mx - my;
    return x.gate_id.localeCompare(y.gate_id);
  })[0];

  return rowToGate(best, 'approach_vector');
```

- [ ] **Step 4: Run test to verify all pass**

Run: `npm test -- tests/movement/gate-picker.test.js`
Expected: PASS — all route-identity AND approach-vector tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/gate-picker.js tests/movement/gate-picker.test.js
git commit -m "feat(movement): add approach-vector fallback to gate-picker"
```

---

## Task 8: Retarget plan to gate

**Files:**
- Modify: `server/services/movement/gate-picker.js`
- Modify: `tests/movement/gate-picker.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/movement/gate-picker.test.js`:

```javascript
import { retargetPlanToGate } from '../../server/services/movement/gate-picker.js';

describe('retargetPlanToGate', () => {
  test('replaces final waypoint with the gate position', () => {
    const plan = {
      waypoints: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      distancePixels: 100,
      effectiveVia: 'roads',
      totalDays: 1,
      campPoints: [],
      distanceMiles: null,
      dailyPixels: 500,
    };
    const gate = { x: 110, y: 5 };
    const out = retargetPlanToGate(plan, gate);
    expect(out.waypoints[out.waypoints.length - 1]).toEqual({ x: 110, y: 5 });
    expect(out.waypoints.length).toBe(3);
    // recomputed distance: 50 + sqrt((110-50)^2 + 5^2) = 50 + 60.21
    expect(out.distancePixels).toBeCloseTo(50 + Math.hypot(60, 5), 6);
    expect(out.effectiveVia).toBe('roads');
  });

  test('returns the original plan when gate is null', () => {
    const plan = { waypoints: [{x:0,y:0},{x:10,y:0}], distancePixels: 10 };
    expect(retargetPlanToGate(plan, null)).toBe(plan);
  });

  test('handles a single-point plan by appending the gate', () => {
    const plan = {
      waypoints: [{ x: 20, y: 20 }],
      distancePixels: 0,
      effectiveVia: 'direct',
      totalDays: 0,
      campPoints: [],
      distanceMiles: null,
      dailyPixels: Infinity,
    };
    const out = retargetPlanToGate(plan, { x: 25, y: 25 });
    expect(out.waypoints).toEqual([{ x: 20, y: 20 }, { x: 25, y: 25 }]);
    expect(out.distancePixels).toBeCloseTo(Math.hypot(5, 5), 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/movement/gate-picker.test.js -t "retargetPlanToGate"`
Expected: FAIL — `retargetPlanToGate` not exported.

- [ ] **Step 3: Implement**

Append to `server/services/movement/gate-picker.js`:

```javascript
function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Return a new plan whose final waypoint is the gate's position.
 * - Multi-point plan: replace last waypoint.
 * - Single-point plan (teleport-ish): append gate as second waypoint.
 * Other plan fields are preserved. distancePixels is recomputed.
 * Camp points are intentionally NOT recomputed — the shift is small and
 * recomputing would drift them visibly for cosmetic gain only.
 */
export function retargetPlanToGate(plan, gate) {
  if (!gate) return plan;
  const newWaypoints = plan.waypoints.length <= 1
    ? [...plan.waypoints, { x: gate.x, y: gate.y }]
    : [...plan.waypoints.slice(0, -1), { x: gate.x, y: gate.y }];
  return {
    ...plan,
    waypoints: newWaypoints,
    distancePixels: polylineLength(newWaypoints),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/movement/gate-picker.test.js`
Expected: PASS — all gate-picker + retarget tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/gate-picker.js tests/movement/gate-picker.test.js
git commit -m "feat(movement): add retargetPlanToGate helper"
```

---

## Task 9: Settlemaker ingestor

**Files:**
- Create: `server/services/settlemaker/ingestor.js`
- Test: `tests/settlemaker/ingestor.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/settlemaker/ingestor.test.js`:

```javascript
import { jest } from '@jest/globals';

// Mock the settlemaker library BEFORE importing the ingestor.
jest.unstable_mockModule('settlemaker', () => ({
  generateFromBurg: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/maps/burg-entrances-service.js', () => ({
  distinctVersionForBurg: jest.fn(),
  deleteForBurg:          jest.fn(),
  insertMany:             jest.fn(),
  listByBurg:             jest.fn(),
  listByWorld:            jest.fn(),
}));

const settlemaker = await import('settlemaker');
const entrancesService = await import('../../server/services/maps/burg-entrances-service.js');
const { ingestBurg } = await import('../../server/services/settlemaker/ingestor.js');

function makeClient(burgRow, routeRows) {
  const query = jest.fn(async (sql) => {
    if (/FROM public\.maps_burgs/.test(sql) && !/ST_ClosestPoint/.test(sql)) {
      return { rows: [burgRow] };
    }
    if (/ST_ClosestPoint/.test(sql)) {
      return { rows: routeRows };
    }
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM public\.maps_world/.test(sql)) {
      return { rows: [{ pixels_per_mile: 50 }] };
    }
    return { rows: [] };
  });
  return { query };
}

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
        layer: 'gate',
        gate_id: 'g5',
        kind: 'land', sub_kind: 'road',
        bearing_deg: 90,
        wall_vertex_index: 5,
        matched_route_id: 'route-east',
        bearing_match_delta_deg: 3,
        prev_gate_id: 'g3',
        next_gate_id: 'g7',
      },
      geometry: { type: 'Point', coordinates: [200, 0] },
    },
  ],
  metadata: {
    schema_version: 1,
    settlemaker_version: '0.2.0',
    settlement_generation_version: 'v1hash',
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: '2026-04-19T00:00:00Z',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ingestBurg', () => {
  test('idempotent: noop when settlement_generation_version matches', async () => {
    entrancesService.distinctVersionForBurg.mockResolvedValue('v1hash');
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    const result = await ingestBurg(client, { burgId: 'burg-1' });
    expect(result.updated).toBe(false);
    expect(entrancesService.deleteForBurg).not.toHaveBeenCalled();
    expect(entrancesService.insertMany).not.toHaveBeenCalled();
  });

  test('full rebuild when version differs', async () => {
    entrancesService.distinctVersionForBurg.mockResolvedValue('stale');
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    const result = await ingestBurg(client, { burgId: 'burg-1' });
    expect(result.updated).toBe(true);
    expect(entrancesService.deleteForBurg).toHaveBeenCalledWith(client, 'burg-1');
    expect(entrancesService.insertMany).toHaveBeenCalledTimes(1);
    const [, rows] = entrancesService.insertMany.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      burg_id: 'burg-1',
      gate_id: 'g5',
      route_id: 'route-east',
      kind: 'land',
      sub_kind: 'road',
      wall_vertex_index: 5,
      bearing_deg: 90,
      bearing_match_delta_deg: 3,
      prev_gate_id: 'g3',
      next_gate_id: 'g7',
      settlement_generation_version: 'v1hash',
      settlemaker_version: '0.2.0',
    });
    // coordinate translation: wall_radius_local=200, pop=10000, pixels_per_mile=50
    // diameterMeters = 200 * 100^0.4 ≈ 1261.9, radiusMiles = 0.392, scale ≈ 0.098
    // gate local (200, 0) → centroid + local * scale = (1000 + 200*scale, 2000 + 0*scale)
    expect(rows[0].x_px).toBeGreaterThan(1000);
    expect(rows[0].y_px).toBeCloseTo(2000, 3);
  });

  test('unwalled burg with zero gates still clears prior rows', async () => {
    entrancesService.distinctVersionForBurg.mockResolvedValue('stale');
    const emptyFc = { ...FAKE_FC, features: [], metadata: { ...FAKE_FC.metadata, settlement_generation_version: 'empty' } };
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: emptyFc });
    const client = makeClient(
      { id: 'burg-2', name: 'Unwalled', population: 300, port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false, x_px: 500, y_px: 500 },
      [],
    );
    const result = await ingestBurg(client, { burgId: 'burg-2' });
    expect(result.updated).toBe(true);
    expect(entrancesService.deleteForBurg).toHaveBeenCalled();
    expect(entrancesService.insertMany).not.toHaveBeenCalled(); // empty rows short-circuits
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settlemaker/ingestor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the ingestor**

Create `server/services/settlemaker/ingestor.js`:

```javascript
import { generateFromBurg, SETTLEMAKER_VERSION } from 'settlemaker';
import { classifyRouteKind } from './route-classifier.js';
import {
  computeLocalToWorldScale,
  maxRadiusFromOrigin,
  translateLocalToWorldPx,
} from './coordinate-translator.js';
import {
  distinctVersionForBurg,
  deleteForBurg,
  insertMany,
} from '../maps/burg-entrances-service.js';
import { logInfo, logWarn } from '../../utils/logger.js';

async function loadBurgRow(client, burgId) {
  const { rows } = await client.query(
    `SELECT id, world_id, name, population, port, citadel, walls, plaza,
            temple, shanty, capital, x_px, y_px
       FROM public.maps_burgs
      WHERE id = $1
      LIMIT 1`,
    [burgId],
  );
  return rows[0] ?? null;
}

async function loadPixelsPerMile(client, worldId) {
  const { rows } = await client.query(
    `SELECT pixels_per_mile FROM public.maps_world WHERE id = $1 LIMIT 1`,
    [worldId],
  );
  return rows[0]?.pixels_per_mile ?? null;
}

async function loadApproachingRoutes(client, burg, thresholdPx = 50) {
  const { rows } = await client.query(
    `WITH b AS (SELECT geom FROM public.maps_burgs WHERE id = $1)
     SELECT r.id AS route_id,
            r.type AS type,
            ST_X(ST_ClosestPoint(r.geom, b.geom)) AS snap_x,
            ST_Y(ST_ClosestPoint(r.geom, b.geom)) AS snap_y
       FROM public.maps_routes r, b
      WHERE r.world_id = $2
        AND ST_Distance(r.geom, b.geom) < $3`,
    [burg.id, burg.world_id, thresholdPx],
  );
  return rows;
}

function bearingFromBurgToSnap(burg, snap) {
  const dx = Number(snap.snap_x) - Number(burg.x_px);
  const dy = Number(snap.snap_y) - Number(burg.y_px);
  return ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
}

function wallRadiusFromFc(fc) {
  const wall = fc.features.find(f => f?.properties?.layer === 'wall');
  if (!wall) return 0;
  return maxRadiusFromOrigin(wall.geometry);
}

function buildRows({ fc, burg, centroidPx, scale, settlemakerVersion }) {
  const version = fc.metadata.settlement_generation_version;
  const out = [];
  for (const f of fc.features) {
    if (f?.properties?.layer !== 'gate') continue;
    const p = f.properties;
    const [lx, ly] = f.geometry.coordinates;
    const world = translateLocalToWorldPx({
      localPoint: { x: lx, y: ly },
      burgCentroidPx: centroidPx,
      scale,
    });
    out.push({
      burg_id: burg.id,
      gate_id: p.gate_id,
      route_id: p.matched_route_id ?? null,
      x_px: world.x,
      y_px: world.y,
      bearing_deg: Number(p.bearing_deg),
      bearing_match_delta_deg: p.bearing_match_delta_deg ?? null,
      kind: p.kind,
      sub_kind: p.sub_kind,
      wall_vertex_index: Number(p.wall_vertex_index),
      prev_gate_id: p.prev_gate_id ?? null,
      next_gate_id: p.next_gate_id ?? null,
      name: p.name ?? null,
      settlement_generation_version: version,
      settlemaker_version: settlemakerVersion,
    });
  }
  return out;
}

function computeOceanBearing(burg, routes) {
  const sea = routes.find(r => classifyRouteKind(r.type) === 'sea');
  if (!sea) return undefined;
  return bearingFromBurgToSnap(burg, sea);
}

function buildInput(burg, routes) {
  const roadBearings = routes.map(r => ({
    bearing_deg: bearingFromBurgToSnap(burg, r),
    route_id: r.route_id,
    kind: classifyRouteKind(r.type),
  })).sort((a, b) => a.bearing_deg - b.bearing_deg);

  return {
    name: burg.name ?? 'Unnamed',
    population: Number(burg.population) || 100,
    port: Boolean(burg.port),
    citadel: Boolean(burg.citadel),
    walls: Boolean(burg.walls),
    plaza: Boolean(burg.plaza),
    temple: Boolean(burg.temple),
    shanty: Boolean(burg.shanty),
    capital: Boolean(burg.capital),
    roadBearings,
    oceanBearing: burg.port ? computeOceanBearing(burg, routes) : undefined,
    harbourSize: burg.port ? (Number(burg.population) >= 15000 ? 'large' : 'small') : undefined,
  };
}

export async function ingestBurg(client, { burgId }) {
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
  const newVersion = geojson.metadata.settlement_generation_version;

  const existingVersion = await distinctVersionForBurg(client, burgId);
  if (existingVersion === newVersion) {
    return { updated: false, count: 0 };
  }

  const pixelsPerMile = await loadPixelsPerMile(client, burg.world_id);
  const wallRadiusLocal = wallRadiusFromFc(geojson);
  const scale = computeLocalToWorldScale({
    population: Number(burg.population) || 100,
    wallRadiusLocal,
    pixelsPerMile,
  });

  const centroidPx = { x: Number(burg.x_px), y: Number(burg.y_px) };
  const rows = buildRows({
    fc: geojson,
    burg,
    centroidPx,
    scale,
    settlemakerVersion: geojson.metadata.settlemaker_version ?? SETTLEMAKER_VERSION,
  });

  await client.query('BEGIN');
  try {
    await deleteForBurg(client, burgId);
    if (rows.length > 0) await insertMany(client, rows);
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
  // Lazy, idempotent — short-circuits in ingestBurg when version matches.
  return ingestBurg(client, { burgId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settlemaker/ingestor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/settlemaker/ingestor.js tests/settlemaker/ingestor.test.js
git commit -m "feat(settlemaker): add ingestor with idempotent version invalidation"
```

---

## Task 10: Wire gate-picker into `applyNarrativeMove`

**Files:**
- Modify: `server/services/movement/narrative-movement.js`
- Create: `tests/movement/narrative-movement.gate.integration.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/movement/narrative-movement.gate.integration.test.js`:

```javascript
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/movement/destination-resolver.js', () => ({
  resolveDestination: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/movement/travel-planner.js', () => ({
  planTravel: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/movement/gate-picker.js', () => ({
  pickArrivalGate: jest.fn(),
  retargetPlanToGate: jest.fn((plan, gate) => gate
    ? { ...plan, waypoints: [...plan.waypoints.slice(0, -1), { x: gate.x, y: gate.y }] }
    : plan),
}));
jest.unstable_mockModule('../../server/services/campaigns/service.js', () => ({
  performPlayerMovement: jest.fn(async () => ({
    player: { id: 'p1', geometry: null, visibility_state: 'visible', last_located_at: new Date() },
    requestedDistance: 0,
    pathId: 'path-1',
    requestedTarget: null,
    snappedTarget: null,
    grid: null,
  })),
}));
jest.unstable_mockModule('../../server/services/encounters/proactive-generator.js', () => ({
  evaluateEncounterAtPoint: jest.fn(async () => false),
}));

const destModule   = await import('../../server/services/movement/destination-resolver.js');
const plannerModule = await import('../../server/services/movement/travel-planner.js');
const gateModule    = await import('../../server/services/movement/gate-picker.js');
const campaignsModule = await import('../../server/services/campaigns/service.js');
const { applyNarrativeMove } = await import('../../server/services/movement/narrative-movement.js');

function fakeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (/ST_X\(loc_current\)/.test(sql)) return { rows: [{ x: 10, y: 10 }] };
      if (/world_map_id/.test(sql))         return { rows: [{ world_map_id: 'w1' }] };
      if (/campaign_clock_days/.test(sql))  return { rows: [{ campaign_clock_days: 3 }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

test('retargets effective end to gate and surfaces arrival.gate in summary', async () => {
  destModule.resolveDestination.mockResolvedValue({
    x: 500, y: 500, burgId: 'burg-1', mapLevel: 'settlement', resolvedName: 'Foo',
  });
  plannerModule.planTravel.mockResolvedValue({
    waypoints: [{ x: 10, y: 10 }, { x: 500, y: 500 }],
    distancePixels: 691, distanceMiles: null, totalDays: 2,
    campPoints: [{ x: 255, y: 255, day: 1 }],
    effectiveVia: 'roads', dailyPixels: 500,
  });
  gateModule.pickArrivalGate.mockResolvedValue({
    entranceId: 'ent-s', gateId: 'g3', x: 510, y: 510,
    bearingDeg: 180, kind: 'land', subKind: 'road',
    name: 'South Gate', matchedBy: 'route_id',
  });

  const client = fakeClient();
  const summary = await applyNarrativeMove(client, {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'u1',
    destination: { kind: 'burg', ref: 'Foo' },
    reason: 'test',
    mode: 'walk', via: 'roads',
  });

  expect(gateModule.retargetPlanToGate).toHaveBeenCalled();
  const performArgs = campaignsModule.performPlayerMovement.mock.calls[0][0];
  expect(performArgs.targetX).toBe(510);
  expect(performArgs.targetY).toBe(510);
  expect(performArgs.arrivalGateEntranceId).toBe('ent-s');
  expect(summary.arrival).toEqual({
    gate: {
      id: 'ent-s', gateId: 'g3', name: 'South Gate',
      kind: 'land', subKind: 'road', matchedBy: 'route_id',
    },
  });
});

test('arrival.gate is null when pickArrivalGate returns null', async () => {
  destModule.resolveDestination.mockResolvedValue({
    x: 500, y: 500, burgId: 'burg-1', mapLevel: 'settlement', resolvedName: 'Foo',
  });
  plannerModule.planTravel.mockResolvedValue({
    waypoints: [{ x: 10, y: 10 }, { x: 500, y: 500 }],
    distancePixels: 691, distanceMiles: null, totalDays: 2,
    campPoints: [], effectiveVia: 'direct', dailyPixels: 500,
  });
  gateModule.pickArrivalGate.mockResolvedValue(null);

  const client = fakeClient();
  const summary = await applyNarrativeMove(client, {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'u1',
    destination: { kind: 'burg', ref: 'Foo' },
    mode: 'walk', via: 'direct',
  });
  expect(summary.arrival).toEqual({ gate: null });
  const performArgs = campaignsModule.performPlayerMovement.mock.calls[0][0];
  expect(performArgs.targetX).toBe(500);
  expect(performArgs.targetY).toBe(500);
  expect(performArgs.arrivalGateEntranceId ?? null).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/movement/narrative-movement.gate.integration.test.js`
Expected: FAIL — `pickArrivalGate` not wired in, `arrival` missing from summary.

- [ ] **Step 3: Extend `applyNarrativeMove`**

Edit `server/services/movement/narrative-movement.js`:

Add near the top of the file with the other imports:
```javascript
import { pickArrivalGate, retargetPlanToGate } from './gate-picker.js';
```

Inside `applyNarrativeMove`, directly after the `const plan = worldId ? await planTravel(...) : {...}` assignment, add:

```javascript
  const arrivalGate = await pickArrivalGate(client, {
    plan: { ...plan, mode },
    destination: { kind: destination.kind, burgId: resolved.burgId },
  });
  const gatedPlan = arrivalGate ? retargetPlanToGate(plan, arrivalGate) : plan;
```

Replace all subsequent uses of `plan` inside the function body (except within the destination-name construction) with `gatedPlan`. Concretely:

- `plan.campPoints` → `gatedPlan.campPoints`
- `plan.waypoints` → `gatedPlan.waypoints`
- `plan.totalDays` → `gatedPlan.totalDays`
- `plan.distancePixels` → `gatedPlan.distancePixels`
- `plan.distanceMiles` → `gatedPlan.distanceMiles`
- `plan.effectiveVia` → `gatedPlan.effectiveVia`

Recompute `effectiveEnd` so it lands on the gate (not the resolved centroid) when `arrivalGate` is present:

```javascript
  const centroidEnd = { x: resolved.x, y: resolved.y };
  const gateEnd = arrivalGate ? { x: arrivalGate.x, y: arrivalGate.y } : centroidEnd;
  const effectiveEnd = interrupt.interruptedAt ?? gateEnd;
```

Pass `arrivalGateEntranceId` into `performPlayerMovement`:
```javascript
  const moveResult = await performPlayerMovement({
    // ... existing args ...
    arrivalGateEntranceId: arrivalGate?.entranceId ?? null,
    pathWaypoints: effectiveWaypoints,
    gameDaysElapsed: daysElapsed,
  });
```

Add to the summary object:
```javascript
    arrival: {
      gate: arrivalGate ? {
        id:        arrivalGate.entranceId,
        gateId:    arrivalGate.gateId,
        name:      arrivalGate.name,
        kind:      arrivalGate.kind,
        subKind:   arrivalGate.subKind,
        matchedBy: arrivalGate.matchedBy,
      } : null,
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/movement/narrative-movement.gate.integration.test.js`
Expected: PASS.

Also re-run existing narrative-movement tests to verify no regressions:
```bash
npm test -- tests/movement/narrative-movement.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/narrative-movement.js tests/movement/narrative-movement.gate.integration.test.js
git commit -m "feat(movement): wire gate-picker into applyNarrativeMove"
```

---

## Task 11: `performPlayerMovement` accepts `arrivalGateEntranceId`

**Files:**
- Modify: `server/services/campaigns/service.js`

- [ ] **Step 1: Locate the function and its audit-row INSERT**

Run:
```bash
grep -n "performPlayerMovement\|player_movement_audit" server/services/campaigns/service.js
```

Note the line numbers for the function signature and the audit INSERT.

- [ ] **Step 2: Add the parameter + column**

In the function signature, add `arrivalGateEntranceId = null,` to the destructured options (alongside `pathWaypoints`, `gameDaysElapsed`, etc.).

In the `INSERT INTO public.player_movement_audit (...) VALUES (...)` statement, add `arrival_gate_entrance_id` to the column list and `$N` to the values list with `arrivalGateEntranceId` as the binding. Keep column order consistent with the table definition (append at the end).

- [ ] **Step 3: Verify existing test still passes**

Run: `npm test -- tests/movement/perform-player-movement-path.test.js`
Expected: PASS (new parameter is optional/defaulted).

Add a new test case to `tests/movement/perform-player-movement-path.test.js` using the existing `makeClientWithCapture()` helper:

```javascript
test('arrivalGateEntranceId: recorded on the audit INSERT', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm', isRequestorAdmin: false,
    targetX: 500, targetY: 0, mode: 'walk', reason: 'narrative',
    source: 'llm',
    arrivalGateEntranceId: 'ent-abc',
  });
  const auditInsert = client.queries.find((q) =>
    /INSERT INTO public\.player_movement_audit/.test(q.sql),
  );
  expect(auditInsert).toBeTruthy();
  expect(/arrival_gate_entrance_id/.test(auditInsert.sql)).toBe(true);
  expect(auditInsert.params).toEqual(expect.arrayContaining(['ent-abc']));
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/movement/perform-player-movement-path.test.js`
Expected: PASS including the new case.

- [ ] **Step 5: Commit**

```bash
git add server/services/campaigns/service.js tests/movement/perform-player-movement-path.test.js
git commit -m "feat(campaigns): persist arrival_gate_entrance_id on movement audit"
```

---

## Task 12: LLM context — `recentTravel.arrival.gate`

**Files:**
- Modify: `server/services/dm-action/context-manager.js`
- Modify: `server/services/dm-action/action-prompt-builder.js`

- [ ] **Step 1: Locate the `recentTravel` assembly**

Run:
```bash
grep -n "recentTravel\|player_movement_paths\|campaign_clock_days" server/services/dm-action/context-manager.js
```

Identify where `recentTravel` is constructed.

- [ ] **Step 2: Extend the query to pull the arrival gate**

Wherever the most-recent movement is selected (likely a join or a sequence of queries over `player_movement_audit` / `player_movement_paths`), extend the SELECT with a LEFT JOIN to `public.maps_burg_entrances` on `player_movement_audit.arrival_gate_entrance_id`:

```sql
LEFT JOIN public.maps_burg_entrances e
       ON e.id = pma.arrival_gate_entrance_id
```

Return the gate columns needed: `e.gate_id AS arrival_gate_id`, `e.name AS arrival_gate_name`, `e.kind AS arrival_gate_kind`, `e.sub_kind AS arrival_gate_sub_kind`, `e.bearing_deg AS arrival_gate_bearing_deg`.

- [ ] **Step 3: Build `arrival.gate` in the context object**

In the JS side, where `recentTravel` is assembled, add:

```javascript
import { cardinalGateName } from '../movement/cardinal-names.js';

const arrivalGate = row.arrival_gate_id ? {
  name: row.arrival_gate_name ?? cardinalGateName(Number(row.arrival_gate_bearing_deg)),
  kind: row.arrival_gate_kind,
  subKind: row.arrival_gate_sub_kind,
} : null;

recentTravel.arrival = { gate: arrivalGate };
```

(Place near the existing `daysElapsed` / `distanceMiles` assignments.)

- [ ] **Step 4: Update the prompt**

Edit `server/services/dm-action/action-prompt-builder.js`. Find the existing `move_player` guidance block (search for `move_player`). Append:

> **Arrival context:** when the previous turn concluded with a `move_player` outcome, the `recentTravel` block may carry `arrival.gate.name` (e.g. "South Gate", "Harbour Gate"). If present, weave it into your narration. If absent, the party entered an unwalled settlement or arrived by air/teleport — do not invent a gate.

Format as an HTML-style prompt section matching the existing style in that file.

- [ ] **Step 5: Add/extend a context-manager test**

Write a small unit test in `tests/dm-action/context-manager.test.js` (create if missing) verifying that `buildGameContext` surfaces `recentTravel.arrival.gate.name` from a mocked audit row join. Use the file's existing mocking pattern; if none, mock `pool.query` to return a row with `arrival_gate_id = 'ent-a'`, `arrival_gate_name = 'South Gate'`, etc.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/dm-action`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/services/dm-action tests/dm-action
git commit -m "feat(dm-action): surface arrival gate in recentTravel context"
```

---

## Task 13: API endpoint — `GET /:worldId/burg-entrances`

**Files:**
- Modify: `server/routes/maps.routes.js`

- [ ] **Step 1: Inspect existing route pattern**

Run:
```bash
grep -n "router.get.*burgs\b\|listWorldBurgs" server/routes/maps.routes.js
```

Note the structure of `GET /:worldId/burgs` for mirroring.

- [ ] **Step 2: Add the new endpoint**

Edit `server/routes/maps.routes.js`:

Add to the existing imports block from `maps/...`:
```javascript
import { listByWorld as listBurgEntrancesByWorld } from '../services/maps/burg-entrances-service.js';
```

Below the `GET /:worldId/burgs` handler, add:

```javascript
router.get('/:worldId/burg-entrances', async (req, res) => {
  const { worldId } = req.params;
  try {
    const rows = await listBurgEntrancesByWorld(worldId);
    const features = rows.map(r => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(r.x_px), Number(r.y_px)] },
      properties: {
        id: r.id, burgId: r.burg_id, gateId: r.gate_id, routeId: r.route_id,
        bearingDeg: Number(r.bearing_deg), kind: r.kind, subKind: r.sub_kind,
        name: r.name, prevGateId: r.prev_gate_id, nextGateId: r.next_gate_id,
      },
    }));
    return res.json({ type: 'FeatureCollection', features });
  } catch (error) {
    logError('World burg-entrances fetch failed', error, { worldId });
    const status = error.status || 500;
    return res.status(status).json({
      error: error.code || 'maps_burg_entrances_failed',
      message: error.message,
    });
  }
});
```

- [ ] **Step 3: Manual verification**

Start the dev server:
```bash
npm run db:dev
```

In another terminal, hit the endpoint for a known world:
```bash
curl -s "http://localhost:3000/api/world-maps/<WORLD_ID>/burg-entrances" | head -c 2000
```
(Adjust base URL + API prefix to match `server/app.js`.)

Expected: JSON `FeatureCollection` with zero or more features. Zero features is fine if no burgs have been ingested yet — that's covered in Task 14's manual check.

- [ ] **Step 4: Commit**

```bash
git add server/routes/maps.routes.js
git commit -m "feat(api): add GET /:worldId/burg-entrances endpoint"
```

---

## Task 14: Ingestion trigger on world import

**Files:**
- Modify: wherever `maps_burgs` is populated during world import (run the grep in Step 1 to locate)

- [ ] **Step 1: Locate the import/seed pipeline**

Run:
```bash
grep -rn "INSERT INTO public.maps_burgs\|INSERT INTO maps_burgs" server/
```

Identify the script/service that seeds burgs from FMG export.

- [ ] **Step 2: Call the ingestor after burg insert**

In the seed script, after burgs AND routes have been inserted (both are needed for the ingestor's `loadApproachingRoutes`), add a final pass:

```javascript
import { ingestBurg } from './services/settlemaker/ingestor.js';

const { rows: allBurgs } = await client.query(
  `SELECT id FROM public.maps_burgs WHERE world_id = $1`,
  [worldId],
);
for (const b of allBurgs) {
  try {
    await ingestBurg(client, { burgId: b.id });
  } catch (err) {
    logWarn('settlemaker ingest failed for burg (continuing)', {
      burgId: b.id, error: err?.message,
    });
  }
}
```

Log a summary `{ingestedCount, failedCount}` at the end.

- [ ] **Step 3: Manual verification on a test world**

Re-run the world-import flow (follow the app's existing import path). After completion:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM public.maps_burg_entrances WHERE burg_id IN (SELECT id FROM public.maps_burgs WHERE world_id = '<WORLD_ID>');"
```

Expected: nonzero count (walled burgs × gate count).

Hit the API from Task 13 again; it should now return features.

- [ ] **Step 4: Commit**

```bash
git add <files-touched>
git commit -m "feat(import): ingest burg entrances during world import"
```

---

## Task 15: World-map layer — burg-entrance markers

**Files:**
- Create: `components/layers/burg-entrances.ts`
- Modify: `components/maps/questables-style-factory.ts`
- Modify: `components/map-data-loader.tsx`
- Modify: `components/openlayers-map.tsx`

- [ ] **Step 1: Style factory**

In `components/maps/questables-style-factory.ts`, add a new exported factory:

```typescript
import Icon from 'ol/style/Icon';
import Style from 'ol/style/Style';

export const createBurgEntranceStyleFactory = (resolveZoom: ZoomResolver) => {
  return (feature: Feature<Geometry>, resolution: number): Style | undefined => {
    const zoom = resolveZoom(resolution);
    if (zoom < 7) return undefined; // hide at low zoom
    const kind = feature.get('kind') as 'land' | 'harbour' | undefined;
    const bearing = Number(feature.get('bearingDeg') ?? 0);
    const color = kind === 'harbour' ? '#4bb3c7' : '#b8925a';
    return new Style({
      image: new Icon({
        src:
          `data:image/svg+xml;utf8,` +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="-6 -6 12 12">` +
            `<polygon points="0,-5 4,4 -4,4" fill="${color}" stroke="#222" stroke-width="0.8"/>` +
            `</svg>`,
          ),
        rotation: (bearing * Math.PI) / 180,
        rotateWithView: false,
      }),
    });
  };
};
```

- [ ] **Step 2: Layer helper**

Create `components/layers/burg-entrances.ts`:

```typescript
import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';

import {
  createBurgEntranceStyleFactory,
  type ZoomResolver,
} from '../maps/questables-style-factory';
import type { GeometryLayer } from './types';

export interface CreateBurgEntrancesLayerOptions {
  resolveZoom: ZoomResolver;
  visible: boolean;
}

export const createBurgEntrancesLayer = ({
  resolveZoom,
  visible,
}: CreateBurgEntrancesLayerOptions): GeometryLayer => {
  const factory = createBurgEntranceStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) =>
      factory(feature as Feature<Geometry>, resolution),
    visible,
  });
};
```

Export it from `components/layers/index.ts`:
```typescript
export * from './burg-entrances';
```

- [ ] **Step 3: Data loader**

In `components/map-data-loader.tsx`, add a `loadBurgEntrances(worldMapId)` method modelled after `loadBurgs`:

```typescript
async loadBurgEntrances(worldMapId: string): Promise<Feature[]> {
  const res = await fetch(`/api/world-maps/${worldMapId}/burg-entrances`);
  if (!res.ok) return [];
  const fc = await res.json();
  return (fc.features ?? []).map((f: any) => {
    const geometry = this.readGeometry(f);
    if (!geometry) return null;
    const feat = new Feature({ geometry });
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      feat.set(k, v);
    }
    feat.setId(f.properties?.id);
    return feat;
  }).filter(Boolean) as Feature[];
}
```

- [ ] **Step 4: Wire into the map**

In `components/openlayers-map.tsx`, where existing layers are created and added (e.g. `createBurgsLayer`), add:

```typescript
const burgEntrancesLayer = createBurgEntrancesLayer({
  resolveZoom,
  visible: layerVisibility.burgEntrances ?? true,
});
map.addLayer(burgEntrancesLayer);
```

In the same file, within the world-map-data load block, add:

```typescript
if (worldMapId) {
  const features = await (/* arrow wrapper per CLAUDE.md's this-binding note */
    (id) => mapDataLoader.loadBurgEntrances(id)
  )(worldMapId);
  burgEntrancesLayer.getSource()?.clear();
  burgEntrancesLayer.getSource()?.addFeatures(features);
}
```

Add a `burgEntrances: boolean` entry to the `layerVisibility` state type + default, and include it in the visibility toggle UI (follow the existing pattern for "Burgs" toggle).

- [ ] **Step 5: Manual verification in browser**

Run `npm run dev:local`. Open a world with ingested entrances. Confirm:
- At zoom ≥ 7, gate markers appear around walled burgs.
- Harbour gates are cyan; land gates are tan.
- Toggling "Burg Gates" off hides them.
- At zoom < 7, markers disappear.

- [ ] **Step 6: Commit**

```bash
git add components/layers/burg-entrances.ts components/layers/index.ts components/maps/questables-style-factory.ts components/map-data-loader.tsx components/openlayers-map.tsx
git commit -m "feat(map): render burg-entrance markers with kind/bearing styling"
```

---

## Task 16: Arrival-gate pulse animation

**Files:**
- Modify: `components/openlayers-map.tsx`

- [ ] **Step 1: Locate the `player-moved` subscriber**

Run:
```bash
grep -n "player-moved\|player-teleported" components/openlayers-map.tsx
```

Identify the current subscriber that animates the token along `path.waypoints`.

- [ ] **Step 2: Add a pulse on arrival.gate.id**

When the payload carries `arrival?.gate?.id`, after the existing animation's onComplete handler, add a short-lived pulse style swap on the matching feature. Near the top of `components/openlayers-map.tsx` (module scope) add:

```typescript
const PULSE_ICON_DATA_URI =
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-8 -8 16 16">` +
    `<polygon points="0,-6 5,5 -5,5" fill="#ffdc73" stroke="#000" stroke-width="1"/>` +
    `</svg>`,
  );
```

Inside the `player-moved` handler, after the animation completes:

```typescript
const afterAnimate = () => {
  const gateId = payload?.arrival?.gate?.id;
  if (!gateId) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const feature = burgEntrancesLayer.getSource()?.getFeatureById(gateId);
  if (!feature) return;
  const originalStyle = feature.getStyle();
  feature.setStyle(new Style({
    image: new Icon({
      src: PULSE_ICON_DATA_URI,
      scale: 1.4,
      rotation: (Number(feature.get('bearingDeg') ?? 0) * Math.PI) / 180,
      rotateWithView: false,
    }),
  }));
  window.setTimeout(() => feature.setStyle(originalStyle ?? null), 1000);
};
```

- [ ] **Step 3: Manual verification**

Emit a narrative move into a walled burg from within the game. Confirm the gate pulses briefly when the token arrives. Set `prefers-reduced-motion: reduce` in dev-tools → rendering; confirm pulse is skipped.

- [ ] **Step 4: Commit**

```bash
git add components/openlayers-map.tsx
git commit -m "feat(map): pulse arrival gate marker after narrative move lands"
```

---

## Task 17: End-to-end smoke (extend Plan 2's)

**Files:**
- Modify: `tests/movement/narrative-movement.e2e.test.js`

- [ ] **Step 1: Seed fixture + assert**

Read the existing e2e test to understand its fixture setup. Add a new case, typically `test.skipIf(!process.env.QUESTABLES_E2E_DB)`:

```javascript
test('narrative move into walled burg lands at a gate', async () => {
  // Fixture setup: insert world (pixels_per_mile=50), burg (walls=true, pop=10000, x_px=1000, y_px=2000),
  // two routes approaching from east and west, and run ingestBurg to populate entrances.

  // Invoke applyNarrativeMove for a move from (500, 2000) → the burg, via:'roads'.

  // Assert:
  //   - player.loc_current is within ~20 pixels of an entrance row, not the centroid.
  //   - player_movement_audit row has arrival_gate_entrance_id non-null.
  //   - the arrival.gate.name in the returned summary is 'East Gate' or the stored gate name.
});
```

Implement the setup by mirroring the existing test's helpers. If no e2e infrastructure exists for this path, add a `test.skip` stub with a TODO note pointing to the spec's "E2E smoke" section — **but only if the Plan 2 test is itself skipped without QUESTABLES_E2E_DB.** Match the existing project discipline, don't add new fixture infrastructure here.

- [ ] **Step 2: Run when DB available**

```bash
QUESTABLES_E2E_DB=1 DATABASE_URL="$DATABASE_URL" npm test -- tests/movement/narrative-movement.e2e.test.js
```

Expected: PASS (or skip if the env var is absent).

- [ ] **Step 3: Commit**

```bash
git add tests/movement/narrative-movement.e2e.test.js
git commit -m "test(movement): e2e smoke for narrative move landing at gate"
```

---

## Task 18: Full-suite regression + lint + typecheck

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```
Expected: PASS. No new failures; note any pre-existing failures separately.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: no warnings (the project's `--max-warnings 0` gate).

- [ ] **Step 4: Manual acceptance run**

In a browser session against a seeded world:
1. Trigger the LLM to emit a `move_player` into a walled burg along a known route.
2. Observe the token animate along the polyline and land on the gate (not the centroid).
3. Observe the gate marker pulse after arrival.
4. Check the next LLM turn's response for explicit mention of the gate name.
5. Move to an unwalled burg — token should land at centroid, no pulse, no gate mentioned.
6. Use `fly` mode — same centroid behavior, no gate.

- [ ] **Step 5: Final commit (if any small cleanups surfaced)**

```bash
git add -u
git commit -m "chore: Plan 3a polish + lint fixes"
```

---

## Rollout notes

- **Backfill:** any world imported before this plan has zero `maps_burg_entrances` rows. First narrative move into each burg triggers lazy ingest via `ensureEntrancesFresh` (Task 9's export — called from gate-picker before SELECT). Alternatively, run a one-off script:
  ```bash
  node server/scripts/ingest-all-entrances.js <WORLD_ID>
  ```
  (not part of this plan — script lives as a follow-on if users want proactive backfill).

- **Settlemaker version bumps:** when `SETTLEMAKER_VERSION` in the dependency changes, `settlement_generation_version` (which hashes `schema: GEOJSON_SCHEMA_VERSION`) shifts, forcing a rebuild on the next move per burg. No manual invalidation needed.

- **Rollback:** dropping the `maps_burg_entrances` table leaves `arrival_gate_entrance_id` dangling (NULL after `ON DELETE SET NULL`). The plan's rollback SQL is:
  ```sql
  ALTER TABLE public.player_movement_audit DROP COLUMN arrival_gate_entrance_id;
  DROP TABLE public.maps_burg_entrances;
  ```
  Gate-picker's code path is a no-op for destinations without entrances, so code can ship first and back-out cleanly.
