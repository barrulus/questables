import { Router } from 'express';
import { logError, logInfo } from '../utils/logger.js';
import {
  createWorldMap,
  listWorldMaps,
  getWorldMapById,
  listWorldBurgs,
  listWorldMarkers,
  listWorldRivers,
  listWorldRoutes,
  listWorldCells,
  createCampaignLocation,
  listCampaignLocations,
  listTileSets,
} from '../services/maps/service.js';

const router = Router();

router.post('/world', async (req, res) => {
  const { name, description, bounds, layers, uploaded_by: uploadedBy } = req.body ?? {};

  if (!name || !uploadedBy) {
    return res.status(400).json({ error: 'Name and uploaded_by are required' });
  }

  try {
    const worldMap = await createWorldMap({
      name,
      description,
      bounds,
      layers,
      uploadedBy,
    });

    logInfo('World map created', {
      telemetryEvent: 'maps.world.created',
      worldMapId: worldMap?.id,
      uploadedBy,
    });

    return res.status(201).json(worldMap);
  } catch (error) {
    logError('World map creation failed', error, { name, uploadedBy });
    return res.status(500).json({ error: error.message });
  }
});

router.get('/world', async (_req, res) => {
  try {
    const maps = await listWorldMaps();
    return res.json(maps);
  } catch (error) {
    logError('World map listing failed', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/world/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const worldMap = await getWorldMapById(id);
    if (!worldMap) {
      return res.status(404).json({ error: 'World map not found' });
    }
    return res.json(worldMap);
  } catch (error) {
    logError('World map fetch failed', error, { worldMapId: id });
    return res.status(500).json({ error: error.message });
  }
});

router.get('/tilesets', async (_req, res) => {
  try {
    const tileSets = await listTileSets();
    return res.json(tileSets);
  } catch (error) {
    logError('Tile set listing failed', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:worldId/burgs', async (req, res) => {
  const { worldId } = req.params;
  const { bounds } = req.query;

  try {
    const rows = await listWorldBurgs({ worldId, bounds });
    return res.json(rows);
  } catch (error) {
    logError('World map burg listing failed', error, { worldId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'maps_burgs_failed', message: error.message });
  }
});

router.get('/:worldId/markers', async (req, res) => {
  const { worldId } = req.params;
  const { bounds } = req.query;

  try {
    const rows = await listWorldMarkers({ worldId, bounds });
    return res.json(rows);
  } catch (error) {
    logError('World map marker listing failed', error, { worldId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'maps_markers_failed', message: error.message });
  }
});

router.get('/:worldId/rivers', async (req, res) => {
  const { worldId } = req.params;
  const { bounds } = req.query;

  try {
    const rows = await listWorldRivers({ worldId, bounds });
    return res.json(rows);
  } catch (error) {
    logError('World map river listing failed', error, { worldId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'maps_rivers_failed', message: error.message });
  }
});

router.get('/:worldId/routes', async (req, res) => {
  const { worldId } = req.params;
  const { bounds } = req.query;

  try {
    const rows = await listWorldRoutes({ worldId, bounds });
    return res.json(rows);
  } catch (error) {
    logError('World map route listing failed', error, { worldId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'maps_routes_failed', message: error.message });
  }
});

router.get('/:worldId/cells', async (req, res) => {
  const { worldId } = req.params;
  const { bounds } = req.query;

  try {
    const rows = await listWorldCells({ worldId, bounds });
    return res.json(rows);
  } catch (error) {
    logError('World map cell listing failed', error, { worldId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'maps_cells_failed', message: error.message });
  }
});

export const registerMapRoutes = (app) => {
  app.use('/api/maps', router);

  app.post('/api/campaigns/:campaignId/locations', async (req, res) => {
    const { campaignId } = req.params;
    const {
      name,
      description,
      type,
      world_map_id: worldMapId,
      world_position: worldPosition,
      parent_location_id: parentLocationId,
    } = req.body ?? {};

    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedType = typeof type === 'string' ? type.trim() : '';
    if (!normalizedName || !normalizedType) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    try {
      const location = await createCampaignLocation(campaignId, {
        name: normalizedName,
        description: typeof description === 'string' ? description : null,
        type: normalizedType,
        worldMapId: worldMapId ?? null,
        parentLocationId: parentLocationId ?? null,
        worldPosition: worldPosition ?? null,
      });

      logInfo('Campaign location created', {
        telemetryEvent: 'campaign.location.created',
        campaignId,
        locationId: location?.id,
      });

      return res.status(201).json(location);
    } catch (error) {
      logError('Campaign location creation failed', error, { campaignId, name });
      const status = error.status || 500;
      return res.status(status).json({ error: error.code || 'location_create_failed', message: error.message });
    }
  });

  app.get('/api/campaigns/:campaignId/locations', async (req, res) => {
    const { campaignId } = req.params;

    try {
      const locations = await listCampaignLocations(campaignId);
      return res.json(locations);
    } catch (error) {
      logError('Campaign location listing failed', error, { campaignId });
      const status = error.status || 500;
      return res.status(status).json({ error: error.code || 'location_list_failed', message: error.message });
    }
  });
};
