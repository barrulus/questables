export async function ingestWorld(client, worldId, parsed, log) {
  log(0, 'World metadata');
  const info = parsed.info || {};
  await client.query(
    `UPDATE public.maps_world
        SET fmg_version = $2,
            fmg_map_id = $3,
            fmg_seed = $4,
            map_coordinates = $5,
            updated_at = now()
      WHERE id = $1`,
    [
      worldId,
      info.version || null,
      info.mapId != null ? String(info.mapId) : null,
      info.seed || null,
      parsed.mapCoordinates ? JSON.stringify(parsed.mapCoordinates) : null,
    ],
  );
  log(100, 'World metadata done');
  return { rowCount: 1 };
}
