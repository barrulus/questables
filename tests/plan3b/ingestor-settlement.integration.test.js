/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = JSON.parse(
  fs.readFileSync(join(__dirname, '..', 'fixtures', 'settlemaker', 'v2-sample-burg.geojson'), 'utf8'),
);

jest.unstable_mockModule('settlemaker', () => ({
  generateFromBurg: () => ({ model: {}, svg: '', geojson: FIXTURE }),
  SETTLEMAKER_VERSION: FIXTURE.metadata.settlemaker_version,
  computeTileInfo: (viewBox, _population) => ({
    maxZoom: 3,
    squareExtent: Math.max(viewBox.width, viewBox.height),
    metersPerUnit: FIXTURE.metadata.scale.meters_per_unit,
    squareViewBox: viewBox,
    originalViewBox: viewBox,
  }),
}));

const { ingestBurg } = await import('../../server/services/settlemaker/ingestor.js');
const { getByBurg } = await import('../../server/services/maps/burg-settlements-service.js');
const { listByBurg } = await import('../../server/services/maps/burg-entrances-service.js');

const REQUIRED = ['TEST_DATABASE_URL', 'TEST_WORLD_ID', 'TEST_BURG_ID'];
const MISSING = REQUIRED.filter((k) => !process.env[k]);

(MISSING.length ? describe.skip : describe)('ingestor-settlement (real DB)', () => {
  let pool;
  let client;

  beforeAll(async () => {
    // Import pg dynamically so module resolution goes through server/node_modules
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  test('ingestBurg writes sidecar + entrances with arrival_local', async () => {
    const result = await ingestBurg(client, { burgId: process.env.TEST_BURG_ID, force: true });
    expect(result.updated).toBe(true);

    const sidecar = await getByBurg(client, process.env.TEST_BURG_ID);
    expect(sidecar).not.toBeNull();
    expect(Number(sidecar.meters_per_unit)).toBeCloseTo(FIXTURE.metadata.scale.meters_per_unit, 6);
    expect(sidecar.local_bounds).toEqual(FIXTURE.metadata.local_bounds);

    const entrances = await listByBurg(client, process.env.TEST_BURG_ID);
    expect(entrances.length).toBeGreaterThan(0);
    const withArrival = entrances.filter((e) => e.arrival_local != null);
    expect(withArrival.length).toBe(entrances.length);
  }, 30_000);
});
