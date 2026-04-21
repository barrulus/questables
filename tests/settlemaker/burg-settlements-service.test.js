import { jest } from '@jest/globals';

const { getByBurg, upsert, deleteForBurg } = await import(
  '../../server/services/maps/burg-settlements-service.js'
);

function makeClient(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('burg-settlements-service', () => {
  test('getByBurg returns the row or null', async () => {
    const row = {
      burg_id: 'b-1', meters_per_unit: 8.1, diameter_meters: 1200,
      diameter_local: 147, scale_source: 'population_heuristic_v1',
      local_bounds: { min_x: -200, min_y: -200, max_x: 200, max_y: 200 },
      max_zoom: 4, tile_extent_px: 4096,
      svg_viewbox: { x: -200, y: -200, width: 400, height: 400 },
      has_harbour: false, ocean_bearing_deg: null,
      settlement_generation_version: 'v-hash',
      settlemaker_version: '0.3.0-rc.1',
      ingested_at: new Date('2026-04-21T00:00:00Z'),
    };
    const client = makeClient(async () => ({ rows: [row] }));
    const got = await getByBurg(client, 'b-1');
    expect(got).toEqual(row);

    const empty = makeClient(async () => ({ rows: [] }));
    expect(await getByBurg(empty, 'b-nope')).toBeNull();
  });

  test('upsert issues INSERT ... ON CONFLICT DO UPDATE', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await upsert(client, 'b-1', {
      meters_per_unit: 8.1,
      diameter_meters: 1200,
      diameter_local: 147,
      scale_source: 'population_heuristic_v1',
      local_bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 },
      max_zoom: 3,
      tile_extent_px: 2048,
      svg_viewbox: { x: 0, y: 0, width: 1, height: 1 },
      has_harbour: true,
      ocean_bearing_deg: 180,
      settlement_generation_version: 'v2',
      settlemaker_version: '0.3.0-rc.1',
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.maps_burg_settlements/);
    expect(sql).toMatch(/ON CONFLICT \(burg_id\) DO UPDATE/);
    expect(params[0]).toBe('b-1');
    expect(params).toHaveLength(13); // burg_id + 12 payload columns
  });

  test('deleteForBurg issues DELETE', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await deleteForBurg(client, 'b-1');
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM public\.maps_burg_settlements/);
    expect(params).toEqual(['b-1']);
  });
});
