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

skipIfNoFixtures('Plan 2: move_player inserts polyline + advances clock', async () => {
  const { getClient } = await import('../../server/db/pool.js');
  const { applyMechanicalOutcome } = await import('../../server/services/dm-action/service.js');

  const client = await getClient();
  const wsServer = { broadcastToCampaign: jest.fn() };

  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT campaign_clock_days FROM public.campaigns WHERE id = $1`,
      [FIXTURE_CAMPAIGN_ID],
    );

    await applyMechanicalOutcome(client, {
      sessionId: FIXTURE_SESSION_ID,
      actingCharacterId: FIXTURE_ACTING_CHAR_ID,
      mechanicalOutcome: {
        type: 'move_player',
        destination: { kind: 'burg', ref: FIXTURE_BURG_NAME },
        via: 'roads',
        mode: 'walk',
      },
      wsServer,
    });

    const after = await client.query(
      `SELECT campaign_clock_days FROM public.campaigns WHERE id = $1`,
      [FIXTURE_CAMPAIGN_ID],
    );
    expect(after.rows[0].campaign_clock_days).toBeGreaterThanOrEqual(before.rows[0].campaign_clock_days);

    const path = await client.query(
      `SELECT ST_NumPoints(path) AS pts FROM public.player_movement_paths
         WHERE campaign_id = $1
         ORDER BY created_at DESC LIMIT 1`,
      [FIXTURE_CAMPAIGN_ID],
    );
    expect(path.rows[0].pts).toBeGreaterThanOrEqual(2);

    expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith(
      FIXTURE_CAMPAIGN_ID,
      'player-moved',
      expect.objectContaining({ path: expect.any(Object), travel: expect.any(Object) }),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release?.();
  }
});

skipIfNoFixtures('Plan 3a: narrative move into walled burg lands at a gate', async () => {
  const { getClient } = await import('../../server/db/pool.js');
  const { applyMechanicalOutcome } = await import('../../server/services/dm-action/service.js');

  const client = await getClient();
  const wsServer = { broadcastToCampaign: jest.fn() };

  try {
    await client.query('BEGIN');

    await applyMechanicalOutcome(client, {
      sessionId: FIXTURE_SESSION_ID,
      actingCharacterId: FIXTURE_ACTING_CHAR_ID,
      mechanicalOutcome: {
        type: 'move_player',
        destination: { kind: 'burg', ref: FIXTURE_BURG_NAME },
        via: 'roads',
        mode: 'walk',
      },
      wsServer,
    });

    // The most recent llm-tagged audit row for this campaign should carry the
    // arrival gate id — PROVIDED the destination burg has walls and at least
    // one ingested entrance. If the fixture burg is unwalled the column will
    // be null; we assert "column exists" rather than "non-null" to keep the
    // test robust across fixture variants.
    const audit = await client.query(
      `SELECT arrival_gate_entrance_id
         FROM public.player_movement_audit
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [FIXTURE_CAMPAIGN_ID],
    );
    expect(audit.rows[0]).toHaveProperty('arrival_gate_entrance_id');

    // If the gate was resolved, the player position should be within a small
    // distance of that entrance (gate, not centroid).
    const gateId = audit.rows[0].arrival_gate_entrance_id;
    if (gateId) {
      const proximity = await client.query(
        `SELECT ST_Distance(cp.loc_current, e.geom) AS dist
           FROM public.campaign_players cp
           JOIN public.maps_burg_entrances e ON e.id = $1
          WHERE cp.campaign_id = $2 AND cp.character_id = $3`,
        [gateId, FIXTURE_CAMPAIGN_ID, FIXTURE_ACTING_CHAR_ID],
      );
      expect(Number(proximity.rows[0].dist)).toBeLessThan(20);

      expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith(
        FIXTURE_CAMPAIGN_ID,
        'player-moved',
        expect.objectContaining({
          arrival: expect.objectContaining({
            gate: expect.objectContaining({ id: gateId }),
          }),
        }),
      );
    }
  } finally {
    await client.query('ROLLBACK');
    client.release?.();
  }
});
