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
    // There may be multiple burgs with the same name in the world; the resolver
    // returns one of them. We check kind and canonicalName — not the exact id —
    // because name-based resolution cannot guarantee a specific row when names
    // are duplicated in the world data.
    expect(out).not.toBeNull();
    expect(out?.kind).toBe('burg');
    expect(out?.canonicalName).toBe(burgAName);
    expect(typeof out?.id).toBe('string');
  });

  it('resolves with case and whitespace variation', async () => {
    const upper = burgAName.toUpperCase();
    const padded = `   ${burgAName.toLowerCase()}   `;
    const a = await resolveEntity({ campaignId: fixture.campaignId, name: upper, kinds: ['burg'] });
    const b = await resolveEntity({ campaignId: fixture.campaignId, name: padded, kinds: ['burg'] });
    // The resolver matches by normalised name — any matching burg id is correct.
    expect(a?.kind).toBe('burg');
    expect(a?.canonicalName).toBe(burgAName);
    expect(b?.kind).toBe('burg');
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
