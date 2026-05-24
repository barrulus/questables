/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestMarkers } from '../../../../server/services/maps/fmg-full-json/ingesters/markers.js';

describeWithDb('ingestMarkers', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes marker with icon + type + geom', async () => {
    const { rowCount } = await ingestMarkers(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT marker_id, icon, type, ST_AsText(geom) AS wkt
         FROM public.maps_markers WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({ marker_id: 0, icon: '🌋', type: 'volcanoes' });
    expect(rows[0].wkt).toBe('POINT(12 5)');
  });
});
