import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { buildCellPolygonsWkt } from '../geometry-builder.js';

// COPY format: tab-separated, NULL = \N. We escape backslashes and tabs to
// keep WKT and any future text columns safe.
function pgCopyEscape(v) {
  if (v === null || v === undefined) return '\\N';
  if (typeof v === 'boolean') return v ? 't' : 'f';
  const s = String(v);
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

const COLUMNS = [
  'world_id', 'cell_id', 'biome', 'type', 'population', 'state',
  'culture', 'religion', 'height', 'flux', 'confluence', 'river_id',
  'haven', 'harbor', 'pop', 'province', 'feature', 'area', 'temperature',
  'geom_wkt',
];

export async function ingestCells(client, worldId, parsed, log) {
  log(0, 'Cells');
  const cells = parsed.pack?.cells || [];
  const vertices = parsed.pack?.vertices || [];
  if (cells.length === 0) { log(100, 'No cells'); return { rowCount: 0 }; }

  log(5, `Building ${cells.length} cell polygons`);
  const wktList = buildCellPolygonsWkt(cells, vertices);

  log(15, 'Creating staging table');
  await client.query(
    `CREATE TEMP TABLE _ingest_cells (
       world_id UUID, cell_id INTEGER, biome INTEGER, type INTEGER,
       population NUMERIC, state INTEGER, culture INTEGER, religion INTEGER,
       height NUMERIC, flux INTEGER, confluence INTEGER, river_id INTEGER,
       haven INTEGER, harbor INTEGER, pop NUMERIC, province INTEGER,
       feature INTEGER, area NUMERIC, temperature NUMERIC, geom_wkt TEXT
     ) ON COMMIT DROP`,
  );

  log(20, `COPY ${cells.length} cells into staging`);
  const copyStream = client.query(
    copyFrom(`COPY _ingest_cells (${COLUMNS.join(',')}) FROM STDIN`),
  );

  async function* genLines() {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const row = [
        worldId, c.i, c.biome ?? null, c.t ?? null, null /* population */,
        c.state ?? null, c.culture ?? null, c.religion ?? null, c.h ?? null,
        c.fl ?? null, c.conf ?? null, c.r ?? null, c.haven ?? null,
        c.harbor ?? null, c.pop ?? null, c.province ?? null, c.f ?? null,
        c.area ?? null, null /* temperature */, wktList[i],
      ];
      yield row.map(pgCopyEscape).join('\t') + '\n';
    }
  }
  await pipeline(Readable.from(genLines()), copyStream);

  log(80, 'Promoting staging → maps_cells');
  await client.query(
    `INSERT INTO public.maps_cells
       (world_id, cell_id, biome, type, population, state, culture, religion,
        height, flux, confluence, river_id, haven, harbor, pop, province,
        feature, area, temperature, geom)
     SELECT world_id, cell_id, biome, type::text, population, state, culture, religion,
            height, flux, confluence, river_id, haven, harbor, pop, province,
            feature, area, temperature,
            CASE WHEN geom_wkt IS NULL THEN NULL
                 ELSE ST_Multi(ST_GeomFromText(geom_wkt, 0)) END
       FROM _ingest_cells
     ON CONFLICT (world_id, cell_id) DO UPDATE SET
       biome = EXCLUDED.biome, type = EXCLUDED.type, population = EXCLUDED.population,
       state = EXCLUDED.state, culture = EXCLUDED.culture, religion = EXCLUDED.religion,
       height = EXCLUDED.height, flux = EXCLUDED.flux, confluence = EXCLUDED.confluence,
       river_id = EXCLUDED.river_id, haven = EXCLUDED.haven, harbor = EXCLUDED.harbor,
       pop = EXCLUDED.pop, province = EXCLUDED.province, feature = EXCLUDED.feature,
       area = EXCLUDED.area, temperature = EXCLUDED.temperature,
       geom = EXCLUDED.geom`,
  );

  log(100, `${cells.length} cells`);
  return { rowCount: cells.length };
}
