/**
 * @jest-environment node
 *
 * Real-DB integration tests for the entity-resolver. Reuses the campaign
 * fixture from the 2026-05-04 LLM context engine work — same DB, same
 * cleanup pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { pool } from '../../server/db/pool.js';
import { resolveEntity, normaliseName, buildEntityIndex } from '../../server/services/world-building/entity-resolver.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

// Single global pool teardown — runs after ALL describe blocks finish.
// Each describe block only cleans up its own fixture, not the pool.
afterAll(async () => {
  await pool.end();
});

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  Hello World  ')).toBe('hello world');
  });

  it('strips punctuation', () => {
    expect(normaliseName("Mira's General Store!")).toBe('miras general store');
  });

  it('collapses multiple spaces into one', () => {
    expect(normaliseName('foo   bar')).toBe('foo bar');
  });

  it('does not corrupt names containing the letters s, p, a, c, e', () => {
    // Regression test: a buggy regex /[[:space:]]+/g would treat the
    // characters {s, p, a, c, e} as whitespace and collapse runs of
    // them. Verify these names round-trip cleanly.
    expect(normaliseName('Spacer')).toBe('spacer');
    expect(normaliseName('Escape')).toBe('escape');
    expect(normaliseName('Cape Spear')).toBe('cape spear');
  });

  it('handles tabs and newlines — strips them (non-alphanumeric/space chars removed first)', () => {
    // The first .replace(/[^a-z0-9 ]+/g, '') removes tabs and newlines outright
    // before the \s+ collapse runs.  Spaces embedded in the original string are
    // preserved and collapsed; tabs/newlines disappear without a space substitute.
    expect(normaliseName('foo\tbar\nbaz')).toBe('foobarbaz');
    // But a tab that sits between words where there is also a space does collapse:
    expect(normaliseName('foo \t bar')).toBe('foo bar');
  });

  it('returns empty string for non-string input', () => {
    expect(normaliseName(null)).toBe('');
    expect(normaliseName(undefined)).toBe('');
    expect(normaliseName(42)).toBe('');
  });
});

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
    // pool.end() is handled by the global afterAll at the top of this file.
  });

  it('resolves a real burg by exact name', async () => {
    const { rows: candidates } = await pool.query(
      `SELECT b.id FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
          AND btrim(regexp_replace(lower(regexp_replace(b.name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g'))
            = btrim(regexp_replace(lower(regexp_replace($2,    '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g'))`,
      [fixture.campaignId, burgAName],
    );
    const validIds = new Set(candidates.map((r) => r.id));
    expect(candidates.length).toBeGreaterThan(0);

    const out = await resolveEntity({
      campaignId: fixture.campaignId, name: burgAName, kinds: ['burg'],
    });
    expect(out?.kind).toBe('burg');
    expect(out?.canonicalName).toBe(burgAName);
    expect(validIds.has(out?.id)).toBe(true);
  });

  it('resolves with case and whitespace variation', async () => {
    const { rows: candidates } = await pool.query(
      `SELECT b.id FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
          AND btrim(regexp_replace(lower(regexp_replace(b.name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g'))
            = btrim(regexp_replace(lower(regexp_replace($2,    '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g'))`,
      [fixture.campaignId, burgAName],
    );
    const validIds = new Set(candidates.map((r) => r.id));

    const upper = burgAName.toUpperCase();
    const padded = `   ${burgAName.toLowerCase()}   `;
    const a = await resolveEntity({ campaignId: fixture.campaignId, name: upper, kinds: ['burg'] });
    const b = await resolveEntity({ campaignId: fixture.campaignId, name: padded, kinds: ['burg'] });
    expect(validIds.has(a?.id)).toBe(true);
    expect(validIds.has(b?.id)).toBe(true);
    expect(a?.canonicalName).toBe(burgAName);
    expect(b?.canonicalName).toBe(burgAName);
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
    // pool.end() is handled by the global afterAll at the top of this file.
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
