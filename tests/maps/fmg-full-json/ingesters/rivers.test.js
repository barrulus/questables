/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestRivers } from '../../../../server/services/maps/fmg-full-json/ingesters/rivers.js';

describeWithDb('ingestRivers', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes rivers with parent/basin/width factors', async () => {
    const { rowCount } = await ingestRivers(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT river_id, name, parent, basin, source_width, width_factor,
              ST_NPoints(geom) AS pts
         FROM public.maps_rivers WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      river_id: 1, name: 'Tinyriver', parent: 1, basin: 1,
    });
    expect(Number(rows[0].source_width)).toBeCloseTo(0.1);
    expect(rows[0].pts).toBeGreaterThanOrEqual(2);
  });
});
