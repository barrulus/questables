import { jest } from '@jest/globals';

const FIXTURE_CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID;
const FIXTURE_SESSION_ID = process.env.TEST_SESSION_ID;
const FIXTURE_ACTING_CHAR_ID = process.env.TEST_ACTING_CHAR_ID;
const FIXTURE_BURG_NAME = process.env.TEST_BURG_NAME ?? 'TestBurg';

const skipIfNoFixtures = (FIXTURE_CAMPAIGN_ID && FIXTURE_SESSION_ID && FIXTURE_ACTING_CHAR_ID)
  ? test
  : test.skip;

skipIfNoFixtures('move_player outcome updates loc_current and current_map_level', async () => {
  const { getClient } = await import('../../server/db/pool.js');
  const { applyMechanicalOutcome } = await import('../../server/services/dm-action/service.js');

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
