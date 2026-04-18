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
