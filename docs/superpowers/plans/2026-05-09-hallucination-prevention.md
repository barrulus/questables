# Hallucination Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fabricated entities (places, NPCs, shops, items) from being persisted to `campaign_world_lore` and `npcs` after narration, while leaving narration text itself untouched.

**Architecture:** A new stateless `entity-resolver.js` service does case-insensitive normalised lookups across `maps_burgs`, `maps_burgs.statefull` (states), `campaign_map_regions`, `npcs`, `locations` (discovered only), and `npc_shops`. Both extractors call it: `lore-extractor.js` injects a `## Known entities` block into its LLM user prompt AND post-validates each extracted fact's `subsection`; `npc-extractor.js` adds the same prompt block but relies on prompt-side enforcement only (NPCs are by definition not yet in the DB). `proactive-narrator.js` gets one new line in each system prompt forbidding invented establishments.

**Tech Stack:** Node.js (ESM), Express, PostgreSQL/PostGIS, Jest (real-DB integration tests, no DB mocks).

**Spec:** [docs/superpowers/specs/2026-05-09-hallucination-prevention-design.md](../specs/2026-05-09-hallucination-prevention-design.md) (commit `755c17f`).

---

## File Map

**Created:**
- `server/services/world-building/entity-resolver.js` — `resolveEntity` + `buildEntityIndex`
- `tests/world-building/entity-resolver.test.js` — unit tests for both functions
- `tests/world-building/lore-extractor-gate.test.js` — stub-LLM tests of the post-LLM gate
- `tests/world-building/npc-extractor-prompt.test.js` — stub-LLM tests verifying prompt injection

**Modified:**
- `server/services/world-building/lore-extractor.js` — wire resolver in, inject Known entities, add post-LLM gate
- `server/services/world-building/npc-extractor.js` — inject Known entities, add anti-fabrication clause to system prompt
- `server/services/narration/proactive-narrator.js` — append "do not invent establishments" line to both system prompts
- `tests/llm/proactive-narrator-prompts.test.js` — assert the new line is present

**Schema:** No migrations.

---

## Task 1: Entity resolver — `resolveEntity`

The single-lookup function. Six entity kinds, exact normalised match only, returns `{kind, id, canonicalName} | null`.

**Files:**
- Create: `server/services/world-building/entity-resolver.js`
- Create: `tests/world-building/entity-resolver.test.js`

- [ ] **Step 1: Create the test file with all `resolveEntity` cases**

```javascript
// tests/world-building/entity-resolver.test.js
/**
 * @jest-environment node
 *
 * Real-DB integration tests for the entity-resolver. Reuses the campaign
 * fixture from the 2026-05-04 LLM context engine work — same DB, same
 * cleanup pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { pool } from '../../server/db/pool.js';
import { resolveEntity } from '../../server/services/world-building/entity-resolver.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

describe('resolveEntity', () => {
  let fixture;
  let burgAName;

  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
    const { rows } = await pool.query(
      `SELECT name FROM public.maps_burgs WHERE id = $1`,
      [fixture.playerA.burgId],
    );
    burgAName = rows[0].name;
  });
  afterAll(async () => {
    await fixture.cleanup();
    await pool.end();
  });

  it('resolves a real burg by exact name', async () => {
    const out = await resolveEntity({
      campaignId: fixture.campaignId,
      name: burgAName,
      kinds: ['burg'],
    });
    expect(out).toEqual({
      kind: 'burg',
      id: fixture.playerA.burgId,
      canonicalName: burgAName,
    });
  });

  it('resolves with case and whitespace variation', async () => {
    const upper = burgAName.toUpperCase();
    const padded = `   ${burgAName.toLowerCase()}   `;
    const a = await resolveEntity({ campaignId: fixture.campaignId, name: upper, kinds: ['burg'] });
    const b = await resolveEntity({ campaignId: fixture.campaignId, name: padded, kinds: ['burg'] });
    expect(a?.id).toBe(fixture.playerA.burgId);
    expect(b?.id).toBe(fixture.playerA.burgId);
  });

  it('rejects fabricated names that contain a real prefix', async () => {
    const fabricated = `${burgAName} Village`;
    const out = await resolveEntity({
      campaignId: fixture.campaignId,
      name: fabricated,
      kinds: ['burg'],
    });
    expect(out).toBeNull();
  });

  it('returns null for entirely unknown names', async () => {
    const out = await resolveEntity({
      campaignId: fixture.campaignId,
      name: 'Definitely Not A Real Place 9000',
      kinds: ['burg', 'state', 'region', 'npc', 'location', 'shop'],
    });
    expect(out).toBeNull();
  });

  it('resolves a state derived from maps_burgs.statefull', async () => {
    const { rows } = await pool.query(
      `SELECT statefull FROM public.maps_burgs
        WHERE id = $1 AND statefull IS NOT NULL`,
      [fixture.playerA.burgId],
    );
    if (!rows.length) return; // burg has no state — skip
    const stateName = rows[0].statefull;
    const out = await resolveEntity({
      campaignId: fixture.campaignId,
      name: stateName,
      kinds: ['state'],
    });
    expect(out?.kind).toBe('state');
    expect(out?.canonicalName).toBe(stateName);
  });

  it('resolves an NPC scoped to the campaign', async () => {
    const { rows } = await pool.query(
      `INSERT INTO public.npcs (campaign_id, name, race, personality)
       VALUES ($1, 'Karam the Shepherd', 'human', 'cautious')
       RETURNING id`,
      [fixture.campaignId],
    );
    const npcId = rows[0].id;
    const out = await resolveEntity({
      campaignId: fixture.campaignId,
      name: 'karam the shepherd',
      kinds: ['npc'],
    });
    expect(out).toEqual({ kind: 'npc', id: npcId, canonicalName: 'Karam the Shepherd' });
  });

  it('resolves a discovered location but not an undiscovered one', async () => {
    const { rows: discRows } = await pool.query(
      `INSERT INTO public.locations (campaign_id, name, type, is_discovered)
       VALUES ($1, 'The Old Well', 'wilderness', true)
       RETURNING id`,
      [fixture.campaignId],
    );
    await pool.query(
      `INSERT INTO public.locations (campaign_id, name, type, is_discovered)
       VALUES ($1, 'Hidden Crypt', 'dungeon', false)`,
      [fixture.campaignId],
    );

    const known = await resolveEntity({
      campaignId: fixture.campaignId, name: 'The Old Well', kinds: ['location'],
    });
    const hidden = await resolveEntity({
      campaignId: fixture.campaignId, name: 'Hidden Crypt', kinds: ['location'],
    });
    expect(known?.id).toBe(discRows[0].id);
    expect(hidden).toBeNull();
  });

  it('resolves a shop via npc_shops', async () => {
    const { rows: npcRows } = await pool.query(
      `INSERT INTO public.npcs (campaign_id, name, race, personality)
       VALUES ($1, 'Mira the Apothecary', 'human', 'curt')
       RETURNING id`,
      [fixture.campaignId],
    );
    const { rows: shopRows } = await pool.query(
      `INSERT INTO public.npc_shops (campaign_id, npc_id, name, shop_type)
       VALUES ($1, $2, 'Mira''s General Store', 'general')
       RETURNING id`,
      [fixture.campaignId, npcRows[0].id],
    );
    const out = await resolveEntity({
      campaignId: fixture.campaignId,
      name: "mira's general store",
      kinds: ['shop'],
    });
    expect(out).toEqual({
      kind: 'shop',
      id: shopRows[0].id,
      canonicalName: "Mira's General Store",
    });
  });

  it('honours the kinds order — first match wins', async () => {
    // Insert an NPC and a shop with the same name; the kinds order
    // passed in dictates which one is returned.
    const { rows: npcRows } = await pool.query(
      `INSERT INTO public.npcs (campaign_id, name, race, personality)
       VALUES ($1, 'Ambiguous Name', 'human', 'mysterious')
       RETURNING id`,
      [fixture.campaignId],
    );
    await pool.query(
      `INSERT INTO public.npc_shops (campaign_id, npc_id, name, shop_type)
       VALUES ($1, $2, 'Ambiguous Name', 'general')`,
      [fixture.campaignId, npcRows[0].id],
    );

    const npcFirst = await resolveEntity({
      campaignId: fixture.campaignId, name: 'Ambiguous Name', kinds: ['npc', 'shop'],
    });
    const shopFirst = await resolveEntity({
      campaignId: fixture.campaignId, name: 'Ambiguous Name', kinds: ['shop', 'npc'],
    });
    expect(npcFirst?.kind).toBe('npc');
    expect(shopFirst?.kind).toBe('shop');
  });

  it('does not throw on DB failure — returns null', async () => {
    // Pass a malformed campaignId to force a query error path.
    const out = await resolveEntity({
      campaignId: 'not-a-uuid',
      name: 'anything',
      kinds: ['burg'],
    });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/world-building/entity-resolver.test.js
```
Expected: FAIL — `entity-resolver.js` doesn't exist yet.

- [ ] **Step 3: Implement `resolveEntity`**

```javascript
// server/services/world-building/entity-resolver.js
/**
 * Entity resolver — single source of truth for "does this name correspond to
 * an actual entity in this campaign's world?". Used post-narration by the
 * lore- and NPC-extractors to gate writes back to the DB and stop the LLM
 * from poisoning campaign_world_lore with fabricated places.
 *
 * Exact normalised match only — no fuzzy matching, by design. "Toprak Village"
 * must NOT silently resolve to a real "Toprak" burg, or the hallucination
 * loop returns through a softer back door.
 */
import { query } from '../../db/pool.js';
import { logError } from '../../utils/logger.js';

/**
 * Normalise a name for comparison: lowercase, strip non-alphanumeric punctuation
 * (preserving spaces and apostrophes-as-empty), collapse whitespace, trim.
 * Mirrors `normaliseName` in npc-extractor.js so lookups behave consistently.
 */
export const normaliseName = (name) => {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const RESOLVERS = {
  burg: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT b.id, b.name
         FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
          AND lower(regexp_replace(b.name, '[^a-zA-Z0-9 ]+', '', 'g')) = $2
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.burg' },
    );
    return rows[0] ? { kind: 'burg', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  state: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT DISTINCT b.statefull AS name
         FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
          AND b.statefull IS NOT NULL
          AND lower(regexp_replace(b.statefull, '[^a-zA-Z0-9 ]+', '', 'g')) = $2
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.state' },
    );
    return rows[0] ? { kind: 'state', id: null, canonicalName: rows[0].name } : null;
  },

  region: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.campaign_map_regions
        WHERE campaign_id = $1
          AND lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')) = $2
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.region' },
    );
    return rows[0] ? { kind: 'region', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  npc: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.npcs
        WHERE campaign_id = $1
          AND lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')) = $2
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.npc' },
    );
    return rows[0] ? { kind: 'npc', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  location: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.locations
        WHERE campaign_id = $1
          AND is_discovered = true
          AND lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')) = $2
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.location' },
    );
    return rows[0] ? { kind: 'location', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  shop: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.npc_shops
        WHERE campaign_id = $1
          AND lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')) = $2
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.shop' },
    );
    return rows[0] ? { kind: 'shop', id: rows[0].id, canonicalName: rows[0].name } : null;
  },
};

/**
 * Resolve a name to an entity in the campaign's world.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.name - Free-text name from narration / extracted lore.
 * @param {Array<'burg'|'state'|'region'|'npc'|'location'|'shop'>} opts.kinds
 *   Search order. First hit wins.
 * @returns {Promise<{kind: string, id: string|null, canonicalName: string}|null>}
 */
export async function resolveEntity({ campaignId, name, kinds }) {
  if (!campaignId || !name || !Array.isArray(kinds) || kinds.length === 0) {
    return null;
  }
  const normalised = normaliseName(name);
  if (!normalised) return null;

  for (const kind of kinds) {
    const resolver = RESOLVERS[kind];
    if (!resolver) continue;
    try {
      const hit = await resolver(campaignId, normalised);
      if (hit) return hit;
    } catch (err) {
      logError('entity-resolver: lookup failed', { campaignId, kind, name, error: err.message });
      // Swallow and try next kind. If every kind fails, return null.
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/world-building/entity-resolver.test.js
```
Expected: PASS — all `resolveEntity` cases green.

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add server/services/world-building/entity-resolver.js tests/world-building/entity-resolver.test.js
git commit -m "feat(world-building): add entity-resolver for post-narration name lookups"
```

---

## Task 2: Entity resolver — `buildEntityIndex`

The bulk-fetch function used to build the `## Known entities` prompt block. K-nearest for burgs (matches `geographic-context-builder.js:120`), `linked_burg_id`-scoped for NPCs/shops, geometry-contains for regions, campaign-scoped for everything else.

**Files:**
- Modify: `server/services/world-building/entity-resolver.js` (append `buildEntityIndex`)
- Modify: `tests/world-building/entity-resolver.test.js` (append `buildEntityIndex` describe block)

- [ ] **Step 1: Append the failing tests**

```javascript
// Append to tests/world-building/entity-resolver.test.js
import { buildEntityIndex } from '../../server/services/world-building/entity-resolver.js';

describe('buildEntityIndex', () => {
  let fixture;
  let burgACoords;

  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
    const { rows } = await pool.query(
      `SELECT ST_X(geom) AS x, ST_Y(geom) AS y FROM public.maps_burgs WHERE id = $1`,
      [fixture.playerA.burgId],
    );
    burgACoords = { x: Number(rows[0].x), y: Number(rows[0].y) };
  });
  afterAll(async () => {
    await fixture.cleanup();
  });

  it('returns the current burg plus k-nearest others', async () => {
    const idx = await buildEntityIndex({
      campaignId: fixture.campaignId,
      scope: { insideBurgId: fixture.playerA.burgId, locX: burgACoords.x, locY: burgACoords.y },
    });
    const burgIds = idx.burgs.map((b) => b.id);
    expect(burgIds).toContain(fixture.playerA.burgId);
    expect(idx.burgs.length).toBeGreaterThan(0);
    expect(idx.burgs.length).toBeLessThanOrEqual(9); // current + up to 8 neighbours
  });

  it('returns distinct states drawn from those burgs', async () => {
    const idx = await buildEntityIndex({
      campaignId: fixture.campaignId,
      scope: { insideBurgId: fixture.playerA.burgId, locX: burgACoords.x, locY: burgACoords.y },
    });
    const names = new Set(idx.states.map((s) => s.name));
    expect(names.size).toBe(idx.states.length); // distinct
  });

  it('returns NPCs whose linked_burg_id is in scope', async () => {
    await pool.query(
      `INSERT INTO public.npcs (campaign_id, name, race, personality, linked_burg_id)
       VALUES ($1, 'Local NPC', 'human', 'friendly', $2)`,
      [fixture.campaignId, fixture.playerA.burgId],
    );
    await pool.query(
      `INSERT INTO public.npcs (campaign_id, name, race, personality)
       VALUES ($1, 'Unlinked NPC', 'human', 'distant')`,
      [fixture.campaignId],
    );

    const idx = await buildEntityIndex({
      campaignId: fixture.campaignId,
      scope: { insideBurgId: fixture.playerA.burgId, locX: burgACoords.x, locY: burgACoords.y },
    });
    const names = idx.npcs.map((n) => n.name);
    expect(names).toContain('Local NPC');
    expect(names).not.toContain('Unlinked NPC');
  });

  it('excludes undiscovered locations', async () => {
    await pool.query(
      `INSERT INTO public.locations (campaign_id, name, type, is_discovered)
       VALUES ($1, 'Discovered Vale', 'wilderness', true),
              ($1, 'Hidden Lair', 'dungeon', false)`,
      [fixture.campaignId],
    );
    const idx = await buildEntityIndex({
      campaignId: fixture.campaignId,
      scope: { insideBurgId: fixture.playerA.burgId, locX: burgACoords.x, locY: burgACoords.y },
    });
    const names = idx.locations.map((l) => l.name);
    expect(names).toContain('Discovered Vale');
    expect(names).not.toContain('Hidden Lair');
  });

  it('returns shops linked to NPCs whose linked_burg_id is in scope', async () => {
    const { rows: npcRows } = await pool.query(
      `INSERT INTO public.npcs (campaign_id, name, race, personality, linked_burg_id)
       VALUES ($1, 'Shopkeeper', 'human', 'shrewd', $2)
       RETURNING id`,
      [fixture.campaignId, fixture.playerA.burgId],
    );
    await pool.query(
      `INSERT INTO public.npc_shops (campaign_id, npc_id, name, shop_type)
       VALUES ($1, $2, 'Local Wares', 'general')`,
      [fixture.campaignId, npcRows[0].id],
    );

    const idx = await buildEntityIndex({
      campaignId: fixture.campaignId,
      scope: { insideBurgId: fixture.playerA.burgId, locX: burgACoords.x, locY: burgACoords.y },
    });
    const names = idx.shops.map((s) => s.name);
    expect(names).toContain('Local Wares');
  });

  it('returns an empty index when scope has no insideBurgId or coords', async () => {
    const idx = await buildEntityIndex({
      campaignId: fixture.campaignId,
      scope: {},
    });
    expect(idx).toEqual({
      burgs: [], states: [], regions: [], npcs: [], locations: [], shops: [],
    });
  });

  it('does not throw on DB failure — returns empty index', async () => {
    const idx = await buildEntityIndex({
      campaignId: 'not-a-uuid',
      scope: { insideBurgId: 'also-not-a-uuid', locX: 0, locY: 0 },
    });
    expect(idx).toEqual({
      burgs: [], states: [], regions: [], npcs: [], locations: [], shops: [],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/world-building/entity-resolver.test.js -t buildEntityIndex
```
Expected: FAIL — `buildEntityIndex` is not exported yet.

- [ ] **Step 3: Append `buildEntityIndex` to `entity-resolver.js`**

Add to `server/services/world-building/entity-resolver.js`:

```javascript
const MAX_NEARBY_BURGS = 8;

/**
 * Resolve the campaign's world map id once. Used for scoping burg/state lookups.
 */
async function getWorldMapId(campaignId) {
  const { rows } = await query(
    `SELECT world_map_id FROM public.campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
    { label: 'entity-resolver.world-map-id' },
  );
  return rows[0]?.world_map_id ?? null;
}

const EMPTY_INDEX = Object.freeze({
  burgs: [], states: [], regions: [], npcs: [], locations: [], shops: [],
});

/**
 * Build a scoped index of all named entities relevant to a position on the
 * world map. Used to populate the `## Known entities` block in extractor
 * prompts so the LLM has a positive list to anchor against.
 *
 * Scope mirrors geographic-context-builder: k-nearest burgs (≤ MAX_NEARBY_BURGS
 * + current), `linked_burg_id`-scoped NPCs and shops, geometry-contains regions.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {object} opts.scope
 * @param {string} [opts.scope.insideBurgId]
 * @param {number} [opts.scope.locX]
 * @param {number} [opts.scope.locY]
 * @returns {Promise<{
 *   burgs: Array<{id: string, name: string, statefull: string|null}>,
 *   states: Array<{name: string}>,
 *   regions: Array<{id: string, name: string}>,
 *   npcs: Array<{id: string, name: string}>,
 *   locations: Array<{id: string, name: string}>,
 *   shops: Array<{id: string, name: string}>,
 * }>}
 */
export async function buildEntityIndex({ campaignId, scope = {} }) {
  if (!campaignId) return { ...EMPTY_INDEX };
  const { insideBurgId = null, locX = null, locY = null } = scope;
  if (!insideBurgId && (locX == null || locY == null)) {
    return { ...EMPTY_INDEX };
  }

  try {
    const worldMapId = await getWorldMapId(campaignId);
    if (!worldMapId) return { ...EMPTY_INDEX };

    const haveCoords = typeof locX === 'number' && typeof locY === 'number';
    const pointWkt = haveCoords
      ? `ST_SetSRID(ST_MakePoint(${Number(locX)}, ${Number(locY)}), 0)`
      : null;

    // Burgs: current burg first, then k-nearest others by distance.
    // Caller passes either (insideBurgId + coords), coords only, or insideBurgId only.
    const burgParams = [worldMapId, MAX_NEARBY_BURGS];
    let burgsQuery;
    if (insideBurgId && pointWkt) {
      burgParams.push(insideBurgId);
      burgsQuery = `
        WITH ranked AS (
          SELECT id, name, statefull,
                 (CASE WHEN id = $3 THEN 0 ELSE 1 END) AS pri,
                 ST_Distance(geom, ${pointWkt}) AS dist
            FROM public.maps_burgs
           WHERE world_id = $1
        )
        SELECT id, name, statefull FROM ranked
         ORDER BY pri ASC, dist ASC
         LIMIT $2 + 1`;
    } else if (pointWkt) {
      burgsQuery = `
        SELECT id, name, statefull
          FROM public.maps_burgs
         WHERE world_id = $1
         ORDER BY ST_Distance(geom, ${pointWkt})
         LIMIT $2`;
    } else {
      // insideBurgId only, no coords — return that burg alone.
      burgParams.push(insideBurgId);
      burgsQuery = `
        SELECT id, name, statefull
          FROM public.maps_burgs
         WHERE world_id = $1 AND id = $3
         LIMIT 1`;
    }

    const { rows: burgRows } = await query(burgsQuery, burgParams, {
      label: 'entity-resolver.index-burgs',
    });

    const burgIds = burgRows.map((b) => b.id);
    const states = Array.from(
      new Map(burgRows.filter((b) => b.statefull).map((b) => [b.statefull, { name: b.statefull }])).values(),
    );

    // Regions: campaign_map_regions whose geom contains the player point.
    let regionRows = [];
    if (pointWkt) {
      const regionResult = await query(
        `SELECT id, name
           FROM public.campaign_map_regions
          WHERE campaign_id = $1
            AND ST_Contains(region, ${pointWkt})`,
        [campaignId],
        { label: 'entity-resolver.index-regions' },
      );
      regionRows = regionResult.rows;
    }

    // NPCs: linked_burg_id IN (scope burgs).
    let npcRows = [];
    if (burgIds.length > 0) {
      const npcResult = await query(
        `SELECT id, name FROM public.npcs
          WHERE campaign_id = $1 AND linked_burg_id = ANY($2::uuid[])`,
        [campaignId, burgIds],
        { label: 'entity-resolver.index-npcs' },
      );
      npcRows = npcResult.rows;
    }

    // Locations: campaign-scoped, discovered only.
    const { rows: locationRows } = await query(
      `SELECT id, name FROM public.locations
        WHERE campaign_id = $1 AND is_discovered = true`,
      [campaignId],
      { label: 'entity-resolver.index-locations' },
    );

    // Shops: npc_shops where the NPC's linked_burg_id is in scope.
    let shopRows = [];
    if (burgIds.length > 0) {
      const shopResult = await query(
        `SELECT s.id, s.name
           FROM public.npc_shops s
           JOIN public.npcs n ON n.id = s.npc_id
          WHERE s.campaign_id = $1 AND n.linked_burg_id = ANY($2::uuid[])`,
        [campaignId, burgIds],
        { label: 'entity-resolver.index-shops' },
      );
      shopRows = shopResult.rows;
    }

    return {
      burgs: burgRows.map((b) => ({ id: b.id, name: b.name, statefull: b.statefull ?? null })),
      states,
      regions: regionRows.map((r) => ({ id: r.id, name: r.name })),
      npcs: npcRows.map((n) => ({ id: n.id, name: n.name })),
      locations: locationRows.map((l) => ({ id: l.id, name: l.name })),
      shops: shopRows.map((s) => ({ id: s.id, name: s.name })),
    };
  } catch (err) {
    logError('entity-resolver: buildEntityIndex failed', { campaignId, error: err.message });
    return { ...EMPTY_INDEX };
  }
}
```

The CTE branch keeps the current burg first (priority 0), then orders the remaining burgs by distance, returning `MAX_NEARBY_BURGS + 1` rows total (current + 8 neighbours).

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/world-building/entity-resolver.test.js
```
Expected: PASS — all `resolveEntity` AND `buildEntityIndex` cases green.

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/world-building/entity-resolver.js tests/world-building/entity-resolver.test.js
git commit -m "feat(world-building): add buildEntityIndex for prompt injection scope"
```

---

## Task 3: Wire resolver into `lore-extractor.js`

Three changes to `extractAndPersistLore`: build the entity index up-front, inject `## Known entities` into the user prompt, and validate each extracted fact's `subsection` post-LLM. The currently-unused `_locX/_locY/_insideBurgId` parameters (lore-extractor.js:68-70) lose their underscore prefix and start being used.

**Files:**
- Modify: `server/services/world-building/lore-extractor.js`
- Create: `tests/world-building/lore-extractor-gate.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/world-building/lore-extractor-gate.test.js
/**
 * @jest-environment node
 *
 * Real-DB tests for the lore-extractor's post-LLM gate. Stubs the LLM
 * response (no real provider call) so we can assert on prompt contents
 * and which facts get persisted.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { pool } from '../../server/db/pool.js';
import { extractAndPersistLore } from '../../server/services/world-building/lore-extractor.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

const buildStubLlm = (facts) => {
  const captured = { lastPrompt: null, lastSystemPrompt: null };
  const llmService = {
    generate: jest.fn(async ({ prompt, systemPrompt }) => {
      captured.lastPrompt = prompt;
      captured.lastSystemPrompt = systemPrompt;
      return { parsed: { facts }, content: JSON.stringify({ facts }) };
    }),
  };
  return { llmService, captured };
};

describe('lore-extractor — post-LLM gate', () => {
  let fixture;
  let burgAName;

  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
    const { rows } = await pool.query(
      `SELECT name FROM public.maps_burgs WHERE id = $1`,
      [fixture.playerA.burgId],
    );
    burgAName = rows[0].name;
  });
  afterAll(async () => {
    await fixture.cleanup();
    await pool.end();
  });

  it('persists a fact whose subsection resolves to a real burg', async () => {
    const { llmService } = buildStubLlm([
      { section: 'location', subsection: burgAName, content: 'Has a notable bell tower.' },
    ]);

    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration to clear the 50-character minimum length filter for the lore extractor.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it('drops a fact whose subsection does not resolve to any entity', async () => {
    const { llmService } = buildStubLlm([
      { section: 'location', subsection: 'Toprak Village (fabricated)', content: 'A made-up place.' },
    ]);
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration to clear the 50-character minimum length filter for the lore extractor.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('drops every fact when the entity index is empty (no scope)', async () => {
    const { llmService } = buildStubLlm([
      { section: 'location', subsection: burgAName, content: 'Anything.' },
    ]);
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration to clear the 50-character minimum length filter for the lore extractor.',
      llmService,
      // no insideBurgId, no coords — entity index will be empty
    });
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    // With an empty index, even a real-burg subsection has nothing to validate against — drop.
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('injects a ## Known entities block into the user prompt', async () => {
    const { llmService, captured } = buildStubLlm([]);
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration to clear the 50-character minimum length filter for the lore extractor.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastPrompt).toMatch(/## Known entities/);
    expect(captured.lastPrompt).toContain(burgAName);
  });

  it('extends the system prompt with the Zero-Dummy clause', async () => {
    const { llmService, captured } = buildStubLlm([]);
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration to clear the 50-character minimum length filter for the lore extractor.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastSystemPrompt).toMatch(/not in the Known entities list/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx jest tests/world-building/lore-extractor-gate.test.js
```
Expected: FAIL on the "drops fabricated subsection", "drops every fact when empty scope", and prompt-content assertions, because the current extractor neither validates nor injects.

- [ ] **Step 3: Modify `lore-extractor.js`**

Replace the body of `extractAndPersistLore` in `server/services/world-building/lore-extractor.js`. The existing imports remain; add the resolver imports.

```javascript
import { resolveEntity, buildEntityIndex } from './entity-resolver.js';
```

Update `EXTRACT_SYSTEM_PROMPT` (currently at lore-extractor.js:35) by appending the Zero-Dummy clause:

```javascript
const EXTRACT_SYSTEM_PROMPT = `You are a lore extraction tool. Given a narration from a D&D game session, extract any NEW world facts that were introduced. Only extract facts that would be useful to remember for future sessions.

Extract facts about:
- NPCs mentioned (name, role, disposition, location)
- Locations described (features, atmosphere, notable details)
- Events that occurred (what happened, who was involved)
- Political or cultural details revealed
- Religious or magical phenomena

Rules:
- Only extract facts explicitly stated in the narration — do NOT invent or infer
- Each fact should be a single, concise statement (1-2 sentences)
- Use the entity name as the subsection (e.g., "Grumbar the Blacksmith", "Millhaven", "Cheth Empire")
- If no new facts worth remembering, return an empty facts array
- Do NOT extract player actions or dice rolls — only world-building details
- A "## Known entities" list is provided below. If a fact's subsection is not in the Known entities list, DROP it. Do not invent shops, taverns, items, or named places. If the narration uses a name that is not in the list, treat it as descriptive prose and skip the fact.`;
```

Replace the function body (signature stays — drop the `_` prefixes since the parameters are now used):

```javascript
export async function extractAndPersistLore({
  campaignId,
  narrationContent,
  llmService,
  locX = null,
  locY = null,
  insideBurgId = null,
}) {
  if (!narrationContent || narrationContent.length < 50) {
    return [];
  }

  try {
    // 1. Build the entity index for this scope.
    const entityIndex = await buildEntityIndex({
      campaignId,
      scope: { insideBurgId, locX, locY },
    });

    // 2. Format Known entities for the prompt.
    const formatList = (label, items) =>
      items.length === 0 ? null : `${label}: ${items.map((i) => i.name).join(', ')}`;
    const knownLines = [
      formatList('Settlements', entityIndex.burgs),
      formatList('States', entityIndex.states),
      formatList('Regions', entityIndex.regions),
      formatList('NPCs', entityIndex.npcs),
      formatList('Locations', entityIndex.locations),
      formatList('Shops', entityIndex.shops),
    ].filter(Boolean);
    const knownBlock = knownLines.length > 0
      ? knownLines.join('\n')
      : '(none — extract no facts)';

    const userPrompt = `## Known entities (extract facts ONLY about these — do not invent new places, NPCs, or establishments)

${knownBlock}

## Narration to analyse
${narrationContent}`;

    const result = await llmService.generate({
      type: NARRATIVE_TYPES.LORE_EXTRACTION,
      prompt: userPrompt,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      schema: LORE_EXTRACT_SCHEMA,
    });

    let facts = [];
    const raw = result.content || '';
    try {
      const parsed = result.parsed ?? JSON.parse(raw);
      facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    } catch {
      logInfo('Lore extractor: no parseable facts from LLM response', { campaignId });
      return [];
    }

    // 3. Filter to valid sections and non-empty content.
    const validFacts = facts.filter(
      (f) => VALID_SECTIONS.has(f.section) && f.subsection?.trim() && f.content?.trim()
    );

    if (validFacts.length === 0) {
      logInfo('Lore extractor: no new facts found', { campaignId });
      return [];
    }

    // 4. Resolver gate: drop facts whose subsection does not resolve.
    const RESOLVE_KINDS = ['burg', 'state', 'region', 'npc', 'location', 'shop'];
    const resolvedFacts = [];
    for (const fact of validFacts) {
      const resolved = await resolveEntity({
        campaignId,
        name: fact.subsection,
        kinds: RESOLVE_KINDS,
      });
      if (resolved) {
        resolvedFacts.push({ fact, resolved });
      } else {
        logInfo('Lore extractor: dropped unresolved subsection', {
          campaignId,
          subsection: fact.subsection,
          contentPreview: fact.content.slice(0, 80),
        });
      }
    }

    if (resolvedFacts.length === 0) {
      logInfo('Lore extractor: every extracted fact failed entity resolution', { campaignId });
      return [];
    }

    // 5. Persist the survivors.
    const persisted = [];
    for (const { fact } of resolvedFacts) {
      try {
        const { rows } = await query(
          `INSERT INTO campaign_world_lore (campaign_id, section, subsection, content, generated_by)
           VALUES ($1, $2, $3, $4, 'llm')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [campaignId, fact.section, fact.subsection.trim(), fact.content.trim()],
          { label: 'lore-extractor.persist' },
        );
        if (rows.length) {
          persisted.push({ id: rows[0].id, section: fact.section, subsection: fact.subsection });
        }
      } catch (err) {
        logError('Lore extractor: failed to persist fact', { campaignId, fact, error: err.message });
      }
    }

    logInfo('Lore extractor: facts persisted', {
      campaignId,
      extracted: validFacts.length,
      resolved: resolvedFacts.length,
      persisted: persisted.length,
      sections: persisted.map((p) => `${p.section}:${p.subsection}`),
    });

    return persisted;
  } catch (err) {
    logError('Lore extractor: extraction failed', { campaignId, error: err.message });
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/world-building/lore-extractor-gate.test.js
```
Expected: PASS — all five gate scenarios green.

- [ ] **Step 5: Re-run all tests in `tests/world-building` and `tests/llm` to catch regressions**

```
npx jest tests/world-building tests/llm
```
Expected: clean.

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/services/world-building/lore-extractor.js tests/world-building/lore-extractor-gate.test.js
git commit -m "feat(lore-extractor): gate writes against entity-resolver, inject known-entities prompt"
```

---

## Task 4: Wire resolver into `npc-extractor.js`

Inject the Known entities block into the user prompt and add an anti-fabrication clause to the system prompt. No post-LLM resolver call (new NPCs are by definition not yet in `npcs`); the prompt-side push is the only gate.

**Files:**
- Modify: `server/services/world-building/npc-extractor.js`
- Create: `tests/world-building/npc-extractor-prompt.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/world-building/npc-extractor-prompt.test.js
/**
 * @jest-environment node
 *
 * The NPC extractor's hard-gate behaviour (population cap, dedup, PC-name reject)
 * is unchanged by this work. These tests pin the *prompt-side* changes:
 * the new ## Known entities block and the new system-prompt clause.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { pool } from '../../server/db/pool.js';
import { extractAndPersistNpcs } from '../../server/services/world-building/npc-extractor.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

const buildStubLlm = () => {
  const captured = { lastPrompt: null, lastSystemPrompt: null };
  const llmService = {
    generate: jest.fn(async ({ prompt, systemPrompt }) => {
      captured.lastPrompt = prompt;
      captured.lastSystemPrompt = systemPrompt;
      return { parsed: { npcs: [] }, content: JSON.stringify({ npcs: [] }) };
    }),
  };
  return { llmService, captured };
};

describe('npc-extractor — prompt injection', () => {
  let fixture;
  let burgAName;

  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
    const { rows } = await pool.query(
      `SELECT name FROM public.maps_burgs WHERE id = $1`,
      [fixture.playerA.burgId],
    );
    burgAName = rows[0].name;
  });
  afterAll(async () => {
    await fixture.cleanup();
    await pool.end();
  });

  it('injects ## Known entities into the user prompt', async () => {
    const { llmService, captured } = buildStubLlm();
    await extractAndPersistNpcs({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration text for the NPC extractor minimum length, including some incidental detail to mimic real prose.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastPrompt).toMatch(/## Known entities/);
    expect(captured.lastPrompt).toContain(burgAName);
  });

  it('system prompt forbids extracting NPCs anchored to fabricated places', async () => {
    const { llmService, captured } = buildStubLlm();
    await extractAndPersistNpcs({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration text for the NPC extractor minimum length, including some incidental detail to mimic real prose.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastSystemPrompt).toMatch(/anchors an NPC to a place not in Known/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/world-building/npc-extractor-prompt.test.js
```
Expected: FAIL — neither block is currently in the extractor.

- [ ] **Step 3: Modify `npc-extractor.js`**

Add the resolver import:
```javascript
import { buildEntityIndex } from './entity-resolver.js';
```

Append a new line to `EXTRACT_SYSTEM_PROMPT` (currently at npc-extractor.js:73):

```javascript
const EXTRACT_SYSTEM_PROMPT = `You are an NPC extraction tool for a D&D campaign. Given a DM narration, extract any NPCs that were newly introduced.

RULES:
- Only extract NPCs explicitly mentioned in THIS narration. Do not invent.
- An NPC counts if they speak, act, or are clearly described as a present individual.
- Crowds, groups, or generic references ("the villagers", "some sailors") are NOT NPCs — skip those.
- If the narration mentions an NPC by name (e.g. "Karam the shepherd"), use that name.
- If the narration describes an NPC without naming them ("an old woman in a faded indigo headwrap"), use the descriptor as the name.
- A list of "Existing NPCs" is provided. SKIP any NPC that matches an entry in that list — they are already persisted.
- A "Population Cap" tells you the MAXIMUM number of new NPCs you may extract for this location. If the narration introduces more than the cap, extract only the most prominent ones up to the cap.
- A "Current Demographics" breakdown is provided. Avoid extracting NPCs that would make the demographics unrealistic (e.g. don't add a 5th elder to a hamlet of 10 that already has 4 elders).
- A "## Known entities" list of real settlements, NPCs, and shops is provided. If the narration anchors an NPC to a place not in Known settlements (e.g. names a village, tavern, or shop that is not listed), do NOT extract that NPC — they are tied to a fabricated location.
- If no NEW NPCs were introduced, return {"npcs": []}.`;
```

In `extractAndPersistNpcs`, after the `playerCharNames` block (currently around npc-extractor.js:207) and before the existing-NPCs query, build the entity index:

```javascript
    const entityIndex = await buildEntityIndex({
      campaignId,
      scope: { insideBurgId, locX, locY },
    });
    const formatList = (label, items) =>
      items.length === 0 ? null : `${label}: ${items.map((i) => i.name).join(', ')}`;
    const knownLines = [
      formatList('Settlements', entityIndex.burgs),
      formatList('NPCs', entityIndex.npcs),
      formatList('Locations', entityIndex.locations),
      formatList('Shops', entityIndex.shops),
    ].filter(Boolean);
    const knownBlock = knownLines.length > 0 ? knownLines.join('\n') : '(none)';
```

Then prepend `## Known entities` to the existing `userPrompt` template (currently at npc-extractor.js:267) — the new block goes BEFORE `## Location`:

```javascript
    const userPrompt = `## Known entities (do NOT anchor NPCs to places not in this list)
${knownBlock}

## Location
${burgLabel}

## Population Cap
This location can support at most ${totalCap} named NPCs total.
You may extract at most ${remainingSlots} new NPC(s) from this narration.

## Current Demographics
${distSummary}

## Existing NPCs at This Location (DO NOT re-extract these)
${existingList}

## New Narration to Analyse
${narrationContent}`;
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/world-building/npc-extractor-prompt.test.js
```
Expected: PASS.

- [ ] **Step 5: Re-run the world-building suite to catch regressions**

```
npx jest tests/world-building
```
Expected: clean.

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/services/world-building/npc-extractor.js tests/world-building/npc-extractor-prompt.test.js
git commit -m "feat(npc-extractor): inject known-entities block, forbid fabricated-place anchors"
```

---

## Task 5: Tighten `proactive-narrator.js` system prompts

One new line appended to `AREA_DESCRIPTION_SYSTEM_PROMPT` and `WORLD_TURN_SYSTEM_PROMPT`. Existing test file gets one new assertion per prompt.

**Files:**
- Modify: `server/services/narration/proactive-narrator.js`
- Modify: `tests/llm/proactive-narrator-prompts.test.js`

- [ ] **Step 1: Append the failing assertions**

In `tests/llm/proactive-narrator-prompts.test.js`, add to the existing describe block:

```javascript
  it('AREA_DESCRIPTION forbids inventing named establishments', () => {
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/Do not invent named establishments/i);
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/generically/i);
  });

  it('WORLD_TURN forbids inventing named establishments', () => {
    expect(WORLD_TURN_SYSTEM_PROMPT).toMatch(/Do not invent named establishments/i);
    expect(WORLD_TURN_SYSTEM_PROMPT).toMatch(/generically/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/llm/proactive-narrator-prompts.test.js
```
Expected: FAIL on both new cases.

- [ ] **Step 3: Append the new clause to both prompts in `proactive-narrator.js`**

The exact line to append (same wording in both prompts):

```
Do not invent named establishments, shops, taverns, items, or settlements. Refer to commerce, lodging, and goods generically ("a market stall", "an inn", "a clay jug") unless a specific name appears in the geographic or NPC context above.
```

Add it as a final bullet in the existing rules list of `AREA_DESCRIPTION_SYSTEM_PROMPT` (proactive-narrator.js:181-193) and `WORLD_TURN_SYSTEM_PROMPT` (proactive-narrator.js:284-300). Match the existing bullet style (`- ` prefix).

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/llm/proactive-narrator-prompts.test.js
```
Expected: PASS — all assertions including the two new ones.

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/narration/proactive-narrator.js tests/llm/proactive-narrator-prompts.test.js
git commit -m "fix(narration): forbid inventing named establishments in both system prompts"
```

---

## Task 6: Full verification + browser test

No code changes. Verification only.

- [ ] **Step 1: Run the full Jest suite for affected areas**

```
npx jest tests/world-building tests/llm
```
Expected: every test passes.

- [ ] **Step 2: Type-check the whole tree**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Browser verification — area-entry narration in a real burg**

Spin up dev (`npm run dev` from the project root, per the existing convention; verify with `cat package.json | grep -E '"dev":'`). In a clean campaign:

1. Place a player inside a real burg.
2. Trigger area-entry narration.
3. Inspect `campaign_world_lore` for the campaign:
   ```sql
   SELECT section, subsection, content FROM campaign_world_lore
    WHERE campaign_id = '<campaign-id>' AND generated_by = 'llm'
    ORDER BY created_at DESC LIMIT 10;
   ```
   Every `subsection` must resolve to a real burg, state, region, NPC, location, or shop in the campaign. If any row's subsection looks fabricated, capture the row and the original chat narration before proceeding — that's a regression.
4. Confirm the chat message itself reads naturally despite the new "do not invent named establishments" clause. Generic phrasing ("a tavern", "an inn") is fine; the prose should not feel sanitised.

- [ ] **Step 4: Browser verification — world-turn narration**

In the same session, trigger a world-turn narration (any in-game action that fires the world turn). Repeat the lore check from Step 3.

- [ ] **Step 5: Capture log lines for tuning visibility**

The new `logInfo('Lore extractor: dropped unresolved subsection', …)` line fires whenever the gate catches a hallucination. Tail the dev server log during the browser test:

```bash
# In whatever terminal the dev server runs in, watch for:
# Lore extractor: dropped unresolved subsection
```

If it fires constantly, the prompt-side push is too weak. If it fires never, the LLM is following the rule. Either is fine; record what you observed.

- [ ] **Step 6: No commit** unless a regression was found and fixed. If everything is clean, the work is shipped at the Task 5 commit.

---

## Note on a deliberate spec divergence

The spec's Error Handling section 1 says a DB failure on the resolver should make lore-extraction fall back to "permissive — every fact is written, no gate". This plan does NOT implement that. Both `resolveEntity` and `buildEntityIndex` already return `null` / empty index on DB failure (spec section 1 wording stands), but the lore-extractor treats that identically to a legitimately empty scope: drop the fact.

Reason: distinguishing "DB hiccup" from "no scope" requires a side channel (e.g. a `dbFailure` flag on the resolver result), which adds complexity for a behaviour whose only benefit is "preserve potentially-poisoned writes through transient infra failures". The gate's entire purpose is the opposite. If a future operator wants permissive-on-failure, they can add the flag in a follow-up — none of the current code paths ship a regression by erring toward drop.

## Self-Review Checklist (run before claiming complete)

- [ ] Every file path in this plan exists or is created by an earlier task.
- [ ] `tests/world-building/*.test.js` files clean up after themselves via the fixture's `cleanup()` (lore inserts cascade with the campaign delete).
- [ ] `entity-resolver.js` exports `resolveEntity`, `buildEntityIndex`, and `normaliseName`. All three are used by tests or extractors.
- [ ] The `lore-extractor.js` change preserves the existing fire-and-forget call site in `dm-narrator.js:131-141` — the function signature stays compatible.
- [ ] The `npc-extractor.js` change preserves the existing call site in `dm-narrator.js:142-154`.
- [ ] No new schema columns, no new tables, no migrations.
- [ ] No commit on Task 6 (verification-only).
- [ ] `npx tsc --noEmit` is clean.

---

## Out of scope (intentionally deferred)

- **CLI cleanup tool** for retroactive purging of polluted lore/npcs in existing campaigns. Same resolver would power it; track as a follow-up.
- **`resolved_kind`/`resolved_id` columns on `campaign_world_lore`.** Useful for joining lore to its anchor entity, but no current consumer.
- **Items/shops as canonical entities for *unnamed* mentions.** Belongs to the deferred culture-aware naming layer.
- **Two-pass LLM judge** (generate → validate → regenerate). Considered and rejected as too expensive.
- **Hallucination metric / dashboard.** Log-grep is sufficient for this plan.
