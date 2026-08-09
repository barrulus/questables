import { negateY } from '../geometry-builder.js';

function lineWktFromCellCentroids(cellIds, cellsById) {
  const pts = [];
  for (const id of cellIds) {
    const c = cellsById.get(id);
    if (!c || !Array.isArray(c.p)) continue;
    pts.push(`${c.p[0]} ${negateY(c.p[1])}`);
  }
  if (pts.length < 2) return null;
  return `LINESTRING(${pts.join(',')})`;
}

export async function ingestRivers(client, worldId, parsed, log) {
  log(0, 'Rivers');
  const rivers = (parsed.pack?.rivers || []).filter((r) => r && typeof r === 'object');
  if (rivers.length === 0) { log(100, 'No rivers'); return { rowCount: 0 }; }

  const cellsById = new Map();
  for (const c of (parsed.pack?.cells || [])) cellsById.set(c.i, c);

  for (const r of rivers) {
    const wkt = lineWktFromCellCentroids(Array.isArray(r.cells) ? r.cells : [], cellsById);
    await client.query(
      `INSERT INTO public.maps_rivers
        (world_id, river_id, name, type, discharge, length, width,
         mouth, source, parent, basin, source_width, width_factor, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               CASE WHEN $14::text IS NULL THEN NULL
                    ELSE ST_Multi(ST_GeomFromText($14, 0)) END)
       ON CONFLICT (world_id, river_id) DO UPDATE SET
         name=EXCLUDED.name, type=EXCLUDED.type, discharge=EXCLUDED.discharge,
         length=EXCLUDED.length, width=EXCLUDED.width, mouth=EXCLUDED.mouth,
         source=EXCLUDED.source, parent=EXCLUDED.parent, basin=EXCLUDED.basin,
         source_width=EXCLUDED.source_width, width_factor=EXCLUDED.width_factor,
         geom=EXCLUDED.geom`,
      [
        worldId, r.i, r.name ?? null, r.type ?? null, r.discharge ?? null,
        r.length ?? null, r.width ?? null, r.mouth ?? null, r.source ?? null,
        r.parent ?? null, r.basin ?? null, r.sourceWidth ?? null,
        r.widthFactor ?? null, wkt,
      ],
    );
  }
  log(100, `${rivers.length} rivers`);
  return { rowCount: rivers.length };
}
