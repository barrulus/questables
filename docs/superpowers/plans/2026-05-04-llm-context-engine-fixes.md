# LLM Context Engine — Reliability & Accuracy Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make narration more dependable by fixing the five highest-leverage flaws in the LLM context engine: acting-player geography, chat-history scoping, known-locations filter, lore weighting, and consolidated NPC scene-presence query (with the prompt-side band-aids removed once their root causes are resolved).

**Architecture:** Two phases land in order. Phase A (Tasks 1–3) tightens what `LLMContextManager.buildGameContext` selects from the DB and flows the acting user through the call chain. Phase B (Tasks 4–5) replaces the lore ordering heuristic and consolidates NPC scene presence into the context-manager so the prompt-side overrides in `proactive-narrator.js` can be deleted. Between phases there is an explicit re-test checkpoint.

**Tech Stack:** Node.js (ESM), Express, PostgreSQL/PostGIS, Jest (real-DB integration tests, no mocks).

---

## File Map

**Modified:**
- `server/llm/context/context-manager.js` — every task touches this file
- `server/llm/contextual-service.js` — adds `actingUserId` plumbing (Task 1)
- `server/llm/context/geographic-context-builder.js` — adds `currentBurgId` separation so the prompt can distinguish "you are HERE" from "nearby" (Task 3)
- `server/llm/context/prompt-builder.js` — fix the silent drop of `extraSections` (string vs array) and `systemPromptOverride` (Task 5 setup)
- `server/services/narration/proactive-narrator.js` — switch `extraSections` to array form, then delete the band-aids in Phase B
- `server/routes/campaigns.routes.js` — pass `actingUserId` into `narrateAreaEntry` call site (Task 1)
- `server/routes/game-state.routes.js` — pass `actingUserId` into `narrateWorldTurn` (Task 1)
- `server/services/dm-action/service.js` — pass `actingUserId` into `generateFromContext` calls (Task 1)
- `server/services/chat/action-interceptor.js` — same (Task 1)

**Created (tests only):**
- `tests/llm/context-manager.test.js` — real-DB integration tests for buildGameContext

**Schema:** No migrations needed. The `locations.discovered_by` jsonb column already exists per `database/migrations/001_llm_dm_pivot.sql`.

---

## Phase A — Context Selection Fixes

### Task 1: Plumb `actingUserId` through context assembly

The geographic context is currently computed for `gameState.activePlayerId`, not the player who triggered the action. With split parties (or the DM acting on behalf of an off-screen NPC), the geographic facts shown to the LLM describe the wrong location.

**Files:**
- Modify: `server/llm/context/context-manager.js:257-320` (signature + position loader)
- Modify: `server/llm/context/context-manager.js:575-612` (`#loadActivePlayerPosition` → `#loadPlayerPosition`)
- Modify: `server/llm/contextual-service.js:88-153` (`generateFromContext` + `generateDirect` signatures)
- Modify: `server/services/narration/proactive-narrator.js:205-280` (`narrateAreaEntry` accepts + forwards `actingUserId`)
- Modify: `server/services/narration/proactive-narrator.js:373-426` (`narrateWorldTurn` accepts + forwards `actingUserId`)
- Modify: `server/routes/campaigns.routes.js` — every call to `narrateAreaEntry`
- Modify: `server/routes/game-state.routes.js` — every call to `narrateWorldTurn`
- Modify: `server/services/dm-action/service.js:281, 331, 830` — pass `actingUserId`
- Modify: `server/services/chat/action-interceptor.js:120` — pass `actingUserId`
- Test: `tests/llm/context-manager.test.js` (new)

- [ ] **Step 1: Write the failing integration test**

Create `tests/llm/context-manager.test.js` with the harness pattern used in `tests/plan3b/`:

```javascript
import { LLMContextManager } from '../../server/llm/context/context-manager.js';
import { pool } from '../../server/db/pool.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

describe('LLMContextManager.buildGameContext — actingUserId', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
  });
  afterAll(async () => {
    await fixture.cleanup();
    await pool.end();
  });

  it('uses acting-player position for geography when actingUserId is supplied', async () => {
    const ctx = new LLMContextManager({ pool });
    // Player A is at burg X, player B is at burg Y, gameState.activePlayerId = A
    const ctxBuiltForA = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerA.userId,
    });
    expect(ctxBuiltForA.geographic?.insideBurgId).toBe(fixture.playerA.burgId);

    const ctxBuiltForB = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerB.userId,
    });
    expect(ctxBuiltForB.geographic?.insideBurgId).toBe(fixture.playerB.burgId);
  });

  it('falls back to gameState.activePlayerId when actingUserId is omitted', async () => {
    const ctx = new LLMContextManager({ pool });
    const built = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
    });
    expect(built.geographic?.insideBurgId).toBe(fixture.playerA.burgId);
  });
});
```

Also create the fixture helper. Mirror the shape of `tests/plan3b/fixtures.js` (or whatever it's actually called — verify with `ls tests/plan3b`):

```javascript
// tests/fixtures/llm-context-fixtures.js
import { pool } from '../../server/db/pool.js';
import { randomUUID } from 'crypto';

export async function createTestCampaignWithTwoPlayers() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Pick any existing world with at least two distinct burgs.
    const { rows: worlds } = await client.query(
      `SELECT id FROM public.maps_world LIMIT 1`,
    );
    if (!worlds.length) throw new Error('No world available for fixture');
    const worldId = worlds[0].id;

    const { rows: burgs } = await client.query(
      `SELECT id, ST_X(geom) AS x, ST_Y(geom) AS y
         FROM public.maps_burgs
        WHERE world_id = $1
        ORDER BY id LIMIT 2`,
      [worldId],
    );
    if (burgs.length < 2) throw new Error('Need >=2 burgs in fixture world');

    const dmUserId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();

    // Use existing test-user pattern. If your project has a `_test_user` helper,
    // call it here instead of inserting raw rows.
    for (const id of [dmUserId, userA, userB]) {
      await client.query(
        `INSERT INTO public.user_profiles (id, username, email, status, roles)
         VALUES ($1, 'fixture-' || substring($1::text, 1, 8), $1::text || '@test.local', 'active', ARRAY['user'])`,
        [id],
      );
    }

    const { rows: [campaign] } = await client.query(
      `INSERT INTO public.campaigns
         (id, name, status, system, dm_user_id, world_map_id)
       VALUES ($1, 'fixture-context', 'active', 'dnd5e', $2, $3)
       RETURNING id`,
      [randomUUID(), dmUserId, worldId],
    );

    const { rows: [session] } = await client.query(
      `INSERT INTO public.sessions
         (id, campaign_id, session_number, status, game_state)
       VALUES ($1, $2, 1, 'active', $3::jsonb)
       RETURNING id`,
      [randomUUID(), campaign.id, JSON.stringify({ activePlayerId: userA })],
    );

    // Two characters, two campaign_players, each at a different burg
    for (const [user, burg] of [[userA, burgs[0]], [userB, burgs[1]]]) {
      const charId = randomUUID();
      await client.query(
        `INSERT INTO public.characters (id, campaign_id, user_id, name, class, level, race)
         VALUES ($1, $2, $3, 'char-' || substring($1::text,1,4), 'fighter', 1, 'human')`,
        [charId, campaign.id, user],
      );
      await client.query(
        `INSERT INTO public.campaign_players
           (campaign_id, user_id, character_id, status, loc_current, inside_burg_id, last_located_at)
         VALUES ($1, $2, $3, 'active',
           ST_SetSRID(ST_MakePoint($4, $5), 0), $6, now())`,
        [campaign.id, user, charId, burg.x, burg.y, burg.id],
      );
    }

    await client.query('COMMIT');

    return {
      campaignId: campaign.id,
      sessionId: session.id,
      playerA: { userId: userA, burgId: burgs[0].id },
      playerB: { userId: userB, burgId: burgs[1].id },
      cleanup: async () => {
        const c = await pool.connect();
        try {
          await c.query('DELETE FROM public.campaigns WHERE id = $1', [campaign.id]);
          await c.query(
            `DELETE FROM public.user_profiles WHERE id = ANY($1::uuid[])`,
            [[dmUserId, userA, userB]],
          );
        } finally {
          c.release();
        }
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npx jest tests/llm/context-manager.test.js -t actingUserId
```
Expected: FAIL — first assertion will pass (because activePlayerId = A and player A is at burg X), but the `actingUserId: fixture.playerB.userId` test will fail because today's code ignores `actingUserId` and reads from `gameState.activePlayerId`.

- [ ] **Step 3: Add `actingUserId` to `buildGameContext`**

In `server/llm/context/context-manager.js:257`, change the signature:

```javascript
async buildGameContext({ campaignId, sessionId, actingUserId = null, llmSettings } = {}) {
```

Replace the line at `:286`:
```javascript
const playerPosition = await this.#loadActivePlayerPosition(client, campaignId, session);
```
with:
```javascript
const playerPosition = await this.#loadPlayerPosition(client, campaignId, session, actingUserId);
```

Rename `#loadActivePlayerPosition` → `#loadPlayerPosition` and change the priority order:

```javascript
async #loadPlayerPosition(client, campaignId, session, actingUserId) {
  // Priority: explicit acting user → session.gameState.activePlayerId → most recent active player
  const gameState = session?.gameState;
  const fallbackId = gameState?.activePlayerId ?? null;
  const targetUserId = actingUserId ?? fallbackId;

  let positionQuery;
  let positionParams;

  if (targetUserId) {
    positionQuery = `
      SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y, inside_burg_id
        FROM public.campaign_players
       WHERE campaign_id = $1 AND user_id = $2 AND loc_current IS NOT NULL
       LIMIT 1`;
    positionParams = [campaignId, targetUserId];
  } else {
    positionQuery = `
      SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y, inside_burg_id
        FROM public.campaign_players
       WHERE campaign_id = $1 AND loc_current IS NOT NULL AND status = 'active'
       ORDER BY last_located_at DESC NULLS LAST
       LIMIT 1`;
    positionParams = [campaignId];
  }

  const { rows } = await client.query(positionQuery, positionParams);
  if (!rows.length) return null;
  return {
    x: Number(rows[0].x),
    y: Number(rows[0].y),
    insideBurgId: rows[0].inside_burg_id ?? null,
  };
}
```

- [ ] **Step 4: Plumb through `contextualService`**

In `server/llm/contextual-service.js:88-108`, add `actingUserId` to `generateFromContext`:

```javascript
const generateFromContext = async ({
  campaignId,
  sessionId,
  actingUserId = null,
  type,
  provider: providerOverride,
  parameters,
  metadata = {},
  request = {},
}) => {
  // …existing settings/provider resolution unchanged…

  const gameContext = await contextManager.buildGameContext({
    campaignId,
    sessionId,
    actingUserId,
    llmSettings,
  });
```

Do NOT add it to `generateDirect` — that path bypasses `buildGameContext`.

- [ ] **Step 5: Pass `actingUserId` from every call site**

Each call site below currently has access to the user who triggered the action — pass it through.

In `server/services/narration/proactive-narrator.js:205`, change `narrateAreaEntry` signature to accept `actingUserId` and forward to `contextualService.generateFromContext` at line 237.

In `server/services/narration/proactive-narrator.js:373`, do the same for `narrateWorldTurn`.

In `server/services/dm-action/service.js:830`, pass the action's actor user id (look upwards in the function — the dm-action context already knows who is acting).

In `server/services/chat/action-interceptor.js:120`, pass the message sender's user id.

In `server/routes/campaigns.routes.js` and `server/routes/game-state.routes.js`, every `narrateAreaEntry` / `narrateWorldTurn` call site has the request user via `req.user.id` — pass that as `actingUserId`.

If a caller genuinely doesn't know the acting user (e.g. a system-triggered narration), pass `null` and the existing fallback path runs.

- [ ] **Step 6: Run the test to confirm pass**

```
npx jest tests/llm/context-manager.test.js -t actingUserId
```
Expected: PASS on both cases.

- [ ] **Step 7: Type-check the whole tree**

```
npx tsc --noEmit
```
Expected: no new errors. (The codebase is JS for these files, but the TS check will catch any TSX consumers that broke.)

- [ ] **Step 8: Commit**

```bash
git add server/llm/context/context-manager.js server/llm/contextual-service.js \
        server/services/narration/proactive-narrator.js \
        server/services/dm-action/service.js \
        server/services/chat/action-interceptor.js \
        server/routes/campaigns.routes.js server/routes/game-state.routes.js \
        tests/llm/context-manager.test.js tests/fixtures/llm-context-fixtures.js
git commit -m "feat(llm-context): build geography for the acting player, not the active one"
```

---

### Task 2: Scope chat history to the current session by default

`#loadRecentMessages` at `context-manager.js:614` includes "session_id IS NULL" rows alongside the current session. That clause was meant for system-level events but in practice it lets old campaign-wide chatter (and worse, narration from prior sessions if the session-scope was ever broken) leak into the prompt. Tighten it.

**Files:**
- Modify: `server/llm/context/context-manager.js:614-639`
- Test: `tests/llm/context-manager.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/llm/context-manager.test.js`:

```javascript
describe('LLMContextManager.buildGameContext — chat history scoping', () => {
  it('excludes messages from prior sessions when sessionId is supplied', async () => {
    const fixture = await createTestCampaignWithTwoPlayers();
    try {
      // Insert a message in the current session and one in a prior session
      const priorSessionId = randomUUID();
      await pool.query(
        `INSERT INTO public.sessions (id, campaign_id, session_number, status)
         VALUES ($1, $2, 0, 'completed')`,
        [priorSessionId, fixture.campaignId],
      );
      await pool.query(
        `INSERT INTO public.chat_messages (campaign_id, session_id, content, message_type, sender_id, created_at)
         VALUES
           ($1, $2, 'CURRENT_SESSION_MSG', 'narration', $3, now()),
           ($1, $4, 'PRIOR_SESSION_MSG',   'narration', $3, now() - interval '1 day')`,
        [fixture.campaignId, fixture.sessionId, fixture.playerA.userId, priorSessionId],
      );

      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({
        campaignId: fixture.campaignId,
        sessionId: fixture.sessionId,
      });
      const contents = built.chat.recentMessages.map((m) => m.content);
      expect(contents).toContain('CURRENT_SESSION_MSG');
      expect(contents).not.toContain('PRIOR_SESSION_MSG');
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npx jest tests/llm/context-manager.test.js -t "chat history scoping"
```
Expected: FAIL — `PRIOR_SESSION_MSG` is currently NOT excluded because the loader keeps `m.session_id IS NULL OR m.session_id = $2` (the OR allows nulls but not other sessions; the real failure mode is when callers pass `sessionId=null`, in which case ALL campaign messages come through. Adjust the test if the OR-NULL clause already produces the correct strict-session result; the deeper failure to exercise here is the no-session-id path).

If the OR-NULL clause already yields the strict-session behaviour for this test, additionally test the no-sessionId case:

```javascript
it('still bounds chat history when sessionId is omitted (campaign-scoped, recency-bounded)', async () => {
  // … insert a message older than the time-window cutoff and one within …
  const built = await ctx.buildGameContext({ campaignId: fixture.campaignId });
  const contents = built.chat.recentMessages.map((m) => m.content);
  expect(contents).not.toContain('OLD_CAMPAIGN_MSG');
});
```

- [ ] **Step 3: Tighten the loader**

Replace `#loadRecentMessages` at `context-manager.js:614-639`:

```javascript
async #loadRecentMessages(client, campaignId, sessionId, limit = 20) {
  // Two scoping rules:
  // 1. If a session is supplied, only return that session's messages. Drop the
  //    historical "OR session_id IS NULL" clause — it lets cross-session events
  //    leak into the prompt and the LLM hallucinates against them.
  // 2. If no session is supplied, bound by recency (default 6 hours real time)
  //    so an idle campaign doesn't dredge up stale messages.
  const params = [campaignId];
  let whereClause = 'm.campaign_id = $1';

  if (sessionId) {
    params.push(sessionId);
    whereClause += ` AND m.session_id = $${params.length}`;
  } else {
    whereClause += ` AND m.created_at >= now() - interval '6 hours'`;
  }

  params.push(limit);

  const { rows } = await client.query(
    `SELECT m.*, u.username, c.name AS character_name
       FROM public.chat_messages m
       LEFT JOIN public.user_profiles u ON u.id = m.sender_id
       LEFT JOIN public.characters c ON c.id = m.character_id
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapChatMessageRow);
}
```

- [ ] **Step 4: Run the tests**

```
npx jest tests/llm/context-manager.test.js
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/llm/context/context-manager.js tests/llm/context-manager.test.js
git commit -m "fix(llm-context): scope chat history strictly to the current session"
```

---

### Task 3: Default to known-locations only, separate current burg in geographic context

Two related fixes:

1. The `locations` table is loaded with `includeUndiscovered ?? true` (line 471) — flip the default. Even when undiscovered locations are requested, filter by the acting party's `discovered_by` array so personal-knowledge contamination stops.
2. `nearbyBurgs` in geographic context lumps the burg the party is currently inside with the eight nearest neighbours. The LLM picks names from this list. Surface `currentBurg` separately so the prompt builder can label them clearly.

**Files:**
- Modify: `server/llm/context/context-manager.js:470-485`
- Modify: `server/llm/context/geographic-context-builder.js:75-96` (return shape)
- Test: `tests/llm/context-manager.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/llm/context-manager.test.js`:

```javascript
describe('LLMContextManager.buildGameContext — locations + geography', () => {
  it('omits undiscovered locations by default', async () => {
    const fixture = await createTestCampaignWithTwoPlayers();
    try {
      await pool.query(
        `INSERT INTO public.locations (campaign_id, name, type, is_discovered, discovered_by)
         VALUES
           ($1, 'KNOWN_LOC',   'wilderness', true,  '[]'::jsonb),
           ($1, 'HIDDEN_LOC',  'dungeon',    false, '[]'::jsonb)`,
        [fixture.campaignId],
      );
      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({ campaignId: fixture.campaignId });
      const names = built.locations.map((l) => l.name);
      expect(names).toContain('KNOWN_LOC');
      expect(names).not.toContain('HIDDEN_LOC');
    } finally {
      await fixture.cleanup();
    }
  });

  it('exposes the current burg distinct from nearbyBurgs', async () => {
    const fixture = await createTestCampaignWithTwoPlayers();
    try {
      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({
        campaignId: fixture.campaignId,
        sessionId: fixture.sessionId,
        actingUserId: fixture.playerA.userId,
      });
      expect(built.geographic?.currentBurg?.id).toBe(fixture.playerA.burgId);
      const nearbyIds = built.geographic.nearbyBurgs.map((b) => b.id);
      expect(nearbyIds).not.toContain(fixture.playerA.burgId);
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
npx jest tests/llm/context-manager.test.js -t "locations + geography"
```
Expected: FAIL on both — undiscovered locations come through today, and `nearbyBurgs` includes the current burg.

- [ ] **Step 3: Flip the default in `#loadLocations`**

In `context-manager.js:470-485`:

```javascript
async #loadLocations(client, campaignId, llmSettings) {
  const includeUndiscovered = llmSettings?.includeUndiscoveredLocations ?? false;
  const whereClause = includeUndiscovered
    ? 'WHERE l.campaign_id = $1'
    : 'WHERE l.campaign_id = $1 AND l.is_discovered = true';

  const { rows } = await client.query(
    `SELECT l.*, parent.name AS parent_name
       FROM public.locations l
       LEFT JOIN public.locations parent ON parent.id = l.parent_location_id
      ${whereClause}
      ORDER BY l.is_discovered DESC, l.name ASC`,
    [campaignId],
  );
  return rows.map(mapLocationRow);
}
```

- [ ] **Step 4: Surface `currentBurg` separately in geographic context**

In `geographic-context-builder.js:118-134`, change `queryNearbyBurgs` to also return `id`, and exclude the current burg:

```javascript
async function queryNearbyBurgs(worldMapId, pointWkt, excludeBurgId) {
  const params = [worldMapId, MAX_NEARBY_BURGS];
  let exclusion = '';
  if (excludeBurgId) {
    params.push(excludeBurgId);
    exclusion = `AND id <> $${params.length}`;
  }
  const { rows } = await query(
    `SELECT
       id, name, statefull, provincefull, culture, religion,
       population, elevation, temperature,
       capital, port, citadel, walls, plaza, temple, shanty,
       ST_Distance(geom, ${pointWkt}) AS distance_px,
       ST_X(geom) AS x_px, ST_Y(geom) AS y_px
     FROM public.maps_burgs
     WHERE world_id = $1 ${exclusion}
     ORDER BY geom <-> ${pointWkt}
     LIMIT $2`,
    params,
    { label: 'geo-ctx.nearby-burgs' },
  );
  return rows;
}
```

In `buildGeographicContext` (lines 29-103), pass `insideBurgId` through:

```javascript
queryNearbyBurgs(worldMapId, pointWkt, insideBurgId),
```

And add `currentBurg` to the returned object — it's the existing `settlementDetail` query result, just renamed in the public shape:

```javascript
return {
  position: { x, y },
  worldMapId,
  metersPerPixel,
  insideBurgId,
  isInsideSettlement: !!insideBurgId,
  currentBurg: settlementDetail
    ? { id: insideBurgId, ...settlementDetail }
    : null,
  terrain: terrainCell,
  nearbyBurgs: nearbyBurgs.map((b) => ({
    ...b,
    distanceKm: metersPerPixel ? Math.round((b.distance_px * metersPerPixel) / 100) / 10 : null,
  })),
  // …rest unchanged…
};
```

Update `querySettlementDetail` to return `id` along with the existing columns so the join above works without a re-query:

```javascript
async function querySettlementDetail(burgId) {
  const { rows } = await query(
    `SELECT
       id, name, statefull, provincefull, culture, religion,
       population, elevation, temperature,
       capital, port, citadel, walls, plaza, temple, shanty
     FROM public.maps_burgs
     WHERE id = $1`,
    [burgId],
    { label: 'geo-ctx.settlement-detail' },
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 5: Update the prompt builder to render `currentBurg` as its own section**

In `server/llm/context/prompt-builder.js`, find the geographic-context summarizer (search for `summarizeGeographic` or whatever it's called — verify with `grep -n "geographic\|nearbyBurgs" server/llm/context/prompt-builder.js`) and add a `## Current Settlement` line above `Nearby settlements:`:

```javascript
const summarizeGeographic = (geo) => {
  if (!geo) return 'No geographic context available.';
  const out = [];
  if (geo.currentBurg) {
    const b = geo.currentBurg;
    const tag = [b.statefull, b.provincefull].filter(Boolean).join(', ');
    out.push(`Current settlement: **${b.name}**${tag ? ` (${tag})` : ''}, pop ${b.population ?? 'unknown'}, ${b.culture ?? '—'} culture`);
  }
  // …existing terrain / nearbyBurgs / markers / etc. unchanged…
  return out.join('\n');
};
```

The exact integration point depends on the existing summariser shape — read the file before editing.

- [ ] **Step 6: Run the tests**

```
npx jest tests/llm/context-manager.test.js
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/llm/context/context-manager.js \
        server/llm/context/geographic-context-builder.js \
        server/llm/context/prompt-builder.js \
        tests/llm/context-manager.test.js
git commit -m "fix(llm-context): hide undiscovered locations and surface current burg distinctly"
```

---

## Phase A Checkpoint

**Pause here.** Re-test narration in the browser before deleting the band-aids:

1. Start a session in campaign `259d40d6-4ad7-4950-8f45-a30ab9f31d8d` (Test1) with players in Folive.
2. Trigger area-entry narration. Confirm the LLM names "Folive" reliably without the `## CURRENT LOCATION` block.
3. Trigger world-turn narration with the party in a sealed cave (use a chat tag to set scene). Confirm no off-scene NPCs appear.
4. If both behave correctly without the band-aids being load-bearing, proceed to Phase B. If either still leaks, file the residual symptoms before deleting overrides.

---

## Phase B — Lore Weighting & Band-Aid Removal

### Task 4: Weighted lore selection

The current selector orders lore by `subsection IS NULL → subsection = $currentState → other`, then truncates at 6 entries. "Other" subsections come through arbitrarily, and global lore (`subsection IS NULL`) outranks state-specific lore. Replace with a weighting that prefers location-relevant lore, then campaign-objective-relevant lore, then global, with low-priority sections dropped on overflow.

**Files:**
- Modify: `server/llm/context/context-manager.js:641-673`
- Test: `tests/llm/context-manager.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
describe('LLMContextManager.buildGameContext — lore weighting', () => {
  it('prefers state-matched lore over generic global lore when both exist', async () => {
    const fixture = await createTestCampaignWithTwoPlayers();
    try {
      // Insert 8 lore rows: 1 state-matched, 1 global, 6 unrelated subsections
      // (assuming the fixture's player A burg has a known statefull value).
      const { rows: [{ statefull }] } = await pool.query(
        `SELECT statefull FROM public.maps_burgs WHERE id = $1`,
        [fixture.playerA.burgId],
      );
      await pool.query(
        `INSERT INTO public.campaign_world_lore (campaign_id, section, subsection, content)
         VALUES
           ($1, 'history', NULL,        'GLOBAL'),
           ($1, 'history', $2,          'STATE_MATCH'),
           ($1, 'culture', 'Atlantis',  'UNRELATED_1'),
           ($1, 'culture', 'Lemuria',   'UNRELATED_2'),
           ($1, 'culture', 'Mu',        'UNRELATED_3'),
           ($1, 'culture', 'Pangaea',   'UNRELATED_4'),
           ($1, 'culture', 'Avalon',    'UNRELATED_5'),
           ($1, 'culture', 'Eldorado',  'UNRELATED_6')`,
        [fixture.campaignId, statefull],
      );

      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({
        campaignId: fixture.campaignId,
        sessionId: fixture.sessionId,
        actingUserId: fixture.playerA.userId,
      });
      const contents = built.worldLore.map((l) => l.content);
      expect(contents[0]).toBe('STATE_MATCH');
      expect(contents).toContain('GLOBAL');
      expect(contents.length).toBeLessThanOrEqual(6);
      // None of the unrelated subsections should make it through
      const hasUnrelated = contents.some((c) => c.startsWith('UNRELATED_'));
      expect(hasUnrelated).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Expected: FAIL — today's selector lets `subsection IS NULL` rank above state-matched lore, and may not strictly drop unrelated subsections (the existing `filter` already excludes them, so this assertion may already pass; the ordering assertion will fail).

- [ ] **Step 3: Replace `#loadWorldLore` with a weighted selector**

```javascript
async #loadWorldLore(client, campaignId, geographic) {
  const currentState =
    geographic?.terrain?.state ??
    geographic?.currentBurg?.statefull ??
    geographic?.nearbyBurgs?.[0]?.statefull ??
    null;

  const { rows } = await client.query(
    `SELECT section, subsection, content, updated_at
       FROM public.campaign_world_lore
      WHERE campaign_id = $1`,
    [campaignId],
  );
  if (rows.length === 0) return [];

  // Weight: state-matched first, then global, then drop unrelated subsections.
  // Recency is a tiebreaker. Hard cap at 6 to keep the prompt bounded.
  const MAX_LORE_SECTIONS = 6;
  const scored = rows
    .map((r) => {
      let score;
      if (currentState && r.subsection === currentState) score = 0;
      else if (r.subsection === null) score = 1;
      else score = null; // unrelated — drop entirely
      return { row: r, score };
    })
    .filter((entry) => entry.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return new Date(b.row.updated_at) - new Date(a.row.updated_at);
    });

  return scored.slice(0, MAX_LORE_SECTIONS).map(({ row }) => ({
    section: row.section,
    subsection: row.subsection,
    content: row.content,
  }));
}
```

- [ ] **Step 4: Run the test**

```
npx jest tests/llm/context-manager.test.js -t "lore weighting"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/llm/context/context-manager.js tests/llm/context-manager.test.js
git commit -m "fix(llm-context): weight world lore by location relevance, drop unrelated subsections"
```

---

### Task 5: Consolidate scene-presence filters in the context builder, drop prompt-side band-aids

The `## CURRENT LOCATION` prepend in `narrateAreaEntry` and the "HARD OVERRIDE" scene block in `narrateWorldTurn` exist because the generic rosters pulled by `#loadNPCs` and `#loadParty` don't filter by current scene. Move the filter into `buildGameContext` so every consumer sees a clean roster.

**Two scene-presence filters, not one** (revised after Phase A browser test, 2026-05-04):
- `npcsInScene` — NPCs whose `scene_tag` matches the acting player's `current_scene`.
- `partyInScene` — party members whose `inside_burg_id` matches the acting player's. The 2026-05-04 browser test surfaced an Asmodeus mention in a Sorceff-only Yelensaz scene because the LLM treated the campaign-wide roster as "who's in this scene". The filter mirrors the NPC pattern.

While there: fix `prompt-builder.js` to honour `extraSections` when passed as a string, and honour `systemPromptOverride` so the dead overrides actually reach the LLM.

**Files:**
- Modify: `server/llm/context/context-manager.js:277` (NPC loader integration + party scene filter)
- Modify: `server/llm/context/context-manager.js:417-468` (`#loadParty` returns `inside_burg_id`)
- Modify: `server/llm/context/context-manager.js:487-526` (`#loadNPCs` accepts scene context)
- Modify: `server/llm/context/prompt-builder.js:291-366` (honour `systemPromptOverride`, accept string `extraSections`, render `partyInScene`)
- Modify: `server/services/narration/proactive-narrator.js:181-280` (delete `AREA_DESCRIPTION_SYSTEM_PROMPT` band-aid block, switch `extraSections` to array form OR remove entirely)
- Modify: `server/services/narration/proactive-narrator.js:282-426` (delete the HARD OVERRIDE block, rely on consolidated context)
- Test: `tests/llm/context-manager.test.js`

**Additional party-scene step** (insert after Step 4 of the original Task 5):

Add `partyInScene` derivation after the NPC scene logic:

```javascript
async #loadPartyInScene(client, campaignId, actingUserId, session, party) {
  const target = actingUserId ?? session?.gameState?.activePlayerId ?? null;
  if (!target) return [];
  const { rows } = await client.query(
    `SELECT inside_burg_id FROM public.campaign_players
      WHERE campaign_id = $1 AND user_id = $2 LIMIT 1`,
    [campaignId, target],
  );
  const actingBurgId = rows[0]?.inside_burg_id ?? null;
  if (!actingBurgId) return [];
  // Filter the already-loaded party by inside_burg_id matching the acting
  // player. `#loadParty` must include inside_burg_id on each entry for this
  // to work — see the loader change in this task.
  return party.filter((p) => p.insideBurgId === actingBurgId);
}
```

Update `#loadParty` (lines 417-468) to also SELECT `cp.inside_burg_id` and include it on each entry as `insideBurgId`. The existing `mapCharacterRow` is per-row scoped — add `insideBurgId: row.inside_burg_id ?? null` to the `result.rows.map(...)` block at line 460.

Add `partyInScene` to the `buildGameContext` return:
```javascript
return {
  campaign,
  session,
  party,
  partyInScene,
  locations,
  npcs,
  npcsInScene,
  // …rest unchanged…
};
```

In `prompt-builder.js`, render the party split mirroring the NPC split:
```javascript
out.push('### Party in current scene');
out.push(context.partyInScene.length === 0
  ? '_The acting player is alone (no other party members are co-located).  Do NOT narrate other party members as present._'
  : summarizeParty(context.partyInScene));

out.push('### Full party roster (for reference only — do not narrate as present unless they appear in the in-scene party list above)');
out.push(summarizeParty(context.party));
```

**Additional test** (append to the scene-NPC describe block):

```javascript
it('exposes partyInScene as members co-located with the acting player', async () => {
  const ctx = new LLMContextManager({ pool });
  const built = await ctx.buildGameContext({
    campaignId: fixture.campaignId,
    sessionId: fixture.sessionId,
    actingUserId: fixture.playerA.userId,
  });
  const sceneNames = built.partyInScene.map((p) => p.character.name);
  // Player A and Player B are at different burgs in the fixture
  expect(sceneNames).toContain(/* playerA's character name */);
  expect(sceneNames).not.toContain(/* playerB's character name */);
});
```

- [ ] **Step 1: Write the failing test**

```javascript
describe('LLMContextManager.buildGameContext — scene NPC filtering', () => {
  it('returns only NPCs in the active player\'s current_scene + general roster split', async () => {
    const fixture = await createTestCampaignWithTwoPlayers();
    try {
      // Set player A's current_scene
      await pool.query(
        `UPDATE public.campaign_players SET current_scene = 'cave_chamber'
          WHERE campaign_id = $1 AND user_id = $2`,
        [fixture.campaignId, fixture.playerA.userId],
      );
      await pool.query(
        `INSERT INTO public.npcs (campaign_id, name, race, scene_tag)
         VALUES
           ($1, 'IN_SCENE_NPC',  'human', 'cave_chamber'),
           ($1, 'OFF_SCENE_NPC', 'human', 'wellhead'),
           ($1, 'GLOBAL_NPC',    'human', NULL)`,
        [fixture.campaignId],
      );

      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({
        campaignId: fixture.campaignId,
        sessionId: fixture.sessionId,
        actingUserId: fixture.playerA.userId,
      });

      const sceneNames = built.npcsInScene.map((n) => n.name);
      const rosterNames = built.npcs.map((n) => n.name);
      expect(sceneNames).toEqual(['IN_SCENE_NPC']);
      expect(rosterNames).toContain('OFF_SCENE_NPC'); // still in roster for relationship lookups
      expect(rosterNames).toContain('GLOBAL_NPC');
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Expected: FAIL — `built.npcsInScene` does not exist today.

- [ ] **Step 3: Add scene NPC filtering**

In `context-manager.js:277`, before `#loadNPCs`, derive the acting player's `current_scene`:

```javascript
const actingScene = await this.#loadActingScene(client, campaignId, actingUserId, session);
const npcs = await this.#loadNPCs(client, campaignId);
const npcsInScene = await this.#loadNpcsInScene(client, campaignId, actingScene);
```

Add the helpers below `#loadNPCs`:

```javascript
async #loadActingScene(client, campaignId, actingUserId, session) {
  const target = actingUserId ?? session?.gameState?.activePlayerId ?? null;
  if (!target) return null;
  const { rows } = await client.query(
    `SELECT current_scene FROM public.campaign_players
      WHERE campaign_id = $1 AND user_id = $2 LIMIT 1`,
    [campaignId, target],
  );
  return rows[0]?.current_scene ?? null;
}

async #loadNpcsInScene(client, campaignId, sceneTag) {
  if (!sceneTag) return [];
  const { rows } = await client.query(
    `SELECT id, name, race, occupation, personality, motivations, gender, age_group
       FROM public.npcs
      WHERE campaign_id = $1 AND scene_tag = $2`,
    [campaignId, sceneTag],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    race: r.race,
    occupation: r.occupation,
    personality: r.personality,
    motivations: r.motivations,
    gender: r.gender,
    ageGroup: r.age_group,
  }));
}
```

Add `npcsInScene` to the `buildGameContext` return at line 301:

```javascript
return {
  campaign,
  session,
  party,
  locations,
  npcs,
  npcsInScene,
  encounters,
  // …rest unchanged…
};
```

- [ ] **Step 4: Render the scene split in `prompt-builder.js`**

In `prompt-builder.js`, find where `summarizeNPCs(context.npcs)` is rendered and split the section so the LLM sees scene NPCs first and the full roster only as a relationship lookup:

```javascript
// Replace the existing single ### NPCs section with two sections:
out.push('### NPCs in current scene');
out.push(context.npcsInScene.length === 0
  ? '_No NPCs are physically present with the party right now. Do NOT have any NPC speak, act, or react in this narration unless one of the players names them._'
  : summarizeNPCs(context.npcsInScene));

out.push('### Campaign NPC roster (relationship lookup only — do not narrate these as present unless they appear in the in-scene list above)');
out.push(summarizeNPCs(context.npcs));
```

- [ ] **Step 5: Honour `systemPromptOverride` and string `extraSections` in prompt-builder**

In `prompt-builder.js:291-366`, change the end of `buildStructuredPrompt`:

```javascript
// Accept extraSections as a string (single block) or array of {title,content}.
if (typeof request.extraSections === 'string' && request.extraSections.trim()) {
  promptSections.push(request.extraSections);
} else if (Array.isArray(request.extraSections)) {
  // …existing array handling unchanged…
}

// …rest unchanged…

const systemPrompt = request.systemPromptOverride
  ? sanitize(request.systemPromptOverride) || buildSystemPrompt({ type, providerConfig, campaignLLMSettings })
  : buildSystemPrompt({ type, providerConfig, campaignLLMSettings });
```

(Note: `sanitize` collapses whitespace which is wrong for multi-line system prompts. Either drop the `sanitize` call here or replace with a minimal trimmer. The grep step in Task 3 step 5 will tell you which sanitize variant exists.)

A safer path: just trim, don't sanitize:

```javascript
const trimmedOverride = typeof request.systemPromptOverride === 'string'
  ? request.systemPromptOverride.trim() : null;
const systemPrompt = trimmedOverride && trimmedOverride.length > 0
  ? trimmedOverride
  : buildSystemPrompt({ type, providerConfig, campaignLLMSettings });
```

- [ ] **Step 6: Delete the band-aids in proactive-narrator.js**

Replace `narrateAreaEntry` so it stops fabricating the `## CURRENT LOCATION` block — `currentBurg` is now in the geographic context:

```javascript
export async function narrateAreaEntry({
  campaignId,
  sessionId,
  actingUserId = null,
  movementContext = null,
  contextualService,
  wsServer,
}) {
  try {
    const extraSections = movementContext
      ? [{ title: 'Movement Context', content: movementContext }]
      : [];

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      actingUserId,
      type: NARRATIVE_TYPES.AREA_DESCRIPTION,
      request: {
        extraSections,
        systemPromptOverride: AREA_DESCRIPTION_SYSTEM_PROMPT,
      },
    });

    const narration = result.parsed?.narration || result.content || null;
    if (narration) {
      await postNarrationToChat({
        campaignId, content: narration, messageType: 'narration', sessionId, wsServer,
      });
    }

    // (NPC auto-generation block unchanged — keep lines 258-273)
  } catch (error) {
    logError('Area entry narration failed', { campaignId, error: error.message });
  }
}
```

Trim `AREA_DESCRIPTION_SYSTEM_PROMPT` so the "CURRENT LOCATION" rule is gone — replace the whole constant with:

```javascript
const AREA_DESCRIPTION_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. The party has moved to a new area. Describe what they see.

RULES:
- Write a brief scene description (2-4 sentences) based on the geographic context.
- The "Current settlement" line in the geographic context, if present, names the place the party is in. Use that name, not names from earlier chat or lore.
- Mention any points of interest (markers) or campaign regions they have entered.
- If entering a settlement, describe the approach — gates, walls, sounds, smells.
- Keep it atmospheric and evocative but concise.
- Respond with plain narrative text, not JSON.`;
```

For `narrateWorldTurn`, delete `buildCurrentSceneSection` entirely (lines 308-362) and remove the `extraSections` it produced. The `WORLD_TURN_SYSTEM_PROMPT` rules about scene awareness still apply but reference the new context structure — replace the constant with:

```javascript
const WORLD_TURN_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A full round of player actions has just completed. Narrate the world's response.

RULES:
- Write a brief world turn narration (2-4 sentences) describing what happens in the world.
- Use ONLY the NPCs listed under "### NPCs in current scene". The "Campaign NPC roster" section is a reference for who exists, not who is present. If "NPCs in current scene" is empty, no NPC speaks or acts.
- Use the geographic context to ground details — reference actual nearby locations and terrain.
- If in a dangerous area (encounter region), hint at tension or approaching threats.
- Keep it atmospheric. Respond with plain narrative text, not JSON.`;
```

And `narrateWorldTurn` becomes:

```javascript
export async function narrateWorldTurn({
  campaignId, sessionId, actingUserId = null, contextualService, wsServer,
}) {
  try {
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      actingUserId,
      type: NARRATIVE_TYPES.WORLD_TURN_NARRATION,
      request: { systemPromptOverride: WORLD_TURN_SYSTEM_PROMPT },
    });

    const narration = result.parsed?.narration || result.content || null;
    if (narration) {
      await postNarrationToChat({
        campaignId, content: narration, messageType: 'world_turn', sessionId, wsServer,
      });
      logInfo('World turn narration posted', { campaignId, sessionId });
    }

    const shouldEncounter = await evaluateEncounterChance({ campaignId, sessionId });
    if (shouldEncounter) {
      await generateEncounter({ campaignId, sessionId, contextualService, wsServer });
    }
  } catch (error) {
    logError('World turn narration failed', { campaignId, sessionId, error: error.message });
  }
}
```

- [ ] **Step 7: Run all the tests**

```
npx jest tests/llm/context-manager.test.js
npx tsc --noEmit
```
Expected: all PASS.

- [ ] **Step 8: Browser verification**

Spin up dev (`npm run dev` in the project, or whatever the existing convention is — verify with `cat package.json | grep dev`) and run the same Phase A checkpoint scenarios. Confirm:

1. Area-entry narration in Folive names "Folive" without the deleted band-aid.
2. World-turn narration in a sealed cave does not surface off-scene NPCs.
3. Lore for the current state appears in narration; lore for unrelated states does not.

If any regression appears, do NOT mark the task complete — file the symptom and revisit. Per the user's standing preference on this project, browser testing is not optional for narration changes.

- [ ] **Step 9: Commit**

```bash
git add server/llm/context/context-manager.js \
        server/llm/context/prompt-builder.js \
        server/services/narration/proactive-narrator.js \
        tests/llm/context-manager.test.js
git commit -m "refactor(llm-context): consolidate scene NPC filtering, drop prompt-side band-aids"
```

---

## Phase B Addendum (added 2026-05-04 after browser test surfaced new gaps)

The Phase A checkpoint surfaced three failure modes that the original Phase B plan did not cover:

1. **Chat-history priors win over the structured `Current settlement` line.** When the current session contains five prior "Toprak Village Square" narrations, the LLM treats them as ground truth and re-narrates Toprak even though `currentBurg: Yelensaz` is in the prompt. The system prompt has to actively reject prior-message location names. The original plan assumed Task 5's wiring fix (honouring `systemPromptOverride`) would be sufficient — it isn't, because the existing override text doesn't push back hard enough.

2. **Cache hits return stale narration after movement.** `enhanced-llm-service.js` keys cache entries by prompt hash and lives for 5 minutes. Two narrations 1m12s apart with the same prompt body (because nothing in the user-facing prompt changed in a way the cache key noticed) returned identical text even after a teleport. Movement events must invalidate the cache for the affected campaign.

3. **Lore data hygiene.** 24 rows in `campaign_world_lore` for the test campaign reference a hallucinated location ("Toprak Village") with NPCs ("Marta", "Kael", "Old Woman") that don't exist in `npcs`. Once the LLM hallucinates and the world-context builder turns the hallucination into lore, the lore self-perpetuates: next call sees the lore, narrates Toprak again, generates more lore. Code can't fix already-poisoned data — it has to be culled before any code change can be evaluated.

### Task 6: Lore data hygiene — purge hallucinated rows

**Run before resuming Phase B.** Without this, you can't tell whether a code change worked or whether the same poisoned lore is still driving narration.

**Identify the contamination.** For each campaign currently in active testing:

```sql
SELECT id, section, subsection, LEFT(content, 120) AS preview
  FROM campaign_world_lore
 WHERE campaign_id = $1
   AND content ILIKE '%<hallucinated_name>%'
 ORDER BY updated_at DESC;
```

For Test1 (`259d40d6-4ad7-4950-8f45-a30ab9f31d8d`) on 2026-05-04 the hallucination is "Toprak Village" — *not* the real Toprak burgs (15 of them exist in `maps_burgs`), but the *fictional* "Toprak Village" with NPCs Marta/Kael/Old Woman. The `subsection` field disambiguates: real-burg-derived lore uses the burg's actual `statefull` as subsection (e.g. "Sultantorut"); hallucinated lore uses subsections like "Toprak Village", "Dure", or NPC names.

**Purge query** (run interactively, do NOT batch — review what's being deleted):

```sql
DELETE FROM campaign_world_lore
 WHERE campaign_id = '259d40d6-4ad7-4950-8f45-a30ab9f31d8d'
   AND (
        subsection IN ('Toprak Village', 'Dure', 'Marta', 'Kael', 'Unnamed Old Woman')
     OR content ILIKE '%Toprak Village%'
   )
RETURNING id, section, subsection;
```

Also purge any `npcs` rows for the same hallucinated names if they exist:

```sql
SELECT id, name FROM npcs
 WHERE campaign_id = '259d40d6-4ad7-4950-8f45-a30ab9f31d8d'
   AND name IN ('Marta', 'Kael', 'Unnamed Old Woman', 'Old Woman');
-- review, then DELETE if appropriate
```

And any `chat_messages` containing the contamination from the **active session** (which becomes "recent chat" in subsequent prompts):

```sql
SELECT id, LEFT(content, 80) FROM chat_messages
 WHERE campaign_id = '259d40d6-4ad7-4950-8f45-a30ab9f31d8d'
   AND session_id  = 'ad044cd5-2723-49bc-8f24-886bf99b30f5'
   AND content ILIKE '%Toprak Village%';
-- Don't necessarily delete chat history — but be aware these messages will
-- continue to anchor the LLM until they age out of the chat-history depth.
```

**Verification after purge:** `SELECT COUNT(*) FROM campaign_world_lore WHERE campaign_id = '...' AND content ILIKE '%Toprak Village%'` returns 0.

**No code change in this task** — pure data cleanup. Commit nothing; record what was deleted in the session log.

**Out of scope:** a generic "lore hygiene" job that detects-and-flags hallucinated lore. Too broad. The pragmatic move is to (a) purge before testing, (b) make Tasks 5/7 strong enough that lore doesn't get poisoned again.

### Task 7: Strengthen the area-entry / world-turn system prompts

Once Task 5 wires `systemPromptOverride` correctly, the override text needs to be strong enough to actually override chat-history priors.

**Files:**
- Modify: `server/services/narration/proactive-narrator.js:181-193` (`AREA_DESCRIPTION_SYSTEM_PROMPT`)
- Modify: `server/services/narration/proactive-narrator.js:284-300` (`WORLD_TURN_SYSTEM_PROMPT`)

The new prompts must:
- Lead with an explicit anti-priors clause: *"The 'Current settlement' line in the geographic context is the only authoritative source of where the party is right now. Recent chat may describe a different settlement — that was where the party WAS, not where they are. Do NOT reuse settlement names from chat history or lore."*
- Forbid using NPCs from the campaign roster who aren't in the in-scene list (already in WORLD_TURN; tighten language for AREA_DESCRIPTION too).
- Forbid mentioning party members who aren't in `partyInScene` — same anti-roster clause.
- Be terse. Long system prompts dilute the strongest rule.

**Test approach (manual, not Jest):** after the new prompts ship, run a deliberate "after-priors" test:

1. Start a fresh session in a clean campaign or one without poisoned lore.
2. Trigger area-entry narration in burg X. Verify burg X is named.
3. Teleport the acting player to burg Y (different state ideally).
4. Trigger area-entry narration. Verify burg Y is named, NOT burg X. The LLM should NOT carry burg X forward despite chat history showing the X narration.
5. Repeat with a session-mate at a third location, verify the session-mate is not narrated as co-present.

Document the result of the manual test in the commit message; this task does NOT have an automated test because it's exercising LLM behaviour, not code paths. (If a regression test is wanted, it would have to be a snapshot test of the assembled prompt string — feasible but a separate plan.)

**Commit:**
```
fix(llm-context): tighten area-entry / world-turn system prompts

Override prompts now explicitly reject location names from prior chat
and roster entries not in the in-scene lists. The previous wording
allowed the LLM to anchor to chat-history priors when the structured
context disagreed; the 2026-05-04 Yelensaz/Toprak browser test made
that pattern visible.
```

### Task 8: Cache invalidation on movement

`enhanced-llm-service.js` caches by prompt hash with a 5-minute TTL. When the same prompt body is generated within that window — e.g. two narrations 1m apart for the same campaign — the second hits cache and returns stale text even if the underlying world state changed.

**Two design choices, in increasing complexity:**

A. **Bust by campaign on movement events.** Add `clearCacheForCampaign(campaignId)` to `enhanced-llm-service.js` and call it from the movement code paths (`server/routes/campaigns.routes.js:1125-1156` for teleport, plus the LLM-driven move handler — find with `grep -rn "loc_current\|inside_burg_id" server/routes server/services/movement | grep -v "test"`).

B. **Include campaign_clock_days + acting position in the cache key.** Cleaner architecturally but requires changing the cache-key derivation in `enhanced-llm-service.js`. A position-aware key naturally invalidates whenever the acting player moves.

**Recommendation: A.** The cache is keyed on prompt hash today; the prompt already includes the geographic snapshot, so a movement that changes the snapshot will already produce a different key. The observed cache hit means the prompt itself wasn't changing — likely because `chat_history_depth=20` lets the same recent messages dominate even when geographic context shifts. Busting by campaign on every movement event is a one-line nuke that's easy to reason about. Optimise if it causes a measurable cache-hit-rate drop.

**Files:**
- Modify: `server/llm/enhanced-llm-service.js` — add `clearCacheForCampaign(campaignId)` method. Iterate the cache map; delete entries whose `metadata.campaignId === campaignId`. (The existing entries store `metadata` per `enhanced-llm-service.js:7-8`; verify the field with a quick read before implementing.)
- Modify: movement code paths to call `llmService.clearCacheForCampaign(campaignId)` after a successful move.
- Test: `tests/llm/cache-invalidation.test.js` — small Jest test that exercises `generate` → re-`generate` (cache hit) → `clearCacheForCampaign` → re-`generate` (cache miss).

**Test sketch:**

```javascript
import { EnhancedLLMService } from '../../server/llm/enhanced-llm-service.js';

describe('EnhancedLLMService.clearCacheForCampaign', () => {
  it('busts only the targeted campaign\'s cache entries', async () => {
    const fakeProvider = {
      name: 'fake',
      defaultOptions: {},
      invoke: jest.fn().mockResolvedValue({ content: 'hello', metadata: {} }),
    };
    const svc = new EnhancedLLMService({ providers: [fakeProvider] });
    await svc.generate({ providerName: 'fake', prompt: 'p', metadata: { campaignId: 'A' } });
    await svc.generate({ providerName: 'fake', prompt: 'p', metadata: { campaignId: 'A' } });
    expect(fakeProvider.invoke).toHaveBeenCalledTimes(1); // 2nd was cached

    svc.clearCacheForCampaign('A');
    await svc.generate({ providerName: 'fake', prompt: 'p', metadata: { campaignId: 'A' } });
    expect(fakeProvider.invoke).toHaveBeenCalledTimes(2); // cache busted

    await svc.generate({ providerName: 'fake', prompt: 'p2', metadata: { campaignId: 'B' } });
    svc.clearCacheForCampaign('A');
    await svc.generate({ providerName: 'fake', prompt: 'p2', metadata: { campaignId: 'B' } });
    expect(fakeProvider.invoke).toHaveBeenCalledTimes(3); // B's cache untouched
  });
});
```

**Commit:**
```
fix(llm-cache): invalidate campaign cache on movement events

Two narrations 1m apart for the same campaign were returning identical
cached output even after a teleport, because the cached prompt-hash
didn't shift enough to trigger a key miss. Bust the campaign's cache
entries explicitly when a movement event lands.
```

---

## Self-review checklist (run before claiming complete)

- [ ] Every file path in this plan exists and matches the line numbers cited (verify with `grep -n` if unsure).
- [ ] Tests in `tests/llm/context-manager.test.js` clean up after themselves and don't leak rows into the dev DB.
- [ ] No call site that previously passed `actingUserId=undefined` accidentally breaks the fallback path — verify by greping for every `narrateAreaEntry`, `narrateWorldTurn`, and `generateFromContext` call.
- [ ] The `systemPromptOverride` change in Task 5 doesn't change the system prompt for any caller that doesn't set it (i.e. all existing non-narration callers).
- [ ] `proactive-narrator.js` no longer imports `getClient` if `buildCurrentSceneSection` was its only caller (check imports after deletion).
- [ ] `npx tsc --noEmit` is clean.
- [ ] Manual narration runs in dev produce believable output for: area entry in a known burg, world turn in an isolated chamber, world turn in a populated tavern.

---

## Out of scope (intentionally deferred)

- **Generic-item / minor-NPC hallucination** (the LLM still invents shop names and incidental characters). Needs separate work — likely a stricter `Zero-Dummy` reinforcement in the system prompt plus a post-generation entity validator.
- **Token budgeting**. The full game context is sent every call; under heavy use this is wasteful. A future plan should track section-level token costs and drop sections by priority when the budget is tight.
- **Per-character knowledge**. `discovered_by` per-character filtering is plumbed but not used — the current code only checks `is_discovered` campaign-wide. Worth a follow-up once the basics are landed.
- **Director whisper relevance scoring**. The last 5 are always loaded; some may be ancient. Out of scope for this plan.
