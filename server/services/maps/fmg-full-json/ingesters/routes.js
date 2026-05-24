export async function ingestRoutes(client, worldId, parsed, log) {
  log(0, 'Routes');
  const routes = (parsed.pack?.routes || []).filter((r) => r && typeof r === 'object');
  if (routes.length === 0) { log(100, 'No routes'); return { rowCount: 0 }; }

  for (const r of routes) {
    if (!Array.isArray(r.points) || r.points.length < 2) continue;
    const wkt = `LINESTRING(${r.points.map((p) => `${p[0]} ${p[1]}`).join(',')})`;
    await client.query(
      `INSERT INTO public.maps_routes
        (world_id, route_id, name, type, feature, group_name, geom)
       VALUES ($1,$2,$3,$4,$5,$6, ST_Multi(ST_GeomFromText($7, 0)))
       ON CONFLICT (world_id, route_id) DO UPDATE SET
         name=EXCLUDED.name, type=EXCLUDED.type, feature=EXCLUDED.feature,
         group_name=EXCLUDED.group_name, geom=EXCLUDED.geom`,
      [worldId, r.i, r.name ?? null, r.type ?? null, r.feature ?? null, r.group ?? null, wkt],
    );
  }
  log(100, `${routes.length} routes`);
  return { rowCount: routes.length };
}
