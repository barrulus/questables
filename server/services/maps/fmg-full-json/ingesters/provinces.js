import { upsertCoa } from './coats.js';

export async function ingestProvinces(client, worldId, parsed, log) {
  log(0, 'Provinces');
  const provinces = (parsed.pack?.provinces || []).filter((p) => p && typeof p === 'object');
  if (provinces.length === 0) { log(100, 'No provinces'); return { rowCount: 0 }; }
  for (const p of provinces) {
    const pole = Array.isArray(p.pole) ? p.pole : [null, null];
    await client.query(
      `INSERT INTO public.maps_provinces
        (world_id, province_id, name, full_name, form_name, color,
         state_id, burg_id, center_x, center_y)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (world_id, province_id) DO UPDATE SET
         name=EXCLUDED.name, full_name=EXCLUDED.full_name,
         form_name=EXCLUDED.form_name, color=EXCLUDED.color,
         state_id=EXCLUDED.state_id, burg_id=EXCLUDED.burg_id,
         center_x=EXCLUDED.center_x, center_y=EXCLUDED.center_y`,
      [
        worldId, p.i, p.name ?? null, p.fullName ?? null, p.formName ?? null,
        p.color ?? null, p.state ?? null, p.burg ?? null, pole[0] ?? null, pole[1] ?? null,
      ],
    );
    if (p.coa) await upsertCoa(client, worldId, 'province', p.i, p.coa);
  }
  log(100, `${provinces.length} provinces`);
  return { rowCount: provinces.length };
}

export async function aggregateProvinceGeometry(client, worldId, log) {
  log(0, 'Province geometry');
  await client.query(
    `UPDATE public.maps_provinces p
        SET geom = sub.geom
       FROM (
         SELECT province AS province_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND province IS NOT NULL AND province > 0
          GROUP BY province
       ) sub
      WHERE p.world_id = $1 AND p.province_id = sub.province_id`,
    [worldId],
  );
  log(100, 'Province geometry done');
}
