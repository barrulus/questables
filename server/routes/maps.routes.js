import { Router } from 'express';
import { logError, logInfo } from '../utils/logger.js';
import { requireAuth, requireCampaignParticipation } from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import {
  createWorldMap,
  listWorldMaps,
  getWorldMapById,
  listWorldBurgs,
  searchWorldBurgs,
  listWorldMarkers,
  listWorldRivers,
  listWorldRoutes,
  listWorldCells,
  createCampaignLocation,
  listCampaignLocations,
  listTileSets,
  listCampaignRegions,
  createCampaignRegion,
  updateCampaignRegion,
  deleteCampaignRegion,
} from '../services/maps/service.js';
import { getSettlementInfo, getSettlementTile } from '../services/maps/settlement-service.js';
import { getViewerContextOrThrow, ensureDmControl } from '../services/campaigns/service.js';

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

router.get('/:worldId/burgs/search', async (req, res) => {
  const { worldId } = req.params;
  const { q, limit } = req.query;

  try {
    const results = await searchWorldBurgs({ worldId, term: q, limit });
    return res.json({ results });
  } catch (error) {
    logError('World map burg search failed', error, { worldId, q });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'maps_burgs_search_failed', message: error.message });
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

router.get('/settlements/:burgId/info', async (req, res) => {
  const { burgId } = req.params;

  try {
    const info = await getSettlementInfo(burgId);
    return res.json(info);
  } catch (error) {
    logError('Settlement info fetch failed', error, { burgId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'settlement_info_failed', message: error.message });
  }
});

router.get('/settlements/:burgId/tiles/:z/:x/:y.png', async (req, res) => {
  const { burgId } = req.params;
  const z = parseInt(req.params.z, 10);
  const x = parseInt(req.params.x, 10);
  const y = parseInt(req.params.y, 10);

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0) {
    return res.status(400).json({ error: 'invalid_tile_coords', message: 'z, x, y must be non-negative integers' });
  }

  try {
    const png = await getSettlementTile(burgId, z, x, y);
    if (!png) {
      return res.status(204).send();
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(png);
  } catch (error) {
    logError('Settlement tile fetch failed', error, { burgId, z, x, y });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'settlement_tile_failed', message: error.message });
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

  const ensureMapRegionAccess = async (campaignId, user, appLabel) => {
    const client = await getClient({ label: appLabel });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, user);
      ensureDmControl(viewer, 'Only DMs or co-DMs can manage campaign map regions.');
      return null;
    } catch (error) {
      return error;
    } finally {
      client.release();
    }
  };

  app.get(
    '/api/campaigns/:campaignId/map-regions',
    requireAuth,
    requireCampaignParticipation,
    async (req, res) => {
      const { campaignId } = req.params;

      const authError = await ensureMapRegionAccess(
        campaignId,
        req.user,
        'campaign.map_regions.list.auth',
      );
      if (authError) {
        const status = authError.status || 403;
        return res.status(status).json({
          error: authError.code || 'map_regions_forbidden',
          message: authError.message || 'Unable to access campaign map regions.',
        });
      }

      try {
        const regions = await listCampaignRegions(campaignId);
        return res.json({ regions });
      } catch (error) {
        logError('Campaign map regions list failed', error, { campaignId });
        const status = error.status || 500;
        return res.status(status).json({
          error: error.code || 'map_regions_list_failed',
          message: error.message || 'Failed to load campaign map regions.',
        });
      }
    },
  );

  app.post(
    '/api/campaigns/:campaignId/map-regions',
    requireAuth,
    requireCampaignParticipation,
    async (req, res) => {
      const { campaignId } = req.params;

      const authError = await ensureMapRegionAccess(
        campaignId,
        req.user,
        'campaign.map_regions.create.auth',
      );
      if (authError) {
        const status = authError.status || 403;
        return res.status(status).json({
          error: authError.code || 'map_regions_forbidden',
          message: authError.message || 'Unable to manage campaign map regions.',
        });
      }

      try {
        const region = await createCampaignRegion(campaignId, req.body ?? {}, { actorId: req.user.id });
        logInfo('Campaign map region created', {
          telemetryEvent: 'campaign.map_region.created',
          campaignId,
          regionId: region?.id ?? null,
          userId: req.user.id,
        });
        return res.status(201).json({ region });
      } catch (error) {
        logError('Campaign map region creation failed', error, { campaignId, userId: req.user.id });
        const status = error.status || 500;
        return res.status(status).json({
          error: error.code || 'map_region_create_failed',
          message: error.message || 'Failed to create campaign map region.',
        });
      }
    },
  );

  app.put(
    '/api/campaigns/:campaignId/map-regions/:regionId',
    requireAuth,
    requireCampaignParticipation,
    async (req, res) => {
      const { campaignId, regionId } = req.params;

      const authError = await ensureMapRegionAccess(
        campaignId,
        req.user,
        'campaign.map_regions.update.auth',
      );
      if (authError) {
        const status = authError.status || 403;
        return res.status(status).json({
          error: authError.code || 'map_regions_forbidden',
          message: authError.message || 'Unable to manage campaign map regions.',
        });
      }

      try {
        const region = await updateCampaignRegion(campaignId, regionId, req.body ?? {}, { actorId: req.user.id });
        if (!region) {
          return res.status(404).json({
            error: 'map_region_not_found',
            message: 'Map region not found for this campaign.',
          });
        }

        logInfo('Campaign map region updated', {
          telemetryEvent: 'campaign.map_region.updated',
          campaignId,
          regionId,
          userId: req.user.id,
        });

        return res.json({ region });
      } catch (error) {
        logError('Campaign map region update failed', error, { campaignId, regionId, userId: req.user.id });
        const status = error.status || 500;
        return res.status(status).json({
          error: error.code || 'map_region_update_failed',
          message: error.message || 'Failed to update campaign map region.',
        });
      }
    },
  );

  app.delete(
    '/api/campaigns/:campaignId/map-regions/:regionId',
    requireAuth,
    requireCampaignParticipation,
    async (req, res) => {
      const { campaignId, regionId } = req.params;

      const authError = await ensureMapRegionAccess(
        campaignId,
        req.user,
        'campaign.map_regions.delete.auth',
      );
      if (authError) {
        const status = authError.status || 403;
        return res.status(status).json({
          error: authError.code || 'map_regions_forbidden',
          message: authError.message || 'Unable to manage campaign map regions.',
        });
      }

      try {
        const removed = await deleteCampaignRegion(campaignId, regionId);
        if (!removed) {
          return res.status(404).json({
            error: 'map_region_not_found',
            message: 'Map region not found for this campaign.',
          });
        }

        logInfo('Campaign map region deleted', {
          telemetryEvent: 'campaign.map_region.deleted',
          campaignId,
          regionId,
          userId: req.user.id,
        });

        return res.status(204).send();
      } catch (error) {
        logError('Campaign map region delete failed', error, { campaignId, regionId, userId: req.user.id });
        const status = error.status || 500;
        return res.status(status).json({
          error: error.code || 'map_region_delete_failed',
          message: error.message || 'Failed to delete campaign map region.',
        });
      }
    },
  );
};
