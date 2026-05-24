export async function ingestMarkers(client, worldId, parsed, log) {
  log(0, 'Markers');
  const markers = (parsed.pack?.markers || []).filter((m) => m && typeof m === 'object');
  if (markers.length === 0) { log(100, 'No markers'); return { rowCount: 0 }; }

  for (const m of markers) {
    if (m.x == null || m.y == null) continue;
    await client.query(
      `INSERT INTO public.maps_markers
        (world_id, marker_id, type, icon, x_px, y_px, geom)
       VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_MakePoint($5, $6), 0))
       ON CONFLICT (world_id, marker_id) DO UPDATE SET
         type=EXCLUDED.type, icon=EXCLUDED.icon,
         x_px=EXCLUDED.x_px, y_px=EXCLUDED.y_px, geom=EXCLUDED.geom`,
      [worldId, m.i, m.type ?? null, m.icon ?? null, m.x, m.y],
    );
  }
  log(100, `${markers.length} markers`);
  return { rowCount: markers.length };
}
