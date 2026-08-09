/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestRegiments } from '../../../../server/services/maps/fmg-full-json/ingesters/regiments.js';

describeWithDb('ingestRegiments', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('flattens states[].military[] into rows', async () => {
    const { rowCount } = await ingestRegiments(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT regiment_id, state_id, name, total_men, u_infantry, u_archers, u_cavalry,
              x_px, y_px, ST_AsText(geom) AS wkt
         FROM public.maps_regiments WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      regiment_id: 0, state_id: 1, name: '1st Tiny Regiment',
      u_infantry: 50, u_archers: 30, u_cavalry: 15,
    });
    // x_px/y_px stay raw FMG pixels; the generated geom flips Y (migration 018).
    expect(Number(rows[0].y_px)).toBe(5);
    expect(rows[0].wkt).toBe('POINT(5 -5)');
  });
});
