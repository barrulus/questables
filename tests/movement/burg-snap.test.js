import { jest } from '@jest/globals';
import { snapCoordToNearbyBurg } from '../../server/services/movement/burg-snap.js';

function makeClient(rowsByMatcher) {
  return {
    query: jest.fn(async (sql) => {
      const match = rowsByMatcher.find((r) => r.match.test(sql));
      if (!match) throw new Error(`No mock for SQL:\n${sql}`);
      return { rows: match.rows };
    }),
  };
}

describe('snapCoordToNearbyBurg', () => {
  test('returns the burg when the target lies within its approach radius', async () => {
    // Balur-shaped fixture: diameter 377m, target 4001m away, world mpp 10000.
    // Approach radius should be max(diameter*10=3770, mpp=10000) = 10000.
    // 4001 < 10000 → snap.
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{
          id: 'burg-balur',
          name: 'Balur',
          x: 4357500,
          y: -14659800,
          distance: 4001.5,
          diameter_meters: 377,
          meters_per_pixel: 10000,
        }],
      },
    ]);

    const snap = await snapCoordToNearbyBurg(client, {
      worldId: 'world-1',
      x: 4354428.99,
      y: -14662365.38,
    });

    expect(snap).toEqual({
      burgId: 'burg-balur',
      x: 4357500,
      y: -14659800,
      resolvedName: 'Balur',
      distance: 4001.5,
    });
  });

  test('returns null when target is far beyond the approach radius', async () => {
    // Target 50000 away from a 200m-diameter burg on mpp=10000 world.
    // Approach radius = max(2000, 10000) = 10000. 50000 > 10000 → no snap.
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{
          id: 'burg-far',
          name: 'Faraway',
          x: 1000000,
          y: 1000000,
          distance: 50000,
          diameter_meters: 200,
          meters_per_pixel: 10000,
        }],
      },
    ]);

    const snap = await snapCoordToNearbyBurg(client, {
      worldId: 'world-1',
      x: 1050000,
      y: 1000000,
    });

    expect(snap).toBeNull();
  });

  test('scales the approach radius with large burgs', async () => {
    // Big city: diameter 5000m → approach radius = max(50000, 10000) = 50000.
    // Target 30000 away → snap.
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{
          id: 'burg-big',
          name: 'Bigport',
          x: 0,
          y: 0,
          distance: 30000,
          diameter_meters: 5000,
          meters_per_pixel: 10000,
        }],
      },
    ]);

    const snap = await snapCoordToNearbyBurg(client, {
      worldId: 'world-1',
      x: 30000,
      y: 0,
    });

    expect(snap?.burgId).toBe('burg-big');
  });

  test('falls back to a sane radius when burg has no settlemaker sidecar', async () => {
    // No diameter_meters → radius = max(NaN, mpp) = mpp = 10000.
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{
          id: 'burg-thin',
          name: 'Thinbar',
          x: 0,
          y: 0,
          distance: 8000,
          diameter_meters: null,
          meters_per_pixel: 10000,
        }],
      },
    ]);

    const snap = await snapCoordToNearbyBurg(client, {
      worldId: 'world-1',
      x: 8000,
      y: 0,
    });

    expect(snap?.burgId).toBe('burg-thin');
  });

  test('returns null when no burg row is found', async () => {
    const client = makeClient([
      { match: /FROM public\.maps_burgs/, rows: [] },
    ]);

    const snap = await snapCoordToNearbyBurg(client, {
      worldId: 'world-1',
      x: 0,
      y: 0,
    });

    expect(snap).toBeNull();
  });

  test('returns null without querying when worldId is missing', async () => {
    const client = { query: jest.fn() };
    const snap = await snapCoordToNearbyBurg(client, { worldId: null, x: 0, y: 0 });
    expect(snap).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });
});
