#!/usr/bin/env node
/* eslint-env node */
/* global console */
/**
 * Import Azgaar's Fantasy Map Generator GeoJSON files into the PostgreSQL database.
 * Mirrors the behaviour of working/import_geojson.py using Node.js.
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import process from 'process';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);

const LOG_LEVELS = {
  info: 'INFO',
  warning: 'WARNING',
  error: 'ERROR',
  debug: 'DEBUG',
};

const log = (level, message) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${LOG_LEVELS[level] ?? level.toUpperCase()} - ${message}`);
};

const logInfo = (msg) => log('info', msg);
const logWarn = (msg) => log('warning', msg);
const logError = (msg) => log('error', msg);

const parseNumeric = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const match = /^-?\d+(?:\.\d+)?/.exec(String(value).trim());
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
};

const extractAttributes = (svgContent) => {
  const tagMatch = svgContent.match(/<svg[^>]*>/i);
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

  return attributes;
};

const findExecutable = async (binary) => {
  try {
    const { stdout } = await execFileAsync('which', [binary]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

const queryInkscapeDimension = async (inkscapePath, flag, svgPath) => {
  const { stdout } = await execFileAsync(inkscapePath, [flag, svgPath]);
  const value = parseNumeric(stdout.trim());
  if (value === null) {
    throw new Error(`Inkscape returned non-numeric value for ${flag}: ${stdout}`);
  }
  return value;
};

const extractSvgDimensions = async (svgPath) => {
  let svgContent;
  try {
    svgContent = await readFile(svgPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read SVG at ${svgPath}: ${error.message}`);
  }

  const attributes = extractAttributes(svgContent);
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
    const inkscapePath = await findExecutable('inkscape');
    if (!inkscapePath) {
      throw new Error(
        `Unable to determine SVG dimensions for ${svgPath}: missing width/height and inkscape not found.`,
      );
    }

    try {
      width = await queryInkscapeDimension(inkscapePath, '--query-width', svgPath);
      height = await queryInkscapeDimension(inkscapePath, '--query-height', svgPath);
    } catch (error) {
      throw new Error(
        `Unable to determine SVG dimensions for ${svgPath} using inkscape: ${error.message}`,
      );
    }
  }

  if (width === null || height === null) {
    throw new Error(`Unable to determine SVG dimensions for ${svgPath}`);
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
};

const safeStr = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return String(value).replace(/[\uD800-\uDFFF]/g, '');
  } catch {
    return null;
  }
};

const readGeoJson = async (filePath) => {
  try {
    const fileContents = await readFile(filePath, 'utf8');
    const data = JSON.parse(fileContents);
    logInfo(`Successfully read ${path.basename(filePath)}`);
    return data;
  } catch (error) {
    logError(`Failed to read ${filePath}: ${error.message}`);
    throw error;
  }
};

const getMetersPerPixel = async (worldFiles) => {
  for (const filePath of Object.values(worldFiles)) {
    try {
      const data = await readGeoJson(filePath);
      const metadata = data?.metadata;
      const scale = metadata && typeof metadata === 'object' ? metadata.scale : null;
      const metersPerPixel =
        scale && typeof scale === 'object' ? scale.meters_per_pixel ?? scale.metersPerPixel : null;
      if (metersPerPixel !== undefined && metersPerPixel !== null) {
        const numeric = Number.parseFloat(metersPerPixel);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
        logWarn(`Invalid meters_per_pixel '${metersPerPixel}' found in ${filePath}`);
      }
    } catch {
      // Continue searching other files.
    }
  }
  return null;
};

const findWorldSvg = async (worldName, worldFiles) => {
  const candidateDirs = new Set();
  Object.values(worldFiles).forEach((filePath) => {
    const dir = path.dirname(filePath);
    candidateDirs.add(dir);
    candidateDirs.add(path.dirname(dir));
  });

  const preferredNames = [
    `${worldName}_states.svg`,
    `${worldName}_map.svg`,
    `${worldName}.svg`,
  ];

  for (const directory of candidateDirs) {
    for (const name of preferredNames) {
      const candidate = path.resolve(directory, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const searched = Array.from(candidateDirs).sort().join(', ');
  throw new Error(
    `Unable to locate SVG for world '${worldName}'. Searched directories: ${searched}`,
  );
};

const buildMapMetadata = async (worldName, worldFiles) => {
  const metersPerPixel = await getMetersPerPixel(worldFiles);
  if (metersPerPixel === null) {
    throw new Error(
      'Unable to determine meters_per_pixel from GeoJSON metadata. ' +
        'Ensure exported files include metadata.scale.meters_per_pixel.',
    );
  }

  const svgPath = await findWorldSvg(worldName, worldFiles);
  const { width, height } = await extractSvgDimensions(svgPath);

  const east = width * metersPerPixel;
  const west = 0.0;
  const north = 0.0;
  const south = -height * metersPerPixel;

  const bounds = {
    north,
    south,
    east,
    west,
    width_pixels: width,
    height_pixels: height,
    meters_per_pixel: metersPerPixel,
  };

  const generatedAt = `${new Date().toISOString().split('.')[0]}Z`;
  const metadata = {
    world: worldName,
    generated_at: generatedAt,
    source_svg: path.resolve(svgPath),
    width_pixels: width,
    height_pixels: height,
    meters_per_pixel: metersPerPixel,
    bounds,
  };

  const metadataPath = path.resolve(path.dirname(svgPath), `${worldName}_mapinfo.json`);
  return { metadata, metadataPath };
};

const writeMetadataFile = async (metadata, metadataPath) => {
  try {
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    logInfo(`Saved map metadata to ${metadataPath}`);
  } catch (error) {
    throw new Error(`Failed to write metadata file ${metadataPath}: ${error.message}`);
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    world: null,
    dir: process.cwd(),
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost/questables',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--world') {
      options.world = args[i + 1];
      i += 1;
    } else if (arg === '--dir') {
      options.dir = args[i + 1];
      i += 1;
    } else if (arg === '--database-url') {
      options.databaseUrl = args[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node afmg_geojson_importer.mjs --world <world_name> [--dir <directory>] [--database-url <url>]',
          '',
          'Options:',
          '  --world          World name (required)',
          '  --dir            Directory to search for GeoJSON files (default: current directory)',
          '  --database-url   PostgreSQL database URL (default: postgresql://localhost/questables)',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      logWarn(`Unknown argument: ${arg}`);
    }
  }

  if (!options.world) {
    throw new Error('Missing required --world argument');
  }

  options.dir = path.resolve(options.dir);
  return options;
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
  if (allowNull && (actual === null || actual === undefined)) {
    return null;
  }
  const parsed = Number.parseFloat(actual);
  if (Number.isNaN(parsed)) {
    if (allowNull) {
      return null;
    }
    throw new Error(`Invalid float value: ${actual}`);
  }
  return parsed;
};

const toBool = (value) => Boolean(value);

class DatabaseManager {
  constructor(databaseUrl, Pool) {
    this.databaseUrl = databaseUrl;
    this.Pool = Pool;
    this.pool = null;
  }

  async connect() {
    if (!this.pool) {
      this.pool = new this.Pool({ connectionString: this.databaseUrl });
      logInfo('Database connection pool established');
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logInfo('Database connection pool closed');
    }
  }

  async acquire() {
    if (!this.pool) {
      throw new Error('Database pool not initialised');
    }
    return this.pool.connect();
  }
}

const loadPgModule = async () => {
  try {
    return await import('pg');
  } catch (firstError) {
    try {
      const require = createRequire(__filename);
      return require('./server/node_modules/pg');
    } catch (secondError) {
      const message =
        'Unable to load pg module. Install it in the project root or ensure server/node_modules is available.';
      throw new Error(`${message}\nOriginal error: ${firstError.message}\n${secondError.message}`);
    }
  }
};

const withClient = async (dbManager, fn) => {
  const client = await dbManager.acquire();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
};

const createWorldEntry = async (dbManager, worldName, metadata) => {
  const bounds = metadata.bounds ?? {};
  const widthPixels = metadata.width_pixels;
  const heightPixels = metadata.height_pixels;
  const metersPerPixel = metadata.meters_per_pixel;

  if (typeof widthPixels !== 'number' || typeof heightPixels !== 'number') {
    throw new Error('Map metadata missing width/height information');
  }

  if (typeof metersPerPixel !== 'number') {
    throw new Error('Map metadata missing meters_per_pixel information');
  }

  const selectSql = 'SELECT id FROM public.maps_world WHERE name = $1';

  return withClient(dbManager, async (client) => {
    const selectResult = await client.query(selectSql, [worldName]);

    if (selectResult.rows.length > 0) {
      const worldId = String(selectResult.rows[0].id);
      const updateSql = `
        UPDATE public.maps_world
        SET description = $2,
            bounds = $3,
            width_pixels = $4,
            height_pixels = $5,
            meters_per_pixel = $6,
            updated_at = NOW()
        WHERE id = $1
      `;
      await client.query(updateSql, [
        worldId,
        `Imported world map: ${worldName}`,
        JSON.stringify(bounds),
        Math.trunc(widthPixels),
        Math.trunc(heightPixels),
        metersPerPixel,
      ]);
      logInfo(`Updated existing world '${worldName}' with ID: ${worldId}`);
      return worldId;
    }

    const worldId = randomUUID();
    const insertSql = `
      INSERT INTO public.maps_world (
        id,
        name,
        description,
        bounds,
        width_pixels,
        height_pixels,
        meters_per_pixel,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    await client.query(insertSql, [
      worldId,
      worldName,
      `Imported world map: ${worldName}`,
      JSON.stringify(bounds),
      Math.trunc(widthPixels),
      Math.trunc(heightPixels),
      metersPerPixel,
      true,
    ]);
    logInfo(`Created new world '${worldName}' with ID: ${worldId}`);
    return worldId;
  });
};

const ingestCells = async (dbManager, filePath, worldId) => {
  const data = await readGeoJson(filePath);
  const features = data?.features ?? [];
  logInfo(`Ingesting cells from ${path.basename(filePath)} (${features.length} features)`);

  const insertSql = `
    INSERT INTO public.maps_cells (
      id,
      world_id,
      cell_id,
      biome,
      type,
      population,
      state,
      culture,
      religion,
      height,
      geom
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($11)), 0))
    ON CONFLICT (world_id, cell_id) DO UPDATE SET
      biome = EXCLUDED.biome,
      type = EXCLUDED.type,
      population = EXCLUDED.population,
      state = EXCLUDED.state,
      culture = EXCLUDED.culture,
      religion = EXCLUDED.religion,
      height = EXCLUDED.height,
      geom = EXCLUDED.geom
  `;

  return withClient(dbManager, async (client) => {
    let rows = 0;
    for (const feature of features) {
      const props = feature?.properties ?? {};
      const geom = feature?.geometry ?? null;

      await client.query(insertSql, [
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
  });
};

const ingestBurgs = async (dbManager, filePath, worldId) => {
  const data = await readGeoJson(filePath);
  const features = data?.features ?? [];
  logInfo(`Ingesting burgs from ${path.basename(filePath)} (${features.length} features)`);

  const insertSql = `
    INSERT INTO public.maps_burgs (
      id,
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
      xworld,
      yworld,
      x_px,
      y_px,
      cell,
      emblem,
      geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, ST_SetSRID(ST_GeomFromGeoJSON($29), 0)
    )
    ON CONFLICT (world_id, burg_id) DO UPDATE SET
      name = EXCLUDED.name,
      state = EXCLUDED.state,
      statefull = EXCLUDED.statefull,
      province = EXCLUDED.province,
      provincefull = EXCLUDED.provincefull,
      culture = EXCLUDED.culture,
      religion = EXCLUDED.religion,
      population = EXCLUDED.population,
      populationraw = EXCLUDED.populationraw,
      elevation = EXCLUDED.elevation,
      temperature = EXCLUDED.temperature,
      temperaturelikeness = EXCLUDED.temperaturelikeness,
      capital = EXCLUDED.capital,
      port = EXCLUDED.port,
      citadel = EXCLUDED.citadel,
      walls = EXCLUDED.walls,
      plaza = EXCLUDED.plaza,
      temple = EXCLUDED.temple,
      shanty = EXCLUDED.shanty,
      xworld = EXCLUDED.xworld,
      yworld = EXCLUDED.yworld,
      x_px = EXCLUDED.x_px,
      y_px = EXCLUDED.y_px,
      cell = EXCLUDED.cell,
      emblem = EXCLUDED.emblem,
      geom = EXCLUDED.geom
  `;

  return withClient(dbManager, async (client) => {
    let rows = 0;
    for (const feature of features) {
      const props = feature?.properties ?? {};
      const geom = feature?.geometry ?? null;

      await client.query(insertSql, [
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
        toInt(props.xWorld ?? props.xworld ?? 0),
        toInt(props.yWorld ?? props.yworld ?? 0),
        toFloat(props.xPixel ?? props.xpixel ?? 0.0),
        toFloat(props.yPixel ?? props.ypixel ?? 0.0),
        toInt(props.cell ?? 0),
        props.emblem !== undefined ? JSON.stringify(props.emblem) : null,
        JSON.stringify(geom),
      ]);
      rows += 1;
    }
    return rows;
  });
};

const ingestRoutes = async (dbManager, filePath, worldId) => {
  const data = await readGeoJson(filePath);
  const features = data?.features ?? [];
  logInfo(`Ingesting routes from ${path.basename(filePath)} (${features.length} features)`);

  const insertSql = `
    INSERT INTO public.maps_routes (
      id,
      world_id,
      route_id,
      name,
      type,
      feature,
      geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($7)), 0)
    )
    ON CONFLICT (world_id, route_id) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      feature = EXCLUDED.feature,
      geom = EXCLUDED.geom
  `;

  return withClient(dbManager, async (client) => {
    let rows = 0;
    for (const feature of features) {
      const props = feature?.properties ?? {};
      const geom = feature?.geometry ?? null;

      await client.query(insertSql, [
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
  });
};

const ingestRivers = async (dbManager, filePath, worldId) => {
  const data = await readGeoJson(filePath);
  const features = data?.features ?? [];
  logInfo(`Ingesting rivers from ${path.basename(filePath)} (${features.length} features)`);

  const insertSql = `
    INSERT INTO public.maps_rivers (
      id,
      world_id,
      river_id,
      name,
      type,
      discharge,
      length,
      width,
      geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($9)), 0)
    )
    ON CONFLICT (world_id, river_id) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      discharge = EXCLUDED.discharge,
      length = EXCLUDED.length,
      width = EXCLUDED.width,
      geom = EXCLUDED.geom
  `;

  return withClient(dbManager, async (client) => {
    let rows = 0;
    for (const feature of features) {
      const props = feature?.properties ?? {};
      const geom = feature?.geometry ?? null;

      await client.query(insertSql, [
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
  });
};

const ingestMarkers = async (dbManager, filePath, worldId) => {
  const data = await readGeoJson(filePath);
  const features = data?.features ?? [];
  logInfo(`Ingesting markers from ${path.basename(filePath)} (${features.length} features)`);

  const insertSql = `
    INSERT INTO public.maps_markers (
      id,
      world_id,
      marker_id,
      type,
      icon,
      x_px,
      y_px,
      note,
      geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_GeomFromGeoJSON($9), 0)
    )
    ON CONFLICT (world_id, marker_id) DO UPDATE SET
      type = EXCLUDED.type,
      icon = EXCLUDED.icon,
      x_px = EXCLUDED.x_px,
      y_px = EXCLUDED.y_px,
      note = EXCLUDED.note,
      geom = EXCLUDED.geom
  `;

  return withClient(dbManager, async (client) => {
    let rows = 0;
    for (const feature of features) {
      const props = feature?.properties ?? {};
      const geom = feature?.geometry ?? null;

      await client.query(insertSql, [
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
  });
};

const findWorldFiles = async (worldName, searchDir) => {
  const types = {
    cells: `${worldName}_cells.geojson`,
    burgs: `${worldName}_burgs.geojson`,
    routes: `${worldName}_routes.geojson`,
    rivers: `${worldName}_rivers.geojson`,
    markers: `${worldName}_markers.geojson`,
  };

  const files = {};

  await Promise.all(
    Object.entries(types).map(async ([type, file]) => {
      const candidate = path.resolve(searchDir, file);
      try {
        await access(candidate);
        files[type] = candidate;
        logInfo(`Found ${type} file: ${candidate}`);
      } catch {
        logWarn(`Missing ${type} file: ${candidate}`);
      }
    }),
  );

  return files;
};

const importWorld = async (dbManager, worldName, searchDir) => {
  logInfo(`Starting import for world: ${worldName}`);

  const worldFiles = await findWorldFiles(worldName, searchDir);

  if (Object.keys(worldFiles).length === 0) {
    throw new Error(`No GeoJSON files found for world '${worldName}'`);
  }

  const { metadata, metadataPath } = await buildMapMetadata(worldName, worldFiles);
  logInfo(
    `Using canonical map metadata: ${metadata.width_pixels}px x ${metadata.height_pixels}px @ ${metadata.meters_per_pixel}m/px`,
  );
  await writeMetadataFile(metadata, metadataPath);

  const worldId = await createWorldEntry(dbManager, worldName, metadata);

  const importers = {
    cells: ingestCells,
    burgs: ingestBurgs,
    routes: ingestRoutes,
    rivers: ingestRivers,
    markers: ingestMarkers,
  };

  let totalRows = 0;
  for (const [type, filePath] of Object.entries(worldFiles)) {
    const importer = importers[type];
    if (!importer) {
      continue;
    }
    try {
      const rows = await importer(dbManager, filePath, worldId);
      totalRows += rows;
      logInfo(`Imported ${rows} ${type} features`);
    } catch (error) {
      logError(`Failed to import ${type}: ${error.message}`);
      throw error;
    }
  }

  logInfo(`Successfully imported world '${worldName}' with ${totalRows} total features`);
};

const main = async () => {
  try {
    const { world, dir, databaseUrl } = parseArgs();
    const { Pool } = await loadPgModule();
    const dbManager = new DatabaseManager(databaseUrl, Pool);
    await dbManager.connect();

    try {
      await importWorld(dbManager, world, dir);
    } finally {
      await dbManager.close();
    }
  } catch (error) {
    logError(`Import failed: ${error.message}`);
    process.exit(1);
  }
};

if (import.meta.url === `file://${__filename}`) {
  await main();
}
