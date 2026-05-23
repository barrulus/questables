import { validateParsedFmg } from '../../../server/services/maps/fmg-full-json/validators.js';

const minimal = () => ({
  info: { version: '1.122.3', width: 100, height: 100 },
  settings: {},
  pack: {
    cells: Array.from({ length: 1200 }, (_, i) => ({ i, v: [0, 1, 2] })),
    vertices: Array.from({ length: 2500 }, (_, i) => ({ i, p: [i, i] })),
    features: [{ i: 0 }],
    states: [{ i: 0 }],
    burgs: [{ i: 0 }],
  },
});

describe('validateParsedFmg', () => {
  test('accepts a minimally valid file', () => {
    expect(() => validateParsedFmg(minimal())).not.toThrow();
  });

  test('rejects missing top-level keys', () => {
    const j = minimal(); delete j.pack;
    expect(() => validateParsedFmg(j)).toThrow(/pack/);
  });

  test('rejects missing pack subkeys', () => {
    const j = minimal(); delete j.pack.cells;
    expect(() => validateParsedFmg(j)).toThrow(/pack\.cells/);
  });

  test('rejects fewer than 1000 cells', () => {
    const j = minimal(); j.pack.cells = j.pack.cells.slice(0, 500);
    expect(() => validateParsedFmg(j)).toThrow(/cell count/);
  });

  test('rejects vertex count less than 2x cell count', () => {
    const j = minimal(); j.pack.vertices = j.pack.vertices.slice(0, 100);
    expect(() => validateParsedFmg(j)).toThrow(/vertex count/);
  });

  test('rejects unknown FMG major version', () => {
    const j = minimal(); j.info.version = '0.9.0';
    expect(() => validateParsedFmg(j)).toThrow(/version/);
  });

  test('rejects orphan burg.state references', () => {
    const j = minimal();
    j.pack.burgs = [{ i: 0 }, { i: 1, state: 99 }];
    expect(() => validateParsedFmg(j)).toThrow(/burg 1.*state 99/);
  });
});
