import { jest } from '@jest/globals';
import { pickArrivalGate } from '../../server/services/movement/gate-picker.js';

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
