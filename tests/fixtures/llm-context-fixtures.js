/**
 * Fixture helper for LLM context-engine integration tests.
 *
 * Creates a campaign with two players, each at a different burg, in a session
 * whose `gameState.activePlayerId` is playerA. Reuses an existing world map
 * and existing burgs from the dev DB rather than seeding new map data.
 *
 * Returns `{ campaignId, sessionId, playerA, playerB, cleanup }`. Always call
 * `cleanup()` in `afterAll` — it deletes the campaign (cascades to dependents)
 * and the temporary user_profiles rows.
 */

import { pool } from '../../server/db/pool.js';

const FIXTURE_TAG = 'fixture-context';

/**
 * Build a fixture campaign with two players at two different burgs.
 *
 * @returns {Promise<{
 *   campaignId: string,
 *   sessionId: string,
 *   worldMapId: string,
 *   playerA: { userId: string, characterId: string, burgId: string },
 *   playerB: { userId: string, characterId: string, burgId: string },
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function createTestCampaignWithTwoPlayers() {
  const client = await pool.connect();
  const createdUserIds = [];
  let campaignId = null;

  try {
    await client.query('BEGIN');

    // Pick the most recent world map that has at least two burgs.
    const { rows: worldRows } = await client.query(
      `SELECT id FROM public.maps_world
        WHERE id IN (SELECT world_id FROM public.maps_burgs GROUP BY world_id HAVING COUNT(*) >= 2)
        ORDER BY created_at DESC
        LIMIT 1`,
    );
    if (!worldRows.length) {
      throw new Error('No world map with at least two burgs found in dev DB');
    }
    const worldMapId = worldRows[0].id;

    // Pick two distinct burgs on this world.
    const { rows: burgRows } = await client.query(
      `SELECT id, ST_X(geom) AS x, ST_Y(geom) AS y
         FROM public.maps_burgs
        WHERE world_id = $1
        ORDER BY id
        LIMIT 2`,
      [worldMapId],
    );
    if (burgRows.length < 2) {
      throw new Error(`World ${worldMapId} has fewer than 2 burgs`);
    }
    const burgA = burgRows[0];
    const burgB = burgRows[1];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // DM user (also the campaign owner)
    const { rows: dmRows } = await client.query(
      `INSERT INTO public.user_profiles (username, email, roles, status)
         VALUES ($1, $2, ARRAY['dm','player'], 'active')
       RETURNING id`,
      [`${FIXTURE_TAG}-dm-${suffix}`, `${FIXTURE_TAG}-dm-${suffix}@example.test`],
    );
    const dmUserId = dmRows[0].id;
    createdUserIds.push(dmUserId);

    // Two player users
    const { rows: pARows } = await client.query(
      `INSERT INTO public.user_profiles (username, email, roles, status)
         VALUES ($1, $2, ARRAY['player'], 'active')
       RETURNING id`,
      [`${FIXTURE_TAG}-pa-${suffix}`, `${FIXTURE_TAG}-pa-${suffix}@example.test`],
    );
    const playerAUserId = pARows[0].id;
    createdUserIds.push(playerAUserId);

    const { rows: pBRows } = await client.query(
      `INSERT INTO public.user_profiles (username, email, roles, status)
         VALUES ($1, $2, ARRAY['player'], 'active')
       RETURNING id`,
      [`${FIXTURE_TAG}-pb-${suffix}`, `${FIXTURE_TAG}-pb-${suffix}@example.test`],
    );
    const playerBUserId = pBRows[0].id;
    createdUserIds.push(playerBUserId);

    // Characters owned by each player
    const { rows: chARows } = await client.query(
      `INSERT INTO public.characters (user_id, name, class, race, background)
         VALUES ($1, $2, 'Fighter', 'Human', 'Soldier')
       RETURNING id`,
      [playerAUserId, `${FIXTURE_TAG}-charA-${suffix}`],
    );
    const characterAId = chARows[0].id;

    const { rows: chBRows } = await client.query(
      `INSERT INTO public.characters (user_id, name, class, race, background)
         VALUES ($1, $2, 'Wizard', 'Elf', 'Sage')
       RETURNING id`,
      [playerBUserId, `${FIXTURE_TAG}-charB-${suffix}`],
    );
    const characterBId = chBRows[0].id;

    // Campaign
    const { rows: campRows } = await client.query(
      `INSERT INTO public.campaigns (name, dm_user_id, world_map_id, status)
         VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [`${FIXTURE_TAG}-${suffix}`, dmUserId, worldMapId],
    );
    campaignId = campRows[0].id;

    // Session — gameState.activePlayerId points to player A
    const gameState = {
      phase: 'exploration',
      roundNumber: 1,
      turnOrder: [playerAUserId, playerBUserId],
      activePlayerId: playerAUserId,
    };
    const { rows: sessionRows } = await client.query(
      `INSERT INTO public.sessions (campaign_id, session_number, title, status, game_state)
         VALUES ($1, 1, $2, 'active', $3::jsonb)
       RETURNING id`,
      [campaignId, `${FIXTURE_TAG}-session`, JSON.stringify(gameState)],
    );
    const sessionId = sessionRows[0].id;

    // Campaign players — each pinned inside a different burg.
    // loc_current uses SRID 0, matching the schema's check constraint.
    await client.query(
      `INSERT INTO public.campaign_players
         (campaign_id, user_id, character_id, status, loc_current, inside_burg_id, last_located_at)
       VALUES ($1, $2, $3, 'active',
               ST_SetSRID(ST_MakePoint($4, $5), 0), $6, NOW())`,
      [campaignId, playerAUserId, characterAId, Number(burgA.x), Number(burgA.y), burgA.id],
    );
    await client.query(
      `INSERT INTO public.campaign_players
         (campaign_id, user_id, character_id, status, loc_current, inside_burg_id, last_located_at)
       VALUES ($1, $2, $3, 'active',
               ST_SetSRID(ST_MakePoint($4, $5), 0), $6, NOW() - INTERVAL '1 minute')`,
      [campaignId, playerBUserId, characterBId, Number(burgB.x), Number(burgB.y), burgB.id],
    );

    await client.query('COMMIT');

    const cleanup = async () => {
      const c = await pool.connect();
      try {
        // Campaign delete cascades to sessions, campaign_players, etc.
        if (campaignId) {
          await c.query(`DELETE FROM public.campaigns WHERE id = $1`, [campaignId]);
        }
        // Characters cascade with the user_profiles delete (FK ON DELETE CASCADE).
        if (createdUserIds.length) {
          await c.query(
            `DELETE FROM public.user_profiles WHERE id = ANY($1::uuid[])`,
            [createdUserIds],
          );
        }
      } finally {
        c.release();
      }
    };

    return {
      campaignId,
      sessionId,
      worldMapId,
      playerA: {
        userId: playerAUserId,
        characterId: characterAId,
        burgId: burgA.id,
      },
      playerB: {
        userId: playerBUserId,
        characterId: characterBId,
        burgId: burgB.id,
      },
      cleanup,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Best-effort cleanup of anything that survived the rollback (rare —
    // user_profiles are inside the transaction so they roll back too).
    if (createdUserIds.length) {
      const c = await pool.connect();
      try {
        await c.query(
          `DELETE FROM public.user_profiles WHERE id = ANY($1::uuid[])`,
          [createdUserIds],
        ).catch(() => {});
      } finally {
        c.release();
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
