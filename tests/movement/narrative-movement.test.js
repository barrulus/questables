import { jest } from '@jest/globals';

const resolveDestinationMock = jest.fn();
const planTravelMock = jest.fn();
const evaluateEncounterAtPointMock = jest.fn();
const performPlayerMovementMock = jest.fn();

jest.unstable_mockModule('../../server/services/movement/destination-resolver.js', () => ({
  resolveDestination: resolveDestinationMock,
}));
jest.unstable_mockModule('../../server/services/movement/travel-planner.js', () => ({
  planTravel: planTravelMock,
}));
jest.unstable_mockModule('../../server/services/encounters/proactive-generator.js', () => ({
  evaluateEncounterAtPoint: evaluateEncounterAtPointMock,
  evaluateEncounterChance: jest.fn(),
  generateEncounter: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/campaigns/service.js', () => ({
  performPlayerMovement: performPlayerMovementMock,
}));

const { applyNarrativeMove } = await import('../../server/services/movement/narrative-movement.js');

function baseResolved() {
  return { x: 1500, y: 0, burgId: 'b1', mapLevel: 'settlement', resolvedName: 'Harrowick' };
}
function basePlan() {
  return {
    waypoints:      [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }, { x: 1500, y: 0 }],
    distancePixels: 1500,
    distanceMiles:  150,
    totalDays:      3,
    campPoints:     [
      { x: 500,  y: 0, day: 1 },
      { x: 1000, y: 0, day: 2 },
    ],
    effectiveVia:   'roads',
    dailyPixels:    500,
  };
}
function baseMoveResult() {
  return {
    player: {
      id: 'p1', visibility_state: 'visible',
      geometry: { type: 'Point', coordinates: [1500, 0] },
      last_located_at: new Date('2026-04-17T14:00:00Z'),
    },
    requestedDistance: 1500,
    requestedTarget: { x: 1500, y: 0 },
    snappedTarget:   { x: 1500, y: 0 },
    grid: { type: 'none', size: 1, origin: { x: 0, y: 0 } },
    pathId: 'path-1',
  };
}

function makeClient(extraRows = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/ST_X\(loc_current\)/.test(sql)) return { rows: [{ x: 0, y: 0 }] };
      if (/SELECT world_map_id FROM public\.campaigns/.test(sql))
        return { rows: [{ world_map_id: 'w1' }] };
      if (/SELECT campaign_clock_days FROM public\.campaigns/.test(sql))
        return { rows: [{ campaign_clock_days: extraRows.clockDay ?? 3 }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  resolveDestinationMock.mockReset();
  planTravelMock.mockReset();
  evaluateEncounterAtPointMock.mockReset();
  performPlayerMovementMock.mockReset();
});

test('no encounter: full arrival, clock advances by totalDays', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue(basePlan());
  evaluateEncounterAtPointMock.mockResolvedValue(false);
  performPlayerMovementMock.mockResolvedValue(baseMoveResult());

  const wsServer = { broadcastToCampaign: jest.fn() };
  const result = await applyNarrativeMove(makeClient({ clockDay: 3 }), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    mode: 'walk', via: 'roads',
    wsServer,
  });

  expect(performPlayerMovementMock).toHaveBeenCalledWith(expect.objectContaining({
    targetX: 1500, targetY: 0, source: 'llm',
    pathWaypoints: basePlan().waypoints,
    gameDaysElapsed: 3,
  }));
  expect(result.travel).toMatchObject({
    totalDaysPlanned: 3, daysElapsed: 3, interrupted: false, effectiveVia: 'roads',
  });
  expect(result.clockDay).toBe(3);
  expect(result.encounter).toBeNull();
  expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith('c1', 'player-moved',
    expect.objectContaining({ path: expect.any(Object), travel: expect.any(Object) }));
});

test('encounter on day 2 of 3: interrupted at camp[1], daysElapsed=2, polyline truncated', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue(basePlan());
  evaluateEncounterAtPointMock
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  performPlayerMovementMock.mockResolvedValue({
    ...baseMoveResult(),
    player: { ...baseMoveResult().player,
              geometry: { type: 'Point', coordinates: [1000, 0] } },
    requestedTarget: { x: 1000, y: 0 },
    snappedTarget:   { x: 1000, y: 0 },
  });

  const result = await applyNarrativeMove(makeClient({ clockDay: 2 }), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    mode: 'walk', via: 'roads',
  });

  expect(performPlayerMovementMock).toHaveBeenCalledWith(expect.objectContaining({
    targetX: 1000, targetY: 0,
    gameDaysElapsed: 2,
    pathWaypoints: expect.arrayContaining([{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
  }));
  expect(result.travel.interrupted).toBe(true);
  expect(result.travel.daysElapsed).toBe(2);
});

test('teleport (0 days): skips encounter loop, no clock update', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue({
    ...basePlan(),
    totalDays: 0, campPoints: [], dailyPixels: Infinity,
  });
  performPlayerMovementMock.mockResolvedValue(baseMoveResult());

  await applyNarrativeMove(makeClient({ clockDay: 0 }), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    mode: 'teleport',
  });

  expect(evaluateEncounterAtPointMock).not.toHaveBeenCalled();
  expect(performPlayerMovementMock).toHaveBeenCalledWith(expect.objectContaining({
    gameDaysElapsed: 0,
  }));
});

test('works without wsServer (broadcast is best-effort)', async () => {
  resolveDestinationMock.mockResolvedValue(baseResolved());
  planTravelMock.mockResolvedValue(basePlan());
  evaluateEncounterAtPointMock.mockResolvedValue(false);
  performPlayerMovementMock.mockResolvedValue(baseMoveResult());

  const result = await applyNarrativeMove(makeClient(), {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
  });
  expect(result.playerId).toBe('p1');
});
