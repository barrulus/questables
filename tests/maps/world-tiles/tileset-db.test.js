/** @jest-environment node */
import {
  describeWithDb,
  openTxClient,
  rollbackAndClose,
  seedWorld,
} from '../../maps/fmg-full-json/db-harness.js';
import { listTileSets, upsertWorldTileset } from '../../../server/services/maps/service.js';

describeWithDb('world-scoped tile_sets', () => {
  let client;
  let q;
  let worldA;
  let worldB;

  beforeEach(async () => {
    client = await openTxClient();
    // Adapter: the pool `query` helper takes (text, params, opts); a pg Client
    // only takes (text, params). Drop opts inside the transaction.
    q = (text, params) => client.query(text, params);
    worldA = await seedWorld(client, { name: 'Tileset world A' });
    worldB = await seedWorld(client, { name: 'Tileset world B' });
  });

  afterEach(async () => {
    await rollbackAndClose(client);
  });

  test('upsert inserts one Base map row with the spec fields', async () => {
    const row = await upsertWorldTileset({ worldId: worldA, maxZoom: 6, uploadedBy: null }, q);
    expect(row).toMatchObject({
      name: 'Base map',
      format: 'png',
      tile_size: 256,
      min_zoom: 0,
      max_zoom: 6,
      is_active: true,
      world_id: worldA,
    });
    // base_url carries a cache-busting ?v= query param minted at upsert
    // time (immutable Cache-Control means the URL itself must change to
    // invalidate stale browser-cached tiles after a base-map replace).
    expect(row.base_url).toMatch(new RegExp(`^/api/maps/${worldA}/tiles/\\{z\\}/\\{x\\}/\\{y\\}\\.png\\?v=\\d+$`));
  });

  test('re-upsert keeps exactly one row per world and updates max_zoom', async () => {
    const first = await upsertWorldTileset({ worldId: worldA, maxZoom: 5, uploadedBy: null }, q);
    // Guard against both upserts landing in the same millisecond, which
    // would make the ?v= timestamps collide and the "differs" assertion
    // below flaky.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await upsertWorldTileset({ worldId: worldA, maxZoom: 7, uploadedBy: null }, q);
    expect(second.id).toBe(first.id);
    expect(second.max_zoom).toBe(7);
    // The whole point of versioning the URL: a replace must mint a new
    // base_url so immutable browser caches from the old URL are bypassed.
    expect(second.base_url).not.toBe(first.base_url);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM tile_sets WHERE world_id = $1`,
      [worldA],
    );
    expect(rows[0].n).toBe(1);
  });

  test('listTileSets(worldId): scoped row wins; legacy global only as fallback', async () => {
    // A legacy global tileset (world_id NULL), like snoopia's.
    await client.query(
      `INSERT INTO tile_sets (name, base_url, format, is_active)
       VALUES ('Legacy global', '/tiles/{z}/{x}/{y}.png', 'png', true)`,
    );
    await upsertWorldTileset({ worldId: worldA, maxZoom: 6, uploadedBy: null }, q);

    const scoped = await listTileSets(worldA, q);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].world_id).toBe(worldA);

    // worldB has no scoped tileset → sees the legacy global rows.
    const fallback = await listTileSets(worldB, q);
    expect(fallback.length).toBeGreaterThanOrEqual(1);
    expect(fallback.every((r) => r.world_id === null)).toBe(true);
    expect(fallback.some((r) => r.name === 'Legacy global')).toBe(true);
  });

  test('listTileSets() without worldId keeps current behavior and exposes world_id', async () => {
    await upsertWorldTileset({ worldId: worldA, maxZoom: 6, uploadedBy: null }, q);
    const all = await listTileSets(null, q);
    const mine = all.find((r) => r.world_id === worldA);
    expect(mine).toBeDefined();
    expect(mine.is_active).toBe(true);
  });

  test('inactive scoped row does not shadow the global fallback', async () => {
    await client.query(
      `INSERT INTO tile_sets (name, base_url, format, is_active)
       VALUES ('Legacy global', '/tiles/{z}/{x}/{y}.png', 'png', true)`,
    );
    await client.query(
      `INSERT INTO tile_sets (name, base_url, format, is_active, world_id)
       VALUES ('Base map', '/api/x/{z}/{x}/{y}.png', 'png', false, $1)`,
      [worldA],
    );
    const rows = await listTileSets(worldA, q);
    expect(rows.every((r) => r.world_id === null)).toBe(true);
  });
});
