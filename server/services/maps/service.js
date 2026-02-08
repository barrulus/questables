import { query } from '../../db/pool.js';
import { parseBounds } from '../campaigns/service.js';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const REGION_CATEGORY_SET = new Set(['encounter', 'rumour', 'narrative', 'travel', 'custom']);
const DEFAULT_REGION_CATEGORY = 'custom';
const BURG_SEARCH_LIMIT = { min: 1, max: 50, default: 10 };
const ESCAPE_LIKE_REGEX = /[%_\\]/g;

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

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

const createValidationError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
};

const sanitizeText = (value, { field, required = false, maxLength = 255 } = {}) => {
  if (value === undefined || value === null) {
    if (required) {
      throw createValidationError('missing_field', `${field} is required.`);
    }
    return null;
  }

  if (typeof value !== 'string') {
    throw createValidationError('invalid_field_type', `${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      throw createValidationError('invalid_field', `${field} cannot be blank.`);
    }
    return null;
  }

  if (trimmed.length > maxLength) {
    throw createValidationError('field_too_long', `${field} cannot exceed ${maxLength} characters.`);
  }

  return trimmed;
};

const sanitizeRegionCategory = (category) => {
  if (category === undefined || category === null) {
    return DEFAULT_REGION_CATEGORY;
  }

  if (typeof category !== 'string') {
    throw createValidationError('invalid_region_category', 'category must be a string.');
  }

  const normalized = category.trim().toLowerCase();
  if (!REGION_CATEGORY_SET.has(normalized)) {
    throw createValidationError(
      'unsupported_region_category',
      `category must be one of ${Array.from(REGION_CATEGORY_SET).join(', ')}.`,
    );
  }

  return normalized;
};

const sanitizeRegionColor = (color) => {
  if (color === undefined || color === null) {
    return null;
  }

  if (typeof color !== 'string') {
    throw createValidationError('invalid_region_color', 'color must be a string.');
  }

  const trimmed = color.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    throw createValidationError('invalid_region_color', 'color must be a hex value formatted as #RRGGBB.');
  }

  return trimmed;
};

const normalizeMetadata = (metadata) => {
  if (metadata === undefined || metadata === null) {
    return '{}';
  }

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed);
      }
      throw new Error('Metadata string must be a JSON object.');
    } catch (error) {
      throw createValidationError('invalid_region_metadata', error.message || 'Invalid metadata JSON string.');
    }
  }

  if (typeof metadata === 'object') {
    try {
      return JSON.stringify(metadata);
    } catch {
      throw createValidationError('invalid_region_metadata', 'Metadata object could not be serialized.');
    }
  }

  throw createValidationError('invalid_region_metadata', 'Metadata must be an object or JSON string.');
};

const normalizeGeometry = (geometry) => {
  if (geometry === undefined || geometry === null) {
    throw createValidationError('missing_region_geometry', 'geometry is required.');
  }

  let parsed = geometry;
  if (typeof geometry === 'string') {
    try {
      parsed = JSON.parse(geometry);
    } catch {
      throw createValidationError('invalid_region_geometry', 'geometry must be valid GeoJSON.');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw createValidationError('invalid_region_geometry', 'geometry must be a GeoJSON object.');
  }

  const type = typeof parsed.type === 'string' ? parsed.type : null;
  if (!type || !['Polygon', 'MultiPolygon'].includes(type)) {
    throw createValidationError(
      'unsupported_region_geometry',
      'geometry must be a Polygon or MultiPolygon GeoJSON object.',
    );
  }

  const coordinates = parsed.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw createValidationError('invalid_region_geometry', 'geometry coordinates must be a non-empty array.');
  }

  if (type === 'Polygon') {
    return JSON.stringify({ type: 'MultiPolygon', coordinates: [coordinates] });
  }

  return JSON.stringify(parsed);
};

const sanitizeRegionPayload = (payload, { requireGeometry = true } = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw createValidationError('invalid_payload', 'Region payload must be an object.');
  }

  const sanitized = {
    name: sanitizeText(payload.name, { field: 'name', required: true, maxLength: 120 }),
    description: sanitizeText(payload.description, { field: 'description', required: false, maxLength: 2000 }),
    category: sanitizeRegionCategory(payload.category),
    color: sanitizeRegionColor(payload.color),
    metadata: normalizeMetadata(payload.metadata),
  };

  if (payload.world_map_id !== undefined || payload.worldMapId !== undefined) {
    const worldMapCandidate = payload.world_map_id ?? payload.worldMapId;
    if (worldMapCandidate === null) {
      sanitized.worldMapId = null;
    } else if (!isUuid(worldMapCandidate)) {
      throw createValidationError('invalid_world_map_reference', 'worldMapId must be a valid UUID when provided.');
    } else {
      sanitized.worldMapId = worldMapCandidate;
    }
  } else {
    sanitized.worldMapId = null;
  }

  if (requireGeometry || Object.prototype.hasOwnProperty.call(payload, 'geometry') || Object.prototype.hasOwnProperty.call(payload, 'region')) {
    const rawGeometry = payload.geometry ?? payload.region;
    sanitized.geometry = normalizeGeometry(rawGeometry);
  }

  return sanitized;
};

const formatRegionRow = (row) => ({
  id: row.id,
  campaignId: row.campaign_id,
  worldMapId: row.world_map_id ?? null,
  name: row.name,
  description: row.description ?? null,
  category: row.category,
  color: row.color ?? null,
  metadata: row.metadata ?? {},
  geometry: row.geometry,
  createdBy: row.created_by ?? null,
  updatedBy: row.updated_by ?? null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

const escapeLikePattern = (term) => term.replace(ESCAPE_LIKE_REGEX, (match) => `\\${match}`);

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
           xpixel AS x_px,
           ypixel AS y_px,
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

export const searchWorldBurgs = async ({ worldId, term, limit }) => {
  const queryTerm = typeof term === 'string' ? term.trim() : '';
  if (!queryTerm) {
    throw createValidationError('search_term_required', 'Search term "q" must be provided.');
  }

  const numericLimit = Number.parseInt(limit, 10);
  const boundedLimit = Number.isFinite(numericLimit)
    ? Math.min(Math.max(numericLimit, BURG_SEARCH_LIMIT.min), BURG_SEARCH_LIMIT.max)
    : BURG_SEARCH_LIMIT.default;

  const pattern = `%${escapeLikePattern(queryTerm)}%`;

  const { rows } = await query(
    `
      SELECT id,
             world_id,
             burg_id,
             name,
             state,
             province,
             culture,
             religion,
             population,
             populationraw,
             elevation,
             capital,
             port,
             citadel,
             walls,
             plaza,
             temple,
             xpixel AS x_px,
             ypixel AS y_px,
             ST_AsGeoJSON(geom)::json AS geometry
        FROM maps_burgs
       WHERE world_id = $1
         AND name ILIKE $2 ESCAPE '\\'
       ORDER BY population DESC NULLS LAST, name ASC
       LIMIT $3
    `,
    [worldId, pattern, boundedLimit],
    { label: 'maps.burgs.search' },
  );

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

export const listCampaignRegions = async (campaignId) => {
  const { rows } = await query(
    `
      SELECT
        cmr.id,
        cmr.campaign_id,
        cmr.world_map_id,
        cmr.name,
        cmr.description,
        cmr.category,
        cmr.color,
        cmr.metadata,
        ST_AsGeoJSON(cmr.region)::json AS geometry,
        cmr.created_by,
        cmr.updated_by,
        cmr.created_at,
        cmr.updated_at
      FROM campaign_map_regions cmr
     WHERE cmr.campaign_id = $1
     ORDER BY cmr.created_at ASC
    `,
    [campaignId],
    { label: 'campaign.map_regions.list' },
  );

  return rows.map(formatRegionRow);
};

export const createCampaignRegion = async (campaignId, payload, { actorId } = {}) => {
  const sanitized = sanitizeRegionPayload(payload, { requireGeometry: true });

  const { rows } = await query(
    `
      INSERT INTO campaign_map_regions (
        campaign_id,
        world_map_id,
        name,
        description,
        category,
        color,
        metadata,
        region,
        created_by,
        updated_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        COALESCE($7::jsonb, '{}'::jsonb),
        ST_Multi(ST_GeomFromGeoJSON($8)),
        $9,
        $9
      )
      RETURNING
        id,
        campaign_id,
        world_map_id,
        name,
        description,
        category,
        color,
        metadata,
        ST_AsGeoJSON(region)::json AS geometry,
        created_by,
        updated_by,
        created_at,
        updated_at
    `,
    [
      campaignId,
      sanitized.worldMapId ?? null,
      sanitized.name,
      sanitized.description,
      sanitized.category,
      sanitized.color,
      sanitized.metadata,
      sanitized.geometry,
      actorId ?? null,
    ],
    { label: 'campaign.map_regions.create' },
  );

  return rows[0] ? formatRegionRow(rows[0]) : null;
};

export const getCampaignRegionById = async (campaignId, regionId) => {
  const { rows } = await query(
    `
      SELECT
        cmr.id,
        cmr.campaign_id,
        cmr.world_map_id,
        cmr.name,
        cmr.description,
        cmr.category,
        cmr.color,
        cmr.metadata,
        ST_AsGeoJSON(cmr.region)::json AS geometry,
        cmr.created_by,
        cmr.updated_by,
        cmr.created_at,
        cmr.updated_at
      FROM campaign_map_regions cmr
     WHERE cmr.campaign_id = $1
       AND cmr.id = $2
     LIMIT 1
    `,
    [campaignId, regionId],
    { label: 'campaign.map_regions.fetch' },
  );

  return rows[0] ? formatRegionRow(rows[0]) : null;
};

export const updateCampaignRegion = async (campaignId, regionId, payload, { actorId } = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw createValidationError('invalid_payload', 'Region payload must be an object.');
  }

  const updates = [];
  const values = [regionId, campaignId];
  let paramIndex = 3;

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    updates.push(`name = $${paramIndex}`);
    values.push(sanitizeText(payload.name, { field: 'name', required: true, maxLength: 120 }));
    paramIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    updates.push(`description = $${paramIndex}`);
    values.push(sanitizeText(payload.description, { field: 'description', required: false, maxLength: 2000 }));
    paramIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'category')) {
    updates.push(`category = $${paramIndex}`);
    values.push(sanitizeRegionCategory(payload.category));
    paramIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'color')) {
    updates.push(`color = $${paramIndex}`);
    values.push(sanitizeRegionColor(payload.color));
    paramIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
    updates.push(`metadata = COALESCE($${paramIndex}::jsonb, '{}'::jsonb)`);
    values.push(normalizeMetadata(payload.metadata));
    paramIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'geometry') || Object.prototype.hasOwnProperty.call(payload, 'region')) {
    updates.push(`region = ST_Multi(ST_GeomFromGeoJSON($${paramIndex}))`);
    values.push(normalizeGeometry(payload.geometry ?? payload.region));
    paramIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'world_map_id') || Object.prototype.hasOwnProperty.call(payload, 'worldMapId')) {
    const worldMapCandidate = payload.world_map_id ?? payload.worldMapId;
    if (worldMapCandidate === null) {
      updates.push('world_map_id = NULL');
    } else {
      if (!isUuid(worldMapCandidate)) {
        throw createValidationError('invalid_world_map_reference', 'worldMapId must be a valid UUID when provided.');
      }
      updates.push(`world_map_id = $${paramIndex}`);
      values.push(worldMapCandidate);
      paramIndex += 1;
    }
  }

  if (updates.length === 0) {
    throw createValidationError('no_region_updates', 'No updatable fields were provided.');
  }

  updates.push('updated_at = NOW()');
  updates.push(`updated_by = $${paramIndex}`);
  values.push(actorId ?? null);
  paramIndex += 1;

  const { rows } = await query(
    `
      UPDATE campaign_map_regions
         SET ${updates.join(', ')}
       WHERE id = $1
         AND campaign_id = $2
       RETURNING
         id,
         campaign_id,
         world_map_id,
         name,
         description,
         category,
         color,
         metadata,
         ST_AsGeoJSON(region)::json AS geometry,
         created_by,
         updated_by,
         created_at,
         updated_at
    `,
    values,
    { label: 'campaign.map_regions.update' },
  );

  return rows[0] ? formatRegionRow(rows[0]) : null;
};

export const getBurgById = async (burgId) => {
  const { rows } = await query(
    `SELECT id, name, population, port, citadel, walls, plaza, temple, shanty,
            capital, culture, elevation, temperature
       FROM maps_burgs WHERE id = $1 LIMIT 1`,
    [burgId],
    { label: 'maps.burgs.fetchById' },
  );
  return rows[0] ?? null;
};

export const deleteCampaignRegion = async (campaignId, regionId) => {
  const { rowCount } = await query(
    `
      DELETE FROM campaign_map_regions
       WHERE campaign_id = $1
         AND id = $2
    `,
    [campaignId, regionId],
    { label: 'campaign.map_regions.delete' },
  );

  return rowCount > 0;
};
