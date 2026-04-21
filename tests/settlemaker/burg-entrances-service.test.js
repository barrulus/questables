import { jest } from '@jest/globals';

// Mock the pool module to prevent pg from loading (which requires TextEncoder
// not available in jsdom). Only insertMany is under test; it doesn't use pool.
jest.unstable_mockModule('../../server/db/pool.js', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  getClient: jest.fn(),
  withClient: jest.fn(),
  withTransaction: jest.fn(),
  getPoolStats: jest.fn(),
}));

const { insertMany } = await import(
  '../../server/services/maps/burg-entrances-service.js'
);

function makeClient(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

const BASE_ROW = {
  burg_id: 'b-1',
  gate_id: 'g5',
  route_id: null,
  x_px: 1000,
  y_px: 2000,
  bearing_deg: 90,
  bearing_match_delta_deg: null,
  kind: 'land',
  sub_kind: 'road',
  wall_vertex_index: 5,
  prev_gate_id: null,
  next_gate_id: null,
  name: null,
  settlement_generation_version: 'v1',
  settlemaker_version: '0.3.0-rc.1',
};

describe('burg-entrances-service insertMany', () => {
  test('returns early on empty array', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await insertMany(client, []);
    expect(client.query).not.toHaveBeenCalled();
  });

  test('stringifies arrival_local when present', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await insertMany(client, [{ ...BASE_ROW, arrival_local: [10, 20] }]);
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.maps_burg_entrances/);
    expect(params).toHaveLength(16);
    // arrival_local sits at index 13 (0-based): after name (index 12) and before settlement_generation_version (index 14).
    expect(params[13]).toBe('[10,20]');
  });

  test('passes null for arrival_local when undefined', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    const row = { ...BASE_ROW };
    // arrival_local intentionally absent from row
    await insertMany(client, [row]);
    const [, params] = client.query.mock.calls[0];
    expect(params[13]).toBeNull();
  });

  test('passes null for arrival_local when explicitly null', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await insertMany(client, [{ ...BASE_ROW, arrival_local: null }]);
    const [, params] = client.query.mock.calls[0];
    expect(params[13]).toBeNull();
  });
});
