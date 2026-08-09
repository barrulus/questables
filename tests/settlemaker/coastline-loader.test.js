import { jest } from '@jest/globals';

const { loadCoastlineGeometry } = await import(
  '../../server/services/settlemaker/coastline-loader.js'
);

// geom units are pixel * meters_per_pixel with y negated (PostGIS y-up).
const METERS_PER_PIXEL = 10000;

// The loader issues two queries: meters_per_pixel first, then the water-cell
// union. Only the second is driven by the per-test impl.
function makeClient(queryImpl) {
  const query = jest.fn(async (sql, params) => {
    if (String(sql).includes('meters_per_pixel')) {
      return { rows: [{ meters_per_pixel: METERS_PER_PIXEL }] };
    }
    return queryImpl(sql, params);
  });
  return { query };
}

const gx = (px) => px * METERS_PER_PIXEL;
const gy = (py) => -py * METERS_PER_PIXEL;

describe('coastline-loader', () => {
  const burg = { id: 'b-1', world_id: 'w-1', x_px: 100, y_px: 200 };
  // rWorldPx === rLocal → scale 1, so local coords equal burg-relative pixels.
  const opts = { rWorldPx: 100, rLocal: 100 };

  test('unions water cells in SQL (regression: per-cell rings made water confetti)', async () => {
    const client = makeClient(async () => ({ rows: [] }));
    await loadCoastlineGeometry(client, burg, opts);
    const sql = client.query.mock.calls[1][0];
    expect(sql).toContain('ST_Union(c.geom)');
  });

  test('emits interior rings as separate rings (island holes stay land via even-odd)', async () => {
    // Lake outer ring 10x10 px at burg-relative (0,0)..(10,10) with a 2x2
    // island hole at (2,2)..(4,4). GeoJSON rings are closed (first == last).
    const outer = [
      [gx(100), gy(200)], [gx(110), gy(200)], [gx(110), gy(210)], [gx(100), gy(210)], [gx(100), gy(200)],
    ];
    const hole = [
      [gx(102), gy(202)], [gx(104), gy(202)], [gx(104), gy(204)], [gx(102), gy(204)], [gx(102), gy(202)],
    ];
    const poly = JSON.stringify({ type: 'Polygon', coordinates: [outer, hole] });
    const client = makeClient(async () => ({ rows: [{ poly }] }));

    const rings = await loadCoastlineGeometry(client, burg, opts);

    expect(rings).toHaveLength(2);
    // Closing vertex stripped, coords burg-relative at scale 1.
    expect(rings[0]).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    expect(rings[1]).toEqual([
      { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 },
    ]);
  });

  test('skips degenerate rings but keeps valid ones', async () => {
    const outer = [
      [gx(100), gy(200)], [gx(110), gy(200)], [gx(110), gy(210)], [gx(100), gy(210)], [gx(100), gy(200)],
    ];
    const degenerate = [[gx(100), gy(200)], [gx(101), gy(200)], [gx(100), gy(200)]];
    const poly = JSON.stringify({ type: 'Polygon', coordinates: [outer, degenerate] });
    const client = makeClient(async () => ({ rows: [{ poly }] }));

    const rings = await loadCoastlineGeometry(client, burg, opts);
    expect(rings).toHaveLength(1);
  });
});
