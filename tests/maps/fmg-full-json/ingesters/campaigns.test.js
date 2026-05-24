/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestCampaigns } from '../../../../server/services/maps/fmg-full-json/ingesters/campaigns.js';

describeWithDb('ingestCampaigns', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes one row per state campaign', async () => {
    const { rowCount } = await ingestCampaigns(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT state_id, campaign_index, name, start_year, end_year
         FROM public.maps_campaigns WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      state_id: 1, campaign_index: 0, name: 'Tinywar',
      start_year: 1500, end_year: 1505,
    });
  });
});
