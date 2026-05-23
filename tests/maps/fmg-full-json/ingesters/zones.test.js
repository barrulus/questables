/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestZones } from '../../../../server/services/maps/fmg-full-json/ingesters/zones.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestZones', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts zone with cells[] and unioned geom', async () => {
    const { rowCount } = await ingestZones(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT zone_id, name, type, cells,
              CASE WHEN geom IS NULL THEN 0 ELSE ST_NumGeometries(geom) END AS ngeom
         FROM public.maps_zones WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ zone_id: 0, name: 'Tinyzone', type: 'Invasion' });
    expect(rows[0].cells).toEqual([0, 1]);
    expect(rows[0].ngeom).toBeGreaterThan(0);
  });
});
