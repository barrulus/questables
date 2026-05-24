export async function ingestDiplomacy(client, worldId, parsed, log) {
  log(0, 'Diplomacy');
  const states = parsed.pack?.states || [];
  let count = 0;
  for (const s of states) {
    if (!s || !Array.isArray(s.diplomacy)) continue;
    for (let b = 0; b < s.diplomacy.length; b++) {
      const status = s.diplomacy[b];
      if (!status || status === 'x') continue;
      await client.query(
        `INSERT INTO public.maps_diplomacy (world_id, state_a_id, state_b_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (world_id, state_a_id, state_b_id) DO UPDATE SET status = EXCLUDED.status`,
        [worldId, s.i, b, status],
      );
      count++;
    }
  }
  log(100, `${count} diplomacy edges`);
  return { rowCount: count };
}
