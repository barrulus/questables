import { cardinalGateName } from './cardinal-names.js';

// Settlemaker route ids are used here; accept any string that isn't the
// literal 'roads' or 'direct' as a potential route identifier.
function viaLooksLikeRouteId(via) {
  if (typeof via !== 'string') return false;
  if (via === 'roads' || via === 'direct') return false;
  return true;
}

function rowToGate(row, matchedBy) {
  return {
    entranceId: row.id,
    gateId: row.gate_id,
    x: Number(row.x_px),
    y: Number(row.y_px),
    bearingDeg: Number(row.bearing_deg),
    kind: row.kind,
    subKind: row.sub_kind,
    name: row.name ?? cardinalGateName(Number(row.bearing_deg)),
    matchedBy,
  };
}

async function loadEntrances(client, burgId) {
  const { rows } = await client.query(
    `SELECT id, gate_id, route_id, x_px, y_px, bearing_deg,
            bearing_match_delta_deg, kind, sub_kind, name
       FROM public.maps_burg_entrances
      WHERE burg_id = $1`,
    [burgId],
  );
  return rows;
}

export async function pickArrivalGate(client, { plan, destination }) {
  if (destination?.kind !== 'burg') return null;
  if (!destination.burgId) return null;
  if (plan?.mode === 'fly' || plan?.mode === 'teleport') return null;

  const entrances = await loadEntrances(client, destination.burgId);
  if (entrances.length === 0) return null;
  if (entrances.length === 1) return rowToGate(entrances[0], 'single_option');

  if (viaLooksLikeRouteId(plan.effectiveVia)) {
    const matches = entrances.filter((r) => r.route_id === plan.effectiveVia);
    if (matches.length === 1) return rowToGate(matches[0], 'route_id');
    if (matches.length > 1) {
      matches.sort((a, b) => {
        const da = a.bearing_match_delta_deg ?? Number.POSITIVE_INFINITY;
        const db = b.bearing_match_delta_deg ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
      return rowToGate(matches[0], 'route_id');
    }
  }

  // Approach-vector fallback arrives in Task 7; for now, return null so the
  // caller falls back to Plan 2 centroid behavior.
  return null;
}
