/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestProvinces, aggregateProvinceGeometry } from '../../../../server/services/maps/fmg-full-json/ingesters/provinces.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestProvinces', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('skips sentinel slot 0 and writes a row + COA for real provinces', async () => {
    const { rowCount } = await ingestProvinces(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT province_id, full_name, state_id FROM public.maps_provinces WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ province_id: 1, full_name: 'Tinyprov Province', state_id: 1 });
    const { rows: coa } = await client.query(
      `SELECT t1 FROM public.maps_coats_of_arms
        WHERE world_id = $1 AND owner_kind = 'province' AND owner_id = 1`,
      [worldId],
    );
    expect(coa[0].t1).toBe('sable');
  });

  test('aggregateProvinceGeometry unions cells per province', async () => {
    await aggregateProvinceGeometry(client, worldId, () => {});
    const { rows } = await client.query(
      `SELECT province_id, ST_NumGeometries(geom) AS n
         FROM public.maps_provinces WHERE world_id = $1 AND province_id = 1`,
      [worldId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
