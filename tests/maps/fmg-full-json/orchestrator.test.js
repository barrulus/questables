/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, FIXTURE_PATH } from './db-harness.js';
import { ingestFullJson } from '../../../server/services/maps/fmg-full-json/index.js';

describeWithDb('ingestFullJson (orchestrator)', () => {
  let client, worldId;
  beforeAll(async () => { client = await openTxClient(); worldId = await seedWorld(client); });
  afterAll(() => rollbackAndClose(client));

  test('runs every stage, reports progress, returns per-stage rowCounts', async () => {
    const stages = [];
    const report = await ingestFullJson(
      worldId,
      FIXTURE_PATH,
      { client, onProgress: (s) => stages.push(s.stage) },
    );
    expect(report.stages.cells.rowCount).toBe(3);
    expect(report.stages.states.rowCount).toBe(2);
    expect(report.stages.burgs.rowCount).toBe(1);
    expect(report.stages.notes.rowCount).toBe(2);
    expect(stages).toEqual(expect.arrayContaining([
      'world', 'biomes', 'features', 'cultures', 'religions', 'cells',
      'states', 'provinces', 'burgs', 'rivers', 'routes', 'markers',
      'regiments', 'campaigns', 'diplomacy', 'zones', 'notes',
    ]));
  });
});
