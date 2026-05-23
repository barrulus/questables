import { buildCellPolygonsWkt } from '../../../server/services/maps/fmg-full-json/geometry-builder.js';

describe('buildCellPolygonsWkt', () => {
  const vertices = [
    { i: 0, p: [0, 0] },
    { i: 1, p: [10, 0] },
    { i: 2, p: [10, 10] },
    { i: 3, p: [0, 10] },
  ];

  test('emits a closed POLYGON for a quad cell', () => {
    const cells = [{ i: 0, v: [0, 1, 2, 3] }];
    const wkt = buildCellPolygonsWkt(cells, vertices);
    expect(wkt).toEqual(['POLYGON((0 0,10 0,10 10,0 10,0 0))']);
  });

  test('emits one polygon per cell in input order', () => {
    const cells = [
      { i: 0, v: [0, 1, 2] },
      { i: 1, v: [1, 2, 3] },
    ];
    const wkt = buildCellPolygonsWkt(cells, vertices);
    expect(wkt).toHaveLength(2);
    expect(wkt[0]).toBe('POLYGON((0 0,10 0,10 10,0 0))');
    expect(wkt[1]).toBe('POLYGON((10 0,10 10,0 10,10 0))');
  });

  test('handles non-zero vertex indices via lookup', () => {
    const sparseVerts = [
      { i: 100, p: [0, 0] },
      { i: 200, p: [5, 0] },
      { i: 300, p: [5, 5] },
    ];
    const cells = [{ i: 0, v: [100, 200, 300] }];
    const wkt = buildCellPolygonsWkt(cells, sparseVerts);
    expect(wkt).toEqual(['POLYGON((0 0,5 0,5 5,0 0))']);
  });

  test('throws when a cell references an unknown vertex index', () => {
    const cells = [{ i: 0, v: [0, 999] }];
    expect(() => buildCellPolygonsWkt(cells, vertices)).toThrow(/vertex 999/);
  });

  test('skips degenerate cells with < 3 vertices', () => {
    const cells = [
      { i: 0, v: [0, 1] },
      { i: 1, v: [0, 1, 2] },
    ];
    const wkt = buildCellPolygonsWkt(cells, vertices);
    expect(wkt[0]).toBeNull();
    expect(wkt[1]).toBe('POLYGON((0 0,10 0,10 10,0 0))');
  });
});
