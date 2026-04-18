import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/campaigns/movement-config.js', () => ({
  getMovementConfig: () => ({ gridType: 'none', gridSize: 1, originX: 0, originY: 0 }),
  snapToGrid: (x, y) => ({ x, y }),
  computeDistance: () => 0,
  pointWithinBounds: () => true,
}));

const { performPlayerMovement } = await import('../../server/services/campaigns/service.js');

function makeClientWithCapture() {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) return { rows: [{
        id: 'p1', user_id: 'u1', campaign_id: 'c1', visibility_state: 'visible',
        last_located_at: new Date('2026-04-17T12:00:00Z'), prev_x: 0, prev_y: 0,
      }] };
      if (/ST_DWithin/.test(sql)) return { rows: [] };
      if (/SELECT id,\s+visibility_state,/.test(sql)) return { rows: [{
        id: 'p1', visibility_state: 'visible',
        geometry: { type: 'Point', coordinates: [500, 0] },
        last_located_at: new Date('2026-04-17T12:30:00Z'),
      }] };
      if (/INSERT INTO public\.player_movement_paths/.test(sql)) return { rows: [{ id: 'path-1', created_at: new Date() }] };
      if (/FROM public\.maps_world/.test(sql)) return { rows: [{ bounds: null }] };
      return { rows: [] };
    }),
  };
}

test('pathWaypoints: inserts polyline with len(waypoints) ST_MakePoint calls', async () => {
  const client = makeClientWithCapture();
  const waypoints = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 300, y: 100 },
    { x: 500, y: 0 },
  ];
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm', isRequestorAdmin: false,
    targetX: 500, targetY: 0, mode: 'walk', reason: 'narrative',
    source: 'llm',
    pathWaypoints: waypoints,
  });
  const pathInsert = client.queries.find((q) => /INSERT INTO public\.player_movement_paths/.test(q.sql));
  expect(pathInsert).toBeTruthy();
  const makePointCount = (pathInsert.sql.match(/ST_MakePoint\(/g) ?? []).length;
  expect(makePointCount).toBe(4);
});

test('gameDaysElapsed: issues UPDATE campaigns SET campaign_clock_days = campaign_clock_days + N', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm',
    targetX: 500, targetY: 0, mode: 'walk', source: 'llm',
    gameDaysElapsed: 3,
  });
  const clockUpdate = client.queries.find((q) =>
    /UPDATE public\.campaigns/.test(q.sql) && /campaign_clock_days/.test(q.sql),
  );
  expect(clockUpdate).toBeTruthy();
  expect(clockUpdate.params).toEqual(expect.arrayContaining(['c1', 3]));
});

test('no pathWaypoints, no gameDaysElapsed: DM-drag path identical to Plan 1', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'u1', requestorRole: 'dm',
    targetX: 500, targetY: 0, mode: 'walk',
  });
  const pathInsert = client.queries.find((q) => /INSERT INTO public\.player_movement_paths/.test(q.sql));
  const makePointCount = (pathInsert.sql.match(/ST_MakePoint\(/g) ?? []).length;
  expect(makePointCount).toBe(2);
  const clockUpdate = client.queries.find((q) =>
    /UPDATE public\.campaigns/.test(q.sql) && /campaign_clock_days/.test(q.sql),
  );
  expect(clockUpdate).toBeUndefined();
});

test('gameDaysElapsed = 0 does NOT issue clock update', async () => {
  const client = makeClientWithCapture();
  await performPlayerMovement({
    client, campaignId: 'c1', playerId: 'p1',
    requestorUserId: 'llm-system', requestorRole: 'llm',
    targetX: 500, targetY: 0, mode: 'walk', source: 'llm',
    gameDaysElapsed: 0,
  });
  const clockUpdate = client.queries.find((q) =>
    /UPDATE public\.campaigns/.test(q.sql) && /campaign_clock_days/.test(q.sql),
  );
  expect(clockUpdate).toBeUndefined();
});
