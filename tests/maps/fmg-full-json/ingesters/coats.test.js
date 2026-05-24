/**
 * @jest-environment node
 */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld } from '../db-harness.js';
import { upsertCoa } from '../../../../server/services/maps/fmg-full-json/ingesters/coats.js';

describeWithDb('upsertCoa', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); });
  afterAll(() => rollbackAndClose(client));

  test('inserts then updates a coat for same (kind, id)', async () => {
    await upsertCoa(client, worldId, 'state', 1, {
      shield: 'vesicaPiscis', t1: 'gules',
      charges: [{ charge: 'palmTree', t: 'or' }],
    });
    let { rows } = await client.query(
      `SELECT t1, charges FROM public.maps_coats_of_arms
        WHERE world_id=$1 AND owner_kind='state' AND owner_id=1`,
      [worldId],
    );
    expect(rows[0].t1).toBe('gules');

    await upsertCoa(client, worldId, 'state', 1, { shield: 'fantasy', t1: 'azure' });
    ({ rows } = await client.query(
      `SELECT t1 FROM public.maps_coats_of_arms
        WHERE world_id=$1 AND owner_kind='state' AND owner_id=1`,
      [worldId],
    ));
    expect(rows[0].t1).toBe('azure');
  });

  test('rejects unknown owner_kind', async () => {
    await expect(upsertCoa(client, worldId, 'banana', 1, {})).rejects.toThrow();
  });
});
