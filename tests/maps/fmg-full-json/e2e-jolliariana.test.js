/** @jest-environment node */
process.env.DATABASE_POOL_QUERY_TIMEOUT_MS = '0';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { ingestFullJson } from '../../../server/services/maps/fmg-full-json/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = path.resolve(__dirname, '../../../Jolliariana Full 2026-05-22-20-48.json');
// Counts post-ingest. FMG uses array index 0 as a non-object placeholder for
// provinces/features/burgs, which we skip — DB counts are raw-length minus 1
// for those three. Notes = 484 regiments + 1285 markers, all unique (kind,id).
const EXPECTED = {
  maps_states: 26,
  maps_provinces: 579,
  maps_cultures: 15,
  maps_religions: 21,
  maps_features: 200,
  maps_zones: 13,
  maps_regiments: 484,
  maps_campaigns: 104,
  maps_notes: 1769,
  maps_burgs: 19474,
  maps_routes: 11718,
  maps_rivers: 952,
  maps_markers: 1285,
  maps_cells: 66321,
};

const RUN = process.env.RUN_E2E === '1';
(RUN ? describe : describe.skip)('E2E: ingest Jolliariana fixture', () => {
  let client, worldId;
  beforeAll(async () => {
    client = new Client({
      database: process.env.PGDATABASE || process.env.DATABASE_NAME || 'questables',
    });
    await client.connect();
    const { rows } = await client.query(
      `INSERT INTO public.maps_world (name, width_pixels, height_pixels, bounds)
       VALUES ('E2E Jolliariana', 2133, 1103, $1) RETURNING id`,
      [JSON.stringify({ minX: 0, minY: 0, maxX: 2133, maxY: 1103 })],
    );
    worldId = rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (worldId) await client.query(`DELETE FROM public.maps_world WHERE id = $1`, [worldId]);
    await client.end();
  }, 300000);

  test('ingests fixture and matches expected counts', async () => {
    // skipSettlemaker: the settlemaker auto-trigger uses dynamic import of an
    // ESM-only package that Jest's CJS pipeline can't load. Production (plain
    // Node ESM) handles it fine; settlemaker integration is covered elsewhere.
    await ingestFullJson(worldId, FIXTURE, { skipSettlemaker: true });
    for (const [table, expected] of Object.entries(EXPECTED)) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM public.${table} WHERE world_id = $1`,
        [worldId],
      );
      expect({ table, count: rows[0].c }).toEqual({ table, count: expected });
    }
  }, 600000);

  test('three known burgs sit inside their owning state polygon', async () => {
    const { rows } = await client.query(
      `SELECT b.burg_id, b.name,
              ST_Contains(s.geom, b.geom) AS inside
         FROM public.maps_burgs b
         JOIN public.maps_states s ON s.world_id = b.world_id AND s.name = b.state
        WHERE b.world_id = $1 AND b.burg_id IN (1, 100, 500)`,
      [worldId],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.inside).toBe(true);
  });
});
