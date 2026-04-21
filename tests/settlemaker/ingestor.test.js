import { jest } from '@jest/globals';

jest.unstable_mockModule('settlemaker', () => ({
  generateFromBurg: jest.fn(),
  SETTLEMAKER_VERSION: '0.3.0-rc.1',
  computeTileInfo: jest.fn(() => ({ maxZoom: 3, tileExtentPx: 2048 })),
}));
jest.unstable_mockModule('../../server/services/maps/burg-entrances-service.js', () => ({
  distinctVersionForBurg: jest.fn(),
  deleteForBurg:          jest.fn(),
  insertMany:             jest.fn(),
  listByBurg:             jest.fn(),
  listByWorld:            jest.fn(),
}));
jest.unstable_mockModule('../../server/services/maps/burg-settlements-service.js', () => ({
  getByBurg:      jest.fn(),
  upsert:         jest.fn(),
  deleteForBurg:  jest.fn(),
}));

const settlemaker = await import('settlemaker');
const entrancesService = await import('../../server/services/maps/burg-entrances-service.js');
const settlementsService = await import('../../server/services/maps/burg-settlements-service.js');
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
        layer: 'entrance',
        entrance_id: 'g5',
        kind: 'land', sub_kind: 'road',
        bearing_deg: 90,
        wall_vertex_index: 5,
        matched_route_id: 'route-east',
        bearing_match_delta_deg: 3,
        prev_entrance_id: 'g3',
        next_entrance_id: 'g7',
        arrival_local: [180, 0],
      },
      geometry: { type: 'Point', coordinates: [200, 0] },
    },
  ],
  metadata: {
    schema_version: 2,
    settlemaker_version: '0.3.0-rc.1',
    settlement_generation_version: 'v2hash',
    coordinate_system: 'local_origin_y_down',
    coordinate_units: 'settlement_units',
    generated_at: '2026-04-21T00:00:00Z',
    local_bounds: { min_x: -220, min_y: -220, max_x: 220, max_y: 220 },
    scale: {
      meters_per_unit: 8,
      diameter_meters: 400,
      diameter_local: 50,
      source: 'population_heuristic_v1',
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ingestBurg', () => {
  test('idempotent: noop when sidecar version triplet matches', async () => {
    settlementsService.getByBurg.mockResolvedValue({
      schema_version: 2,
      settlement_generation_version: 'v2hash',
      settlemaker_version: '0.3.0-rc.1',
    });
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    const result = await ingestBurg(client, { burgId: 'burg-1' });
    expect(result.updated).toBe(false);
    expect(entrancesService.deleteForBurg).not.toHaveBeenCalled();
    expect(entrancesService.insertMany).not.toHaveBeenCalled();
    expect(settlementsService.upsert).not.toHaveBeenCalled();
  });

  test('full rebuild when version differs', async () => {
    settlementsService.getByBurg.mockResolvedValue(null);
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
      gate_id: 'g5',                 // DB column name unchanged; value comes from entrance_id prop
      route_id: 'route-east',
      kind: 'land',
      sub_kind: 'road',
      wall_vertex_index: 5,
      bearing_deg: 90,
      bearing_match_delta_deg: 3,
      prev_gate_id: 'g3',            // DB column; value comes from prev_entrance_id
      next_gate_id: 'g7',            // DB column; value comes from next_entrance_id
      settlement_generation_version: 'v2hash',
      settlemaker_version: '0.3.0-rc.1',
    });
    expect(rows[0].arrival_local).toEqual([180, 0]);
    expect(rows[0].x_px).toBeGreaterThan(1000);
    expect(rows[0].y_px).toBeCloseTo(2000, 3);
  });

  test('unwalled burg with zero gates still clears prior rows', async () => {
    settlementsService.getByBurg.mockResolvedValue(null);
    const emptyFc = {
      ...FAKE_FC,
      features: [],
      metadata: { ...FAKE_FC.metadata, schema_version: 2, settlement_generation_version: 'empty' },
    };
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: emptyFc });
    const client = makeClient(
      { id: 'burg-2', world_id: 'w1', name: 'Unwalled', population: 300, port: false, citadel: false, walls: false, plaza: false, temple: false, shanty: false, capital: false, x_px: 500, y_px: 500 },
      [],
    );
    const result = await ingestBurg(client, { burgId: 'burg-2' });
    expect(result.updated).toBe(true);
    expect(entrancesService.deleteForBurg).toHaveBeenCalled();
    expect(entrancesService.insertMany).not.toHaveBeenCalled();
    expect(settlementsService.upsert).toHaveBeenCalled();
  });

  test('hard-requires schema v2; throws SettlemakerSchemaMismatch on v1', async () => {
    const v1Fc = { ...FAKE_FC, metadata: { ...FAKE_FC.metadata, schema_version: 1 } };
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: v1Fc });
    const client = makeClient(
      { id: 'burg-old', world_id: 'w1', name: 'Old', population: 5000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 100, y_px: 100 },
      [],
    );
    await expect(ingestBurg(client, { burgId: 'burg-old' }))
      .rejects.toMatchObject({ code: 'settlemaker_schema_mismatch' });
  });

  test('writes sidecar row with scale + local_bounds from metadata', async () => {
    settlementsService.getByBurg.mockResolvedValue(null);
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    await ingestBurg(client, { burgId: 'burg-1' });
    expect(settlementsService.upsert).toHaveBeenCalledTimes(1);
    const [, burgId, payload] = settlementsService.upsert.mock.calls[0];
    expect(burgId).toBe('burg-1');
    expect(Number(payload.meters_per_unit)).toBe(8);
    expect(payload.local_bounds).toEqual({ min_x: -220, min_y: -220, max_x: 220, max_y: 220 });
    expect(payload.settlement_generation_version).toBe('v2hash');
  });

  test('force: true bypasses the triplet check', async () => {
    settlementsService.getByBurg.mockResolvedValue({
      schema_version: 2,
      settlement_generation_version: 'v2hash',
      settlemaker_version: '0.3.0-rc.1',
    });
    settlemaker.generateFromBurg.mockReturnValue({ model: {}, svg: '', geojson: FAKE_FC });
    const client = makeClient(
      { id: 'burg-1', world_id: 'w1', name: 'Foo', population: 10000, port: false, citadel: false, walls: true, plaza: true, temple: false, shanty: false, capital: false, x_px: 1000, y_px: 2000 },
      [{ route_id: 'route-east', type: 'road', snap_x: 1050, snap_y: 2000 }],
    );
    const result = await ingestBurg(client, { burgId: 'burg-1', force: true });
    expect(result.updated).toBe(true);
    expect(settlementsService.upsert).toHaveBeenCalledTimes(1);
  });
});
