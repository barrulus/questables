import { withTransaction } from '../../../db/pool.js';
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
  const { client: externalClient, onProgress = () => {} } = options;
  const parsed = await parseFmgFile(filePath);
  // Skip validation when an external client is provided (test/caller already owns the
  // transaction and may supply a synthetic fixture that does not meet production minimums).
  if (!externalClient) {
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
    report = await withTransaction(run, { label: 'fmg.full_json.ingest' });
    // Lazy import avoids pulling settlemaker (ESM-only) into Jest's module graph.
    const { ingestBurgEntrancesForWorldIfReady } = await import('../ingestion-service.js');
    await ingestBurgEntrancesForWorldIfReady(worldId);
  }
  onProgress({ stage: 'done', percent: 100, message: 'Ingest complete' });
  return report;
}
