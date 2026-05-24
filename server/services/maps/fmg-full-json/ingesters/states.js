import { upsertCoa } from './coats.js';

export async function ingestStates(client, worldId, parsed, log) {
  log(0, 'States');
  const states = (parsed.pack?.states || []).filter((s) => s && typeof s === 'object');
  if (states.length === 0) { log(100, 'No states'); return { rowCount: 0 }; }

  for (let idx = 0; idx < states.length; idx++) {
    const s = states[idx];
    const pole = Array.isArray(s.pole) ? s.pole : [null, null];
    const center = Array.isArray(s.center) ? s.center : null;
    await client.query(
      `INSERT INTO public.maps_states
        (world_id, state_id, name, full_name, form, form_name, color, type,
         culture, religion, capital_burg_id, expansionism, urban, rural, area,
         neighbors, center_x, center_y, pole_x, pole_y)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (world_id, state_id) DO UPDATE SET
         name=EXCLUDED.name, full_name=EXCLUDED.full_name, form=EXCLUDED.form,
         form_name=EXCLUDED.form_name, color=EXCLUDED.color, type=EXCLUDED.type,
         culture=EXCLUDED.culture, religion=EXCLUDED.religion,
         capital_burg_id=EXCLUDED.capital_burg_id, expansionism=EXCLUDED.expansionism,
         urban=EXCLUDED.urban, rural=EXCLUDED.rural, area=EXCLUDED.area,
         neighbors=EXCLUDED.neighbors, center_x=EXCLUDED.center_x, center_y=EXCLUDED.center_y,
         pole_x=EXCLUDED.pole_x, pole_y=EXCLUDED.pole_y`,
      [
        worldId, s.i, s.name ?? null, s.fullName ?? null, s.form ?? null,
        s.formName ?? null, s.color ?? null, s.type ?? null, s.culture ?? null,
        s.religion ?? null, s.capital ?? null, s.expansionism ?? null,
        s.urban ?? null, s.rural ?? null, s.area ?? null,
        Array.isArray(s.neighbors) ? s.neighbors : null,
        center?.[0] ?? null, center?.[1] ?? null, pole[0] ?? null, pole[1] ?? null,
      ],
    );
    if (s.coa) await upsertCoa(client, worldId, 'state', s.i, s.coa);
  }
  log(100, `${states.length} states`);
  return { rowCount: states.length };
}

export async function aggregateStateGeometry(client, worldId, log) {
  log(0, 'State geometry');
  await client.query(
    `UPDATE public.maps_states st
        SET geom = sub.geom
       FROM (
         SELECT state AS state_id, ST_Multi(ST_Union(geom)) AS geom
           FROM public.maps_cells
          WHERE world_id = $1 AND state IS NOT NULL AND state > 0
          GROUP BY state
       ) sub
      WHERE st.world_id = $1 AND st.state_id = sub.state_id`,
    [worldId],
  );
  log(100, 'State geometry done');
}
