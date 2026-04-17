# Narrative Player Movement — Plan 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the DM LLM narrates the party travelling to a new location, the player's token actually moves — updating `loc_current`, toggling `current_map_level` on burg arrival, and broadcasting the change to all clients. This replaces the current write-only narrative-movement pathway.

**Architecture:** Add a `move_player` case to the existing `applyMechanicalOutcome` dispatcher. A new `destination-resolver` converts an LLM-emitted destination (`{kind, ref}`) into world-pixel coordinates + target burg metadata. A thin `narrative-movement` orchestrator resolves the destination, calls the existing `performPlayerMovement` (extended to accept `source: 'llm'` so it bypasses the DM-only role gate), and broadcasts `player-moved` with a `mapLevel` field. Direct-line movement only in this plan — route snapping (Plan 2) and gate geometry (Plan 3) are deferred.

**Tech Stack:** Node/Express (ESM), PostgreSQL + PostGIS, Jest (`node --experimental-vm-modules jest`), Socket.IO (via `wsServer.broadcastToCampaign`).

**Scope boundaries (NOT in this plan):**
- Route-network snapping (Plan 2)
- Per-day travel-time accounting (Plan 2)
- Gate/entrance picking by approach vector (Plan 3)
- Frontend settlement-view swap animation (Plan 3)
- Building-to-building movement inside settlement view (Plan 3)

**Related files (for orientation):**
- `server/services/dm-action/service.js:397-697` — outcome dispatcher
- `server/services/campaigns/service.js:141-346` — `performPlayerMovement`
- `server/routes/campaigns.routes.js:836-950` — existing HTTP move endpoint + broadcast shape
- `server/llm/schemas/dm-response-schema.js:12-50` — outcome schema
- `server/llm/context/action-prompt-builder.js:108-155` — LLM outcome instructions
- `database/schema.sql:118-198` — `maps_burgs`, `maps_routes`, `maps_markers`
- `database/schema.sql:295-315` — `campaign_players`

---

## File Structure

**New files:**
- `server/services/movement/destination-resolver.js` — one export `resolveDestination`, no side effects
- `server/services/movement/narrative-movement.js` — one export `applyNarrativeMove`, orchestrates resolve → move → broadcast
- `tests/movement/destination-resolver.test.js`
- `tests/movement/narrative-movement.test.js`
- `tests/movement/move-player-outcome.test.js`

**Modified files:**
- `server/llm/schemas/dm-response-schema.js` — add `move_player` to type enum, add `destination` field
- `server/services/campaigns/service.js` — add `source` param to `performPlayerMovement`
- `server/services/dm-action/service.js` — add `case 'move_player':` to switch; thread `campaignId`, `wsServer` through `applyMechanicalOutcome` signature
- `server/routes/actions.routes.js` — pass `campaignId` + `wsServer` to `applyMechanicalOutcome` call sites
- `server/services/chat/action-interceptor.js` — same threading
- `server/services/combat/enemy-turn-service.js` — same threading
- `server/llm/context/action-prompt-builder.js` — document `move_player` with violation check

---

## Task 1: Add `move_player` to the DM response schema

**Files:**
- Modify: `server/llm/schemas/dm-response-schema.js:12-50`

- [ ] **Step 1: Inspect current schema**

Run: `rg -n "type:\s*\{" server/llm/schemas/dm-response-schema.js | head -5`

Read the file in full to confirm current shape of `mechanicalOutcome`. Expected to see an `enum` array at approximately line 18.

- [ ] **Step 2: Add `move_player` to the type enum and add `destination` field**

Replace the `type` enum and add a sibling `destination` property on `mechanicalOutcome`:

```js
// In server/llm/schemas/dm-response-schema.js, inside mechanicalOutcome.properties:
type: {
  type: 'string',
  enum: [
    'damage', 'healing', 'condition_add', 'condition_remove',
    'item_gain', 'item_lose', 'resource_use',
    'spell_slot_use', 'concentration_start', 'concentration_break',
    'move_player',
  ],
  description: 'The mechanical effect type. Use move_player when narration moves the party to a new location (travelling to a town, entering a building, leaving a scene).',
},
// ...
destination: {
  type: 'object',
  description: 'Required when type === "move_player". Where the party ends up.',
  properties: {
    kind: {
      type: 'string',
      enum: ['burg', 'poi', 'coordinate'],
      description: 'burg = a named settlement in maps_burgs. poi = a named point-of-interest in maps_markers. coordinate = raw world pixel coords.',
    },
    ref: {
      description: 'For kind=burg: the burg name (string) or id (uuid). For kind=poi: the marker note/name. For kind=coordinate: object {x,y}.',
    },
  },
  required: ['kind', 'ref'],
},
```

- [ ] **Step 3: Commit**

```bash
git add server/llm/schemas/dm-response-schema.js
git commit -m "feat(llm-schema): add move_player outcome type with destination field"
```

---

## Task 2: Destination resolver — burg by name/id

**Files:**
- Create: `server/services/movement/destination-resolver.js`
- Test: `tests/movement/destination-resolver.test.js`

- [ ] **Step 1: Write failing test for burg-by-name**

Create `tests/movement/destination-resolver.test.js`:

```js
import { jest } from '@jest/globals';
import { resolveDestination } from '../../server/services/movement/destination-resolver.js';

function makeClient(responses) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const match = responses.find((r) => r.match.test(sql));
      if (!match) throw new Error(`No mock for SQL:\n${sql}`);
      return { rows: typeof match.rows === 'function' ? match.rows(params) : match.rows };
    }),
  };
}

describe('resolveDestination — burg by name', () => {
  test('returns coordinates + burgId for exact burg match', async () => {
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{ id: 'burg-uuid', x: 1234.5, y: 678.9, name: 'Harrowick' }],
      },
    ]);

    const result = await resolveDestination(client, {
      campaignId: 'camp-1',
      destination: { kind: 'burg', ref: 'Harrowick' },
    });

    expect(result).toEqual({
      x: 1234.5,
      y: 678.9,
      burgId: 'burg-uuid',
      mapLevel: 'settlement',
      resolvedName: 'Harrowick',
    });
  });

  test('resolves when ref is a uuid', async () => {
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{ id: '11111111-1111-1111-1111-111111111111', x: 10, y: 20, name: 'X' }],
      },
    ]);

    const result = await resolveDestination(client, {
      campaignId: 'camp-1',
      destination: { kind: 'burg', ref: '11111111-1111-1111-1111-111111111111' },
    });

    expect(result.burgId).toBe('11111111-1111-1111-1111-111111111111');
  });

  test('throws destination_not_found when burg is unknown', async () => {
    const client = makeClient([
      { match: /FROM public\.maps_burgs/, rows: [] },
    ]);

    await expect(
      resolveDestination(client, {
        campaignId: 'camp-1',
        destination: { kind: 'burg', ref: 'Nowhereville' },
      }),
    ).rejects.toMatchObject({ code: 'destination_not_found' });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/movement/destination-resolver.test.js`

Expected: FAIL — "Cannot find module '../../server/services/movement/destination-resolver.js'"

- [ ] **Step 3: Create the resolver with burg support**

Create `server/services/movement/destination-resolver.js`:

```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(message, extra = {}) {
  const err = new Error(message);
  err.status = 404;
  err.code = 'destination_not_found';
  Object.assign(err, extra);
  return err;
}

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'invalid_destination';
  return err;
}

async function resolveBurg(client, campaignId, ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    throw invalid('burg ref must be a non-empty string');
  }
  const isUuid = UUID_RE.test(ref.trim());
  const { rows } = await client.query(
    `SELECT b.id, ST_X(b.geom) AS x, ST_Y(b.geom) AS y, b.name
       FROM public.maps_burgs b
       JOIN public.campaigns c ON c.world_map_id = b.world_id
      WHERE c.id = $1
        AND ($2::boolean
              ? b.id = $3::uuid
              : b.name ILIKE $4)
      LIMIT 1`,
    [campaignId, isUuid, isUuid ? ref.trim() : null, isUuid ? null : ref.trim()],
  );

  if (rows.length === 0) {
    throw notFound(`No burg matching "${ref}" in this campaign's world`);
  }

  const row = rows[0];
  return {
    x: Number(row.x),
    y: Number(row.y),
    burgId: row.id,
    mapLevel: 'settlement',
    resolvedName: row.name,
  };
}

export async function resolveDestination(client, { campaignId, destination }) {
  if (!destination || typeof destination !== 'object') {
    throw invalid('destination is required');
  }
  if (!campaignId) {
    throw invalid('campaignId is required');
  }

  switch (destination.kind) {
    case 'burg':
      return resolveBurg(client, campaignId, destination.ref);
    default:
      throw invalid(`Unsupported destination kind: ${destination.kind}`);
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/movement/destination-resolver.test.js`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/destination-resolver.js tests/movement/destination-resolver.test.js
git commit -m "feat(movement): add destination resolver — burg by name/uuid"
```

---

## Task 3: Destination resolver — coordinate and POI

**Files:**
- Modify: `server/services/movement/destination-resolver.js`
- Modify: `tests/movement/destination-resolver.test.js`

- [ ] **Step 1: Append failing tests for coordinate + POI**

Append to `tests/movement/destination-resolver.test.js`:

```js
describe('resolveDestination — coordinate', () => {
  test('passes through {x,y}', async () => {
    const client = { query: jest.fn() };
    const result = await resolveDestination(client, {
      campaignId: 'camp-1',
      destination: { kind: 'coordinate', ref: { x: 500, y: 300 } },
    });
    expect(result).toEqual({
      x: 500, y: 300, burgId: null, mapLevel: 'world', resolvedName: null,
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('rejects non-finite coords', async () => {
    const client = { query: jest.fn() };
    await expect(
      resolveDestination(client, {
        campaignId: 'camp-1',
        destination: { kind: 'coordinate', ref: { x: 'nope', y: 0 } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_destination' });
  });
});

describe('resolveDestination — poi', () => {
  test('matches marker by note ILIKE', async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ id: 'm1', x: 42, y: 99, note: 'Old Mill' }],
      })),
    };
    const result = await resolveDestination(client, {
      campaignId: 'camp-1',
      destination: { kind: 'poi', ref: 'Old Mill' },
    });
    expect(result).toEqual({
      x: 42, y: 99, burgId: null, mapLevel: 'world', resolvedName: 'Old Mill',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/movement/destination-resolver.test.js`

Expected: FAIL — coordinate/poi cases unhandled in switch.

- [ ] **Step 3: Add coordinate and POI resolvers**

In `server/services/movement/destination-resolver.js`, add above the `export` of `resolveDestination`:

```js
function resolveCoordinate(ref) {
  if (!ref || typeof ref !== 'object') {
    throw invalid('coordinate ref must be an object with x and y');
  }
  const x = Number(ref.x);
  const y = Number(ref.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw invalid('coordinate ref requires finite x and y');
  }
  return { x, y, burgId: null, mapLevel: 'world', resolvedName: null };
}

async function resolvePoi(client, campaignId, ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    throw invalid('poi ref must be a non-empty string');
  }
  const { rows } = await client.query(
    `SELECT m.id, ST_X(m.geom) AS x, ST_Y(m.geom) AS y, m.note
       FROM public.maps_markers m
       JOIN public.campaigns c ON c.world_map_id = m.world_id
      WHERE c.id = $1
        AND m.note ILIKE $2
      ORDER BY length(m.note) ASC
      LIMIT 1`,
    [campaignId, `%${ref.trim()}%`],
  );
  if (rows.length === 0) {
    throw notFound(`No POI matching "${ref}" on this world`);
  }
  const row = rows[0];
  return {
    x: Number(row.x),
    y: Number(row.y),
    burgId: null,
    mapLevel: 'world',
    resolvedName: row.note,
  };
}
```

Then extend the switch in `resolveDestination`:

```js
  switch (destination.kind) {
    case 'burg':
      return resolveBurg(client, campaignId, destination.ref);
    case 'poi':
      return resolvePoi(client, campaignId, destination.ref);
    case 'coordinate':
      return resolveCoordinate(destination.ref);
    default:
      throw invalid(`Unsupported destination kind: ${destination.kind}`);
  }
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/movement/destination-resolver.test.js`

Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/destination-resolver.js tests/movement/destination-resolver.test.js
git commit -m "feat(movement): resolve coordinate and POI destinations"
```

---

## Task 4: Extend `performPlayerMovement` with a `source` parameter

**Files:**
- Modify: `server/services/campaigns/service.js:141-166`

- [ ] **Step 1: Write failing test for LLM-source bypass**

Create `tests/movement/perform-player-movement-source.test.js`:

```js
import { jest } from '@jest/globals';

// Mock snapToGrid and computeDistance to keep test focused on auth/source logic
jest.unstable_mockModule('../../server/services/campaigns/utils.js', () => ({
  snapToGrid: (x, y) => ({ x, y }),
  computeDistance: () => 0,
  pointWithinBounds: () => true,
}));
jest.unstable_mockModule('../../server/services/campaigns/movement-config.js', () => ({
  getMovementConfig: () => ({ gridType: 'none', gridSize: 1, originX: 0, originY: 0 }),
}));

const { performPlayerMovement } = await import('../../server/services/campaigns/service.js');

function makeClient() {
  const rows = {
    currentPlayer: [{
      id: 'p1', user_id: 'u1', campaign_id: 'c1',
      visibility_state: 'visible', last_located_at: new Date(),
      prev_x: 0, prev_y: 0,
    }],
    burgProximity: [],
    updated: [{
      id: 'p1', visibility_state: 'visible',
      geometry: { type: 'Point', coordinates: [10, 20] },
      last_located_at: new Date(),
    }],
    pathInsert: [{ id: 'path-1', created_at: new Date() }],
  };
  return {
    query: jest.fn(async (sql) => {
      if (/FOR UPDATE/.test(sql)) return { rows: rows.currentPlayer };
      if (/ST_DWithin/.test(sql)) return { rows: rows.burgProximity };
      if (/UPDATE public\.campaign_players/.test(sql)) return { rows: [] };
      if (/SELECT id,\s+visibility_state,/.test(sql)) return { rows: rows.updated };
      if (/INSERT INTO public\.player_movement_audit/.test(sql)) return { rows: [] };
      if (/INSERT INTO public\.player_movement_paths/.test(sql)) return { rows: rows.pathInsert };
      if (/FROM public\.maps_world/.test(sql)) return { rows: [{ bounds: null }] };
      return { rows: [] };
    }),
  };
}

test('source=llm bypasses DM-only role check', async () => {
  const client = makeClient();
  const result = await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'player', isRequestorAdmin: false,
    targetX: 10, targetY: 20, mode: 'walk', reason: 'narrative',
    source: 'llm',
  });
  expect(result.player.id).toBe('p1');
});

test('source=dm (default) still enforces DM-only role check', async () => {
  const client = makeClient();
  await expect(
    performPlayerMovement({
      client, campaignId: 'c1', playerId: 'p1',
      requestorUserId: 'u1', requestorRole: 'player', isRequestorAdmin: false,
      targetX: 10, targetY: 20, mode: 'walk',
    }),
  ).rejects.toMatchObject({ code: 'move_forbidden' });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/movement/perform-player-movement-source.test.js`

Expected: FAIL — llm source is still rejected by the DM-only gate.

- [ ] **Step 3: Add `source` parameter to `performPlayerMovement`**

In `server/services/campaigns/service.js`, modify the function signature and auth check (lines 141-166):

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
  source = 'dm',  // NEW: 'dm' | 'llm' | 'player'
}) => {
  if (!MOVE_MODE_SET.has(mode)) {
    const error = new Error(`Unsupported movement mode: ${mode}`);
    error.status = 400;
    error.code = 'invalid_move_mode';
    throw error;
  }

  // LLM-sourced movement bypasses human-role gates — it is trusted by virtue
  // of coming from the narrative pipeline (which has already classified the
  // action and produced a mechanicalOutcome).
  if (source !== 'llm' && !isRequestorAdmin && !DM_CONTROL_ROLES.has(requestorRole)) {
    const error = new Error('Only DMs or co-DMs may move players');
    error.status = 403;
    error.code = 'move_forbidden';
    throw error;
  }

  // ... rest unchanged
```

Also include `source` in the audit `mode` reason line — find the `player_movement_audit` insert at lines 275-293 and widen the `reason` the caller sees. The simplest change is to prefix the reason with `[llm] ` when `source === 'llm'`:

Replace the `reason ?? null` inside the `player_movement_paths` insert (line 327) with:

```js
source === 'llm' ? `[llm] ${reason ?? ''}`.trim() : (reason ?? null),
```

And the same prefix for the `reason` parameter at line 287 in the `player_movement_audit` insert.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/movement/perform-player-movement-source.test.js`

Expected: PASS (both tests).

- [ ] **Step 5: Verify existing movement tests still pass**

Run: `npm test -- tests/ -t "performPlayerMovement"` (if any exist)

Expected: all prior tests green. If no prior tests exist, this is a no-op.

- [ ] **Step 6: Commit**

```bash
git add server/services/campaigns/service.js tests/movement/perform-player-movement-source.test.js
git commit -m "feat(movement): add source param to performPlayerMovement, allow llm source"
```

---

## Task 5: Narrative-movement orchestrator

**Files:**
- Create: `server/services/movement/narrative-movement.js`
- Create: `tests/movement/narrative-movement.test.js`

- [ ] **Step 1: Write failing orchestrator test**

Create `tests/movement/narrative-movement.test.js`:

```js
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/movement/destination-resolver.js', () => ({
  resolveDestination: jest.fn(async () => ({
    x: 500, y: 600, burgId: 'burg-1', mapLevel: 'settlement', resolvedName: 'Harrowick',
  })),
}));

jest.unstable_mockModule('../../server/services/campaigns/service.js', () => ({
  performPlayerMovement: jest.fn(async () => ({
    player: {
      id: 'p1', visibility_state: 'visible',
      geometry: { type: 'Point', coordinates: [500, 600] },
      last_located_at: new Date('2026-04-17T12:00:00Z'),
    },
    requestedDistance: 123,
    requestedTarget: { x: 500, y: 600 },
    snappedTarget: { x: 500, y: 600 },
    grid: { type: 'none', size: 1, origin: { x: 0, y: 0 } },
    pathId: 'path-1',
  })),
}));

const { applyNarrativeMove } = await import('../../server/services/movement/narrative-movement.js');
const { resolveDestination } = await import('../../server/services/movement/destination-resolver.js');
const { performPlayerMovement } = await import('../../server/services/campaigns/service.js');

test('resolves destination, calls performPlayerMovement with source=llm, returns summary', async () => {
  const client = { query: jest.fn() };
  const wsServer = { broadcastToCampaign: jest.fn() };

  const result = await applyNarrativeMove(client, {
    campaignId: 'c1',
    playerId: 'p1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    reason: 'narrative travel',
    wsServer,
  });

  expect(resolveDestination).toHaveBeenCalledWith(client, {
    campaignId: 'c1',
    destination: { kind: 'burg', ref: 'Harrowick' },
  });

  expect(performPlayerMovement).toHaveBeenCalledWith(expect.objectContaining({
    campaignId: 'c1',
    playerId: 'p1',
    targetX: 500,
    targetY: 600,
    source: 'llm',
    requestorRole: 'llm',
  }));

  expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith('c1', 'player-moved', expect.objectContaining({
    playerId: 'p1',
    mapLevel: 'settlement',
    insideBurgId: 'burg-1',
    resolvedName: 'Harrowick',
  }));

  expect(result).toMatchObject({
    playerId: 'p1',
    mapLevel: 'settlement',
    insideBurgId: 'burg-1',
    resolvedName: 'Harrowick',
  });
});

test('works without a wsServer (broadcast is best-effort)', async () => {
  const client = { query: jest.fn() };
  const result = await applyNarrativeMove(client, {
    campaignId: 'c1', playerId: 'p1', requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
  });
  expect(result.playerId).toBe('p1');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/movement/narrative-movement.test.js`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `server/services/movement/narrative-movement.js`:

```js
import { resolveDestination } from './destination-resolver.js';
import { performPlayerMovement } from '../campaigns/service.js';

export async function applyNarrativeMove(client, {
  campaignId,
  playerId,
  requestorUserId,
  destination,
  reason,
  mode = 'walk',
  wsServer = null,
}) {
  const resolved = await resolveDestination(client, { campaignId, destination });

  const result = await performPlayerMovement({
    client,
    campaignId,
    playerId,
    requestorUserId,
    requestorRole: 'llm',
    isRequestorAdmin: false,
    targetX: resolved.x,
    targetY: resolved.y,
    mode,
    reason: reason ?? `narrative: ${destination.kind}:${destination.ref}`,
    enforceClamp: true,
    source: 'llm',
  });

  const summary = {
    playerId: result.player.id,
    geometry: result.player.geometry,
    mapLevel: resolved.mapLevel,
    insideBurgId: resolved.burgId,
    resolvedName: resolved.resolvedName,
    distance: result.requestedDistance,
    pathId: result.pathId,
    updatedAt: result.player.last_located_at,
  };

  if (wsServer?.broadcastToCampaign) {
    try {
      wsServer.broadcastToCampaign(campaignId, 'player-moved', {
        ...summary,
        mode,
        movedBy: requestorUserId,
        reason: reason ?? null,
        target: result.requestedTarget,
        snapped: result.snappedTarget,
        grid: result.grid,
        source: 'llm',
      });
    } catch (err) {
      // best-effort; don't fail the move if broadcast fails
    }
  }

  return summary;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/movement/narrative-movement.test.js`

Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/movement/narrative-movement.js tests/movement/narrative-movement.test.js
git commit -m "feat(movement): narrative-movement orchestrator resolves + moves + broadcasts"
```

---

## Task 6: Hook `move_player` into `applyMechanicalOutcome`

The existing `applyMechanicalOutcome(client, { sessionId, mechanicalOutcome, actingCharacterId })` signature doesn't carry `campaignId` or `playerId`. We need to look them up from `sessionId` + `actingCharacterId`, and we need `wsServer` for the broadcast.

**Files:**
- Modify: `server/services/dm-action/service.js:397-698`
- Modify callers to pass `wsServer`:
  - `server/routes/actions.routes.js:223, 508`
  - `server/services/chat/action-interceptor.js:339`
  - `server/services/combat/enemy-turn-service.js:109`
- Create: `tests/movement/move-player-outcome.test.js`

- [ ] **Step 1: Write failing test for the outcome case**

Create `tests/movement/move-player-outcome.test.js`:

```js
import { jest } from '@jest/globals';

const applyNarrativeMoveMock = jest.fn(async () => ({
  playerId: 'p1', mapLevel: 'settlement', insideBurgId: 'b1', resolvedName: 'Harrowick',
}));

jest.unstable_mockModule('../../server/services/movement/narrative-movement.js', () => ({
  applyNarrativeMove: applyNarrativeMoveMock,
}));

const { applyMechanicalOutcome } = await import('../../server/services/dm-action/service.js');

function makeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM public\.sessions/.test(sql)) return { rows: [{ campaign_id: 'c1' }] };
      if (/FROM public\.campaign_players/.test(sql)) return { rows: [{ id: 'p1', user_id: 'u1' }] };
      return { rows: [] };
    }),
  };
}

test('move_player outcome calls applyNarrativeMove with resolved ids', async () => {
  const client = makeClient();
  const wsServer = { broadcastToCampaign: jest.fn() };

  await applyMechanicalOutcome(client, {
    sessionId: 's1',
    actingCharacterId: 'char-1',
    mechanicalOutcome: {
      type: 'move_player',
      destination: { kind: 'burg', ref: 'Harrowick' },
    },
    wsServer,
  });

  expect(applyNarrativeMoveMock).toHaveBeenCalledWith(client, expect.objectContaining({
    campaignId: 'c1',
    playerId: 'p1',
    destination: { kind: 'burg', ref: 'Harrowick' },
    wsServer,
  }));
});

test('move_player with missing destination returns null and logs', async () => {
  const client = makeClient();
  const result = await applyMechanicalOutcome(client, {
    sessionId: 's1',
    actingCharacterId: 'char-1',
    mechanicalOutcome: { type: 'move_player' },
  });
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/movement/move-player-outcome.test.js`

Expected: FAIL — the switch default branch fires for `move_player`.

- [ ] **Step 3: Add `wsServer` to `applyMechanicalOutcome` signature**

In `server/services/dm-action/service.js` at line 397, extend the destructure:

```js
export const applyMechanicalOutcome = async (client, {
  sessionId,
  mechanicalOutcome,
  actingCharacterId,
  wsServer = null,   // NEW
}) => {
```

- [ ] **Step 4: Add the `move_player` case before the `default:` branch**

In `server/services/dm-action/service.js`, add this case just before `default:` at line 694:

```js
    case 'move_player': {
      const destination = mechanicalOutcome.destination;
      if (!destination || !destination.kind || destination.ref == null) {
        logWarn('move_player outcome missing destination', { sessionId });
        return null;
      }

      // Resolve campaignId from sessionId
      const { rows: sessionRows } = await client.query(
        `SELECT campaign_id FROM public.sessions WHERE id = $1 LIMIT 1`,
        [sessionId],
      );
      if (sessionRows.length === 0) {
        logWarn('move_player: session not found', { sessionId });
        return null;
      }
      const campaignId = sessionRows[0].campaign_id;

      // Resolve campaign_player row from the acting character
      const { rows: playerRows } = await client.query(
        `SELECT id, user_id
           FROM public.campaign_players
          WHERE campaign_id = $1
            AND character_id = $2
            AND status = 'active'
          LIMIT 1`,
        [campaignId, actingCharacterId],
      );
      if (playerRows.length === 0) {
        logWarn('move_player: no active campaign_player for acting character', {
          campaignId, actingCharacterId,
        });
        return null;
      }
      const playerId = playerRows[0].id;

      // Import lazily to avoid a circular dependency with campaigns/service.js
      const { applyNarrativeMove } = await import('../movement/narrative-movement.js');

      const summary = await applyNarrativeMove(client, {
        campaignId,
        playerId,
        requestorUserId: playerRows[0].user_id,
        destination,
        reason: 'llm narrative move',
        wsServer,
      });

      logInfo('move_player applied', summary);
      return summary;
    }
```

- [ ] **Step 5: Update callers to thread `wsServer`**

In `server/routes/actions.routes.js` at lines 223 and 508, find each `applyMechanicalOutcome(asyncClient, { ... })` call and add `wsServer: req.app?.locals?.wsServer ?? null` to the options object.

Example (line 223 area):

```js
await applyMechanicalOutcome(asyncClient, {
  sessionId,
  mechanicalOutcome: dmResponse.mechanicalOutcome,
  actingCharacterId,
  wsServer: req.app?.locals?.wsServer ?? null,   // NEW
});
```

In `server/services/chat/action-interceptor.js` at line 339, do the same — the surrounding function receives context that already includes `req` or `wsServer`; find the nearest reference and thread it through. If the function doesn't currently receive `wsServer`, add it as an option on its public signature and update the single call site in `server/routes/chat.routes.js` to pass `req.app?.locals?.wsServer`.

In `server/services/combat/enemy-turn-service.js` at line 109, do the same. Enemy turns don't emit `move_player` today so passing `null` is acceptable if the call chain doesn't already have `wsServer`:

```js
await applyMechanicalOutcome(client, {
  sessionId,
  mechanicalOutcome,
  actingCharacterId,
  wsServer: null,
});
```

- [ ] **Step 6: Run the targeted test**

Run: `npm test -- tests/movement/move-player-outcome.test.js`

Expected: PASS (both tests).

- [ ] **Step 7: Run the full movement test suite**

Run: `npm test -- tests/movement/`

Expected: all tests green across all movement files.

- [ ] **Step 8: Commit**

```bash
git add server/services/dm-action/service.js server/routes/actions.routes.js \
        server/services/chat/action-interceptor.js server/services/combat/enemy-turn-service.js \
        tests/movement/move-player-outcome.test.js
git commit -m "feat(dm-action): wire move_player outcome through applyMechanicalOutcome"
```

---

## Task 7: Update the LLM prompt to emit `move_player`

**Files:**
- Modify: `server/llm/context/action-prompt-builder.js:108-155`

- [ ] **Step 1: Add prompt instructions near the existing sceneTransition + mechanicalOutcome guidance**

In `server/llm/context/action-prompt-builder.js`, locate the block around line 108 (the `sceneTransition` instructions) and the block around line 129 (the `item_gain` violation check). Add a new block immediately after the item guidance:

```js
// (template-string content — merge into the existing prompt builder)
`
- When your narration moves the party to a NEW location (travelling to a town, entering a named landmark, leaving a settlement), you MUST populate "mechanicalOutcome" with type "move_player" AND the destination object. The player token does NOT move unless you emit this outcome.
- Shape:
    mechanicalOutcome: {
      type: "move_player",
      destination: {
        kind: "burg" | "poi" | "coordinate",
        ref:  "<name string for burg/poi, or {x,y} for coordinate>"
      }
    }
- kind="burg" — use the exact settlement name from the campaign's world (e.g. "Harrowick"). This is the normal case for town-to-town travel.
- kind="poi"  — use for named landmarks stored as markers (e.g. "Old Mill", "Standing Stones").
- kind="coordinate" — only when you have been given explicit pixel coordinates.
- VIOLATION CHECK: if your narration uses verbs like "arrive at", "reach", "enter the town of", "travel to", "push on to", "make camp outside", or "the party comes to", your mechanicalOutcome MUST be { type: "move_player", destination: {...} }. Narration alone does NOT move the token, and the NEXT turn's geographic context will be wrong if you skip this.
- If the move is also a scene change (you walk INTO the town's inn), populate BOTH move_player AND sceneTransition. move_player handles the map position; sceneTransition handles which NPCs are currently visible.
`
```

- [ ] **Step 2: Confirm prompt compiles (unit-test the builder if tests exist)**

Run: `npm test -- action-prompt-builder` (if tests exist) or at minimum `node -e "require('./server/llm/context/action-prompt-builder.js')"` equivalent for ESM.

Expected: no syntax error, prompt string contains the new block.

- [ ] **Step 3: Commit**

```bash
git add server/llm/context/action-prompt-builder.js
git commit -m "docs(llm-prompt): instruct DM to emit move_player on narrative travel"
```

---

## Task 8: End-to-end integration smoke test

**Files:**
- Create: `tests/movement/narrative-movement.e2e.test.js`

This test exercises the full chain against a real PostgreSQL test DB (assumes the project's existing test DB setup; skip this task if no integration DB is available and mark it as a manual verification step instead).

- [ ] **Step 1: Write the end-to-end test**

Create `tests/movement/narrative-movement.e2e.test.js`:

```js
import { jest } from '@jest/globals';
import { getClient } from '../../server/db.js';
import { applyMechanicalOutcome } from '../../server/services/dm-action/service.js';

// Fixtures: assumes a seeded campaign with at least one burg named "TestBurg"
// and one active campaign_player linked to a character.
const FIXTURE_CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID;
const FIXTURE_SESSION_ID = process.env.TEST_SESSION_ID;
const FIXTURE_ACTING_CHAR_ID = process.env.TEST_ACTING_CHAR_ID;
const FIXTURE_BURG_NAME = process.env.TEST_BURG_NAME ?? 'TestBurg';

const skipIfNoFixtures = (FIXTURE_CAMPAIGN_ID && FIXTURE_SESSION_ID && FIXTURE_ACTING_CHAR_ID)
  ? test
  : test.skip;

skipIfNoFixtures('move_player outcome updates loc_current and current_map_level', async () => {
  const client = await getClient();
  const wsServer = { broadcastToCampaign: jest.fn() };

  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y, current_map_level
         FROM public.campaign_players
        WHERE campaign_id = $1 AND character_id = $2`,
      [FIXTURE_CAMPAIGN_ID, FIXTURE_ACTING_CHAR_ID],
    );

    await applyMechanicalOutcome(client, {
      sessionId: FIXTURE_SESSION_ID,
      actingCharacterId: FIXTURE_ACTING_CHAR_ID,
      mechanicalOutcome: {
        type: 'move_player',
        destination: { kind: 'burg', ref: FIXTURE_BURG_NAME },
      },
      wsServer,
    });

    const after = await client.query(
      `SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y, current_map_level, inside_burg_id
         FROM public.campaign_players
        WHERE campaign_id = $1 AND character_id = $2`,
      [FIXTURE_CAMPAIGN_ID, FIXTURE_ACTING_CHAR_ID],
    );

    expect(after.rows[0].inside_burg_id).not.toBeNull();
    expect(after.rows[0].current_map_level).toBe('settlement');
    // Position must differ from before (we moved the token)
    expect(after.rows[0].x).not.toBe(before.rows[0].x ?? null);
    expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith(
      FIXTURE_CAMPAIGN_ID,
      'player-moved',
      expect.objectContaining({ mapLevel: 'settlement' }),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release?.();
  }
});
```

- [ ] **Step 2: Run with fixtures or confirm skipped**

Run: `TEST_CAMPAIGN_ID=... TEST_SESSION_ID=... TEST_ACTING_CHAR_ID=... TEST_BURG_NAME=Harrowick npm test -- tests/movement/narrative-movement.e2e.test.js`

Expected: PASS if fixtures are available, skipped otherwise.

- [ ] **Step 3: Manual verification in a live session**

1. Start the dev server: `npm run dev` (or project-standard command)
2. Open a campaign with at least one burg.
3. In chat, type: "I travel north to Harrowick."
4. Confirm in the browser console that a `player-moved` WebSocket event fires with `mapLevel: "settlement"` and `insideBurgId` populated.
5. Confirm the token icon moves on the map.
6. Send a follow-up message: "Who do I see around me?" — verify the geographic context now lists NPCs near Harrowick, not the old location.

- [ ] **Step 4: Commit**

```bash
git add tests/movement/narrative-movement.e2e.test.js
git commit -m "test(movement): e2e smoke test for move_player outcome"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - LLM emits `move_player` outcome → Task 1 (schema) + Task 7 (prompt). ✓
  - Destination resolver handles burg / poi / coordinate → Tasks 2, 3. ✓
  - `performPlayerMovement` accepts LLM source → Task 4. ✓
  - Orchestrator ties it together with WebSocket broadcast → Task 5. ✓
  - Dispatcher case wired up with campaignId/playerId lookup → Task 6. ✓
  - End-to-end verification → Task 8. ✓
  - **Gap (intentional, deferred):** route-snapping, travel-time economics, gate geometry, settlement-view frontend swap, building-to-building movement. These are Plan 2 and Plan 3.

- **Type consistency:**
  - `applyNarrativeMove` return shape `{playerId, geometry, mapLevel, insideBurgId, resolvedName, distance, pathId, updatedAt}` is used consistently across Tasks 5, 6, 8.
  - `resolveDestination` return shape `{x, y, burgId, mapLevel, resolvedName}` consistent across Tasks 2, 3, 5.
  - `source` parameter values `'dm' | 'llm' | 'player'` consistent in Task 4 and Task 5.

- **Known open questions for the executing engineer:**
  1. The `maps_markers.note` ILIKE match in Task 3 may hit multiple markers. Task 3 uses `ORDER BY length(m.note) ASC LIMIT 1` as a crude best-match — revisit if ambiguity becomes a problem.
  2. `requestorRole: 'llm'` in Task 5 is a new role string that doesn't exist in the existing `DM_CONTROL_ROLES` set. That's deliberate — the `source === 'llm'` check is what bypasses the gate; the role is only used for audit.
  3. If `applyMechanicalOutcome` is called from a code path where `wsServer` cannot be plumbed (background job, cron), the move will still persist — the broadcast is best-effort. Clients will reconcile on their next `player-state` fetch.

---

## Follow-on Plans (not implemented here)

- **Plan 2 — Route-network snapping + travel-time:**
  - New `route-planner.js` snaps start→destination path to `maps_routes` geometry via `ST_ClosestPoint` + `ST_LineSubstring` segmentation.
  - `move_player` destination gains an optional `via: 'roads' | 'direct' | <route_id>` field; default `'roads'`.
  - Extend `performPlayerMovement` (or add `performPlayerMovementAlongPath`) to accept a waypoint array and write the path to `player_movement_paths` as a polyline rather than a 2-point line.
  - Travel-time model: distance-per-day config; LLM receives `travelDaysElapsed` in the next turn's context; "one town per day" becomes a soft game-time clock.

- **Plan 3 — Gate geometry + settlement-view handoff:**
  - Introduce `maps_burg_entrances` table (or convention on `maps_markers` with `type = 'gate'` + FK to burg).
  - Gate-picker: given approach vector, pick entrance whose outward normal best matches.
  - Frontend: listen for `player-moved` with `mapLevel` change; animate world→settlement view swap; place token at gate coord inside settlement view.
  - Building-to-building movement: extend `move_player` destination with `kind: 'building'` resolving inside the current `inside_burg_id`.
