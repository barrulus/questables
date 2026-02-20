import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../db/pool.js';
import { logInfo } from '../../utils/logger.js';

// --- Helpers (ported from afmg_geojson_importer.mjs) ---

const parseNumeric = (value) => {
  if (value === undefined || value === null) return null;
  const match = /^-?\d+(?:\.\d+)?/.exec(String(value).trim());
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
};

const safeStr = (value) => {
  if (value === undefined || value === null) return null;
  try {
    return String(value).replace(/[\uD800-\uDFFF]/g, '');
  } catch {
    return null;
  }
};

const toInt = (value, fallback = 0) => {
  const actual = value ?? fallback;
  const parsed = Number.parseInt(actual, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: ${actual}`);
  }
  return parsed;
};

const toFloat = (value, fallback = 0.0, allowNull = false) => {
  const actual = value ?? fallback;
  if (allowNull && (actual === null || actual === undefined)) return null;
  const parsed = Number.parseFloat(actual);
  if (Number.isNaN(parsed)) {
    if (allowNull) return null;
    throw new Error(`Invalid float value: ${actual}`);
  }
  return parsed;
};

const toBool = (value) => Boolean(value);

// --- SVG Parsing ---

export const parseSvgDimensions = (svgString) => {
  const tagMatch = svgString.match(/<svg[^>]*>/i);
  if (!tagMatch) {
    throw new Error('Unable to find root <svg> element');
  }

  const attributes = {};
  const attributeRegex = /([^\s=]+)\s*=\s*(['"])(.*?)\2/g;
  let match = attributeRegex.exec(tagMatch[0]);
  while (match) {
    attributes[match[1]] = match[3];
    match = attributeRegex.exec(tagMatch[0]);
  }

  let width = parseNumeric(attributes.width);
  let height = parseNumeric(attributes.height);

  if (width === null || height === null) {
    const viewBox = attributes.viewBox ?? attributes.viewbox;
    if (viewBox) {
      const parts = viewBox.trim().split(/\s+/);
      if (parts.length === 4) {
        width = parseNumeric(parts[2]);
        height = parseNumeric(parts[3]);
      }
    }
  }

  if (width === null || height === null) {
    throw new Error('Unable to determine SVG dimensions: missing width/height and no valid viewBox');
  }

  return { width: Math.round(width), height: Math.round(height) };
};

// --- Metadata Extraction ---

export const extractMetersPerPixel = (geojsonObj) => {
  const metadata = geojsonObj?.metadata;
  const scale = metadata && typeof metadata === 'object' ? metadata.scale : null;
  const mpp = scale && typeof scale === 'object'
    ? scale.meters_per_pixel ?? scale.metersPerPixel
    : null;

  if (mpp === undefined || mpp === null) return null;
  const numeric = Number.parseFloat(mpp);
  return Number.isNaN(numeric) ? null : numeric;
};

// --- World Creation/Update ---

export const createOrUpdateWorld = async ({
  name,
  description,
  widthPixels,
  heightPixels,
  metersPerPixel,
  uploadedBy,
}) => {
  const mpp = metersPerPixel ?? 1;
  const bounds = {
    north: 0,
    south: -heightPixels * mpp,
    east: widthPixels * mpp,
    west: 0,
    width_pixels: widthPixels,
    height_pixels: heightPixels,
    meters_per_pixel: mpp,
  };

  // Check if world exists by name
  const { rows: existing } = await query(
    'SELECT id FROM maps_world WHERE name = $1',
    [name],
    { label: 'ingestion.world.check' },
  );

  if (existing.length > 0) {
    const worldId = String(existing[0].id);
    await query(
      `UPDATE maps_world
          SET description = $2,
              bounds = $3,
              width_pixels = $4,
              height_pixels = $5,
              meters_per_pixel = $6,
              uploaded_by = COALESCE($7, uploaded_by),
              updated_at = NOW()
        WHERE id = $1`,
      [
        worldId,
        description ?? `Imported world map: ${name}`,
        JSON.stringify(bounds),
        Math.trunc(widthPixels),
        Math.trunc(heightPixels),
        mpp,
        uploadedBy ?? null,
      ],
      { label: 'ingestion.world.update' },
    );
    logInfo('Updated existing world', { worldId, name });
    return worldId;
  }

  const worldId = randomUUID();
  await query(
    `INSERT INTO maps_world (id, name, description, bounds, width_pixels, height_pixels, meters_per_pixel, uploaded_by, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
    [
      worldId,
      name,
      description ?? `Imported world map: ${name}`,
      JSON.stringify(bounds),
      Math.trunc(widthPixels),
      Math.trunc(heightPixels),
      mpp,
      uploadedBy ?? null,
    ],
    { label: 'ingestion.world.create' },
  );
  logInfo('Created new world', { worldId, name });
  return worldId;
};

// --- Layer Ingesters ---

const ingestCells = async (client, worldId, features) => {
  const sql = `
    INSERT INTO maps_cells (id, world_id, cell_id, biome, type, population, state, culture, religion, height, geom)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($11)), 0))
    ON CONFLICT (world_id, cell_id) DO UPDATE SET
      biome = EXCLUDED.biome, type = EXCLUDED.type, population = EXCLUDED.population,
      state = EXCLUDED.state, culture = EXCLUDED.culture, religion = EXCLUDED.religion,
      height = EXCLUDED.height, geom = EXCLUDED.geom`;

  let rows = 0;
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const geom = feature?.geometry ?? null;
    await client.query(sql, [
      randomUUID(),
      worldId,
      toInt(props.id),
      toInt(props.biome ?? props.Biome ?? 0),
      safeStr(props.type),
      toInt(props.population ?? 0),
      toInt(props.state ?? 0),
      toInt(props.culture ?? 0),
      toInt(props.religion ?? 0),
      toInt(props.height ?? 0),
      JSON.stringify(geom),
    ]);
    rows += 1;
  }
  return rows;
};

const ingestBurgs = async (client, worldId, features) => {
  const sql = `
    INSERT INTO maps_burgs (
      id, world_id, burg_id, name, state, statefull, province, provincefull,
      culture, religion, population, populationraw, elevation, temperature,
      temperaturelikeness, capital, port, citadel, walls, plaza, temple, shanty,
      x_px, y_px, cell, emblem, geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
      $23, $24, $25, $26, ST_SetSRID(ST_GeomFromGeoJSON($27), 0)
    )
    ON CONFLICT (world_id, burg_id) DO UPDATE SET
      name = EXCLUDED.name, state = EXCLUDED.state, statefull = EXCLUDED.statefull,
      province = EXCLUDED.province, provincefull = EXCLUDED.provincefull,
      culture = EXCLUDED.culture, religion = EXCLUDED.religion,
      population = EXCLUDED.population, populationraw = EXCLUDED.populationraw,
      elevation = EXCLUDED.elevation, temperature = EXCLUDED.temperature,
      temperaturelikeness = EXCLUDED.temperaturelikeness,
      capital = EXCLUDED.capital, port = EXCLUDED.port, citadel = EXCLUDED.citadel,
      walls = EXCLUDED.walls, plaza = EXCLUDED.plaza, temple = EXCLUDED.temple,
      shanty = EXCLUDED.shanty,
      x_px = EXCLUDED.x_px, y_px = EXCLUDED.y_px,
      cell = EXCLUDED.cell, emblem = EXCLUDED.emblem, geom = EXCLUDED.geom`;

  let rows = 0;
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const geom = feature?.geometry ?? null;
    await client.query(sql, [
      randomUUID(),
      worldId,
      toInt(props.id),
      safeStr(props.name),
      safeStr(props.state),
      safeStr(props.stateFull ?? props.statefull),
      safeStr(props.province),
      safeStr(props.provinceFull ?? props.provincefull),
      safeStr(props.culture),
      safeStr(props.religion),
      toInt(props.population ?? 0),
      toFloat(props.populationRaw ?? props.populationraw ?? 0.0),
      toInt(props.elevation ?? 0),
      safeStr(props.temperature),
      safeStr(props.temperatureLikeness ?? props.temperaturelikeness),
      toBool(props.capital ?? false),
      toBool(props.port ?? false),
      toBool(props.citadel ?? false),
      toBool(props.walls ?? false),
      toBool(props.plaza ?? false),
      toBool(props.temple ?? false),
      toBool(props.shanty ?? false),
      toFloat(props.xPixel ?? props.xpixel ?? props.x_px ?? 0.0),
      toFloat(props.yPixel ?? props.ypixel ?? props.y_px ?? 0.0),
      toInt(props.cell ?? 0),
      props.emblem !== undefined ? JSON.stringify(props.emblem) : null,
      JSON.stringify(geom),
    ]);
    rows += 1;
  }
  return rows;
};

const ingestRoutes = async (client, worldId, features) => {
  const sql = `
    INSERT INTO maps_routes (id, world_id, route_id, name, type, feature, geom)
    VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($7)), 0))
    ON CONFLICT (world_id, route_id) DO UPDATE SET
      name = EXCLUDED.name, type = EXCLUDED.type, feature = EXCLUDED.feature, geom = EXCLUDED.geom`;

  let rows = 0;
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const geom = feature?.geometry ?? null;
    await client.query(sql, [
      randomUUID(),
      worldId,
      toInt(props.id),
      safeStr(props.name),
      safeStr(props.type),
      toInt(props.feature ?? 0),
      JSON.stringify(geom),
    ]);
    rows += 1;
  }
  return rows;
};

const ingestRivers = async (client, worldId, features) => {
  const sql = `
    INSERT INTO maps_rivers (id, world_id, river_id, name, type, discharge, length, width, geom)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($9)), 0))
    ON CONFLICT (world_id, river_id) DO UPDATE SET
      name = EXCLUDED.name, type = EXCLUDED.type, discharge = EXCLUDED.discharge,
      length = EXCLUDED.length, width = EXCLUDED.width, geom = EXCLUDED.geom`;

  let rows = 0;
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const geom = feature?.geometry ?? null;
    await client.query(sql, [
      randomUUID(),
      worldId,
      toInt(props.id),
      safeStr(props.name),
      safeStr(props.type),
      props.discharge !== undefined ? toFloat(props.discharge, 0.0, true) : null,
      props.length !== undefined ? toFloat(props.length, 0.0, true) : null,
      props.width !== undefined ? toFloat(props.width, 0.0, true) : null,
      JSON.stringify(geom),
    ]);
    rows += 1;
  }
  return rows;
};

const ingestMarkers = async (client, worldId, features) => {
  const sql = `
    INSERT INTO maps_markers (id, world_id, marker_id, type, icon, x_px, y_px, note, geom)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_GeomFromGeoJSON($9), 0))
    ON CONFLICT (world_id, marker_id) DO UPDATE SET
      type = EXCLUDED.type, icon = EXCLUDED.icon, x_px = EXCLUDED.x_px,
      y_px = EXCLUDED.y_px, note = EXCLUDED.note, geom = EXCLUDED.geom`;

  let rows = 0;
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const geom = feature?.geometry ?? null;
    await client.query(sql, [
      randomUUID(),
      worldId,
      toInt(props.id),
      safeStr(props.type),
      safeStr(props.icon),
      props.x_px !== undefined ? toFloat(props.x_px, 0.0, true) : null,
      props.y_px !== undefined ? toFloat(props.y_px, 0.0, true) : null,
      safeStr(props.note),
      JSON.stringify(geom),
    ]);
    rows += 1;
  }
  return rows;
};

// --- Dispatcher ---

const INGESTERS = { cells: ingestCells, burgs: ingestBurgs, routes: ingestRoutes, rivers: ingestRivers, markers: ingestMarkers };
const VALID_LAYER_TYPES = new Set(Object.keys(INGESTERS));

export const ingestLayer = async (worldId, layerType, geojsonObj) => {
  if (!VALID_LAYER_TYPES.has(layerType)) {
    throw new Error(`Invalid layer type: ${layerType}. Must be one of: ${[...VALID_LAYER_TYPES].join(', ')}`);
  }

  const features = geojsonObj?.features ?? [];
  if (features.length === 0) {
    return { layerType, rowCount: 0 };
  }

  const ingester = INGESTERS[layerType];
  const rowCount = await withTransaction(
    async (client) => ingester(client, worldId, features),
    { label: `ingestion.${layerType}` },
  );

  logInfo(`Ingested ${layerType}`, { worldId, rowCount });
  return { layerType, rowCount };
};

// --- Status ---

export const getWorldIngestionStatus = async (worldId) => {
  const tables = ['maps_cells', 'maps_burgs', 'maps_routes', 'maps_rivers', 'maps_markers'];
  const keys = ['cells', 'burgs', 'routes', 'rivers', 'markers'];

  const counts = await Promise.all(
    tables.map((table) =>
      query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE world_id = $1`, [worldId], {
        label: `ingestion.status.${table}`,
      }),
    ),
  );

  const status = {};
  keys.forEach((key, i) => {
    status[key] = counts[i].rows[0]?.count ?? 0;
  });
  return status;
};

export const updateWorldMetersPerPixel = async (worldId, metersPerPixel) => {
  const { rows } = await query(
    'SELECT width_pixels, height_pixels FROM maps_world WHERE id = $1',
    [worldId],
    { label: 'ingestion.world.fetchDims' },
  );
  if (rows.length === 0) return;

  const { width_pixels: w, height_pixels: h } = rows[0];
  const bounds = {
    north: 0,
    south: -h * metersPerPixel,
    east: w * metersPerPixel,
    west: 0,
    width_pixels: w,
    height_pixels: h,
    meters_per_pixel: metersPerPixel,
  };

  await query(
    `UPDATE maps_world SET meters_per_pixel = $2, bounds = $3, updated_at = NOW() WHERE id = $1`,
    [worldId, metersPerPixel, JSON.stringify(bounds)],
    { label: 'ingestion.world.updateMpp' },
  );
};
