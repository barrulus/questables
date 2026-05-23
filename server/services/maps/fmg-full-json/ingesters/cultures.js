export async function ingestCultures(client, worldId, parsed, log) {
  log(0, 'Cultures');
  const cultures = (parsed.pack?.cultures || []).filter((c) => c && typeof c === 'object');
  if (cultures.length === 0) { log(100, 'No cultures'); return { rowCount: 0 }; }
  for (let i = 0; i < cultures.length; i++) {
    const c = cultures[i];
    await client.query(
      `INSERT INTO public.maps_cultures
        (world_id, culture_id, name, code, color, type, base, expansionism, center_cell)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (world_id, culture_id) DO UPDATE SET
         name = EXCLUDED.name, code = EXCLUDED.code, color = EXCLUDED.color,
         type = EXCLUDED.type, base = EXCLUDED.base,
         expansionism = EXCLUDED.expansionism, center_cell = EXCLUDED.center_cell`,
      [
        worldId, c.i, c.name ?? null, c.code ?? null, c.color ?? null,
        c.type ?? null, c.base ?? null, c.expansionism ?? null, c.center ?? null,
      ],
    );
  }
  log(100, `${cultures.length} cultures`);
  return { rowCount: cultures.length };
}
