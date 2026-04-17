import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/campaigns/utils.js', () => ({
  DEFAULT_VISIBILITY_RADIUS: 500,
  DEFAULT_MAX_MOVE_DISTANCE: 500,
  DEFAULT_MIN_MOVE_INTERVAL_MS: 1000,
}));
jest.unstable_mockModule('../../server/services/campaigns/movement-config.js', () => ({
  getMovementConfig: () => ({ gridType: 'none', gridSize: 1, originX: 0, originY: 0 }),
  snapToGrid: (x, y) => ({ x, y }),
  computeDistance: () => 0,
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
