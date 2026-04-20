import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/movement/destination-resolver.js', () => ({
  resolveDestination: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/movement/travel-planner.js', () => ({
  planTravel: jest.fn(),
}));
jest.unstable_mockModule('../../server/services/movement/gate-picker.js', () => ({
  pickArrivalGate: jest.fn(),
  retargetPlanToGate: jest.fn((plan, gate) => (gate
    ? { ...plan, waypoints: [...plan.waypoints.slice(0, -1), { x: gate.x, y: gate.y }] }
    : plan)),
}));
jest.unstable_mockModule('../../server/services/campaigns/service.js', () => ({
  performPlayerMovement: jest.fn(async () => ({
    player: { id: 'p1', geometry: null, visibility_state: 'visible', last_located_at: new Date() },
    requestedDistance: 0,
    pathId: 'path-1',
    requestedTarget: null,
    snappedTarget: null,
    grid: null,
  })),
}));
jest.unstable_mockModule('../../server/services/encounters/proactive-generator.js', () => ({
  evaluateEncounterAtPoint: jest.fn(async () => false),
}));

const destModule   = await import('../../server/services/movement/destination-resolver.js');
const plannerModule = await import('../../server/services/movement/travel-planner.js');
const gateModule    = await import('../../server/services/movement/gate-picker.js');
const campaignsModule = await import('../../server/services/campaigns/service.js');
const { applyNarrativeMove } = await import('../../server/services/movement/narrative-movement.js');

function fakeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (/ST_X\(loc_current\)/.test(sql)) return { rows: [{ x: 10, y: 10 }] };
      if (/world_map_id/.test(sql))         return { rows: [{ world_map_id: 'w1' }] };
      if (/campaign_clock_days/.test(sql))  return { rows: [{ campaign_clock_days: 3 }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

test('retargets effective end to gate and surfaces arrival.gate in summary', async () => {
  destModule.resolveDestination.mockResolvedValue({
    x: 500, y: 500, burgId: 'burg-1', mapLevel: 'settlement', resolvedName: 'Foo',
  });
  plannerModule.planTravel.mockResolvedValue({
    waypoints: [{ x: 10, y: 10 }, { x: 500, y: 500 }],
    distancePixels: 691, distanceMiles: null, totalDays: 2,
    campPoints: [{ x: 255, y: 255, day: 1 }],
    effectiveVia: 'roads', dailyPixels: 500,
  });
  gateModule.pickArrivalGate.mockResolvedValue({
    entranceId: 'ent-s', gateId: 'g3', x: 510, y: 510,
    bearingDeg: 180, kind: 'land', subKind: 'road',
    name: 'South Gate', matchedBy: 'route_id',
  });

  const client = fakeClient();
  const summary = await applyNarrativeMove(client, {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'u1',
    destination: { kind: 'burg', ref: 'Foo' },
    reason: 'test',
    mode: 'walk', via: 'roads',
  });

  expect(gateModule.retargetPlanToGate).toHaveBeenCalled();
  const performArgs = campaignsModule.performPlayerMovement.mock.calls[0][0];
  expect(performArgs.targetX).toBe(510);
  expect(performArgs.targetY).toBe(510);
  expect(performArgs.arrivalGateEntranceId).toBe('ent-s');
  expect(summary.arrival).toEqual({
    gate: {
      id: 'ent-s', gateId: 'g3', name: 'South Gate',
      kind: 'land', subKind: 'road', matchedBy: 'route_id',
    },
  });
});

test('arrival.gate is null when pickArrivalGate returns null', async () => {
  destModule.resolveDestination.mockResolvedValue({
    x: 500, y: 500, burgId: 'burg-1', mapLevel: 'settlement', resolvedName: 'Foo',
  });
  plannerModule.planTravel.mockResolvedValue({
    waypoints: [{ x: 10, y: 10 }, { x: 500, y: 500 }],
    distancePixels: 691, distanceMiles: null, totalDays: 2,
    campPoints: [], effectiveVia: 'direct', dailyPixels: 500,
  });
  gateModule.pickArrivalGate.mockResolvedValue(null);

  const client = fakeClient();
  const summary = await applyNarrativeMove(client, {
    campaignId: 'c1', playerId: 'p1', sessionId: 's1',
    requestorUserId: 'u1',
    destination: { kind: 'burg', ref: 'Foo' },
    mode: 'walk', via: 'direct',
  });
  expect(summary.arrival).toEqual({ gate: null });
  const performArgs = campaignsModule.performPlayerMovement.mock.calls[0][0];
  expect(performArgs.targetX).toBe(500);
  expect(performArgs.targetY).toBe(500);
  expect(performArgs.arrivalGateEntranceId ?? null).toBeNull();
});
