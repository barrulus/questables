/** @jest-environment node */
import {
  computeMaxZoom,
  parseSvgDimensions,
  tileViewBox,
  buildTileSvg,
} from '../../../server/services/maps/world-tile-service.js';

describe('computeMaxZoom', () => {
  test('Jolliariana 2133x1103 → 6 (spec example)', () => {
    expect(computeMaxZoom(2133, 1103)).toBe(6);
  });
  test('2048x1024 → 5', () => {
    // log2(2048/256) = 3, +2 = 5
    expect(computeMaxZoom(2048, 1024)).toBe(5);
  });
  test('tiny maps never go below +2 over a single tile', () => {
    expect(computeMaxZoom(100, 100)).toBe(2);
  });
  test('height-dominant maps use the larger dimension', () => {
    expect(computeMaxZoom(1024, 4096)).toBe(6);
  });
  test('invalid dimensions → null', () => {
    expect(computeMaxZoom(null, 1000)).toBeNull();
    expect(computeMaxZoom(0, 0)).toBeNull();
    expect(computeMaxZoom(NaN, 100)).toBeNull();
  });
});

describe('parseSvgDimensions', () => {
  test('reads the root viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"><rect/></svg>';
    expect(parseSvgDimensions(svg)).toEqual({ x: 0, y: 0, width: 512, height: 256 });
  });
  test('honours non-zero viewBox origin', () => {
    const svg = '<svg viewBox="-10 5 100 50"></svg>';
    expect(parseSvgDimensions(svg)).toEqual({ x: -10, y: 5, width: 100, height: 50 });
  });
  test('falls back to width/height attributes', () => {
    const svg = '<svg width="2133" height="1103px"></svg>';
    expect(parseSvgDimensions(svg)).toEqual({ x: 0, y: 0, width: 2133, height: 1103 });
  });
  test('no svg root → null; no usable dims → null', () => {
    expect(parseSvgDimensions('not svg at all')).toBeNull();
    expect(parseSvgDimensions('<svg data-foo="1"></svg>')).toBeNull();
  });
});

describe('tileViewBox — matches the OL TileGrid used by createQuestablesTileSource', () => {
  const dims = { x: 0, y: 0, width: 512, height: 256 };

  test('z=0 is one square tile spanning the full width', () => {
    expect(tileViewBox(dims, 0, 0, 0)).toEqual({ x: 0, y: 0, size: 512 });
    expect(tileViewBox(dims, 0, 1, 0)).toBeNull();
    expect(tileViewBox(dims, 0, 0, 1)).toBeNull();
  });

  test('z=1: 2 columns, 1 row (256px squares cover the 256px height)', () => {
    expect(tileViewBox(dims, 1, 1, 0)).toEqual({ x: 256, y: 0, size: 256 });
    expect(tileViewBox(dims, 1, 0, 1)).toBeNull();
  });

  test('clean 2:1 aspect matches legacy utils/tile-svg.mjs output exactly', () => {
    // tile-svg.mjs at z=2 for 2048x1024: nTilesX=4, nTilesY=round(4/2)=2,
    // tileW=512, tileH=512 → tile (x=3,y=1) viewBox = (1536, 512, 512, 512).
    const legacy = { x: 0, y: 0, width: 2048, height: 1024 };
    expect(tileViewBox(legacy, 2, 3, 1)).toEqual({ x: 1536, y: 512, size: 512 });
    expect(tileViewBox(legacy, 2, 0, 2)).toBeNull();
  });

  test('non-clean aspect uses ceil rows (OL alignment), not legacy round', () => {
    // Jolliariana at z=6: side = 2133/64 ≈ 33.328, rows = ceil(1103/33.328) = 34.
    // Legacy round() gave 33 and dropped the bottom strip — we keep row 33.
    const jolli = { x: 0, y: 0, width: 2133, height: 1103 };
    expect(tileViewBox(jolli, 6, 0, 33)).not.toBeNull();
    expect(tileViewBox(jolli, 6, 0, 34)).toBeNull();
    expect(tileViewBox(jolli, 6, 64, 0)).toBeNull();
  });

  test('height-dominant worlds allow more rows than columns', () => {
    const tall = { x: 0, y: 0, width: 256, height: 1024 };
    // z=0: side=256, rows=ceil(1024/256)=4
    expect(tileViewBox(tall, 0, 0, 3)).toEqual({ x: 0, y: 768, size: 256 });
    expect(tileViewBox(tall, 0, 0, 4)).toBeNull();
  });

  test('negative coords → null', () => {
    expect(tileViewBox(dims, 1, -1, 0)).toBeNull();
    expect(tileViewBox(dims, 1, 0, -1)).toBeNull();
  });
});

describe('buildTileSvg', () => {
  test('replaces root viewBox and forces 256px output size', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256" width="512" height="256"><rect/></svg>';
    const out = buildTileSvg(svg, { x: 256, y: 0, size: 256 });
    expect(out).toContain('viewBox="256 0 256 256"');
    expect(out).toContain('width="256"');
    expect(out).toContain('height="256"');
    expect(out).toContain('<rect/>');
  });

  test('injects viewBox/width/height when the root lacks them', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const out = buildTileSvg(svg, { x: 0, y: 0, size: 128 });
    expect(out).toContain('viewBox="0 0 128 128"');
    expect(out).toContain('width="256"');
    expect(out).toContain('height="256"');
  });

  test('does not touch a nested viewBox (only the root tag)', () => {
    const svg = '<svg viewBox="0 0 512 256"><symbol viewBox="0 0 10 10"/></svg>';
    const out = buildTileSvg(svg, { x: 0, y: 0, size: 512 });
    expect(out).toContain('<symbol viewBox="0 0 10 10"/>');
  });
});
