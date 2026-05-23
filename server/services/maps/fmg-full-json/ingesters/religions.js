export async function ingestReligions(client, worldId, parsed, log) {
  log(0, 'Religions');
  const religions = (parsed.pack?.religions || []).filter((r) => r && typeof r === 'object');
  if (religions.length === 0) { log(100, 'No religions'); return { rowCount: 0 }; }
  for (const r of religions) {
    await client.query(
      `INSERT INTO public.maps_religions
        (world_id, religion_id, name, code, color, type, form, deity,
         culture, expansion, expansionism, center_cell, origins)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (world_id, religion_id) DO UPDATE SET
         name=EXCLUDED.name, code=EXCLUDED.code, color=EXCLUDED.color,
         type=EXCLUDED.type, form=EXCLUDED.form, deity=EXCLUDED.deity,
         culture=EXCLUDED.culture, expansion=EXCLUDED.expansion,
         expansionism=EXCLUDED.expansionism, center_cell=EXCLUDED.center_cell,
         origins=EXCLUDED.origins`,
      [
        worldId, r.i, r.name ?? null, r.code ?? null, r.color ?? null,
        r.type ?? null, r.form ?? null, r.deity ?? null, r.culture ?? null,
        r.expansion ?? null, r.expansionism ?? null, r.center ?? null,
        Array.isArray(r.origins) ? r.origins : null,
      ],
    );
  }
  log(100, `${religions.length} religions`);
  return { rowCount: religions.length };
}

export async function aggregateReligionGeometry(client, worldId, log) {
  log(0, 'Religion geometry');
  await client.query(
    `UPDATE public.maps_religions r
        SET geom = sub.geom
       FROM (
         SELECT religion AS religion_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND religion IS NOT NULL
          GROUP BY religion
       ) sub
      WHERE r.world_id = $1 AND r.religion_id = sub.religion_id`,
    [worldId],
  );
  log(100, 'Religion geometry done');
}
