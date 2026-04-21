import { pool } from '../../db/pool.js';

const SELECT_COLUMNS = [
  'id', 'burg_id', 'gate_id', 'route_id', 'x_px', 'y_px', 'bearing_deg',
  'bearing_match_delta_deg', 'kind', 'sub_kind', 'wall_vertex_index',
  'prev_gate_id', 'next_gate_id', 'name',
  'arrival_local',
  'settlement_generation_version', 'settlemaker_version',
];

const SELECT_LIST = SELECT_COLUMNS.join(', ');
const SELECT_LIST_PREFIXED = SELECT_COLUMNS.map((c) => `e.${c}`).join(', ');

export async function listByBurg(client, burgId) {
  const { rows } = await client.query(
    `SELECT ${SELECT_LIST} FROM public.maps_burg_entrances WHERE burg_id = $1`,
    [burgId],
  );
  return rows;
}

export async function listByWorld(worldId) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_LIST_PREFIXED}
       FROM public.maps_burg_entrances e
       JOIN public.maps_burgs b ON b.id = e.burg_id
      WHERE b.world_id = $1`,
    [worldId],
  );
  return rows;
}

export async function distinctVersionForBurg(client, burgId) {
  const { rows } = await client.query(
    `SELECT DISTINCT settlement_generation_version
       FROM public.maps_burg_entrances
      WHERE burg_id = $1`,
    [burgId],
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) return 'MIXED';
  return rows[0].settlement_generation_version;
}

export async function deleteForBurg(client, burgId) {
  await client.query(
    `DELETE FROM public.maps_burg_entrances WHERE burg_id = $1`,
    [burgId],
  );
}

export async function insertMany(client, rows) {
  if (rows.length === 0) return;
  for (const r of rows) {
    await client.query(
      `INSERT INTO public.maps_burg_entrances
         (burg_id, gate_id, route_id, x_px, y_px, bearing_deg,
          bearing_match_delta_deg, kind, sub_kind, wall_vertex_index,
          prev_gate_id, next_gate_id, name, arrival_local,
          settlement_generation_version, settlemaker_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        r.burg_id, r.gate_id, r.route_id, r.x_px, r.y_px, r.bearing_deg,
        r.bearing_match_delta_deg, r.kind, r.sub_kind, r.wall_vertex_index,
        r.prev_gate_id, r.next_gate_id, r.name,
        r.arrival_local != null ? JSON.stringify(r.arrival_local) : null,
        r.settlement_generation_version, r.settlemaker_version,
      ],
    );
  }
}
