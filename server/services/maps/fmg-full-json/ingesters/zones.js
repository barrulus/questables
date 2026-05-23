export async function ingestZones(client, worldId, parsed, log) {
  log(0, 'Zones');
  const zones = (parsed.pack?.zones || []).filter((z) => z && typeof z === 'object');
  if (zones.length === 0) { log(100, 'No zones'); return { rowCount: 0 }; }
  for (const z of zones) {
    const cellIds = Array.isArray(z.cells) ? z.cells : [];
    await client.query(
      `INSERT INTO public.maps_zones
        (world_id, zone_id, name, type, color, cells, geom)
       SELECT $1, $2, $3, $4, $5, $6,
              CASE WHEN $6::int[] = '{}' THEN NULL
                   ELSE (SELECT ST_Multi(ST_Union(geom)) FROM public.maps_cells
                          WHERE world_id = $1 AND cell_id = ANY($6::int[])) END
       ON CONFLICT (world_id, zone_id) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, color = EXCLUDED.color,
         cells = EXCLUDED.cells, geom = EXCLUDED.geom`,
      [worldId, z.i, z.name ?? null, z.type ?? null, z.color ?? null, cellIds],
    );
  }
  log(100, `${zones.length} zones`);
  return { rowCount: zones.length };
}
