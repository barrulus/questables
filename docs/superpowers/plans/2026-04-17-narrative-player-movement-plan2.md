# Narrative Player Movement — Plan 2 (Route-Snapping + Travel-Time) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the LLM DM narrates travel, the server computes a road-snapped polyline, rolls for proactive encounters at each day's camp, advances the campaign day counter, and the frontend animates the player token along the route.

**Architecture:** A pure `travel-planner` module computes a `TravelPlan` (waypoints + camp points + days). An extended `applyNarrativeMove` walks camp points for encounters, truncates at interrupts, and commits the move + clock advance in one transaction. `performPlayerMovement` grows optional `pathWaypoints` and `gameDaysElapsed` parameters. The frontend animates along `path.waypoints` via `requestAnimationFrame`.

**Tech Stack:** Node/Express (ESM), PostgreSQL + PostGIS (`ST_ClosestPoint`, `ST_LineLocatePoint`, `ST_LineSubstring`), Jest (ESM, `node --experimental-vm-modules`), React + OpenLayers + `requestAnimationFrame`.

**Depends on:** Plan 1 MVP (merged at `492549f`).
**Spec:** `docs/superpowers/specs/2026-04-17-narrative-player-movement-plan2-design.md`

---

## File Structure

**New files:**
- `database/migrations/007_plan2_travel.sql` — adds `maps_world.pixels_per_mile` + `campaigns.campaign_clock_days`.
- `server/services/movement/travel-config.js` — speed tables, snap threshold, animation duration. Env-var-overridable.
- `server/services/movement/travel-planner.js` — pure `planTravel()` function.
- `components/player-token-animator.ts` — RAF-based token animator. One exported class `TokenAnimator`.
- `tests/movement/travel-planner.test.js`
- `tests/movement/perform-player-movement-path.test.js`
- `tests/movement/proactive-generator-at-point.test.js`

**Modified files:**
- `database/schema.sql` — mirror the migration for fresh installs.
- `server/services/campaigns/service.js` — add `pathWaypoints` + `gameDaysElapsed` to `performPlayerMovement`.
- `server/services/encounters/proactive-generator.js` — new `evaluateEncounterAtPoint` export.
- `server/services/movement/narrative-movement.js` — grow `applyNarrativeMove` to plan + walk camps + commit.
- `server/llm/schemas/dm-response-schema.js` — add `via` + `mode` to `mechanicalOutcome`.
- `server/llm/context/action-prompt-builder.js` — add setting-out rule + via/mode docs + multi-day hint.
- `server/llm/context/context-manager.js` — add `campaign.clockDay` + `recentTravel`.
- `components/openlayers-map.tsx` — wire `path.waypoints` payload through the animator; add interrupt badge.
- `tests/movement/narrative-movement.test.js` — extend for travel-plan + clock + interrupt cases.
- `tests/movement/narrative-movement.e2e.test.js` — extend the Plan 1 smoke to assert polyline + clock.

---

## Task 1: Database migration + schema.sql update

**Files:**
- Create: `database/migrations/007_plan2_travel.sql`
- Modify: `database/schema.sql`

- [ ] **Step 1: Write the migration**

Create `database/migrations/007_plan2_travel.sql`:

```sql
-- 007_plan2_travel.sql
--
-- Adds two columns supporting narrative player movement Plan 2:
--   - maps_world.pixels_per_mile       (DOUBLE PRECISION, nullable)
--   - campaigns.campaign_clock_days    (INTEGER NOT NULL DEFAULT 0 CHECK >= 0)
--
-- Idempotent: safe to re-apply.

BEGIN;

ALTER TABLE public.maps_world
  ADD COLUMN IF NOT EXISTS pixels_per_mile DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
      AND column_name = 'campaign_clock_days'
  ) THEN
    ALTER TABLE public.campaigns
      ADD COLUMN campaign_clock_days INTEGER NOT NULL DEFAULT 0
        CHECK (campaign_clock_days >= 0);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Mirror in schema.sql**

In `database/schema.sql`, add `pixels_per_mile DOUBLE PRECISION,` to the `maps_world` `CREATE TABLE IF NOT EXISTS` body (it currently ends at approximately line 93, before the closing `);`). Then in the `campaigns` `CREATE TABLE` body (ends around line 284 before `);`), add:

```sql
    campaign_clock_days INTEGER NOT NULL DEFAULT 0 CHECK (campaign_clock_days >= 0),
```

Match the existing quote/indent style in that file. Do not reorder existing columns.

- [ ] **Step 3: Apply the migration to the dev DB (optional sanity check)**

If you have a dev DB handy:

```bash
psql "$QUESTABLES_DATABASE_URL" -f database/migrations/007_plan2_travel.sql
```

Expected: no error; subsequent re-runs are no-ops.

If no dev DB is accessible, skip. The e2e test in Task 14 will exercise the schema against a real DB.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/007_plan2_travel.sql database/schema.sql
git commit -m "feat(schema): add pixels_per_mile and campaign_clock_days for travel Plan 2"
```

---

## Task 2: Travel config constants

**Files:**
- Create: `server/services/movement/travel-config.js`

- [ ] **Step 1: Create the config module**

Create `server/services/movement/travel-config.js`:

```js
/**
 * Travel configuration constants and env-var overrides.
 *
 * DAILY_MILES_PER_MODE — D&D-realistic miles per day per mode. Used when the
 * world has a pixels_per_mile calibration. `teleport` is Infinity (never a limit).
 *
 * FALLBACK_PIXELS_PER_DAY — used when the world has no pixels_per_mile set.
 * Pick values that make a typical cross-map journey feel about right for the
 * pixel-native map scale.
 */

function envNum(key, def) {
  const raw = process.env[key];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export const DAILY_MILES_PER_MODE = {
  walk:     envNum('QUESTABLES_DAILY_MILES_WALK',     24),
  ride:     envNum('QUESTABLES_DAILY_MILES_RIDE',     40),
  boat:     envNum('QUESTABLES_DAILY_MILES_BOAT',     48),
  fly:      envNum('QUESTABLES_DAILY_MILES_FLY',      80),
  teleport: Number.POSITIVE_INFINITY,
};

export const FALLBACK_PIXELS_PER_DAY = {
  walk:     envNum('QUESTABLES_FALLBACK_PX_DAY_WALK',     500),
  ride:     envNum('QUESTABLES_FALLBACK_PX_DAY_RIDE',     833),
  boat:     envNum('QUESTABLES_FALLBACK_PX_DAY_BOAT',    1000),
  fly:      envNum('QUESTABLES_FALLBACK_PX_DAY_FLY',     1667),
  teleport: Number.POSITIVE_INFINITY,
};

export const ROUTE_SNAP_THRESHOLD_PIXELS = envNum('QUESTABLES_ROUTE_SNAP_THRESHOLD_PIXELS', 40);

export const ANIMATION_DURATION_MS = envNum('QUESTABLES_ANIMATION_DURATION_MS', 2500);

export const SUPPORTED_MODES = Object.freeze(['walk', 'ride', 'boat', 'fly', 'teleport']);
export const SUPPORTED_VIA = Object.freeze(['roads', 'direct']);
```

- [ ] **Step 2: Commit**

```bash
git add server/services/movement/travel-config.js
git commit -m "feat(movement): add travel-config constants and env overrides"
```

---

## Task 3: Travel planner — direct / teleport / fly + speed resolution

**Files:**
- Create: `server/services/movement/travel-planner.js`
- Create: `tests/movement/travel-planner.test.js`

- [ ] **Step 1: Write failing tests for non-road paths + speed resolution**

Create `tests/movement/travel-planner.test.js`:

```js
import { jest } from '@jest/globals';
import { planTravel } from '../../server/services/movement/travel-planner.js';

function makeClient(rows = []) {
  return { query: jest.fn(async () => ({ rows })) };
}

describe('planTravel — direct, teleport, fly', () => {
  test('direct via returns 2-point polyline and computes days', async () => {
    const client = makeClient([{ pixels_per_mile: null }]); // world row with no calibration
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1000, y: 0 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.waypoints).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
    expect(plan.distancePixels).toBe(1000);
    expect(plan.distanceMiles).toBeNull();
    expect(plan.totalDays).toBe(2);          // 1000 / 500 fallback walk pixels
    expect(plan.effectiveVia).toBe('direct');
    expect(plan.campPoints).toHaveLength(1); // day 1 between totalDays 2
  });

  test('teleport returns single-point polyline with 0 days', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 10, y: 10 },
      end:     { x: 500, y: 500 },
      mode:    'teleport',
      via:     'roads',
    });
    expect(plan.totalDays).toBe(0);
    expect(plan.campPoints).toEqual([]);
    expect(plan.effectiveVia).toBe('direct'); // teleport ignores via
  });

  test('fly always uses direct line regardless of via', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 300, y: 400 },   // distance 500
      mode:    'fly',
      via:     'roads',
    });
    expect(plan.waypoints).toEqual([{ x: 0, y: 0 }, { x: 300, y: 400 }]);
    expect(plan.distancePixels).toBeCloseTo(500, 5);
    expect(plan.effectiveVia).toBe('direct');
  });

  test('uses miles/day × pixels_per_mile when world has calibration', async () => {
    const client = makeClient([{ pixels_per_mile: 10 }]); // 10 px per mile
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 240, y: 0 },     // 240 px = 24 miles = exactly 1 walk day
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.distanceMiles).toBe(24);
    expect(plan.totalDays).toBe(1);
  });

  test('zero-distance returns 0 days, single-point polyline', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 100, y: 100 },
      end:     { x: 100, y: 100 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.totalDays).toBe(0);
    expect(plan.distancePixels).toBe(0);
    expect(plan.waypoints).toEqual([{ x: 100, y: 100 }]);
  });

  test('unsupported mode throws invalid_mode', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    await expect(planTravel(client, {
      worldId: 'w1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
      mode: 'swim', via: 'direct',
    })).rejects.toMatchObject({ code: 'invalid_mode' });
  });

  test('unsupported via throws invalid_via', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    await expect(planTravel(client, {
      worldId: 'w1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
      mode: 'walk', via: 'skyway',
    })).rejects.toMatchObject({ code: 'invalid_via' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/movement/travel-planner.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the planner with non-road logic only**

Create `server/services/movement/travel-planner.js`:

```js
import {
  DAILY_MILES_PER_MODE,
  FALLBACK_PIXELS_PER_DAY,
  SUPPORTED_MODES,
  SUPPORTED_VIA,
} from './travel-config.js';

function invalid(code, message) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

function segmentLength(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += segmentLength(points[i - 1], points[i]);
  return total;
}

function pointAtDistanceAlong(points, distance) {
  if (points.length === 0) return null;
  if (distance <= 0) return { ...points[0] };
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = segmentLength(points[i - 1], points[i]);
    if (acc + seg >= distance) {
      const remaining = distance - acc;
      const t = seg === 0 ? 0 : remaining / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    acc += seg;
  }
  return { ...points[points.length - 1] };
}

function resolveDailyPixels(mode, pixelsPerMile) {
  if (mode === 'teleport') return Number.POSITIVE_INFINITY;
  if (mode === 'fly')      return FALLBACK_PIXELS_PER_DAY.fly;
  if (pixelsPerMile != null && pixelsPerMile > 0) {
    return DAILY_MILES_PER_MODE[mode] * pixelsPerMile;
  }
  return FALLBACK_PIXELS_PER_DAY[mode];
}

function computeCampPoints(waypoints, dailyPixels, totalDays, distancePixels) {
  if (totalDays <= 1 || !Number.isFinite(dailyPixels) || distancePixels === 0) return [];
  const camps = [];
  for (let day = 1; day < totalDays; day++) {
    const distance = day * dailyPixels;
    if (distance >= distancePixels) break;
    const pt = pointAtDistanceAlong(waypoints, distance);
    camps.push({ x: pt.x, y: pt.y, day });
  }
  return camps;
}

async function loadWorldCalibration(client, worldId) {
  const { rows } = await client.query(
    `SELECT pixels_per_mile FROM public.maps_world WHERE id = $1 LIMIT 1`,
    [worldId],
  );
  if (rows.length === 0) throw invalid('invalid_world', `World ${worldId} not found`);
  return rows[0].pixels_per_mile;
}

export async function planTravel(client, { worldId, start, end, mode, via }) {
  if (!SUPPORTED_MODES.includes(mode)) {
    throw invalid('invalid_mode', `Unsupported mode: ${mode}`);
  }
  const viaIsRouteId = typeof via === 'string' && /^[0-9a-f-]{36}$/i.test(via);
  if (!SUPPORTED_VIA.includes(via) && !viaIsRouteId) {
    throw invalid('invalid_via', `Unsupported via: ${via}`);
  }

  const pixelsPerMile = await loadWorldCalibration(client, worldId);
  const dailyPixels = resolveDailyPixels(mode, pixelsPerMile);

  // Non-road paths: direct, fly, teleport
  if (mode === 'teleport' || mode === 'fly' || via === 'direct') {
    const distancePixels = segmentLength(start, end);
    const waypoints = distancePixels === 0 ? [{ ...start }] : [{ ...start }, { ...end }];
    const totalDays = mode === 'teleport' || distancePixels === 0
      ? 0
      : Math.max(1, Math.ceil(distancePixels / dailyPixels));
    return {
      waypoints,
      distancePixels,
      distanceMiles: pixelsPerMile != null && pixelsPerMile > 0
        ? distancePixels / pixelsPerMile
        : null,
      totalDays,
      campPoints: computeCampPoints(waypoints, dailyPixels, totalDays, distancePixels),
      effectiveVia: 'direct',
      dailyPixels,
    };
  }

  // via === 'roads' OR via === '<route_uuid>' — implemented in Task 4.
  throw invalid('not_implemented', `road snapping not yet implemented — landed in Task 4`);
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- tests/movement/travel-planner.test.js`
Expected: 7 tests pass (7 cover direct/teleport/fly/calibration/zero/invalid-mode/invalid-via).

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/travel-planner.js tests/movement/travel-planner.test.js
git commit -m "feat(travel-planner): direct/fly/teleport paths + speed resolution"
```

---

## Task 4: Travel planner — road-snap same-route case

**Files:**
- Modify: `server/services/movement/travel-planner.js`
- Modify: `tests/movement/travel-planner.test.js`

- [ ] **Step 1: Append failing test for the happy-path road case**

Append to `tests/movement/travel-planner.test.js` after the existing describe block:

```js
describe('planTravel — road snap (same route)', () => {
  test('both endpoints snap to same route, uses ST_LineSubstring path', async () => {
    // Mock sequence:
    //   query 1: world calibration
    //   query 2: nearest route to start
    //   query 3: nearest route to end
    //   query 4: ST_LineSubstring extraction
    const client = {
      query: jest.fn()
        // world calibration
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: 10 }] })
        // start snap: nearest route
        .mockResolvedValueOnce({ rows: [{
          route_id:     'route-1',
          snap_x:       5, snap_y: 0,
          loc_fraction: 0.1,
          distance:     5,
        }]})
        // end snap: nearest route
        .mockResolvedValueOnce({ rows: [{
          route_id:     'route-1',
          snap_x:       195, snap_y: 0,
          loc_fraction: 0.9,
          distance:     5,
        }]})
        // ST_LineSubstring segment points (sorted: start-frac < end-frac, so 0.1 → 0.9)
        .mockResolvedValueOnce({ rows: [{
          points: [
            { x: 5, y: 0 }, { x: 50, y: 0 }, { x: 120, y: 0 }, { x: 195, y: 0 },
          ],
        }]}),
    };

    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 200, y: 0 },
      mode:    'walk',
      via:     'roads',
    });

    expect(plan.effectiveVia).toBe('roads');
    // Expect: start + snap-start + middle points + snap-end + end
    expect(plan.waypoints[0]).toEqual({ x: 0, y: 0 });
    expect(plan.waypoints[plan.waypoints.length - 1]).toEqual({ x: 200, y: 0 });
    // Middle vertices from ST_LineSubstring
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(4);
    expect(plan.distancePixels).toBeGreaterThan(0);
  });

  test('swaps start/end fractions when start-frac > end-frac on the route', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] })
        // start snaps at fraction 0.9
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r1', snap_x: 195, snap_y: 0, loc_fraction: 0.9, distance: 5,
        }]})
        // end snaps at fraction 0.1 (earlier on the route)
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r1', snap_x: 5, snap_y: 0, loc_fraction: 0.1, distance: 5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          points: [{ x: 195, y: 0 }, { x: 100, y: 0 }, { x: 5, y: 0 }],
        }]}),
    };

    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 200, y: 0 },
      end:     { x: 0, y: 0 },
      mode:    'walk',
      via:     'roads',
    });
    // First waypoint is still `start` (not reversed), then the route segment goes
    // from snap-start (195,0) toward snap-end (5,0).
    expect(plan.waypoints[0]).toEqual({ x: 200, y: 0 });
    expect(plan.waypoints[plan.waypoints.length - 1]).toEqual({ x: 0, y: 0 });
    expect(plan.effectiveVia).toBe('roads');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (not_implemented)**

Run: `npm test -- tests/movement/travel-planner.test.js`
Expected: 2 new tests FAIL with `not_implemented` / `road snapping not yet implemented`.

- [ ] **Step 3: Implement road-snap same-route logic**

In `server/services/movement/travel-planner.js`, replace the final `throw invalid('not_implemented', ...)` block with:

```js
  // via === 'roads' OR via === '<route_uuid>'
  const { snap: startSnap } = await snapPointToNearestRoute(client, worldId, start, via);
  const { snap: endSnap }   = await snapPointToNearestRoute(client, worldId, end,   via);

  let waypoints;
  let effectiveVia;

  if (startSnap && endSnap && startSnap.route_id === endSnap.route_id) {
    const [fracA, fracB] = startSnap.loc_fraction <= endSnap.loc_fraction
      ? [startSnap.loc_fraction, endSnap.loc_fraction]
      : [endSnap.loc_fraction, startSnap.loc_fraction];
    const routeMiddle = await extractRouteSubstring(client, startSnap.route_id, fracA, fracB);

    // When the snap-start fraction is larger, the substring we fetched runs
    // from end→start direction. Reverse so the middle flows start→end.
    const middle = startSnap.loc_fraction <= endSnap.loc_fraction
      ? routeMiddle
      : [...routeMiddle].reverse();

    waypoints = [{ ...start }, ...middle, { ...end }];
    effectiveVia = viaIsRouteId ? via : 'roads';
  } else {
    // Fallback is completed in Task 5 — for now, fall back to direct.
    waypoints = segmentLength(start, end) === 0 ? [{ ...start }] : [{ ...start }, { ...end }];
    effectiveVia = 'direct';
  }

  const distancePixels = polylineLength(waypoints);
  const totalDays = distancePixels === 0
    ? 0
    : Math.max(1, Math.ceil(distancePixels / dailyPixels));

  return {
    waypoints,
    distancePixels,
    distanceMiles: pixelsPerMile != null && pixelsPerMile > 0
      ? distancePixels / pixelsPerMile
      : null,
    totalDays,
    campPoints: computeCampPoints(waypoints, dailyPixels, totalDays, distancePixels),
    effectiveVia,
    dailyPixels,
  };
}
```

Then add these two helpers above `export async function planTravel`:

```js
async function snapPointToNearestRoute(client, worldId, point, via) {
  const viaIsRouteId = typeof via === 'string' && /^[0-9a-f-]{36}$/i.test(via);
  const params = [worldId, point.x, point.y];
  let where = `mr.world_id = $1`;
  if (viaIsRouteId) {
    params.push(via);
    where += ` AND mr.id = $4::uuid`;
  }
  const { rows } = await client.query(
    `WITH pt AS (SELECT ST_SetSRID(ST_MakePoint($2, $3), 0) AS geom)
     SELECT mr.id AS route_id,
            ST_X(ST_ClosestPoint(mr.geom, pt.geom)) AS snap_x,
            ST_Y(ST_ClosestPoint(mr.geom, pt.geom)) AS snap_y,
            ST_LineLocatePoint(ST_GeometryN(mr.geom, 1), pt.geom) AS loc_fraction,
            ST_Distance(mr.geom, pt.geom) AS distance
       FROM public.maps_routes mr, pt
      WHERE ${where}
      ORDER BY distance ASC
      LIMIT 1`,
    params,
  );
  if (rows.length === 0) return { snap: null };
  return { snap: rows[0] };
}

async function extractRouteSubstring(client, routeId, fracA, fracB) {
  const { rows } = await client.query(
    `WITH segment AS (
       SELECT ST_LineSubstring(ST_GeometryN(mr.geom, 1), $2, $3) AS geom
         FROM public.maps_routes mr
        WHERE mr.id = $1::uuid
     )
     SELECT json_agg(
              json_build_object('x', ST_X((dp).geom), 'y', ST_Y((dp).geom))
              ORDER BY (dp).path
            ) AS points
       FROM (SELECT ST_DumpPoints(geom) AS dp FROM segment) s`,
    [routeId, fracA, fracB],
  );
  return rows[0]?.points ?? [];
}
```

`ST_DumpPoints` returns rows of `(path integer[], geom geometry)` — the subquery aliases it as `dp` and the outer query extracts `(dp).geom` and `(dp).path` via record-field access.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/movement/travel-planner.test.js`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/travel-planner.js tests/movement/travel-planner.test.js
git commit -m "feat(travel-planner): road snap for same-route endpoints"
```

---

## Task 5: Travel planner — fallback + forced-route + camp point verification

**Files:**
- Modify: `server/services/movement/travel-planner.js`
- Modify: `tests/movement/travel-planner.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/movement/travel-planner.test.js`:

```js
describe('planTravel — fallback and forced-route', () => {
  test('different routes → falls back to direct line with effectiveVia=direct', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] })
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r1', snap_x: 5, snap_y: 0, loc_fraction: 0.5, distance: 5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r2', snap_x: 995, snap_y: 0, loc_fraction: 0.5, distance: 5,
        }]}),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1000, y: 0 },
      mode:    'walk',
      via:     'roads',
    });
    expect(plan.effectiveVia).toBe('direct');
    expect(plan.waypoints).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
  });

  test('neither endpoint snaps → falls back to direct line', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] })
        .mockResolvedValueOnce({ rows: [] })   // no route near start
        .mockResolvedValueOnce({ rows: [] }),  // no route near end
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1000, y: 0 },
      mode:    'walk',
      via:     'roads',
    });
    expect(plan.effectiveVia).toBe('direct');
  });

  test('forced route uuid: uses that route even if threshold would fail', async () => {
    // Forced-route via passes the route uuid to the snap helper, which then
    // adds `AND mr.id = $4::uuid` — the resolver always returns whatever
    // projects onto THAT route.
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: 10 }] })
        .mockResolvedValueOnce({ rows: [{
          route_id: 'forced-route-uuid',
          snap_x: 10, snap_y: 10, loc_fraction: 0.0, distance: 9999,
        }]})
        .mockResolvedValueOnce({ rows: [{
          route_id: 'forced-route-uuid',
          snap_x: 500, snap_y: 10, loc_fraction: 1.0, distance: 9999,
        }]})
        .mockResolvedValueOnce({ rows: [{
          points: [{ x: 10, y: 10 }, { x: 500, y: 10 }],
        }]}),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 600, y: 0 },
      mode:    'walk',
      via:     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(plan.effectiveVia).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(4);
  });
});

describe('planTravel — camp points', () => {
  test('3-day journey returns 2 camp points at correct fractions', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] }),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1500, y: 0 },   // 1500 px / 500 walk-day = 3 days exactly
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.totalDays).toBe(3);
    expect(plan.campPoints).toHaveLength(2);
    expect(plan.campPoints[0]).toMatchObject({ day: 1 });
    expect(plan.campPoints[1]).toMatchObject({ day: 2 });
    expect(plan.campPoints[0].x).toBeCloseTo(500, 5);
    expect(plan.campPoints[1].x).toBeCloseTo(1000, 5);
  });

  test('1-day journey has no camp points', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] }),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 200, y: 0 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.totalDays).toBe(1);
    expect(plan.campPoints).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones pass**

Run: `npm test -- tests/movement/travel-planner.test.js`
Expected: all tests pass (including the new camp-point tests). The forced-route and fallback paths already work from Task 4's implementation. If the forced-route test FAILS because `effectiveVia` is `'roads'` instead of the uuid, add the uuid branch to the effectiveVia assignment. The Task 4 code already has `effectiveVia = viaIsRouteId ? via : 'roads'` — if you skipped that, add it now.

If the fallback-to-direct path fails because the function tries to run the `ST_LineSubstring` query when `endSnap` is null, make sure the `if (startSnap && endSnap && ...)` guard actually catches both nulls and same-route condition.

- [ ] **Step 3: Commit**

```bash
git add server/services/movement/travel-planner.js tests/movement/travel-planner.test.js
git commit -m "feat(travel-planner): fallback, forced-route, and camp-point coverage"
```

---

## Task 6: `performPlayerMovement` — pathWaypoints + gameDaysElapsed

**Files:**
- Modify: `server/services/campaigns/service.js`
- Create: `tests/movement/perform-player-movement-path.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/movement/perform-player-movement-path.test.js`:

```js
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/campaigns/movement-config.js', () => ({
  getMovementConfig: () => ({ gridType: 'none', gridSize: 1, originX: 0, originY: 0 }),
  snapToGrid: (x, y) => ({ x, y }),
  computeDistance: () => 0,
  pointWithinBounds: () => true,
}));

const { performPlayerMovement } = await import('../../server/services/campaigns/service.js');

function makeClientWithCapture() {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) return { rows: [{
        id: 'p1', user_id: 'u1', campaign_id: 'c1', visibility_state: 'visible',
        last_located_at: new Date('2026-04-17T12:00:00Z'), prev_x: 0, prev_y: 0,
      }] };
      if (/ST_DWithin/.test(sql)) return { rows: [] };
      if (/SELECT id,\s+visibility_state,/.test(sql)) return { rows: [{
        id: 'p1', visibility_state: 'visible',
        geometry: { type: 'Point', coordinates: [500, 0] },
        last_located_at: new Date('2026-04-17T12:30:00Z'),
      }] };
      if (/INSERT INTO public\.player_movement_paths/.test(sql)) return { rows: [{ id: 'path-1', created_at: new Date() }] };
      if (/FROM public\.maps_world/.test(sql)) return { rows: [{ bounds: null }] };
      return { rows: [] };
    }),
  };
}

test('pathWaypoints: inserts polyline with len(waypoints) ST_MakePoint calls', async () => {
  const client = makeClientWithCapture();
  const waypoints = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 300, y: 100 },
    { x: 500, y: 0 },
  ];
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm', isRequestorAdmin: false,
    targetX: 500, targetY: 0, mode: 'walk', reason: 'narrative',
    source: 'llm',
    pathWaypoints: waypoints,
  });
  const pathInsert = client.queries.find((q) => /INSERT INTO public\.player_movement_paths/.test(q.sql));
  expect(pathInsert).toBeTruthy();
  // The inserted SQL must include 4 ST_MakePoint calls — one per waypoint —
  // to build the LineStringZ.
  const makePointCount = (pathInsert.sql.match(/ST_MakePoint\(/g) ?? []).length;
  expect(makePointCount).toBe(4);
});

test('gameDaysElapsed: issues UPDATE campaigns SET campaign_clock_days = campaign_clock_days + N', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm',
    targetX: 500, targetY: 0, mode: 'walk', source: 'llm',
    gameDaysElapsed: 3,
  });
  const clockUpdate = client.queries.find((q) =>
    /UPDATE public\.campaigns/.test(q.sql) && /campaign_clock_days/.test(q.sql),
  );
  expect(clockUpdate).toBeTruthy();
  expect(clockUpdate.params).toEqual(expect.arrayContaining(['c1', 3]));
});

test('no pathWaypoints, no gameDaysElapsed: behaviour identical to Plan 1 (2-point path, no clock update)', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'u1', requestorRole: 'dm',
    targetX: 500, targetY: 0, mode: 'walk',
  });
  const pathInsert = client.queries.find((q) => /INSERT INTO public\.player_movement_paths/.test(q.sql));
  const makePointCount = (pathInsert.sql.match(/ST_MakePoint\(/g) ?? []).length;
  expect(makePointCount).toBe(2); // 2-point line, as before
  const clockUpdate = client.queries.find((q) =>
    /UPDATE public\.campaigns/.test(q.sql) && /campaign_clock_days/.test(q.sql),
  );
  expect(clockUpdate).toBeUndefined();
});

test('gameDaysElapsed = 0 does NOT issue clock update', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm',
    targetX: 500, targetY: 0, mode: 'walk', source: 'llm',
    gameDaysElapsed: 0,
  });
  const clockUpdate = client.queries.find((q) =>
    /UPDATE public\.campaigns/.test(q.sql) && /campaign_clock_days/.test(q.sql),
  );
  expect(clockUpdate).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- tests/movement/perform-player-movement-path.test.js`
Expected: FAIL — `pathWaypoints` and `gameDaysElapsed` are not wired up.

- [ ] **Step 3: Extend `performPlayerMovement`**

In `server/services/campaigns/service.js`, add `pathWaypoints` and `gameDaysElapsed` to the destructured params (around lines 141-154):

```js
export const performPlayerMovement = async ({
  client,
  campaignId,
  playerId,
  requestorUserId,
  requestorRole,
  isRequestorAdmin = false,
  targetX,
  targetY,
  mode,
  reason,
  enforceClamp = true,
  source = 'dm',
  pathWaypoints,      // NEW
  gameDaysElapsed,    // NEW
}) => {
```

Replace the existing `player_movement_paths` INSERT (currently a 2-point line using `ST_MakeLine(ARRAY[ST_MakePoint($3,$4,$5), ST_MakePoint($6,$7,$8)])`) with a builder that handles N waypoints.

Locate the current INSERT (approximately lines 295-330) and replace with:

```js
  // Build a polyline. If pathWaypoints is supplied, use it (with Z-timestamps
  // evenly spread across [previousTimestamp, nowTimestamp]); else use the
  // legacy 2-point line.
  const effectivePoints = Array.isArray(pathWaypoints) && pathWaypoints.length >= 2
    ? pathWaypoints
    : [previousPoint, snappedTarget];

  const totalT = nowTimestamp - previousTimestamp;
  const ptSql = effectivePoints.map((_, i) => {
    const a = 3 + i * 3;
    return `ST_MakePoint($${a}, $${a + 1}, $${a + 2})`;
  }).join(', ');
  const ptParams = effectivePoints.flatMap((p, i) => {
    const frac = effectivePoints.length === 1 ? 0 : i / (effectivePoints.length - 1);
    return [p.x, p.y, previousTimestamp + totalT * frac];
  });

  const pathInsert = await client.query(
    `INSERT INTO public.player_movement_paths (
        campaign_id, player_id, path, mode, moved_by, reason
     )
     VALUES (
        $1, $2,
        ST_SetSRID(ST_MakeLine(ARRAY[${ptSql}]), 0),
        $${3 + ptParams.length}, $${4 + ptParams.length}, $${5 + ptParams.length}
     )
     RETURNING id, created_at`,
    [campaignId, playerId, ...ptParams, mode, requestorUserId, auditReason],
  );
```

(`auditReason` comes from Task 4 of Plan 1 — already computed higher in the function.)

Next, immediately after the existing `UPDATE public.campaign_players SET loc_current ...` query (around line 240-249), add the clock bump:

```js
  if (Number.isInteger(gameDaysElapsed) && gameDaysElapsed > 0) {
    await client.query(
      `UPDATE public.campaigns
          SET campaign_clock_days = campaign_clock_days + $2,
              updated_at = NOW()
        WHERE id = $1`,
      [campaignId, gameDaysElapsed],
    );
  }
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- tests/movement/perform-player-movement-path.test.js tests/movement/perform-player-movement-source.test.js`
Expected: all tests pass in both files (the Plan 1 source-param tests must continue to pass).

- [ ] **Step 5: Commit**

```bash
git add server/services/campaigns/service.js tests/movement/perform-player-movement-path.test.js
git commit -m "feat(move): performPlayerMovement accepts pathWaypoints + gameDaysElapsed"
```

---

## Task 7: `proactive-generator` — evaluateEncounterAtPoint

**Files:**
- Modify: `server/services/encounters/proactive-generator.js`
- Create: `tests/movement/proactive-generator-at-point.test.js`

The existing `evaluateEncounterChance` reads `cp.loc_current` and is not callable at arbitrary camp points. We add a sibling function that takes explicit `(campaignId, sessionId, x, y)`.

- [ ] **Step 1: Write failing tests**

Create `tests/movement/proactive-generator-at-point.test.js`:

```js
import { jest } from '@jest/globals';

const queryMock = jest.fn();
jest.unstable_mockModule('../../server/db/pool.js', () => ({
  query: queryMock,
  getClient: jest.fn(),
}));

const { evaluateEncounterAtPoint } = await import('../../server/services/encounters/proactive-generator.js');

beforeEach(() => queryMock.mockReset());

test('returns true when point is inside an encounter region and roll succeeds', async () => {
  // Force a deterministic roll
  const originalRandom = Math.random;
  Math.random = () => 0.01;

  queryMock
    // recent combat count
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    // region containing (x,y)?
    .mockResolvedValueOnce({ rows: [{ category: 'encounter' }] });

  const result = await evaluateEncounterAtPoint({
    campaignId: 'c1', sessionId: 's1', x: 100, y: 200,
  });
  expect(result).toBe(true);

  Math.random = originalRandom;
});

test('returns false when point is not in an encounter region and roll is too high', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.99;

  queryMock
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    .mockResolvedValueOnce({ rows: [] }); // no encounter region at this point

  const result = await evaluateEncounterAtPoint({
    campaignId: 'c1', sessionId: 's1', x: 100, y: 200,
  });
  expect(result).toBe(false);

  Math.random = originalRandom;
});

test('returns false on DB error', async () => {
  queryMock.mockRejectedValueOnce(new Error('db down'));
  const result = await evaluateEncounterAtPoint({
    campaignId: 'c1', sessionId: 's1', x: 0, y: 0,
  });
  expect(result).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- tests/movement/proactive-generator-at-point.test.js`
Expected: FAIL — `evaluateEncounterAtPoint` does not exist.

- [ ] **Step 3: Add the new export to proactive-generator.js**

In `server/services/encounters/proactive-generator.js`, add after the existing `evaluateEncounterChance` export (around line 100):

```js
/**
 * Same probability model as evaluateEncounterChance, but evaluates at an
 * explicit (x, y) in world-pixel coordinates. Used by the travel planner to
 * check each camp point along a multi-day journey without mutating the
 * player's stored position.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {number} opts.x
 * @param {number} opts.y
 * @returns {Promise<boolean>} Whether an encounter should trigger at this point
 */
export async function evaluateEncounterAtPoint({ campaignId, sessionId, x, y }) {
  try {
    const { rows: recentCombat } = await query(
      `SELECT COUNT(*) AS count
         FROM public.game_state_log
        WHERE session_id = $1 AND event_type = 'phase_changed'
          AND (metadata->>'newPhase' = 'combat')
          AND created_at > NOW() - INTERVAL '2 hours'`,
      [sessionId],
      { label: 'encounter-gen.recent-combat-at-point' },
    );
    const recentCombatCount = parseInt(recentCombat[0]?.count ?? '0', 10);

    const { rows: regionHits } = await query(
      `SELECT cmr.category
         FROM public.campaign_map_regions cmr
        WHERE cmr.campaign_id = $1
          AND cmr.category = 'encounter'
          AND ST_Contains(cmr.region, ST_SetSRID(ST_MakePoint($2, $3), 0))
        LIMIT 1`,
      [campaignId, x, y],
      { label: 'encounter-gen.region-at-point' },
    );
    const inEncounterRegion = regionHits.length > 0;

    let probability = 0.05;
    if (inEncounterRegion)       probability  = 0.25;
    if (recentCombatCount === 0) probability += 0.05;
    if (recentCombatCount >= 2)  probability *= 0.5;

    const roll = Math.random();
    const triggered = roll < probability;

    logInfo('Encounter check at point', {
      campaignId, sessionId, x, y,
      probability: Math.round(probability * 100),
      roll: Math.round(roll * 100),
      triggered, inEncounterRegion, recentCombatCount,
    });
    return triggered;
  } catch (error) {
    logError('Encounter-at-point evaluation failed', { error: error.message, campaignId, x, y });
    return false;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/movement/proactive-generator-at-point.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/encounters/proactive-generator.js tests/movement/proactive-generator-at-point.test.js
git commit -m "feat(encounters): evaluateEncounterAtPoint for camp-point checks"
```

---

## Task 8: `applyNarrativeMove` — integrated travel flow

**Files:**
- Modify: `server/services/movement/narrative-movement.js`
- Modify: `tests/movement/narrative-movement.test.js`

This is the integration task. The existing `applyNarrativeMove` is extended to plan travel, walk camps for encounters, truncate at interrupts, and broadcast the richer payload.

- [ ] **Step 1: Write failing tests for the extended flow**

Replace the existing `tests/movement/narrative-movement.test.js` with:

```js
import { jest } from '@jest/globals';

const resolveDestinationMock = jest.fn();
const planTravelMock = jest.fn();
const evaluateEncounterAtPointMock = jest.fn();
const performPlayerMovementMock = jest.fn();

jest.unstable_mockModule('../../server/services/movement/destination-resolver.js', () => ({
  resolveDestination: resolveDestinationMock,
}));
jest.unstable_mockModule('../../server/services/movement/travel-planner.js', () => ({
  planTravel: planTravelMock,
}));
jest.unstable_mockModule('../../server/services/encounters/proactive-generator.js', () => ({
  evaluateEncounterAtPoint: evaluateEncounterAtPointMock,
  evaluateEncounterChance: jest.fn(),
  generateEncounter: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/campaigns/service.js', () => ({
  performPlayerMovement: performPlayerMovementMock,
}));

const { applyNarrativeMove } = await import('../../server/services/movement/narrative-movement.js');

function baseResolved() {
  return { x: 1500, y: 0, burgId: 'b1', mapLevel: 'settlement', resolvedName: 'Harrowick' };
}
function basePlan() {
  return {
    waypoints:      [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }, { x: 1500, y: 0 }],
    distancePixels: 1500,
    distanceMiles:  150,
    totalDays:      3,
    campPoints:     [
      { x: 500,  y: 0, day: 1 },
      { x: 1000, y: 0, day: 2 },
    ],
    effectiveVia:   'roads',
    dailyPixels:    500,
  };
}
function baseMoveResult() {
  return {
    player: {
      id: 'p1', visibility_state: 'visible',
      geometry: { type: 'Point', coordinates: [1500, 0] },
      last_located_at: new Date('2026-04-17T14:00:00Z'),
    },
    requestedDistance: 1500,
    requestedTarget: { x: 1500, y: 0 },
    snappedTarget:   { x: 1500, y: 0 },
    grid: { type: 'none', size: 1, origin: { x: 0, y: 0 } },
    pathId: 'path-1',
  };
}

function makeClient(extraRows = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/ST_X\(loc_current\)/.test(sql)) return { rows: [{ x: 0, y: 0 }] };
      if (/SELECT world_map_id FROM public\.campaigns/.test(sql))
        return { rows: [{ world_map_id: 'w1' }] };
      if (/SELECT campaign_clock_days FROM public\.campaigns/.test(sql))
        return { rows: [{ campaign_clock_days: extraRows.clockDay ?? 3 }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  resolveDestinationMock.mockReset();
  planTravelMock.mockReset();
  evaluateEncounterAtPointMock.mockReset();
  performPlayerMovementMock.mockReset();
});

test('no encounter: full arrival, clock advances by totalDays', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue(basePlan());
  evaluateEncounterAtPointMock.mockResolvedValue(false);
  performPlayerMovementMock.mockResolvedValue(baseMoveResult());

  const wsServer = { broadcastToCampaign: jest.fn() };
  const result = await applyNarrativeMove(makeClient({ clockDay: 3 }), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    mode: 'walk', via: 'roads',
    wsServer,
  });

  expect(performPlayerMovementMock).toHaveBeenCalledWith(expect.objectContaining({
    targetX: 1500, targetY: 0, source: 'llm',
    pathWaypoints: basePlan().waypoints,
    gameDaysElapsed: 3,
  }));
  expect(result.travel).toMatchObject({
    totalDaysPlanned: 3, daysElapsed: 3, interrupted: false, effectiveVia: 'roads',
  });
  expect(result.clockDay).toBe(3);
  expect(result.encounter).toBeNull();
  expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith('c1', 'player-moved',
    expect.objectContaining({ path: expect.any(Object), travel: expect.any(Object) }));
});

test('encounter on day 2 of 3: interrupted at camp[1], daysElapsed=2, polyline truncated', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue(basePlan());
  // First camp clear; second camp triggers
  evaluateEncounterAtPointMock
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  performPlayerMovementMock.mockResolvedValue({
    ...baseMoveResult(),
    player: { ...baseMoveResult().player,
              geometry: { type: 'Point', coordinates: [1000, 0] } },
    requestedTarget: { x: 1000, y: 0 },
    snappedTarget:   { x: 1000, y: 0 },
  });

  const result = await applyNarrativeMove(makeClient({ clockDay: 2 }), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    mode: 'walk', via: 'roads',
  });

  expect(performPlayerMovementMock).toHaveBeenCalledWith(expect.objectContaining({
    targetX: 1000, targetY: 0,
    gameDaysElapsed: 2,
    pathWaypoints: expect.arrayContaining([{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
  }));
  expect(result.travel.interrupted).toBe(true);
  expect(result.travel.daysElapsed).toBe(2);
});

test('teleport (0 days): skips encounter loop, no clock update', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue({
    ...basePlan(),
    totalDays: 0, campPoints: [], dailyPixels: Infinity,
  });
  performPlayerMovementMock.mockResolvedValue(baseMoveResult());

  await applyNarrativeMove(makeClient({ clockDay: 0 }), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    mode: 'teleport',
  });

  expect(evaluateEncounterAtPointMock).not.toHaveBeenCalled();
  expect(performPlayerMovementMock).toHaveBeenCalledWith(expect.objectContaining({
    gameDaysElapsed: 0,
  }));
});

test('works without wsServer (broadcast is best-effort)', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue(basePlan());
  evaluateEncounterAtPointMock.mockResolvedValue(false);
  performPlayerMovementMock.mockResolvedValue(baseMoveResult());

  const result = await applyNarrativeMove(makeClient(), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
  });
  expect(result.playerId).toBe('p1');
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- tests/movement/narrative-movement.test.js`
Expected: FAIL — the module doesn't yet call `planTravel`, `evaluateEncounterAtPoint`, or load world/clock.

- [ ] **Step 3: Rewrite `applyNarrativeMove`**

Replace the contents of `server/services/movement/narrative-movement.js` with:

```js
import { resolveDestination } from './destination-resolver.js';
import { planTravel } from './travel-planner.js';
import { performPlayerMovement } from '../campaigns/service.js';
import { evaluateEncounterAtPoint } from '../encounters/proactive-generator.js';
import { logWarn } from '../../utils/logger.js';

async function loadCurrentPosition(client, campaignId, playerId) {
  const { rows } = await client.query(
    `SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y
       FROM public.campaign_players
      WHERE campaign_id = $1 AND id = $2 AND loc_current IS NOT NULL
      LIMIT 1`,
    [campaignId, playerId],
  );
  if (rows.length === 0) return { x: 0, y: 0 }; // safe default; move will still succeed
  return { x: Number(rows[0].x), y: Number(rows[0].y) };
}

async function loadWorldId(client, campaignId) {
  const { rows } = await client.query(
    `SELECT world_map_id FROM public.campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
  );
  return rows[0]?.world_map_id ?? null;
}

async function loadClockDay(client, campaignId) {
  const { rows } = await client.query(
    `SELECT campaign_clock_days FROM public.campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
  );
  return rows[0]?.campaign_clock_days ?? 0;
}

function segmentLength(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

function truncateWaypointsAtCamp(waypoints, camp) {
  // Walk along waypoints until we hit the camp; include every vertex up to it,
  // then append the camp itself.
  const out = [{ ...waypoints[0] }];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const cur  = waypoints[i];
    if (Math.abs(cur.x - camp.x) < 1e-6 && Math.abs(cur.y - camp.y) < 1e-6) {
      out.push({ ...cur });
      return out;
    }
    // Is the camp on the segment [prev, cur]?
    const segLen = segmentLength(prev, cur);
    const toCamp = segmentLength(prev, camp);
    const fromCamp = segmentLength(camp, cur);
    if (Math.abs(segLen - (toCamp + fromCamp)) < 1e-3) {
      out.push({ x: camp.x, y: camp.y });
      return out;
    }
    out.push({ ...cur });
  }
  out.push({ x: camp.x, y: camp.y });
  return out;
}

async function walkCampsForEncounter({ sessionId, campaignId, campPoints }) {
  for (const camp of campPoints) {
    const triggered = await evaluateEncounterAtPoint({
      campaignId, sessionId,
      x: camp.x, y: camp.y,
    });
    if (triggered) {
      return { interruptedAt: camp, dayReached: camp.day };
    }
  }
  return { interruptedAt: null };
}

export async function applyNarrativeMove(client, {
  campaignId,
  playerId,
  sessionId,
  requestorUserId,
  destination,
  reason,
  mode = 'walk',
  via = 'roads',
  wsServer = null,
}) {
  const resolved = await resolveDestination(client, { campaignId, destination });
  const current  = await loadCurrentPosition(client, campaignId, playerId);
  const worldId  = await loadWorldId(client, campaignId);

  const plan = worldId
    ? await planTravel(client, {
        worldId, start: current,
        end: { x: resolved.x, y: resolved.y },
        mode, via,
      })
    : {
        waypoints: [current, { x: resolved.x, y: resolved.y }],
        distancePixels: segmentLength(current, { x: resolved.x, y: resolved.y }),
        distanceMiles: null,
        totalDays: 0,
        campPoints: [],
        effectiveVia: 'direct',
        dailyPixels: Infinity,
      };

  const interrupt = plan.campPoints.length > 0 && sessionId
    ? await walkCampsForEncounter({ sessionId, campaignId, campPoints: plan.campPoints })
    : { interruptedAt: null };

  const effectiveEnd = interrupt.interruptedAt ?? { x: resolved.x, y: resolved.y };
  const effectiveWaypoints = interrupt.interruptedAt
    ? truncateWaypointsAtCamp(plan.waypoints, interrupt.interruptedAt)
    : plan.waypoints;
  const daysElapsed = interrupt.interruptedAt
    ? interrupt.interruptedAt.day
    : plan.totalDays;

  const moveResult = await performPlayerMovement({
    client, campaignId, playerId,
    requestorUserId,
    requestorRole: 'llm',
    isRequestorAdmin: false,
    targetX: effectiveEnd.x,
    targetY: effectiveEnd.y,
    mode,
    reason: reason ?? `narrative: ${destination.kind}:${destination.ref}`,
    enforceClamp: true,
    source: 'llm',
    pathWaypoints: effectiveWaypoints,
    gameDaysElapsed: daysElapsed,
  });

  const clockDay = await loadClockDay(client, campaignId);

  const summary = {
    playerId: moveResult.player.id,
    geometry: moveResult.player.geometry,
    visibilityState: moveResult.player.visibility_state,
    mapLevel: resolved.mapLevel,
    insideBurgId: resolved.burgId,
    resolvedName: resolved.resolvedName,
    distance: moveResult.requestedDistance,
    pathId: moveResult.pathId,
    updatedAt: moveResult.player.last_located_at,
    path: {
      waypoints: effectiveWaypoints,
      distancePixels: plan.distancePixels,
      distanceMiles: plan.distanceMiles,
      mode,
    },
    travel: {
      totalDaysPlanned: plan.totalDays,
      daysElapsed,
      interrupted: interrupt.interruptedAt !== null,
      effectiveVia: plan.effectiveVia,
    },
    clockDay,
    encounter: null,
  };

  if (wsServer?.broadcastToCampaign) {
    try {
      wsServer.broadcastToCampaign(campaignId, 'player-moved', {
        ...summary,
        mode,
        movedBy: requestorUserId,
        reason: reason ?? null,
        target: moveResult.requestedTarget,
        snapped: moveResult.snappedTarget,
        grid: moveResult.grid,
        source: 'llm',
      });
    } catch (err) {
      logWarn('narrative-movement broadcast failed (non-fatal)', {
        campaignId,
        playerId: moveResult.player.id,
        error: err?.message ?? String(err),
      });
    }
  }

  return summary;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/movement/narrative-movement.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Run the full movement suite**

Run: `npm test -- tests/movement/`
Expected: all movement tests pass (travel-planner ≥ 11, perform-player-movement-path 4, perform-player-movement-source 2, destination-resolver 6, move-player-outcome 2, narrative-movement 4, proactive-generator-at-point 3 = 32+; plus 1 skipped e2e).

- [ ] **Step 6: Commit**

```bash
git add server/services/movement/narrative-movement.js tests/movement/narrative-movement.test.js
git commit -m "feat(movement): applyNarrativeMove plans travel, walks camps, commits clock"
```

---

## Task 9: DM response schema — via + mode fields

**Files:**
- Modify: `server/llm/schemas/dm-response-schema.js`

- [ ] **Step 1: Extend the `mechanicalOutcome` properties**

Read the current file. Locate `mechanicalOutcome.properties` (Plan 1 added `type`, `destination` among others). Add two new siblings inside `properties`:

```js
    via: {
      type: ['string', 'null'],
      description: 'Optional. For type="move_player": "roads" (default, snap to routes), "direct" (cross-country straight line), or a specific route UUID.',
    },
    mode: {
      type: ['string', 'null'],
      enum: ['walk', 'ride', 'boat', 'fly', 'teleport', null],
      description: 'Optional travel mode for type="move_player". Defaults to "walk". Use "ride" when the party is mounted, "boat" on water, "fly" when airborne, "teleport" for magical instant travel.',
    },
```

Keep the existing `destination` property exactly as Plan 1 left it. Do not remove any existing enum values on `type`.

- [ ] **Step 2: Commit**

```bash
git add server/llm/schemas/dm-response-schema.js
git commit -m "feat(llm-schema): add via and mode fields to move_player outcome"
```

---

## Task 10: LLM prompt updates

**Files:**
- Modify: `server/llm/context/action-prompt-builder.js`

- [ ] **Step 1: Locate the existing move_player prompt block**

The Plan 1 Task 7 commit (`a9bb834`) added a `PLAYER MOVEMENT (CRITICAL — move_player outcome)` section. Find it — search for `move_player` in the file.

- [ ] **Step 2: Extend the move_player block**

Insert the following text into that existing block (append after the existing `VIOLATION CHECK` line, before any following sections):

```
- OPTIONAL FIELDS on move_player:
    mechanicalOutcome: {
      type: "move_player",
      destination: {...},
      via:  "roads" | "direct" | "<route_uuid>",   // default "roads"
      mode: "walk" | "ride" | "boat" | "fly" | "teleport"  // default "walk"
    }
  - `via="roads"` is the default: the server snaps travel to the nearest road geometry where possible.
  - `via="direct"` when the party is explicitly cutting cross-country, through wilderness, or avoiding roads.
  - `mode="ride"` when the party is mounted, `"boat"` on a ship or river craft, `"fly"` when airborne, `"teleport"` for magical instantaneous travel.

- SETTING-OUT RULE: when emitting a move_player outcome, narrate ONLY the SETTING OUT of the journey — the party saddling up, pushing through the town gates, the first hours on the road. Do NOT narrate arrival. The system will place the party at the destination (or at an interrupt camp if a random encounter fires along the way) and the NEXT turn will see the outcome. This is the same two-phase pattern you already use for attack wind-up vs damage resolution.

- MULTI-DAY HINT: if your narration implies a multi-day journey ("after days on the road", "by the third morning"), trust the system's day counter — do NOT invent specific day numbers. The prompt context will show you the current day.
```

Match the existing indentation and string style (template literal with regular newlines is typical in this file).

- [ ] **Step 3: Sanity check the file parses**

Run: `node -e "import('./server/llm/context/action-prompt-builder.js').then(m => console.log('ok'))"`
Expected: prints `ok`. Fix any syntax error.

- [ ] **Step 4: Run the movement test suite to make sure nothing regressed**

Run: `npm test -- tests/movement/`
Expected: same count as the end of Task 8.

- [ ] **Step 5: Commit**

```bash
git add server/llm/context/action-prompt-builder.js
git commit -m "docs(llm-prompt): add via/mode, setting-out rule, and multi-day hint to move_player"
```

---

## Task 11: Context builder — clockDay + recentTravel

**Files:**
- Modify: `server/llm/context/context-manager.js`

- [ ] **Step 1: Read context-manager.js to locate `buildGameContext`**

The function that assembles the LLM context is around line 255-316. It builds a `context` object with `campaign`, `session`, `party`, `locations`, `npcs`, `encounters`, `geographic`, `chat`, `worldLore`. You'll add `campaign.clockDay` to the existing campaign sub-object and a new top-level `recentTravel` field.

- [ ] **Step 2: Load campaign_clock_days alongside the existing campaign row query**

Find the SQL that loads the campaign (around line 318-330). Add `campaign_clock_days` to the `SELECT` list. Then, where the `campaign` sub-context object is assembled, add:

```js
campaign.clockDay = row.campaign_clock_days ?? 0;
```

Match the existing property-naming style used elsewhere in the file.

- [ ] **Step 3: Add a `loadRecentTravel` helper**

Add a new private helper inside the same file, near the other private query helpers:

```js
async #loadRecentTravel(client, campaignId) {
  const { rows } = await client.query(
    `SELECT pmp.mode,
            pmp.reason,
            pmp.created_at,
            ST_Length(pmp.path) AS distance_pixels
       FROM public.player_movement_paths pmp
       JOIN public.campaign_players cp ON cp.id = pmp.player_id
      WHERE cp.campaign_id = $1
        AND pmp.reason LIKE '[llm]%'
      ORDER BY pmp.created_at DESC
      LIMIT 1`,
    [campaignId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  // Heuristic: extract interrupted flag by checking the last audit row's reason
  return {
    mode: r.mode,
    reason: r.reason,
    distancePixels: Number(r.distance_pixels),
    at: r.created_at,
  };
}
```

Then, in `buildGameContext`, after the existing context is assembled (near the return statement), add:

```js
context.recentTravel = await this.#loadRecentTravel(client, campaignId);
```

- [ ] **Step 4: Add a light test to confirm the new fields appear**

Given `buildGameContext` is complex to unit-test end-to-end, a targeted test on just the two additions is fine. If the file already has a test harness, extend it. Otherwise, verify via manual smoke:

```bash
node -e "
import('./server/llm/context/context-manager.js').then(({ LLMContextManager }) => {
  console.log('loaded ok; has #loadRecentTravel:',
    LLMContextManager.prototype.constructor.toString().includes('loadRecentTravel'));
});
"
```

If the class is not an ESM default export, adjust the import. The intent is just to confirm the file still parses and the new helper is wired in.

- [ ] **Step 5: Commit**

```bash
git add server/llm/context/context-manager.js
git commit -m "feat(llm-context): add campaign.clockDay and recentTravel to game context"
```

---

## Task 12: Frontend — RAF-based token animator

**Files:**
- Create: `components/player-token-animator.ts`

Pure animation helper. No OpenLayers map reference — takes a feature, a polyline, and a duration. Lifecycle managed by the caller.

- [ ] **Step 1: Create the animator module**

Create `components/player-token-animator.ts`:

```ts
import type { Feature } from 'ol';
import { Point } from 'ol/geom';

export interface Waypoint { x: number; y: number; }

interface AnimationState {
  rafId: number;
  cancelled: boolean;
}

function segmentLength(a: Waypoint, b: Waypoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength(points: Waypoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += segmentLength(points[i - 1], points[i]);
  return total;
}

function pointAtFraction(points: Waypoint[], frac: number): Waypoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const f = Math.max(0, Math.min(1, frac));
  const total = polylineLength(points);
  if (total === 0) return { ...points[0] };
  const target = total * f;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = segmentLength(points[i - 1], points[i]);
    if (acc + seg >= target) {
      const t = seg === 0 ? 0 : (target - acc) / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    acc += seg;
  }
  return { ...points[points.length - 1] };
}

/**
 * Track in-flight animations keyed by an arbitrary identifier (playerId).
 * A new animation for the same key cancels the previous one.
 */
export class TokenAnimator {
  private states = new Map<string, AnimationState>();

  /**
   * Animate a feature's Point geometry along `waypoints` over `durationMs`.
   * If prefers-reduced-motion is set, jumps to the final point immediately.
   * Returns a promise that resolves when animation completes OR is cancelled.
   */
  animate(key: string, feature: Feature, waypoints: Waypoint[], durationMs: number): Promise<void> {
    this.cancel(key);

    if (waypoints.length === 0) return Promise.resolve();

    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduced || durationMs <= 0) {
      const last = waypoints[waypoints.length - 1];
      feature.setGeometry(new Point([last.x, last.y]));
      return Promise.resolve();
    }

    const state: AnimationState = { rafId: 0, cancelled: false };
    this.states.set(key, state);

    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (state.cancelled) return resolve();
        const frac = Math.min(1, (now - t0) / durationMs);
        const pt = pointAtFraction(waypoints, frac);
        feature.setGeometry(new Point([pt.x, pt.y]));
        if (frac >= 1) {
          this.states.delete(key);
          return resolve();
        }
        state.rafId = requestAnimationFrame(tick);
      };
      state.rafId = requestAnimationFrame(tick);
    });
  }

  cancel(key: string): void {
    const s = this.states.get(key);
    if (!s) return;
    s.cancelled = true;
    cancelAnimationFrame(s.rafId);
    this.states.delete(key);
  }

  cancelAll(): void {
    for (const key of Array.from(this.states.keys())) this.cancel(key);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add components/player-token-animator.ts
git commit -m "feat(ui): RAF-based token animator for narrative travel"
```

No unit test — RAF + OpenLayers is hard to meaningfully unit-test. Task 13 will hook this up; manual verification in Task 14.

---

## Task 13: Frontend — wire extended payload into map + interrupt badge

**Files:**
- Modify: `components/openlayers-map.tsx`

- [ ] **Step 1: Locate the `player-moved` subscriber**

The subscriber is around `components/openlayers-map.tsx:1842-1865`. It currently calls `loadVisiblePlayers()` on every `player-moved` and `player-teleported` event (causing the token to jump).

- [ ] **Step 2: Import and instantiate the animator**

Near the top of the file, add:

```tsx
import { TokenAnimator, type Waypoint } from './player-token-animator';
import { ANIMATION_DURATION_MS } from '../server/services/movement/travel-config.js';
```

(Frontend imports from server modules may need adjustment depending on your Vite config. If the server path isn't resolvable from the frontend, inline the constant: `const ANIMATION_DURATION_MS = Number(import.meta.env.VITE_ANIMATION_DURATION_MS ?? 2500);`.)

Inside the main map component, alongside other refs, add:

```tsx
const animatorRef = useRef<TokenAnimator | null>(null);
if (!animatorRef.current) animatorRef.current = new TokenAnimator();
```

And in the effect's cleanup (where other subscribers are torn down):

```tsx
return () => {
  animatorRef.current?.cancelAll();
  // ...existing cleanup...
};
```

- [ ] **Step 3: Extend the `player-moved` handler**

Replace the existing `player-moved` listener's body with:

```tsx
socket.on('player-moved', async (payload: any) => {
  const waypoints: Waypoint[] | undefined = payload?.path?.waypoints;
  const playerId = payload?.playerId;
  if (waypoints && waypoints.length >= 2 && playerId) {
    const feature = playerTokenLayerRef.current
      ?.getSource()
      ?.getFeatureById(playerId);
    if (feature) {
      await animatorRef.current?.animate(
        playerId, feature, waypoints, ANIMATION_DURATION_MS,
      );
    }
  }
  // Always refresh visible players after animation to reconcile any other state.
  loadVisiblePlayers();

  if (payload?.travel?.interrupted) {
    setInterruptBadge({
      playerId,
      day: payload?.travel?.daysElapsed,
      at: payload?.path?.waypoints?.slice(-1)[0],
    });
    // Auto-dismiss on next move for this player.
  } else {
    setInterruptBadge(null);
  }
});
```

The `playerTokenLayerRef` is the existing ref for the player-token vector layer (loadVisiblePlayers builds it). If the current code keeps features in a different structure, adapt `getFeatureById` accordingly — the essential contract is "find the token feature for this playerId".

Add a new local state hook at the top of the component (near other `useState` calls):

```tsx
const [interruptBadge, setInterruptBadge] = useState<{
  playerId: string; day: number; at?: { x: number; y: number };
} | null>(null);
```

- [ ] **Step 4: Render the interrupt badge**

Inside the component's JSX (near the existing overlays / status UI), add:

```tsx
{interruptBadge && (
  <div
    style={{
      position: 'absolute',
      top: 16, right: 16,
      padding: '6px 10px',
      background: 'rgba(30,30,30,0.85)',
      color: 'white',
      borderRadius: 6,
      fontSize: 13,
      pointerEvents: 'auto',
      cursor: 'pointer',
    }}
    onClick={() => setInterruptBadge(null)}
  >
    {'⛺ '}
    <strong>Day {interruptBadge.day}</strong> — journey interrupted (click to dismiss)
  </div>
)}
```

Match the existing style conventions of the file (if it uses CSS classes, Tailwind, or styled-components, use that instead of inline styles).

- [ ] **Step 5: Sanity-check the file compiles**

Run: `npx tsc --noEmit components/openlayers-map.tsx components/player-token-animator.ts` (or whatever the project's type-check command is).
Expected: no type errors.

If the project does not have a typecheck script and the file is large, at least confirm the dev build boots. The user can visually verify in Task 14.

- [ ] **Step 6: Commit**

```bash
git add components/openlayers-map.tsx
git commit -m "feat(ui): animate player token along travel polyline + interrupt badge"
```

---

## Task 14: E2E integration + manual verification

**Files:**
- Modify: `tests/movement/narrative-movement.e2e.test.js`

- [ ] **Step 1: Extend the existing e2e test**

The Plan 1 e2e test at `tests/movement/narrative-movement.e2e.test.js` asserts basic move + mapLevel change. Extend it with Plan 2 assertions. Add a second skipped-by-default test after the existing one:

```js
const skipIfNoFixtures = (
  process.env.TEST_CAMPAIGN_ID &&
  process.env.TEST_SESSION_ID &&
  process.env.TEST_ACTING_CHAR_ID
) ? test : test.skip;

skipIfNoFixtures('Plan 2: move_player inserts polyline + advances clock', async () => {
  const { getClient } = await import('../../server/db/pool.js');
  const { applyMechanicalOutcome } = await import('../../server/services/dm-action/service.js');

  const client = await getClient();
  const wsServer = { broadcastToCampaign: jest.fn() };

  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT campaign_clock_days FROM public.campaigns WHERE id = $1`,
      [process.env.TEST_CAMPAIGN_ID],
    );

    await applyMechanicalOutcome(client, {
      sessionId: process.env.TEST_SESSION_ID,
      actingCharacterId: process.env.TEST_ACTING_CHAR_ID,
      mechanicalOutcome: {
        type: 'move_player',
        destination: { kind: 'burg', ref: process.env.TEST_BURG_NAME ?? 'TestBurg' },
        via: 'roads',
        mode: 'walk',
      },
      wsServer,
    });

    const after = await client.query(
      `SELECT campaign_clock_days FROM public.campaigns WHERE id = $1`,
      [process.env.TEST_CAMPAIGN_ID],
    );
    expect(after.rows[0].campaign_clock_days).toBeGreaterThanOrEqual(before.rows[0].campaign_clock_days);

    const path = await client.query(
      `SELECT ST_NumPoints(path) AS pts FROM public.player_movement_paths
         WHERE campaign_id = $1
         ORDER BY created_at DESC LIMIT 1`,
      [process.env.TEST_CAMPAIGN_ID],
    );
    expect(path.rows[0].pts).toBeGreaterThanOrEqual(2);

    expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith(
      process.env.TEST_CAMPAIGN_ID,
      'player-moved',
      expect.objectContaining({ path: expect.any(Object), travel: expect.any(Object) }),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release?.();
  }
});
```

- [ ] **Step 2: Run the full movement test suite**

Run: `npm test -- tests/movement/`
Expected: the existing 12 tests + Plan 2 additions pass (total ≈ 32-35 tests), plus 2 skipped (Plan 1 e2e + Plan 2 e2e).

- [ ] **Step 3: Manual verification in a live session**

Start the dev server. In an active campaign with a calibrated world (set `maps_world.pixels_per_mile` via a one-off SQL update, or rely on fallback speeds):

1. Via chat: "I lead the party east along the King's Road toward Harrowick."
2. Expected:
   - Token animates along the computed polyline (~2.5s visual).
   - If the journey is >1 day, observe whether any camp encounters fire.
   - `campaign_clock_days` in the DB increments.
   - Next turn's LLM response should reference "Day N" if the prompt pulls in `clockDay`.
3. Try: "We cut directly across the fields." — verify the narration shows `via: 'direct'` behavior (straight line).
4. Try: "The party rides hard." — verify `mode: 'ride'` halves the day count compared to walking.
5. Set `prefers-reduced-motion: reduce` in browser dev tools; verify the token jumps instantly on the next move.

- [ ] **Step 4: Commit**

```bash
git add tests/movement/narrative-movement.e2e.test.js
git commit -m "test(movement): Plan 2 e2e smoke — polyline + clock advance"
```

---

## Self-Review Checklist

**Spec coverage:**

- [x] `maps_world.pixels_per_mile` + `campaigns.campaign_clock_days` columns — Task 1.
- [x] `travel-config.js` with speed tables, snap threshold, animation duration — Task 2.
- [x] Pure `planTravel` for direct/teleport/fly + speed math — Task 3.
- [x] Road-snap same-route path via `ST_ClosestPoint` + `ST_LineSubstring` + `ST_LineLocatePoint` — Task 4.
- [x] Fallback to direct line when endpoints snap to different routes; forced-route via uuid; camp points — Task 5.
- [x] `performPlayerMovement` accepts `pathWaypoints` + `gameDaysElapsed`, writes polyline, bumps clock atomically — Task 6.
- [x] `evaluateEncounterAtPoint` sibling in `proactive-generator.js` — Task 7.
- [x] `applyNarrativeMove` integrates plan + camp loop + truncation + broadcast — Task 8.
- [x] `via` + `mode` fields on the DM schema — Task 9.
- [x] Setting-out rule + via/mode docs + multi-day hint in the prompt — Task 10.
- [x] `campaign.clockDay` + `recentTravel` in LLM context — Task 11.
- [x] Frontend RAF animator — Task 12.
- [x] Frontend wiring + interrupt badge — Task 13.
- [x] E2E smoke + manual verification — Task 14.

**Type consistency:**
- `TravelPlan` shape (`waypoints, distancePixels, distanceMiles, totalDays, campPoints, effectiveVia, dailyPixels`) used consistently across Tasks 3-5, 8.
- `Waypoint = {x, y}` used in the planner AND the frontend animator.
- `camp = {x, y, day}` shape consistent across Task 5 (planner output) and Task 8 (encounter loop / truncation).
- `applyNarrativeMove` summary shape extends Plan 1's — all Plan 1 fields preserved, Plan 2 adds `path`, `travel`, `clockDay`, `encounter`.
- `source: 'llm'` unchanged from Plan 1.

**Known open items for the executing engineer:**
1. **`player_movement_paths.mode` enum.** The existing schema constrains `mode` to `walk/ride/boat/fly/teleport/gm`. Plan 2 prompts the LLM to pick from `walk/ride/boat/fly/teleport` — all valid. `gm` remains DM-only.
2. **Frontend import of ANIMATION_DURATION_MS from the server module.** Depending on Vite setup, the server-side JS module may not be resolvable. The Task 13 step includes a fallback (`import.meta.env.VITE_ANIMATION_DURATION_MS`) — use whichever works in this codebase.
3. **`recentTravel` context is currently `LIKE '[llm]%'`-filtered on `player_movement_paths.reason`.** This leverages the `[llm]` prefix that Plan 1 Task 4 added. If that prefix is ever changed, this query breaks.
4. **The camp-point encounter probability model** is the same as the existing `evaluateEncounterChance` (5% base, 25% in encounter regions). On a 7-day journey with 6 camp points, that's >1 interruption on average. If playtest finds this too frequent, tune via env vars or by lowering the base probability inside `evaluateEncounterAtPoint`.
5. **Forced-route via uuid** currently uses the route regardless of snap distance. If an LLM passes a bogus uuid, the query returns no rows and the fallback kicks in → effectiveVia becomes `'direct'`. That's the right degradation; no additional error-handling needed.
