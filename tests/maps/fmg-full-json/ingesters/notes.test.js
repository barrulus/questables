/** @jest-environment node */
import { describeWithDb, openTxClient, rollbackAndClose, seedWorld, loadTinyFixture } from '../db-harness.js';
import { ingestNotes, parseNoteTarget } from '../../../../server/services/maps/fmg-full-json/ingesters/notes.js';

describe('parseNoteTarget', () => {
  test('extracts target kind + id from FMG conventions', () => {
    expect(parseNoteTarget('burg42')).toEqual({ kind: 'burg', id: '42' });
    expect(parseNoteTarget('regiment3-7')).toEqual({ kind: 'regiment', id: '3-7' });
    expect(parseNoteTarget('state12')).toEqual({ kind: 'state', id: '12' });
    expect(parseNoteTarget('province5')).toEqual({ kind: 'province', id: '5' });
    expect(parseNoteTarget('marker99')).toEqual({ kind: 'marker', id: '99' });
  });
  test('falls back to unknown kind', () => {
    expect(parseNoteTarget('foobar0')).toEqual({ kind: 'unknown', id: 'foobar0' });
  });
});

describeWithDb('ingestNotes', () => {
  let client, worldId, parsed;
  beforeAll(async () => {
    client = await openTxClient();
    worldId = await seedWorld(client);
    parsed = await loadTinyFixture();
  });
  afterAll(() => rollbackAndClose(client));

  test('writes notes raw, no auto-lore', async () => {
    const { rowCount } = await ingestNotes(client, worldId, parsed, () => {});
    expect(rowCount).toBe(2);
    const { rows } = await client.query(
      `SELECT target_kind, target_id, name FROM public.maps_notes
        WHERE world_id = $1 ORDER BY target_kind, target_id`,
      [worldId],
    );
    expect(rows).toEqual([
      { target_kind: 'burg', target_id: '1', name: 'Tinytown' },
      { target_kind: 'regiment', target_id: '1-0', name: '1st Tiny Regiment' },
    ]);
  });

  test('strips null bytes from legend text', async () => {
    const dirty = { notes: [{ id: 'burg99', name: 'X', legend: 'a\x00b' }] };
    await ingestNotes(client, worldId, dirty, () => {});
    const { rows } = await client.query(
      `SELECT legend FROM public.maps_notes
        WHERE world_id = $1 AND target_kind = 'burg' AND target_id = '99'`,
      [worldId],
    );
    expect(rows[0].legend).toBe('ab');
  });
});
