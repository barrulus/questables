/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestRoutes } from '../../../../server/services/maps/fmg-full-json/ingesters/routes.js';

describeWithDb('ingestRoutes', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes route with group_name + linestring', async () => {
    const { rowCount } = await ingestRoutes(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT route_id, group_name, type, ST_AsText(geom) AS wkt
         FROM public.maps_routes WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ route_id: 0, group_name: 'roads', type: 'trail' });
    // geom Y is negated (QUESTABLES_PIXEL Y-up).
    expect(rows[0].wkt).toBe('MULTILINESTRING((5 -5,15 -5))');
  });
});
