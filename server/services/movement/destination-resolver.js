const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(message, extra = {}) {
  const err = new Error(message);
  err.status = 404;
  err.code = 'destination_not_found';
  Object.assign(err, extra);
  return err;
}

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'invalid_destination';
  return err;
}

async function resolveBurg(client, campaignId, ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    throw invalid('burg ref must be a non-empty string');
  }

  const isUuid = UUID_RE.test(ref.trim());
  let rows;

  if (isUuid) {
    // Query by UUID
    ({ rows } = await client.query(
      `SELECT b.id, ST_X(b.geom) AS x, ST_Y(b.geom) AS y, b.name
       FROM public.maps_burgs b
       JOIN public.campaigns c ON c.world_map_id = b.world_id
       WHERE c.id = $1 AND b.id = $2::uuid
       LIMIT 1`,
      [campaignId, ref.trim()],
    ));
  } else {
    // Query by name (case-insensitive)
    ({ rows } = await client.query(
      `SELECT b.id, ST_X(b.geom) AS x, ST_Y(b.geom) AS y, b.name
       FROM public.maps_burgs b
       JOIN public.campaigns c ON c.world_map_id = b.world_id
       WHERE c.id = $1 AND b.name ILIKE $2
       LIMIT 1`,
      [campaignId, ref.trim()],
    ));
  }

  if (rows.length === 0) {
    throw notFound(`No burg matching "${ref}" in this campaign's world`);
  }

  const row = rows[0];
  return {
    x: Number(row.x),
    y: Number(row.y),
    burgId: row.id,
    mapLevel: 'settlement',
    resolvedName: row.name,
  };
}

function resolveCoordinate(ref) {
  if (!ref || typeof ref !== 'object') {
    throw invalid('coordinate ref must be an object with x and y');
  }
  const x = Number(ref.x);
  const y = Number(ref.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw invalid('coordinate ref requires finite x and y');
  }
  return { x, y, burgId: null, mapLevel: 'world', resolvedName: null };
}

async function resolvePoi(client, campaignId, ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    throw invalid('poi ref must be a non-empty string');
  }
  const { rows } = await client.query(
    `SELECT m.id, ST_X(m.geom) AS x, ST_Y(m.geom) AS y, m.note
       FROM public.maps_markers m
       JOIN public.campaigns c ON c.world_map_id = m.world_id
      WHERE c.id = $1
        AND m.note ILIKE $2
      ORDER BY length(m.note) ASC
      LIMIT 1`,
    [campaignId, `%${ref.trim()}%`],
  );
  if (rows.length === 0) {
    throw notFound(`No POI matching "${ref}" on this world`);
  }
  const row = rows[0];
  return {
    x: Number(row.x),
    y: Number(row.y),
    burgId: null,
    mapLevel: 'world',
    resolvedName: row.note,
  };
}

export async function resolveDestination(client, { campaignId, destination }) {
  if (!destination || typeof destination !== 'object') {
    throw invalid('destination is required');
  }
  if (!campaignId) {
    throw invalid('campaignId is required');
  }

  switch (destination.kind) {
    case 'burg':
      return resolveBurg(client, campaignId, destination.ref);
    case 'poi':
      return resolvePoi(client, campaignId, destination.ref);
    case 'coordinate':
      return resolveCoordinate(destination.ref);
    default:
      throw invalid(`Unsupported destination kind: ${destination.kind}`);
  }
}
