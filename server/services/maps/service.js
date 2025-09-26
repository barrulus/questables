import { query } from '../../db/pool.js';
import { parseBounds } from '../campaigns/service.js';

const ensureBounds = (bounds) => {
  const normalized = parseBounds(bounds);
  if (!normalized) {
    const error = new Error('Invalid bounds format');
    error.status = 400;
    error.code = 'invalid_bounds';
    throw error;
  }
  return normalized;
};

export const createWorldMap = async ({
  name,
  description,
  bounds,
  layers,
  uploadedBy,
  geojsonUrl = null,
  fileSizeBytes = null,
}) => {
  const { rows } = await query(
    `INSERT INTO maps_world (
        name,
        description,
        bounds,
        layers,
        uploaded_by,
        is_active,
        geojson_url,
        file_size_bytes
     )
     VALUES ($1, $2, $3, $4, $5, true, $6, $7)
     RETURNING *`,
    [
      name,
      description ?? null,
      bounds ? JSON.stringify(bounds) : null,
      layers ? JSON.stringify(layers) : null,
      uploadedBy,
      geojsonUrl ?? null,
      fileSizeBytes ?? null,
    ],
    { label: 'maps.world.create' },
  );

  return rows[0] ?? null;
};

export const listWorldMaps = async () => {
  const { rows } = await query(
    `SELECT mw.*, up.username AS uploaded_by_username
       FROM maps_world mw
       LEFT JOIN user_profiles up ON mw.uploaded_by = up.id
      WHERE mw.is_active = true
      ORDER BY mw.created_at DESC`,
    [],
    { label: 'maps.world.list' },
  );
  return rows;
};

export const getWorldMapById = async (id) => {
  const { rows } = await query(
    'SELECT * FROM maps_world WHERE id = $1',
    [id],
    { label: 'maps.world.fetch' },
  );
  return rows[0] ?? null;
};

export const listWorldBurgs = async ({ worldId, bounds }) => {
  const params = [worldId];
  let text = `
    SELECT id,
           world_id,
           burg_id,
           name,
           state,
           statefull,
           province,
           provincefull,
           culture,
           religion,
           population,
           populationraw,
           elevation,
           temperature,
           temperaturelikeness,
           capital,
           port,
           citadel,
           walls,
           plaza,
           temple,
           shanty,
           x_px,
           y_px,
           cell,
           ST_AsGeoJSON(geom)::json AS geometry
      FROM maps_burgs
     WHERE world_id = $1`;

  if (bounds) {
    const normalized = ensureBounds(bounds);
    text += ' AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))';
    params.push(normalized.west, normalized.south, normalized.east, normalized.north);
  }

  const { rows } = await query(text, params, { label: 'maps.burgs.list' });
  return rows;
};

export const listWorldMarkers = async ({ worldId, bounds }) => {
  const params = [worldId];
  let text = `
    SELECT id,
           world_id,
           marker_id,
           type,
           icon,
           note,
           x_px,
           y_px,
           ST_AsGeoJSON(geom)::json AS geometry
      FROM maps_markers
     WHERE world_id = $1`;

  if (bounds) {
    const normalized = ensureBounds(bounds);
    text += ' AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))';
    params.push(normalized.west, normalized.south, normalized.east, normalized.north);
  }

  const { rows } = await query(text, params, { label: 'maps.markers.list' });
  return rows;
};

export const listWorldRivers = async ({ worldId, bounds }) => {
  const params = [worldId];
  let text = `
    SELECT id,
           world_id,
           river_id,
           name,
           type,
           length,
           mouth,
           ST_AsGeoJSON(geom)::json AS geometry
      FROM maps_rivers
     WHERE world_id = $1`;

  if (bounds) {
    const normalized = ensureBounds(bounds);
    text += ' AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))';
    params.push(normalized.west, normalized.south, normalized.east, normalized.north);
  }

  const { rows } = await query(text, params, { label: 'maps.rivers.list' });
  return rows;
};

export const listWorldRoutes = async ({ worldId, bounds }) => {
  const params = [worldId];
  let text = `
    SELECT id,
           world_id,
           route_id,
           name,
           type,
           feature,
           ST_AsGeoJSON(geom)::json AS geometry
      FROM maps_routes
     WHERE world_id = $1`;

  if (bounds) {
    const normalized = ensureBounds(bounds);
    text += ' AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))';
    params.push(normalized.west, normalized.south, normalized.east, normalized.north);
  }

  const { rows } = await query(text, params, { label: 'maps.routes.list' });
  return rows;
};

export const listWorldCells = async ({ worldId, bounds }) => {
  if (!bounds) {
    const error = new Error('Bounds are required to fetch map cells');
    error.status = 400;
    error.code = 'cells_bounds_required';
    throw error;
  }

  const normalized = ensureBounds(bounds);
  const { rows } = await query(
    `
      SELECT id,
             world_id,
             cell_id,
             biome,
             type,
             population,
             state,
             culture,
             religion,
             height,
             ST_AsGeoJSON(geom)::json AS geometry
        FROM maps_cells
       WHERE world_id = $1
         AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))
    `,
    [worldId, normalized.west, normalized.south, normalized.east, normalized.north],
    { label: 'maps.cells.list' },
  );

  return rows;
};

export const createCampaignLocation = async (campaignId, {
  name,
  description,
  type,
  worldMapId,
  parentLocationId,
  worldPosition,
}) => {
  const hasWorldPosition = worldPosition
    && Number.isFinite(Number(worldPosition.lng))
    && Number.isFinite(Number(worldPosition.lat));

  if (worldPosition && !hasWorldPosition) {
    const error = new Error('Invalid world position');
    error.status = 400;
    error.code = 'invalid_world_position';
    throw error;
  }

  const params = [
    campaignId,
    name,
    description ?? null,
    type,
    worldMapId ?? null,
    parentLocationId ?? null,
    false,
  ];

  let text;
  if (hasWorldPosition) {
    text = `
      INSERT INTO locations (
        campaign_id,
        name,
        description,
        type,
        world_map_id,
        parent_location_id,
        is_discovered,
        world_position
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        ST_SetSRID(ST_MakePoint($8, $9), 0)
      )
      RETURNING *`;
    params.push(Number(worldPosition.lng), Number(worldPosition.lat));
  } else {
    text = `
      INSERT INTO locations (
        campaign_id,
        name,
        description,
        type,
        world_map_id,
        parent_location_id,
        is_discovered
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`;
  }

  const { rows } = await query(text, params, { label: 'campaign.locations.create' });
  return rows[0] ?? null;
};

export const listCampaignLocations = async (campaignId) => {
  const { rows } = await query(
    `SELECT *,
            CASE WHEN world_position IS NOT NULL THEN ST_X(world_position) END AS lng,
            CASE WHEN world_position IS NOT NULL THEN ST_Y(world_position) END AS lat
       FROM locations
      WHERE campaign_id = $1
      ORDER BY name`,
    [campaignId],
    { label: 'campaign.locations.list' },
  );

  return rows;
};

export const listTileSets = async () => {
  const { rows } = await query(
    `SELECT id,
            name,
            description,
            base_url,
            format,
            min_zoom,
            max_zoom,
            tile_size,
            attribution,
            uploaded_by,
            created_at,
            updated_at
       FROM tile_sets
      WHERE is_active = true
      ORDER BY name ASC`,
    [],
    { label: 'maps.tilesets.list' },
  );

  return rows;
};
