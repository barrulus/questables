/**
 * @jest-environment node
 */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestStates, aggregateStateGeometry } from '../../../../server/services/maps/fmg-full-json/ingesters/states.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestStates', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
    await ingestCells(client, worldId, parsed, () => {});
  });
  afterAll(() => rollbackAndClose(client));

  test('writes state row + COA row', async () => {
    const { rowCount } = await ingestStates(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows: s } = await client.query(
      `SELECT state_id, name, full_name, type, pole_x, pole_y
         FROM public.maps_states WHERE world_id = $1 AND state_id = 1`,
      [worldId],
    );
    expect(s[0]).toMatchObject({
      name: 'Tinystate', full_name: 'Republic of Tinystate',
      type: 'Generic', pole_x: 5, pole_y: 5,
    });
    const { rows: coa } = await client.query(
      `SELECT owner_kind, owner_id, t1 FROM public.maps_coats_of_arms
        WHERE world_id = $1 AND owner_kind = 'state' AND owner_id = 1`,
      [worldId],
    );
    expect(coa[0]).toMatchObject({ owner_kind: 'state', owner_id: 1, t1: 'gules' });
  });

  test('aggregateStateGeometry unions cells per state', async () => {
    await aggregateStateGeometry(client, worldId, () => {});
    const { rows } = await client.query(
      `SELECT state_id, ST_NumGeometries(geom) AS n
         FROM public.maps_states WHERE world_id = $1 AND state_id = 1`,
      [worldId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
