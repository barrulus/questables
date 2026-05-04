/**
 * @jest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { LLMContextManager } from '../../server/llm/context/context-manager.js';
import { pool } from '../../server/db/pool.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

let fixture;

beforeAll(async () => {
  fixture = await createTestCampaignWithTwoPlayers();
});

afterAll(async () => {
  await fixture.cleanup();
  await pool.end();
});

describe('LLMContextManager.buildGameContext — actingUserId', () => {
  it('uses acting-player position for geography when actingUserId is supplied', async () => {
    const ctx = new LLMContextManager({ pool });
    const ctxBuiltForA = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerA.userId,
    });
    expect(ctxBuiltForA.geographic?.insideBurgId).toBe(fixture.playerA.burgId);
    // Prove the downstream PostGIS query keyed off the supplied position —
    // a bug where buildGeographicContext ignored insideBurgId would still pass
    // the assertion above, since insideBurgId is plumbed through directly.
    expect(ctxBuiltForA.geographic?.currentBurg?.name).toBeDefined();
    const burgNameA = ctxBuiltForA.geographic.currentBurg.name;

    const ctxBuiltForB = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerB.userId,
    });
    expect(ctxBuiltForB.geographic?.insideBurgId).toBe(fixture.playerB.burgId);
    expect(ctxBuiltForB.geographic?.currentBurg?.name).toBeDefined();
    expect(ctxBuiltForB.geographic.currentBurg.name).not.toBe(burgNameA);
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

describe('LLMContextManager.#loadRecentMessages — chat-history scoping', () => {
  // Track everything inserted by this describe block so afterEach can clean up
  // cleanly even when an assertion throws mid-test.
  const insertedMessageIds = [];
  const insertedSessionIds = [];

  afterEach(async () => {
    const client = await pool.connect();
    try {
      if (insertedMessageIds.length) {
        await client.query(
          `DELETE FROM public.chat_messages WHERE id = ANY($1::uuid[])`,
          [insertedMessageIds.splice(0)],
        );
      }
      if (insertedSessionIds.length) {
        await client.query(
          `DELETE FROM public.sessions WHERE id = ANY($1::uuid[])`,
          [insertedSessionIds.splice(0)],
        );
      }
    } finally {
      client.release();
    }
  });

  async function insertMessage(client, { sessionId, content, createdAt }) {
    const params = [
      fixture.campaignId,
      sessionId,
      content,
      'text',
      fixture.playerA.userId,
      `${content}-sender`,
    ];
    let createdAtClause = 'DEFAULT';
    if (createdAt) {
      params.push(createdAt);
      createdAtClause = `$${params.length}`;
    }
    const { rows } = await client.query(
      `INSERT INTO public.chat_messages
         (campaign_id, session_id, content, message_type, sender_id, sender_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${createdAtClause})
       RETURNING id`,
      params,
    );
    insertedMessageIds.push(rows[0].id);
    return rows[0].id;
  }

  it('Case A — strict session scoping: only the supplied session\'s messages are returned', async () => {
    const client = await pool.connect();
    let priorSessionId;
    try {
      // Create a separate "prior" session on the same campaign so we have
      // somewhere distinct to anchor the leaking message.
      const { rows: priorSessionRows } = await client.query(
        `INSERT INTO public.sessions (campaign_id, session_number, title, status, game_state)
           VALUES ($1, 99, $2, 'completed', '{}'::jsonb)
         RETURNING id`,
        [fixture.campaignId, 'task2-prior-session'],
      );
      priorSessionId = priorSessionRows[0].id;
      insertedSessionIds.push(priorSessionId);

      await insertMessage(client, {
        sessionId: fixture.sessionId,
        content: 'TASK2_CURRENT_SESSION',
      });
      await insertMessage(client, {
        sessionId: priorSessionId,
        content: 'TASK2_PRIOR_SESSION',
      });
      // Regression guard for the OR-NULL clause: a session_id=NULL message
      // (e.g. a system event) used to leak into every session's prompt.
      await insertMessage(client, {
        sessionId: null,
        content: 'TASK2_NULL_SESSION',
      });
    } finally {
      client.release();
    }

    const ctx = new LLMContextManager({ pool });
    const built = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
    });

    const contents = built.chat.recentMessages.map((m) => m.content);
    expect(contents).toContain('TASK2_CURRENT_SESSION');
    expect(contents).not.toContain('TASK2_PRIOR_SESSION');
    expect(contents).not.toContain('TASK2_NULL_SESSION');
  });

  it('Case B — recency window: only messages from the last 6 hours appear when sessionId is omitted', async () => {
    // To exercise the no-session branch in #loadRecentMessages we need
    // #loadSession to return null. The shared fixture's campaign always has a
    // session, so spin up a tiny dedicated campaign with no session at all,
    // then delete it on the way out — chat_messages cascades on campaign delete.
    const client = await pool.connect();
    let scratchCampaignId;
    try {
      const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const { rows: campRows } = await client.query(
        `INSERT INTO public.campaigns (name, dm_user_id, status)
           VALUES ($1, $2, 'active')
         RETURNING id`,
        [`task2-recency-${suffix}`, fixture.playerA.userId],
      );
      scratchCampaignId = campRows[0].id;

      const recentParams = [
        scratchCampaignId,
        null,
        'TASK2_RECENT',
        'text',
        fixture.playerA.userId,
        'TASK2_RECENT-sender',
      ];
      const { rows: recentRows } = await client.query(
        `INSERT INTO public.chat_messages
           (campaign_id, session_id, content, message_type, sender_id, sender_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        recentParams,
      );
      insertedMessageIds.push(recentRows[0].id);

      const oldParams = [
        scratchCampaignId,
        null,
        'TASK2_OLD',
        'text',
        fixture.playerA.userId,
        'TASK2_OLD-sender',
        new Date(Date.now() - 7 * 60 * 60 * 1000),
      ];
      const { rows: oldRows } = await client.query(
        `INSERT INTO public.chat_messages
           (campaign_id, session_id, content, message_type, sender_id, sender_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        oldParams,
      );
      insertedMessageIds.push(oldRows[0].id);
    } finally {
      client.release();
    }

    try {
      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({
        campaignId: scratchCampaignId,
        // sessionId intentionally omitted — and the scratch campaign has none,
        // so #loadSession returns null and #loadRecentMessages takes the
        // no-session/recency branch.
      });

      const contents = built.chat.recentMessages.map((m) => m.content);
      expect(contents).toContain('TASK2_RECENT');
      expect(contents).not.toContain('TASK2_OLD');
    } finally {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query(
          `DELETE FROM public.campaigns WHERE id = $1`,
          [scratchCampaignId],
        );
      } finally {
        cleanupClient.release();
      }
    }
  });
});

describe('LLMContextManager — known-location default + currentBurg surfacing', () => {
  it('omits undiscovered locations by default', async () => {
    const client = await pool.connect();
    let inserted = [];
    try {
      const known = await client.query(
        `INSERT INTO public.locations (campaign_id, name, type, is_discovered)
         VALUES ($1, 'TASK3_KNOWN_LOC', 'wilderness', true) RETURNING id`,
        [fixture.campaignId],
      );
      const hidden = await client.query(
        `INSERT INTO public.locations (campaign_id, name, type, is_discovered)
         VALUES ($1, 'TASK3_HIDDEN_LOC', 'dungeon', false) RETURNING id`,
        [fixture.campaignId],
      );
      inserted = [known.rows[0].id, hidden.rows[0].id];

      const ctx = new LLMContextManager({ pool });
      const built = await ctx.buildGameContext({ campaignId: fixture.campaignId });
      const names = built.locations.map((l) => l.name);
      expect(names).toContain('TASK3_KNOWN_LOC');
      expect(names).not.toContain('TASK3_HIDDEN_LOC');
    } finally {
      if (inserted.length) {
        await client.query('DELETE FROM public.locations WHERE id = ANY($1::uuid[])', [inserted]);
      }
      client.release();
    }
  });

  it('exposes currentBurg distinct from nearbyBurgs', async () => {
    const ctx = new LLMContextManager({ pool });
    const built = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerA.userId,
    });
    expect(built.geographic?.currentBurg?.id).toBe(fixture.playerA.burgId);
    const nearbyIds = built.geographic.nearbyBurgs.map((b) => b.id);
    expect(nearbyIds).not.toContain(fixture.playerA.burgId);
  });
});

describe('LLMContextManager.buildGameContext — lore weighting', () => {
  it('prefers state-matched lore over global, drops unrelated subsections', async () => {
    const ctx = new LLMContextManager({ pool });
    const client = await pool.connect();
    let inserted = [];
    try {
      // Look up the actual statefull for the fixture's playerA burg so we can
      // insert state-matched lore that the loader will recognise.
      const { rows: [{ statefull }] } = await client.query(
        `SELECT statefull FROM public.maps_burgs WHERE id = $1`,
        [fixture.playerA.burgId],
      );
      // Skip if the fixture burg has no statefull — the test relies on it.
      if (!statefull) {
        // eslint-disable-next-line no-console
        console.warn('Skipping lore weighting test — fixture burg has no statefull');
        return;
      }

      // section must be one of the values in campaign_world_lore_section_check
      // (history, cultures, religions, regions, factions, ...). 'cultures' is
      // the closest match to the spec's intended 'culture'.
      const result = await client.query(
        `INSERT INTO public.campaign_world_lore (campaign_id, section, subsection, content)
         VALUES
           ($1, 'history',  NULL,        'TASK4_GLOBAL'),
           ($1, 'history',  $2,          'TASK4_STATE_MATCH'),
           ($1, 'cultures', 'Atlantis',  'TASK4_UNRELATED_1'),
           ($1, 'cultures', 'Lemuria',   'TASK4_UNRELATED_2'),
           ($1, 'cultures', 'Mu',        'TASK4_UNRELATED_3'),
           ($1, 'cultures', 'Pangaea',   'TASK4_UNRELATED_4'),
           ($1, 'cultures', 'Avalon',    'TASK4_UNRELATED_5'),
           ($1, 'cultures', 'Eldorado',  'TASK4_UNRELATED_6')
         RETURNING id`,
        [fixture.campaignId, statefull],
      );
      inserted = result.rows.map((r) => r.id);

      const built = await ctx.buildGameContext({
        campaignId: fixture.campaignId,
        sessionId: fixture.sessionId,
        actingUserId: fixture.playerA.userId,
      });
      const contents = built.worldLore.map((l) => l.content);
      // Filter to only the rows this test inserted (other tests may inject lore
      // earlier and the loader's MAX_LORE_SECTIONS cap is 6 globally).
      const ours = contents.filter((c) => c.startsWith('TASK4_'));
      expect(ours[0]).toBe('TASK4_STATE_MATCH');
      expect(ours).toContain('TASK4_GLOBAL');
      const hasUnrelated = ours.some((c) => c.startsWith('TASK4_UNRELATED_'));
      expect(hasUnrelated).toBe(false);
    } finally {
      if (inserted.length) {
        await client.query(
          'DELETE FROM public.campaign_world_lore WHERE id = ANY($1::uuid[])',
          [inserted],
        );
      }
      client.release();
    }
  });
});
