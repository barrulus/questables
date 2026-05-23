/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestCultures } from '../../../../server/services/maps/fmg-full-json/ingesters/cultures.js';

describeWithDb('ingestCultures', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts all cultures including Wildlands (i=0)', async () => {
    const { rowCount } = await ingestCultures(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT culture_id, name, code, center_cell FROM public.maps_cultures
       WHERE world_id = $1 ORDER BY culture_id`,
      [worldId],
    );
    expect(rows[1]).toMatchObject({ culture_id: 1, name: 'Tinyfolk', code: 'Ti', center_cell: 0 });
  });
});
