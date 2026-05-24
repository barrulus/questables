import { withTransaction } from '../../../db/pool.js';
import pg from 'pg';
import { parseFmgFile } from './parser.js';
import { validateParsedFmg } from './validators.js';
import { ingestWorld } from './ingesters/world.js';
import { ingestBiomes } from './ingesters/biomes.js';
import { ingestFeatures, aggregateFeatureGeometry } from './ingesters/features.js';
import { ingestCultures, aggregateCultureGeometry } from './ingesters/cultures.js';
import { ingestReligions, aggregateReligionGeometry } from './ingesters/religions.js';
import { ingestCells } from './ingesters/cells.js';
import { ingestStates, aggregateStateGeometry } from './ingesters/states.js';
import { ingestProvinces, aggregateProvinceGeometry } from './ingesters/provinces.js';
import { ingestBurgs } from './ingesters/burgs.js';
import { ingestRivers } from './ingesters/rivers.js';
import { ingestRoutes } from './ingesters/routes.js';
import { ingestMarkers } from './ingesters/markers.js';
import { ingestRegiments } from './ingesters/regiments.js';
import { ingestCampaigns } from './ingesters/campaigns.js';
import { ingestDiplomacy } from './ingesters/diplomacy.js';
import { ingestZones } from './ingesters/zones.js';
import { ingestNotes } from './ingesters/notes.js';
// ingestBurgEntrancesForWorldIfReady is imported lazily (only in the standalone path)
// to avoid pulling in the settlemaker ESM package during Jest runs, which cannot
// transform settlemaker's dist/index.js in the CJS/jsdom Jest environment.

const STAGE_ORDER = [
  ['world', ingestWorld],
  ['biomes', ingestBiomes],
  ['features', ingestFeatures],
  ['cultures', ingestCultures],
  ['religions', ingestReligions],
  ['cells', ingestCells],
  ['states', ingestStates],
  ['provinces', ingestProvinces],
  ['burgs', ingestBurgs],
  ['rivers', ingestRivers],
  ['routes', ingestRoutes],
  ['markers', ingestMarkers],
  ['regiments', ingestRegiments],
  ['campaigns', ingestCampaigns],
  ['diplomacy', ingestDiplomacy],
  ['zones', ingestZones],
  ['notes', ingestNotes],
];

const AGGREGATIONS = [
  ['feature_geom', aggregateFeatureGeometry],
  ['culture_geom', aggregateCultureGeometry],
  ['religion_geom', aggregateReligionGeometry],
  ['state_geom', aggregateStateGeometry],
  ['province_geom', aggregateProvinceGeometry],
];

export async function ingestFullJson(worldId, filePath, options = {}) {
  const { client: externalClient, onProgress = () => {}, skipValidation = false, skipSettlemaker = false } = options;
  const parsed = await parseFmgFile(filePath);
  // Skip validation when an external client is provided (test/caller already owns the
  // transaction and may supply a synthetic fixture that does not meet production minimums).
  // Also skip when skipValidation is explicitly set (e.g. job runner test with tiny fixture).
  if (!externalClient && !skipValidation) {
    validateParsedFmg(parsed);
  }

  const run = async (client) => {
    const stages = {};
    const totalStages = STAGE_ORDER.length + AGGREGATIONS.length;
    let stageIdx = 0;

    for (const [name, fn] of STAGE_ORDER) {
      const log = (percent, message) => onProgress({
        stage: name,
        percent: Math.floor(((stageIdx + percent / 100) / totalStages) * 100),
        message: message || name,
      });
      stages[name] = await fn(client, worldId, parsed, log);
      stageIdx++;
    }

    for (const [name, fn] of AGGREGATIONS) {
      const log = (percent, message) => onProgress({
        stage: name,
        percent: Math.floor(((stageIdx + percent / 100) / totalStages) * 100),
        message: message || name,
      });
      await fn(client, worldId, log);
      stages[name] = { rowCount: null };
      stageIdx++;
    }

    return { worldId, stages };
  };

  let report;
  if (externalClient) {
    report = await run(externalClient);
  } else {
    // Production path: dedicated client with disabled query_timeout. The
    // aggregate ST_Union steps over 60k+ cells routinely exceed the pool's
    // 30s default. We also hold the connection out of the pool for the full
    // ingest (~30-90s) so other server requests aren't blocked behind it.
    const client = new pg.Client({
      ...(await import('../../../db/config.js')).poolConfig,
      query_timeout: 0,
      statement_timeout: 0,
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      report = await run(client);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      await client.end();
    }
    if (!skipSettlemaker) {
      // Lazy import avoids pulling settlemaker (ESM-only) into Jest's module graph.
      const { ingestBurgEntrancesForWorldIfReady } = await import('../ingestion-service.js');
      await ingestBurgEntrancesForWorldIfReady(worldId);
    }
  }
  onProgress({ stage: 'done', percent: 100, message: 'Ingest complete' });
  return report;
}
