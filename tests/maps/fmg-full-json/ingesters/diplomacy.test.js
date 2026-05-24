/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld } from '../db-harness.js';
import { ingestDiplomacy } from '../../../../server/services/maps/fmg-full-json/ingesters/diplomacy.js';

describeWithDb('ingestDiplomacy', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); });
  afterAll(() => rollbackAndClose(client));

  test('unfolds NxN matrix, skips sentinel "x"', async () => {
    const parsed = {
      pack: { states: [
        { i: 0, diplomacy: ['x', 'x', 'x'] },
        { i: 1, diplomacy: ['x', 'x', 'Ally'] },
        { i: 2, diplomacy: ['x', 'Ally', 'x'] },
      ]},
    };
    const { rowCount } = await ingestDiplomacy(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT state_a_id, state_b_id, status FROM public.maps_diplomacy
        WHERE world_id = $1 ORDER BY state_a_id, state_b_id`,
      [worldId],
    );
    expect(rows).toEqual([
      { state_a_id: 1, state_b_id: 2, status: 'Ally' },
      { state_a_id: 2, state_b_id: 1, status: 'Ally' },
    ]);
  });
});
