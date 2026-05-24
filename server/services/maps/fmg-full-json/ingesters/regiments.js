export async function ingestRegiments(client, worldId, parsed, log) {
  log(0, 'Regiments');
  const states = parsed.pack?.states || [];
  let count = 0;
  for (const s of states) {
    if (!s || !Array.isArray(s.military)) continue;
    for (const r of s.military) {
      const u = r.u || {};
      await client.query(
        `INSERT INTO public.maps_regiments
          (world_id, regiment_id, state_id, name, icon, cell, x_px, y_px,
           base_x, base_y, total_men, attack_value,
           u_infantry, u_archers, u_cavalry, u_artillery, u_fleet)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (world_id, state_id, regiment_id) DO UPDATE SET
           name=EXCLUDED.name, icon=EXCLUDED.icon, cell=EXCLUDED.cell,
           x_px=EXCLUDED.x_px, y_px=EXCLUDED.y_px,
           base_x=EXCLUDED.base_x, base_y=EXCLUDED.base_y,
           total_men=EXCLUDED.total_men, attack_value=EXCLUDED.attack_value,
           u_infantry=EXCLUDED.u_infantry, u_archers=EXCLUDED.u_archers,
           u_cavalry=EXCLUDED.u_cavalry, u_artillery=EXCLUDED.u_artillery,
           u_fleet=EXCLUDED.u_fleet`,
        [
          worldId, r.i, s.i, r.name ?? null, r.icon ?? null, r.cell ?? null,
          r.x ?? null, r.y ?? null, r.bx ?? null, r.by ?? null,
          r.n ?? null, r.a ?? null,
          u.infantry ?? null, u.archers ?? null, u.cavalry ?? null,
          u.artillery ?? null, u.fleet ?? null,
        ],
      );
      count++;
    }
  }
  log(100, `${count} regiments`);
  return { rowCount: count };
}
