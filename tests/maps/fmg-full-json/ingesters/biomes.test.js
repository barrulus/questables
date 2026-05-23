/**
 * @jest-environment node
 */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestBiomes } from '../../../../server/services/maps/fmg-full-json/ingesters/biomes.js';

describeWithDb('ingestBiomes', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes one row per biome', async () => {
    const { rowCount } = await ingestBiomes(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT biome_id, name, cost FROM public.maps_biomes
       WHERE world_id = $1 ORDER BY biome_id`,
      [worldId],
    );
    expect(rows).toEqual([
      { biome_id: 0, name: 'Marine', cost: 10 },
      { biome_id: 1, name: 'Hot desert', cost: 200 },
    ]);
  });
});
