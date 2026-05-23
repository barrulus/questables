/**
 * @jest-environment node
 */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestWorld } from '../../../../server/services/maps/fmg-full-json/ingesters/world.js';

describeWithDb('ingestWorld', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('stores info + mapCoordinates onto maps_world', async () => {
    await ingestWorld(client, worldId, parsed, () => {});
    const { rows } = await client.query(
      `SELECT fmg_version, fmg_map_id, fmg_seed, map_coordinates
       FROM public.maps_world WHERE id = $1`,
      [worldId],
    );
    expect(rows[0].fmg_version).toBe('1.122.3');
    expect(rows[0].fmg_map_id).toBe('1');
    expect(rows[0].fmg_seed).toBe('42');
    expect(rows[0].map_coordinates.latT).toBe(60);
  });
});
