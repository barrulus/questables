/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestReligions } from '../../../../server/services/maps/fmg-full-json/ingesters/religions.js';

describeWithDb('ingestReligions', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts religions including deity + origins[]', async () => {
    const { rowCount } = await ingestReligions(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT religion_id, name, deity, origins FROM public.maps_religions
       WHERE world_id = $1 AND religion_id = 1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ name: 'Tinyfaith', deity: 'Tinyx, The Small' });
    expect(rows[0].origins).toEqual([0]);
  });
});
