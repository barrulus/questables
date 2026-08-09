/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestBurgs } from '../../../../server/services/maps/fmg-full-json/ingesters/burgs.js';

describeWithDb('ingestBurgs', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('skips sentinel slot 0, writes burg + COA with new columns', async () => {
    const { rowCount } = await ingestBurgs(client, worldId, parsed, () => {});
    expect(rowCount).toBe(1);
    const { rows } = await client.query(
      `SELECT burg_id, name, xpixel, ypixel, type, settlement_type, "group",
              base_population, feature, state, statefull, culture, religion,
              province, provincefull,
              capital, port, citadel, walls, plaza, temple, shanty,
              population, ST_AsText(geom) AS wkt
         FROM public.maps_burgs WHERE world_id = $1`,
      [worldId],
    );
    expect(rows[0]).toMatchObject({
      burg_id: 1, name: 'Tinytown', xpixel: 5, ypixel: 5,
      type: 'Generic', settlement_type: 'capital',
      group: 'capital', feature: 1,
      state: 'Tinystate', statefull: 'Republic of Tinystate',
      culture: 'Tinyfolk', religion: 'Tinyfaith',
      province: 'Tinyprov', provincefull: 'Tinyprov Province',
      capital: true, port: false, citadel: true, walls: true,
      plaza: true, temple: false, shanty: false,
      population: 3, // round of 2.5
    });
    expect(Number(rows[0].base_population)).toBeCloseTo(2.0);
    // xpixel/ypixel stay raw FMG pixels (the settlemaker/entrance stack reads
    // them); geom carries the QUESTABLES_PIXEL Y-up flip.
    expect(rows[0].wkt).toBe('POINT(5 -5)');

    const { rows: coa } = await client.query(
      `SELECT t1 FROM public.maps_coats_of_arms
        WHERE world_id = $1 AND owner_kind = 'burg' AND owner_id = 1`,
      [worldId],
    );
    expect(coa[0].t1).toBe('or');
  });
});
