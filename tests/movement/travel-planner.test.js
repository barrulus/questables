import { jest } from '@jest/globals';
import { planTravel } from '../../server/services/movement/travel-planner.js';

function makeClient(rows = []) {
  return { query: jest.fn(async () => ({ rows })) };
}

describe('planTravel — direct, teleport, fly', () => {
  test('direct via returns 2-point polyline and computes days', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1000, y: 0 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.waypoints).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
    expect(plan.distancePixels).toBe(1000);
    expect(plan.distanceMiles).toBeNull();
    expect(plan.totalDays).toBe(2);
    expect(plan.effectiveVia).toBe('direct');
    expect(plan.campPoints).toHaveLength(1);
  });

  test('teleport returns single-point polyline with 0 days', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 10, y: 10 },
      end:     { x: 500, y: 500 },
      mode:    'teleport',
      via:     'roads',
    });
    expect(plan.totalDays).toBe(0);
    expect(plan.campPoints).toEqual([]);
    expect(plan.effectiveVia).toBe('direct');
  });

  test('fly always uses direct line regardless of via', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 300, y: 400 },
      mode:    'fly',
      via:     'roads',
    });
    expect(plan.waypoints).toEqual([{ x: 0, y: 0 }, { x: 300, y: 400 }]);
    expect(plan.distancePixels).toBeCloseTo(500, 5);
    expect(plan.effectiveVia).toBe('direct');
  });

  test('uses miles/day × pixels_per_mile when world has calibration', async () => {
    const client = makeClient([{ pixels_per_mile: 10 }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 240, y: 0 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.distanceMiles).toBe(24);
    expect(plan.totalDays).toBe(1);
  });

  test('zero-distance returns 0 days, single-point polyline', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 100, y: 100 },
      end:     { x: 100, y: 100 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.totalDays).toBe(0);
    expect(plan.distancePixels).toBe(0);
    expect(plan.waypoints).toEqual([{ x: 100, y: 100 }]);
  });

  test('unsupported mode throws invalid_mode', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    await expect(planTravel(client, {
      worldId: 'w1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
      mode: 'swim', via: 'direct',
    })).rejects.toMatchObject({ code: 'invalid_mode' });
  });

  test('unsupported via throws invalid_via', async () => {
    const client = makeClient([{ pixels_per_mile: null }]);
    await expect(planTravel(client, {
      worldId: 'w1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
      mode: 'walk', via: 'skyway',
    })).rejects.toMatchObject({ code: 'invalid_via' });
  });
});

describe('planTravel — road snap (same route)', () => {
  test('both endpoints snap to same route, uses ST_LineSubstring path', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: 10 }] })
        .mockResolvedValueOnce({ rows: [{
          route_id:     'route-1',
          snap_x:       5, snap_y: 0,
          loc_fraction: 0.1,
          distance:     5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          route_id:     'route-1',
          snap_x:       195, snap_y: 0,
          loc_fraction: 0.9,
          distance:     5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          points: [
            { x: 5, y: 0 }, { x: 50, y: 0 }, { x: 120, y: 0 }, { x: 195, y: 0 },
          ],
        }]}),
    };

    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 200, y: 0 },
      mode:    'walk',
      via:     'roads',
    });

    expect(plan.effectiveVia).toBe('roads');
    expect(plan.waypoints[0]).toEqual({ x: 0, y: 0 });
    expect(plan.waypoints[plan.waypoints.length - 1]).toEqual({ x: 200, y: 0 });
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(4);
    expect(plan.distancePixels).toBeGreaterThan(0);
  });

  test('swaps start/end fractions when start-frac > end-frac on the route', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] })
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r1', snap_x: 195, snap_y: 0, loc_fraction: 0.9, distance: 5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r1', snap_x: 5, snap_y: 0, loc_fraction: 0.1, distance: 5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          points: [{ x: 195, y: 0 }, { x: 100, y: 0 }, { x: 5, y: 0 }],
        }]}),
    };

    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 200, y: 0 },
      end:     { x: 0, y: 0 },
      mode:    'walk',
      via:     'roads',
    });
    expect(plan.waypoints[0]).toEqual({ x: 200, y: 0 });
    expect(plan.waypoints[plan.waypoints.length - 1]).toEqual({ x: 0, y: 0 });
    expect(plan.effectiveVia).toBe('roads');
  });
});

describe('planTravel — fallback and forced-route', () => {
  test('different routes → falls back to direct line with effectiveVia=direct', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] })
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r1', snap_x: 5, snap_y: 0, loc_fraction: 0.5, distance: 5,
        }]})
        .mockResolvedValueOnce({ rows: [{
          route_id: 'r2', snap_x: 995, snap_y: 0, loc_fraction: 0.5, distance: 5,
        }]}),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1000, y: 0 },
      mode:    'walk',
      via:     'roads',
    });
    expect(plan.effectiveVia).toBe('direct');
    expect(plan.waypoints).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
  });

  test('neither endpoint snaps → falls back to direct line', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1000, y: 0 },
      mode:    'walk',
      via:     'roads',
    });
    expect(plan.effectiveVia).toBe('direct');
  });

  test('forced route uuid: uses that route even if threshold would fail', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: 10 }] })
        .mockResolvedValueOnce({ rows: [{
          route_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          snap_x: 10, snap_y: 10, loc_fraction: 0.0, distance: 9999,
        }]})
        .mockResolvedValueOnce({ rows: [{
          route_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          snap_x: 500, snap_y: 10, loc_fraction: 1.0, distance: 9999,
        }]})
        .mockResolvedValueOnce({ rows: [{
          points: [{ x: 10, y: 10 }, { x: 500, y: 10 }],
        }]}),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 600, y: 0 },
      mode:    'walk',
      via:     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(plan.effectiveVia).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(4);
  });
});

describe('planTravel — camp points', () => {
  test('3-day journey returns 2 camp points at correct fractions', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] }),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 1500, y: 0 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.totalDays).toBe(3);
    expect(plan.campPoints).toHaveLength(2);
    expect(plan.campPoints[0]).toMatchObject({ day: 1 });
    expect(plan.campPoints[1]).toMatchObject({ day: 2 });
    expect(plan.campPoints[0].x).toBeCloseTo(500, 5);
    expect(plan.campPoints[1].x).toBeCloseTo(1000, 5);
  });

  test('1-day journey has no camp points', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ pixels_per_mile: null }] }),
    };
    const plan = await planTravel(client, {
      worldId: 'w1',
      start:   { x: 0, y: 0 },
      end:     { x: 200, y: 0 },
      mode:    'walk',
      via:     'direct',
    });
    expect(plan.totalDays).toBe(1);
    expect(plan.campPoints).toEqual([]);
  });
});
