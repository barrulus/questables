import { jest } from '@jest/globals';
import { pickArrivalGate, retargetPlanToGate } from '../../server/services/movement/gate-picker.js';

function makeClient(entranceRows) {
  return {
    query: jest.fn(async () => ({ rows: entranceRows })),
  };
}

const gateA = {
  id: 'ent-a', gate_id: 'g1', route_id: 'route-a',
  x_px: 100, y_px: 100, bearing_deg: 0,
  bearing_match_delta_deg: 3, kind: 'land', sub_kind: 'road', name: null,
};
const gateB = {
  id: 'ent-b', gate_id: 'g2', route_id: 'route-b',
  x_px: 200, y_px: 200, bearing_deg: 180,
  bearing_match_delta_deg: 7, kind: 'land', sub_kind: 'road', name: 'South Gate',
};

describe('pickArrivalGate — early outs', () => {
  test('returns null when destination kind is not burg', async () => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'roads', waypoints: [] },
      destination: { kind: 'coordinate', burgId: null },
    });
    expect(gate).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('returns null when burgId missing', async () => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'roads', waypoints: [] },
      destination: { kind: 'burg', burgId: null },
    });
    expect(gate).toBeNull();
  });

  test.each(['fly', 'teleport'])('returns null for %s mode', async (mode) => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode, effectiveVia: 'direct', waypoints: [] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate).toBeNull();
  });
});

describe('pickArrivalGate — zero/one rows', () => {
  test('returns null when burg has no entrances', async () => {
    const client = makeClient([]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'roads', waypoints: [{x:0,y:0},{x:100,y:0}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate).toBeNull();
  });

  test('single entrance is returned with single_option', async () => {
    const client = makeClient([gateA]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'direct', waypoints: [{x:0,y:0},{x:100,y:100}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate).toMatchObject({
      entranceId: 'ent-a',
      gateId: 'g1',
      matchedBy: 'single_option',
    });
    expect(gate.name).toBe('North Gate');
  });
});

describe('pickArrivalGate — route identity', () => {
  test('matches entrance by route_id when plan.effectiveVia is a UUID', async () => {
    const client = makeClient([gateA, gateB]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'route-b', waypoints: [{x:0,y:0},{x:200,y:200}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-b');
    expect(gate.matchedBy).toBe('route_id');
    expect(gate.name).toBe('South Gate');
  });

  test('ties on route_id break by smaller bearing_match_delta_deg', async () => {
    const sameRouteTight = { ...gateA, id: 'ent-tight', bearing_match_delta_deg: 1 };
    const sameRouteLoose = { ...gateA, id: 'ent-loose', bearing_match_delta_deg: 10 };
    const client = makeClient([sameRouteLoose, sameRouteTight]);
    const gate = await pickArrivalGate(client, {
      plan: { mode: 'walk', effectiveVia: 'route-a', waypoints: [{x:0,y:0},{x:50,y:50}] },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-tight');
    expect(gate.matchedBy).toBe('route_id');
  });
});

describe('pickArrivalGate — approach vector', () => {
  const north = { ...gateA, id: 'ent-n', route_id: null, bearing_deg: 0,   bearing_match_delta_deg: null };
  const south = { ...gateB, id: 'ent-s', route_id: null, bearing_deg: 180, bearing_match_delta_deg: null, name: null };

  test('picks the entrance whose outward bearing opposes the approach direction', async () => {
    const client = makeClient([north, south]);
    const gate = await pickArrivalGate(client, {
      plan: {
        mode: 'walk',
        effectiveVia: 'direct',
        waypoints: [{ x: 100, y: 0 }, { x: 100, y: 50 }],
      },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-n');
    expect(gate.matchedBy).toBe('approach_vector');
  });

  test('falls back to approach_vector when route_id does not match any entrance', async () => {
    const client = makeClient([north, south]);
    const gate = await pickArrivalGate(client, {
      plan: {
        mode: 'walk',
        effectiveVia: 'route-unknown',
        waypoints: [{ x: 100, y: 300 }, { x: 100, y: 250 }],
      },
      destination: { kind: 'burg', burgId: 'burg-1' },
    });
    expect(gate.entranceId).toBe('ent-s');
    expect(gate.matchedBy).toBe('approach_vector');
  });
});

describe('retargetPlanToGate', () => {
  test('replaces final waypoint with the gate position', () => {
    const plan = {
      waypoints: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      distancePixels: 100,
      effectiveVia: 'roads',
      totalDays: 1,
      campPoints: [],
      distanceMiles: null,
      dailyPixels: 500,
    };
    const gate = { x: 110, y: 5 };
    const out = retargetPlanToGate(plan, gate);
    expect(out.waypoints[out.waypoints.length - 1]).toEqual({ x: 110, y: 5 });
    expect(out.waypoints.length).toBe(3);
    expect(out.distancePixels).toBeCloseTo(50 + Math.hypot(60, 5), 6);
    expect(out.effectiveVia).toBe('roads');
  });

  test('returns the original plan when gate is null', () => {
    const plan = { waypoints: [{x:0,y:0},{x:10,y:0}], distancePixels: 10 };
    expect(retargetPlanToGate(plan, null)).toBe(plan);
  });

  test('handles a single-point plan by appending the gate', () => {
    const plan = {
      waypoints: [{ x: 20, y: 20 }],
      distancePixels: 0,
      effectiveVia: 'direct',
      totalDays: 0,
      campPoints: [],
      distanceMiles: null,
      dailyPixels: Infinity,
    };
    const out = retargetPlanToGate(plan, { x: 25, y: 25 });
    expect(out.waypoints).toEqual([{ x: 20, y: 20 }, { x: 25, y: 25 }]);
    expect(out.distancePixels).toBeCloseTo(Math.hypot(5, 5), 6);
  });
});
