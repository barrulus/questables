export async function ingestBiomes(client, worldId, parsed, log) {
  log(0, 'Biomes');
  const bd = parsed.biomesData;
  if (!bd || !Array.isArray(bd.i)) {
    log(100, 'No biomesData');
    return { rowCount: 0 };
  }
  const values = [];
  const params = [];
  let p = 1;
  for (let idx = 0; idx < bd.i.length; idx++) {
    const iconArr = Array.isArray(bd.icons?.[idx]) ? bd.icons[idx] : [];
    values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
    params.push(
      worldId,
      bd.i[idx],
      bd.name?.[idx] ?? null,
      bd.color?.[idx] ?? null,
      bd.habitability?.[idx] ?? null,
      iconArr.join(','),
      bd.biomesMartin?.[idx] ?? null,
      bd.cost?.[idx] ?? null,
    );
  }
  const sql =
    `INSERT INTO public.maps_biomes
      (world_id, biome_id, name, color, habitability, icons_csv, biomes_martin, cost)
    VALUES ${values.join(',')}
    ON CONFLICT (world_id, biome_id) DO UPDATE SET
      name = EXCLUDED.name, color = EXCLUDED.color,
      habitability = EXCLUDED.habitability, icons_csv = EXCLUDED.icons_csv,
      biomes_martin = EXCLUDED.biomes_martin, cost = EXCLUDED.cost`;
  await client.query(sql, params);
  log(100, `${bd.i.length} biomes`);
  return { rowCount: bd.i.length };
}
