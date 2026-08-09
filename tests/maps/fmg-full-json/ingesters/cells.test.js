/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestCells } from '../../../../server/services/maps/fmg-full-json/ingesters/cells.js';

describeWithDb('ingestCells', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes cells with geometry + scalars + ALTERed columns', async () => {
    const { rowCount } = await ingestCells(client, worldId, parsed, () => {});
    expect(rowCount).toBe(3);

    const { rows } = await client.query(
      `SELECT cell_id, state, culture, religion, province, biome, pop,
              ST_AsText(geom) AS wkt
         FROM public.maps_cells
        WHERE world_id = $1 ORDER BY cell_id`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      cell_id: 0, state: 1, culture: 1, religion: 1, province: 1, biome: 1,
    });
    expect(Number(rows[0].pop)).toBeCloseTo(1.0);
    // QUESTABLES_PIXEL: geom Y is the FMG pixel Y negated (Y-up), so the
    // fixture quad (0,0)-(10,10) lands at y ∈ [-10, 0].
    expect(rows[0].wkt).toBe('MULTIPOLYGON(((0 0,10 0,10 -10,0 -10,0 0)))');
  });
});
