export async function ingestFeatures(client, worldId, parsed, log) {
  log(0, 'Features');
  const features = (parsed.pack?.features || []).filter((f) => f && typeof f === 'object');
  if (features.length === 0) { log(100, 'No features'); return { rowCount: 0 }; }
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    await client.query(
      `INSERT INTO public.maps_features
        (world_id, feature_id, name, type, group_name, land, area, height,
         flux, temp, evaporation, first_cell, outlet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (world_id, feature_id) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, group_name = EXCLUDED.group_name,
         land = EXCLUDED.land, area = EXCLUDED.area, height = EXCLUDED.height,
         flux = EXCLUDED.flux, temp = EXCLUDED.temp, evaporation = EXCLUDED.evaporation,
         first_cell = EXCLUDED.first_cell, outlet = EXCLUDED.outlet`,
      [
        worldId, f.i, f.name ?? null, f.type ?? null, f.group ?? null,
        f.land ?? null, f.area ?? null, f.height ?? null, f.flux ?? null,
        f.temp ?? null, f.evaporation ?? null, f.firstCell ?? null, f.outlet ?? null,
      ],
    );
    if (i % 50 === 0) log(Math.floor((i / features.length) * 100), `features ${i}/${features.length}`);
  }
  log(100, `${features.length} features`);
  return { rowCount: features.length };
}
