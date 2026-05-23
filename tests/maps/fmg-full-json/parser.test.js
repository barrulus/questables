/**
 * @jest-environment node
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFmgFile } from '../../../server/services/maps/fmg-full-json/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TINY = path.join(__dirname, '../../fixtures/fmg-full-json/tiny.json');

describe('parseFmgFile', () => {
  test('parses tiny fixture and exposes top-level keys', async () => {
    const parsed = await parseFmgFile(TINY);
    expect(parsed.info.version).toBe('1.122.3');
    expect(parsed.pack.cells).toHaveLength(3);
    expect(parsed.pack.vertices).toHaveLength(6);
    expect(parsed.biomesData.name).toContain('Marine');
  });

  test('streaming path returns the same shape as in-memory path', async () => {
    const a = await parseFmgFile(TINY, { forceStreaming: false });
    const b = await parseFmgFile(TINY, { forceStreaming: true });
    expect(a.info).toEqual(b.info);
    expect(a.pack.cells.length).toEqual(b.pack.cells.length);
    expect(a.pack.states.length).toEqual(b.pack.states.length);
  });
});
