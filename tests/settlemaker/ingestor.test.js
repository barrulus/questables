import { jest } from '@jest/globals';

jest.unstable_mockModule('settlemaker', () => ({
  generateFromBurg: jest.fn(),
  SETTLEMAKER_VERSION: '0.2.0',
}));
jest.unstable_mockModule('../../server/services/maps/burg-entrances-service.js', () => ({
  distinctVersionForBurg: jest.fn(),
  deleteForBurg:          jest.fn(),
  insertMany:             jest.fn(),
  listByBurg:             jest.fn(),
  listByWorld:            jest.fn(),
}));

const settlemaker = await import('settlemaker');
const entrancesService = await import('../../server/services/maps/burg-entrances-service.js');
const { ingestBurg } = await import('../../server/services/settlemaker/ingestor.js');

function makeClient(burgRow, routeRows) {
  const query = jest.fn(async (sql) => {
    if (/FROM public\.maps_burgs/.test(sql) && !/ST_ClosestPoint/.test(sql)) {
      return { rows: [burgRow] };
    }
    if (/ST_ClosestPoint/.test(sql)) {
      return { rows: routeRows };
    }
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM public\.maps_world/.test(sql)) {
      return { rows: [{ pixels_per_mile: 50 }] };
    }
    return { rows: [] };
  });
  return { query };
}

const FAKE_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { layer: 'wall', wallType: 'city_wall' },
      geometry: { type: 'Polygon', coordinates: [[[200,0],[0,200],[-200,0],[0,-200],[200,0]]] },
    },
    {
      type: 'Feature',
      properties: {
        layer: 'gate',
        gate_id: 'g5',
        kind: 'land', sub_kind: 'road',
        bearing_deg: 90,
        wall_vertex_index: 5,
        matched_route_id: 'route-east',
        bearing_match_delta_deg: 3,
        prev_gate_id: 'g3',
        next_gate_id: 'g7',
      },
      geometry: { type: 'Point', coordinates: [200, 0] },
    },
  ],
  metadata: {
    schema_version: 1,
    settlemaker_version: '0.2.0',
    settlement_generation_version: 'v1hash',
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: '2026-04-19T00:00:00Z',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ingestBurg', () => {
  test('idempotent: noop when settlement_generation_version matches', async () => {
    entrancesService.distinctVersionForBurg.mockResolvedValue('v1hash');
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    const result = await ingestBurg(client, { burgId: 'burg-1' });
    expect(result.updated).toBe(false);
    expect(entrancesService.deleteForBurg).not.toHaveBeenCalled();
    expect(entrancesService.insertMany).not.toHaveBeenCalled();
  });

  test('full rebuild when version differs', async () => {
    entrancesService.distinctVersionForBurg.mockResolvedValue('stale');
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    const result = await ingestBurg(client, { burgId: 'burg-1' });
    expect(result.updated).toBe(true);
    expect(entrancesService.deleteForBurg).toHaveBeenCalledWith(client, 'burg-1');
    expect(entrancesService.insertMany).toHaveBeenCalledTimes(1);
    const [, rows] = entrancesService.insertMany.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      burg_id: 'burg-1',
      gate_id: 'g5',
      route_id: 'route-east',
      kind: 'land',
      sub_kind: 'road',
      wall_vertex_index: 5,
      bearing_deg: 90,
      bearing_match_delta_deg: 3,
      prev_gate_id: 'g3',
      next_gate_id: 'g7',
      settlement_generation_version: 'v1hash',
      settlemaker_version: '0.2.0',
    });
    expect(rows[0].x_px).toBeGreaterThan(1000);
    expect(rows[0].y_px).toBeCloseTo(2000, 3);
  });

  test('unwalled burg with zero gates still clears prior rows', async () => {
    entrancesService.distinctVersionForBurg.mockResolvedValue('stale');
    const emptyFc = { ...FAKE_FC, features: [], metadata: { ...FAKE_FC.metadata, settlement_generation_version: 'empty' } };
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: emptyFc });
    const client = makeClient(
      { id: 'burg-2', world_id: 'w1', name: 'Unwalled', population: 300, port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false, x_px: 500, y_px: 500 },
      [],
    );
    const result = await ingestBurg(client, { burgId: 'burg-2' });
    expect(result.updated).toBe(true);
    expect(entrancesService.deleteForBurg).toHaveBeenCalled();
    expect(entrancesService.insertMany).not.toHaveBeenCalled();
  });
});
