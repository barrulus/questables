const SELECT_COLUMNS = [
  'burg_id', 'meters_per_unit', 'diameter_meters', 'diameter_local',
  'scale_source', 'local_bounds', 'max_zoom', 'tile_extent_px',
  'svg_viewbox', 'has_harbour', 'ocean_bearing_deg', 'degraded_flags',
  'settlement_generation_version', 'settlemaker_version', 'ingested_at',
];

const SELECT_LIST = SELECT_COLUMNS.join(', ');

export async function getByBurg(client, burgId) {
  const { rows } = await client.query(
    `SELECT ${SELECT_LIST} FROM public.maps_burg_settlements WHERE burg_id = $1`,
    [burgId],
  );
  return rows[0] ?? null;
}

export async function upsert(client, burgId, payload) {
  await client.query(
    `INSERT INTO public.maps_burg_settlements
       (burg_id, meters_per_unit, diameter_meters, diameter_local,
        scale_source, local_bounds, max_zoom, tile_extent_px,
        svg_viewbox, has_harbour, ocean_bearing_deg, degraded_flags,
        settlement_generation_version, settlemaker_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (burg_id) DO UPDATE SET
       meters_per_unit = EXCLUDED.meters_per_unit,
       diameter_meters = EXCLUDED.diameter_meters,
       diameter_local = EXCLUDED.diameter_local,
       scale_source = EXCLUDED.scale_source,
       local_bounds = EXCLUDED.local_bounds,
       max_zoom = EXCLUDED.max_zoom,
       tile_extent_px = EXCLUDED.tile_extent_px,
       svg_viewbox = EXCLUDED.svg_viewbox,
       has_harbour = EXCLUDED.has_harbour,
       ocean_bearing_deg = EXCLUDED.ocean_bearing_deg,
       degraded_flags = EXCLUDED.degraded_flags,
       settlement_generation_version = EXCLUDED.settlement_generation_version,
       settlemaker_version = EXCLUDED.settlemaker_version,
       ingested_at = now()`,
    [
      burgId,
      payload.meters_per_unit,
      payload.diameter_meters,
      payload.diameter_local,
      payload.scale_source,
      JSON.stringify(payload.local_bounds),
      payload.max_zoom,
      payload.tile_extent_px,
      JSON.stringify(payload.svg_viewbox),
      payload.has_harbour,
      payload.ocean_bearing_deg ?? null,
      Array.isArray(payload.degraded_flags) && payload.degraded_flags.length > 0
        ? payload.degraded_flags
        : null,
      payload.settlement_generation_version,
      payload.settlemaker_version,
    ],
  );
}

export async function deleteForBurg(client, burgId) {
  await client.query(
    `DELETE FROM public.maps_burg_settlements WHERE burg_id = $1`,
    [burgId],
  );
}
