# Narrative Player Movement — Plan 2 (Route-Snapping + Travel-Time) Design

**Date:** 2026-04-17
**Status:** Design approved, pending implementation plan
**Depends on:** Plan 1 MVP (merged at `492549f`, 2026-04-17)
**Blocks:** Plan 3 (gate geometry + settlement view) — not strictly required, but Plan 3's gate-picker benefits from the approach-vector computed here.

---

## Goal

Turn the current "jump to burg centroid" behavior of Plan 1 into a realistic travel experience: paths that follow roads where possible, journeys that consume in-game days, and multi-day trips that can be interrupted by random encounters along the way. The player token animates along the computed route.

## What the user experiences

1. The LLM narrates "The party sets out east along the King's Road toward Harrowick" and emits `mechanicalOutcome: {type: 'move_player', destination: {kind: 'burg', ref: 'Harrowick'}, via: 'roads', mode: 'ride'}`.
2. The server computes a snapped route along the `maps_routes` geometry, calculates travel time (e.g., "38 miles at 40 mi/day mounted = 1 day"), and rolls for proactive encounters at each day's camp point along the way.
3. If no encounter fires, the token animates along the road on the player's map over a couple of seconds and lands at Harrowick. The campaign clock advances by 1 day. Next turn, the LLM narrates arrival.
4. If an encounter fires (e.g., on night 2 of a 3-day trip), the token lands at that camp instead of Harrowick, the clock advances by 2 days, and the next turn begins with the encounter instead of the arrival.

## Non-goals

- **Graph pathfinding across the route network.** Snap-and-stitch only: if both endpoints snap to the same route, use that route's geometry between them; otherwise fall back to a direct line.
- **Hour-granularity time tracking.** The clock is integer days only.
- **Weather / time-of-day / calendar.** Those are outside this plan; if added later they layer on top of `campaign_clock_days`.
- **Multi-turn "in-transit" state.** Every narrative move resolves in a single turn (with possible interrupt to a camp); the party is never in an ambiguous "still travelling" limbo.
- **Per-campaign speed overrides via UI.** Defaults live in config; campaign-level overrides are a follow-on if needed.
- **Gate/entrance resolution.** That's Plan 3. For Plan 2, arrival at a burg lands at the burg centroid (same as Plan 1).

---

## Architecture

Three coordinated pieces, all built on top of Plan 1:

1. **`travel-planner.js` — pure function.** Takes `(worldId, start, end, mode, via)` and returns a `TravelPlan` (waypoints, distance, total days, camp points, effectiveVia). No DB writes. No session/campaign lookups. Only reads from `maps_routes` and `maps_world.pixels_per_mile`.
2. **Extended orchestrator `applyNarrativeMove`.** Adds a day-by-day encounter-check loop over the plan's camp points, truncates the plan when interrupted, and calls `performPlayerMovement` with the effective endpoint + polyline waypoints + days elapsed.
3. **Frontend animation.** OpenLayers token animates along `path.waypoints` via `requestAnimationFrame`. Decoupled from in-game duration: a fixed visual duration (~2.5s) regardless of days travelled.

Design property: the travel planner is a pure function. Same inputs always produce the same plan. Unit-testable with fixture `maps_routes` rows and no auth plumbing.

### Data flow

```
LLM emits move_player
        ↓
applyMechanicalOutcome  (server/services/dm-action/service.js — from Plan 1)
        ↓
applyNarrativeMove      (server/services/movement/narrative-movement.js — extended)
        ├─ resolveDestination()          Plan 1, unchanged
        ├─ loadPlayerPosition()          existing helper
        ├─ planTravel()                  Plan 2 NEW (Section: Travel planner)
        ├─ walkCampsForEncounter()       Plan 2 NEW (Section: Encounter loop)
        ├─ performPlayerMovement(...)    extended — accepts pathWaypoints + gameDaysElapsed
        └─ broadcast player-moved        extended payload
```

---

## Data model changes

One migration, two columns. No new tables.

```sql
-- database/migrations/00X_plan2_travel.sql
ALTER TABLE public.maps_world
  ADD COLUMN IF NOT EXISTS pixels_per_mile DOUBLE PRECISION;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS campaign_clock_days INTEGER NOT NULL DEFAULT 0
    CHECK (campaign_clock_days >= 0);
```

**`maps_world.pixels_per_mile`** — NULLABLE. When null, the travel planner uses config-default "pixels per day per mode" (so worlds without calibration still work — just with pixel-native speeds). When set, the planner converts D&D miles/day to pixels via this value.

**`campaigns.campaign_clock_days`** — monotonic day counter. Existing campaigns start at 0. Incremented atomically as part of each narrative-movement transaction by `ceil(miles_actually_travelled / daily_mph_for_mode)`. "Actually travelled" means miles up to the arrival or interrupt camp — not the full requested distance.

Defaults live in a new `server/services/movement/travel-config.js`:
```js
export const DAILY_MILES_PER_MODE = {
  walk: 24, ride: 40, boat: 48, fly: 80, teleport: Infinity,
};
export const FALLBACK_PIXELS_PER_DAY = {
  walk: 500, ride: 833, boat: 1000, fly: 1667, teleport: Infinity,
};
export const ROUTE_SNAP_THRESHOLD_PIXELS = 40;
export const ANIMATION_DURATION_MS = 2500;
```

Each is overridable via env var (`QUESTABLES_DAILY_MILES_WALK`, `QUESTABLES_ROUTE_SNAP_THRESHOLD_PIXELS`, etc.).

No changes to `player_movement_paths` — its existing `LineStringZ` + `mode` columns already handle multi-waypoint paths.

---

## Module: `travel-planner.js`

**Location:** `server/services/movement/travel-planner.js`

**Single export:** `planTravel({ client, worldId, start, end, mode, via })`

**Return shape:**

```ts
type TravelPlan = {
  waypoints:       { x: number, y: number }[];   // polyline from start to end, ≥2 points
  distancePixels:  number;                         // sum of Euclidean segment lengths
  distanceMiles:   number | null;                  // null when pixels_per_mile is null on this world
  totalDays:       number;                         // >= 0; 0 only for teleport or zero-distance
  campPoints:      { x: number, y: number, day: number }[]; // day 1, 2, ... totalDays-1
  effectiveVia:    'roads' | 'direct' | string;    // what was actually used; route_uuid if via was a specific route
  dailyPixels:     number;                         // derived daily speed used for the plan
};
```

### Algorithm

1. **Resolve daily pixels per mode:**
   - `teleport` → Infinity (will produce `totalDays = 0`, single-point polyline).
   - `fly` → straight line regardless of `via`. Use `FALLBACK_PIXELS_PER_DAY.fly`.
   - Otherwise: if `maps_world.pixels_per_mile` is non-null, `dailyPixels = DAILY_MILES_PER_MODE[mode] × pixels_per_mile`. Else `dailyPixels = FALLBACK_PIXELS_PER_DAY[mode]`.

2. **Build the path polyline:**
   - `via === 'direct'` or `mode === 'fly'` or `mode === 'teleport'`: `waypoints = [start, end]`.
   - `via === 'roads'` (default):
     - SQL: find nearest route to `start` within `ROUTE_SNAP_THRESHOLD_PIXELS` (GIST-indexed `ST_Distance`). Capture `route_id`, snap point (`ST_ClosestPoint`), and line location (`ST_LineLocatePoint` → fraction 0..1).
     - Same for `end`.
     - If both snap AND share the same `route_id`: `ST_LineSubstring(geom, frac_start, frac_end)` (swap if frac_start > frac_end), extract points as the middle segment, prepend `start`, append `end`. `effectiveVia = 'roads'`.
     - Else (either endpoint fails to snap, or they snap to different routes): fall back to `waypoints = [start, end]`, `effectiveVia = 'direct'`. Honest about what happened.
   - `via === <route_uuid>`: force-snap both endpoints to that specific route. If either fails the threshold, still use that route (LLM was explicit). `effectiveVia = <route_uuid>`.

3. **Distance:** sum Euclidean segment lengths of the final polyline (JS, not PostGIS — path is small).

4. **Miles:** `distancePixels / pixels_per_mile` if calibration exists, else `null`.

5. **Days:** `Math.max(0, Math.ceil(distancePixels / dailyPixels))`; but if `distancePixels > 0` and `dailyPixels !== Infinity`, minimum is `1`. Teleport stays at `0`.

6. **Camp points:** For each day in `[1, totalDays - 1]`, compute the point along the polyline at fractional distance `day × dailyPixels / distancePixels`. Walk cumulative segment lengths, interpolate within the containing segment. Return `[{x, y, day}]`. A 1-day journey has no camp points.

### PostGIS queries issued

Two per call in the `via === 'roads'` case (one nearest-route lookup per endpoint). Zero in the direct/fly/teleport cases. Small enough that no caching is warranted for MVP.

### Error handling

- `worldId` unknown → throw `{ code: 'invalid_world', status: 400 }`.
- Unsupported `mode` → throw `{ code: 'invalid_mode', status: 400 }`.
- Unsupported `via` kind → throw `{ code: 'invalid_via', status: 400 }`.
- Route-snap failure is NOT an error — it's a graceful fallback to `effectiveVia='direct'`.

---

## Orchestrator: extended `applyNarrativeMove`

**Location:** `server/services/movement/narrative-movement.js` (extend the existing Plan 1 module).

**New flow:**

```js
export async function applyNarrativeMove(client, opts) {
  const resolved = await resolveDestination(client, { campaignId, destination });

  const current = await loadPlayerPosition(client, { campaignId, playerId });
  const worldId = await loadWorldIdForCampaign(client, campaignId);

  const plan = await planTravel(client, {
    worldId,
    start: current,
    end:   { x: resolved.x, y: resolved.y },
    mode:  opts.mode ?? 'walk',
    via:   opts.via ?? 'roads',
  });

  const { interruptedAt, dayReached, encounter } = await walkCampsForEncounter(client, {
    campaignId, playerId, plan,
  });

  // Truncate plan if interrupted
  const { effectiveEnd, effectiveWaypoints, daysElapsed } =
    interruptedAt
      ? truncatePlanAtCamp(plan, interruptedAt)
      : { effectiveEnd: plan.waypoints[plan.waypoints.length - 1],
          effectiveWaypoints: plan.waypoints,
          daysElapsed: plan.totalDays };

  const moveResult = await performPlayerMovement({
    client, campaignId, playerId,
    requestorUserId: opts.requestorUserId,
    requestorRole: 'llm',
    targetX: effectiveEnd.x,
    targetY: effectiveEnd.y,
    mode: opts.mode ?? 'walk',
    reason: opts.reason ?? 'llm narrative move',
    source: 'llm',
    pathWaypoints:   effectiveWaypoints,   // NEW
    gameDaysElapsed: daysElapsed,          // NEW
  });

  const newClockDay = await readClockDay(client, campaignId);

  const summary = {
    // ... existing Plan 1 summary fields ...
    path: {
      waypoints: effectiveWaypoints,
      distancePixels: plan.distancePixels,
      distanceMiles: plan.distanceMiles,
      mode: opts.mode ?? 'walk',
    },
    travel: {
      totalDaysPlanned: plan.totalDays,
      daysElapsed,
      interrupted: interruptedAt !== null,
      effectiveVia: plan.effectiveVia,
    },
    clockDay: newClockDay,
    encounter: encounter ?? null,
  };

  if (opts.wsServer?.broadcastToCampaign) { /* broadcast with summary */ }
  return summary;
}
```

### `walkCampsForEncounter`

```js
async function walkCampsForEncounter(client, { campaignId, playerId, plan }) {
  for (const camp of plan.campPoints) {
    const encounter = await proactiveGenerator.checkAt(client, {
      campaignId, playerId, x: camp.x, y: camp.y, dayIndex: camp.day,
    });
    if (encounter) {
      return { interruptedAt: camp, dayReached: camp.day, encounter };
    }
  }
  return { interruptedAt: null, dayReached: plan.totalDays, encounter: null };
}
```

`proactive-generator.js` currently reads `cp.loc_current` to determine position. We extend it (or add a sibling `checkAt`) that accepts explicit `(x, y)` so the camp check doesn't require temporarily moving the player. Side-effects (encounter-row inserts, trigger logs) happen only when an encounter actually triggers — the check itself is read-only, the write happens inside the same transaction as the move.

### `truncatePlanAtCamp`

Given a `plan` and a camp point `{x, y, day}`:
- Find the polyline segment that contains the camp (walking cumulative lengths).
- Build `effectiveWaypoints` = all points up to and including the camp's segment start, then append the camp point itself.
- `daysElapsed = camp.day`.
- `effectiveEnd = camp`.

---

## Extension to `performPlayerMovement`

**Location:** `server/services/campaigns/service.js` (the function that Plan 1 already extended with `source`).

Two new optional parameters:

- **`pathWaypoints: {x: number, y: number}[] | undefined`** — when provided with length ≥ 2, the existing `player_movement_paths` INSERT uses the polyline (LineStringZ) with Z-timestamps evenly distributed across `[previousTimestamp, nowTimestamp]`, replacing today's 2-point line. When omitted (DM-drag), today's behavior is preserved.

- **`gameDaysElapsed: number | undefined`** — when a positive integer is provided, the transaction adds `UPDATE public.campaigns SET campaign_clock_days = campaign_clock_days + $N WHERE id = $1` after the player update, before commit. When omitted or zero, clock is untouched.

Both are purely additive; DM-drag callers continue to work unchanged.

The `player_movement_audit` row remains the same shape — it already captures source, reason, and previous/new positions. No additional audit columns needed (the polyline detail lives in `player_movement_paths`).

---

## LLM prompt + context changes

### Prompt (action-prompt-builder.js)

Add a new block next to the existing Plan 1 `move_player` guidance:

- **Setting-out rule:** "When emitting a `move_player` outcome, narrate only the SETTING OUT of the journey — the party saddling up, pushing through the gates, the first hours of the road. Do NOT narrate arrival. The system will place the party at the destination (or an interrupt camp) and the NEXT turn will see the outcome. This mirrors how you handle attack wind-up vs damage resolution."
- **Via and mode fields:** document the new optional fields.
  - `via: 'roads' | 'direct' | '<route_uuid>'` (default `'roads'`). Use `'direct'` when the party is explicitly cutting cross-country.
  - `mode: 'walk' | 'ride' | 'boat' | 'fly' | 'teleport'` (default `'walk'`). Pick based on party state — mounted = `'ride'`, on a ship = `'boat'`, etc.
- **Multi-day hint:** "If your narration implies a multi-day journey ('after days on the road', 'by the third morning'), trust the system's day counter. Do NOT invent specific day numbers — the system tracks them."

### Schema (dm-response-schema.js)

Add optional `via` and `mode` properties on `mechanicalOutcome` (siblings to the existing `destination`). No new `type` values — still just `move_player`.

### Context (context-manager.js)

Two additions to `buildGameContext`:

- **`campaign.clockDay`** — reads `campaign_clock_days`, surfaces in the prompt header as "Day 12" or similar.
- **`recentTravel`** — when the most recent committed action was a narrative move, include `{daysElapsed, distanceMiles, mode, effectiveVia, interrupted, encounterId?}`. Sourced from the latest `player_movement_paths` row plus the clock delta vs. the prior audit row. Lets the LLM say "after three days on the road" without hallucinating, and prevents re-narrating the journey.

---

## Frontend animation

**Location:** `components/openlayers-map.tsx` — extend the existing `player-moved` / `player-teleported` subscribers around lines 1842-1865 and add an animation helper module (or inline helper hook).

**Mechanics:**
- `requestAnimationFrame` loop, animation state held in a ref-map keyed by `playerId`.
- Each frame: `t = elapsed / ANIMATION_DURATION_MS`. Walk cumulative segment lengths of `path.waypoints`; compute interpolated point. `feature.setGeometry(new Point([x, y]))`.
- Final frame sets geometry to the exact end waypoint (avoid floating-point drift).

**Cancellation:**
- New `player-moved` for the same player mid-animation: cancel the in-flight RAF. Start a fresh animation from the token's **current rendered position** (not from the previous animation's start) to the new destination. This avoids visible teleport-and-replay.
- Component unmount: cancel all animations.

**Duration:** fixed `ANIMATION_DURATION_MS` (2500ms default; exposed as a Vite env var). A 7-day journey animates in the same 2.5s as a 1-day journey. In-game time is narrative, not visual.

**Trail rendering during animation:** a transient highlighted polyline layer traces the already-traversed portion of `path.waypoints`. After the animation completes, the trail fades over ~3 seconds. The existing `refreshTrailForPlayer` persistent trail (for the DM's "where has this player been" view) is untouched.

**Interrupted journeys:** when the broadcast payload has `travel.interrupted === true`, the animation stops at the camp point (`path.waypoints[last]`, which was already truncated server-side). A small badge appears near the token: "⛺ day {daysElapsed}" — auto-dismissed on the next `player-moved`.

**Accessibility:** respect `prefers-reduced-motion` — when set, skip the animation entirely and jump to the end (matches today's behavior).

---

## Transaction safety

All of the following happen in one `BEGIN / COMMIT`:
1. `SELECT ... FOR UPDATE` on `campaign_players` (existing)
2. `UPDATE campaign_players SET loc_current, inside_burg_id, current_map_level` (existing)
3. `UPDATE campaigns SET campaign_clock_days` (NEW)
4. `INSERT INTO player_movement_audit` (existing)
5. `INSERT INTO player_movement_paths` (existing; polyline instead of 2-point line)
6. Any encounter-trigger INSERTs from `proactive-generator` (existing semantics)

An error at any step rolls the entire thing back — no half-moved party with an advanced clock, no interrupt camp recorded without the encounter row, no polyline without the position update.

The `wsServer.broadcastToCampaign` call happens OUTSIDE the transaction (after commit) — same pattern as Plan 1. Broadcast failure is best-effort; clients reconcile on next fetch.

---

## Testing approach

**Unit, `tests/movement/travel-planner.test.js`:**
- Direct via → 2-point polyline, `effectiveVia='direct'`.
- Both endpoints on same route (fixture `maps_routes` row) → `ST_LineSubstring` path with intermediate vertices, `effectiveVia='roads'`.
- Endpoints on different routes → `effectiveVia='direct'` fallback.
- Teleport mode → `totalDays=0`, single-point waypoints.
- Fly mode → always direct line regardless of `via`.
- Camp-point math: 3-day journey returns 2 camp points at fractions 1/3 and 2/3.
- Speed resolution: with `pixels_per_mile=10` and `mode='walk'`, `dailyPixels = 240`. Without calibration, `dailyPixels = FALLBACK_PIXELS_PER_DAY.walk`.
- Forced specific-route via `via: <route_uuid>`: uses that route even if snap threshold would have failed.
- Zero-distance (start === end): `totalDays=0`, single-point polyline.

**Unit, `tests/movement/narrative-movement.test.js` (extended):**
- No-encounter happy path: full arrival, full `daysElapsed`, polyline has all plan waypoints.
- Encounter on day 2 of 3: interrupted at `campPoints[1]`, `daysElapsed=2`, polyline truncated, encounter included in summary.
- Clock advances atomically: mocked `UPDATE campaigns` is called with correct increment.
- `performPlayerMovement` receives `pathWaypoints` and `gameDaysElapsed`.

**Unit, `tests/movement/perform-player-movement-path.test.js` (new):**
- `pathWaypoints` provided → `player_movement_paths` INSERT uses the polyline.
- `gameDaysElapsed` provided → `UPDATE campaigns SET campaign_clock_days` fires.
- Neither provided (DM-drag path) → behavior identical to Plan 1.

**Integration, `tests/movement/narrative-movement.integration.test.js`:**
- Simulated failure mid-transaction (e.g., `UPDATE campaigns` throws): player position is unchanged, clock is unchanged, no rows inserted.

**E2E smoke (skipped by default unless fixtures present), `tests/movement/narrative-movement.e2e.test.js`:**
- Extends the Plan 1 e2e test. Real DB with seeded world + routes. Assert: polyline inserted with ≥3 points (snap + substring + end), `campaign_clock_days` advanced by expected days, `player_movement_paths.mode` correct.

**Frontend — manual verification in the browser:**
- Emit a `player-moved` event with `path.waypoints` via the dev tools; confirm the token animates.
- Emit a second event mid-animation; confirm the first is cancelled and the token continues from current position.
- Set `prefers-reduced-motion: reduce`; confirm the token jumps instantly.

---

## Open follow-ons (explicitly NOT in this plan)

- **Plan 3 — gate geometry + settlement view handoff + building-to-building movement.** Needs its own brainstorming and spec.
- **Route-network graph pathfinding.** If snap-and-stitch produces too many awkward "fell back to direct" results in practice, swap `travel-planner` to a real graph search. Planner's pure-function signature makes this a drop-in replacement.
- **Per-campaign speed overrides.** If DMs want to tune daily miles per campaign (gritty realism, heroic pace), add `campaigns.travel_speed_overrides JSONB`.
- **Hour-granularity clock.** Bigger scope — splits `campaign_clock_days` into `campaign_clock_minutes` with phase-of-day derived. Would affect existing narration infrastructure.
- **Forced march / exhaustion mechanics.** D&D has rules for pushing beyond 8 hours. Adds a `travel_pace` concept not covered here.
- **Weather affecting speed.** Currently no weather model at all.

---

## Assumptions and risks

- **Route geometry quality.** If `maps_routes` linestrings are short and disconnected (typical of FMG exports), snap-and-stitch will fall back to direct line often. Worth measuring on the user's actual world before investing in graph pathfinding.
- **Camp-point encounter frequency.** If `proactive-generator` has a high trigger rate, multi-day journeys will almost always be interrupted. May need to tune per-camp trigger probability down from whatever "moved to new position" uses.
- **LLM adherence to "setting-out only" rule.** Prompt engineering is probabilistic. A VIOLATION CHECK (like Plan 1's item_gain) makes compliance more likely but not certain. Worth post-merge monitoring.
- **Animation jank on slow devices.** `requestAnimationFrame` degrades gracefully, but a long polyline with many vertices might cause frame drops. Acceptable for MVP; can optimize if it surfaces.
