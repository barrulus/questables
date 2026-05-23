/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestFeatures } from '../../../../server/services/maps/fmg-full-json/ingesters/features.js';

describeWithDb('ingestFeatures', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('inserts features with land/type/name', async () => {
    const { rowCount } = await ingestFeatures(client, worldId, parsed, () => {});
    expect(rowCount).toBe(3);
    const { rows } = await client.query(
      `SELECT feature_id, name, type, land FROM public.maps_features
       WHERE world_id = $1 ORDER BY feature_id`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ feature_id: 0, type: 'ocean', land: false });
    expect(rows[1]).toMatchObject({ feature_id: 1, type: 'island', land: true, name: 'Tinyland' });
    expect(rows[2]).toMatchObject({ feature_id: 2, type: 'lake', land: false, name: 'Tinylake' });
  });
});
