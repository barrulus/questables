import { Router } from 'express';
import { promises as fs } from 'fs';
import { logError, logInfo } from '../utils/logger.js';
import {
  createWorldMapFromUpload,
  appendCampaignAsset,
  listCampaignAssets,
} from '../services/uploads/service.js';
import {
  parseSvgDimensions,
  createOrUpdateWorld,
  extractMetersPerPixel,
  ingestLayer,
  updateWorldMetersPerPixel,
} from '../services/maps/ingestion-service.js';
import { getWorldMapById } from '../services/maps/service.js';

export const registerUploadRoutes = (app, { upload }) => {
  if (!upload) {
    throw new Error('registerUploadRoutes requires an upload middleware instance');
  }

  const router = Router();

  router.post('/upload/avatar', upload.single('avatar'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    logInfo('Avatar uploaded', {
      telemetryEvent: 'upload.avatar',
      filename: req.file.filename,
      size: req.file.size,
    });

    return res.json({ url: fileUrl, filename: req.file.filename });
  });

  router.post('/upload/map', upload.single('mapFile'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, uploaded_by: uploadedBy } = req.body ?? {};

    try {
      if (req.file.mimetype === 'application/json') {
        const fileContent = await fs.readFile(req.file.path, 'utf8');
        const mapData = JSON.parse(fileContent);

        const bounds = {
          north: mapData.info?.mapHeight || 100,
          south: 0,
          east: mapData.info?.mapWidth || 100,
          west: 0,
        };

        const worldMap = await createWorldMapFromUpload({
          name,
          description,
          bounds,
          layers: mapData.layers ?? null,
          uploadedBy,
          geojsonUrl: `/uploads/${req.file.filename}`,
          fileSizeBytes: req.file.size,
        });

        logInfo('Map JSON uploaded', {
          telemetryEvent: 'upload.map.json',
          worldMapId: worldMap?.id,
          uploadedBy,
        });

        return res.json({ worldMap, fileUrl: `/uploads/${req.file.filename}` });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      logInfo('Map asset uploaded', {
        telemetryEvent: 'upload.map.asset',
        filename: req.file.filename,
        size: req.file.size,
      });
      return res.json({ url: fileUrl, filename: req.file.filename });
    } catch (error) {
      logError('Map upload failed', error, { filename: req.file?.filename });
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/campaigns/:campaignId/assets', upload.single('asset'), async (req, res) => {
    const { campaignId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, type = 'image' } = req.body ?? {};
    const fileUrl = `/uploads/${req.file.filename}`;

    try {
      const payload = [{
        id: req.file.filename,
        name,
        description,
        type,
        url: fileUrl,
        size: req.file.size,
        uploadedAt: new Date().toISOString(),
      }];

      await appendCampaignAsset(campaignId, payload[0]);

      logInfo('Campaign asset uploaded', {
        telemetryEvent: 'upload.campaign_asset',
        campaignId,
        filename: req.file.filename,
      });

      return res.json({ asset: payload[0] });
    } catch (error) {
      logError('Campaign asset upload failed', error, { campaignId });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/campaigns/:campaignId/assets', async (req, res) => {
    const { campaignId } = req.params;

    try {
      const assets = await listCampaignAssets(campaignId);
      return res.json(assets);
    } catch (error) {
      logError('Campaign asset listing failed', error, { campaignId });
      const status = error.status || 500;
      return res.status(status).json({ error: error.code || 'campaign_assets_failed', message: error.message });
    }
  });

  // --- Map Wizard: SVG upload (Step 0) ---
  router.post('/upload/map/svg', upload.single('svgFile'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No SVG file uploaded' });
    }

    const { name, description, metersPerPixel } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    try {
      const svgContent = await fs.readFile(req.file.path, 'utf8');
      const { width, height } = parseSvgDimensions(svgContent);

      const mpp = metersPerPixel ? Number.parseFloat(metersPerPixel) : null;
      const worldId = await createOrUpdateWorld({
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() || null : null,
        widthPixels: width,
        heightPixels: height,
        metersPerPixel: Number.isFinite(mpp) ? mpp : null,
        uploadedBy: req.body?.uploaded_by ?? null,
      });

      logInfo('Map SVG uploaded', {
        telemetryEvent: 'upload.map.svg',
        worldId,
        width,
        height,
      });

      return res.json({
        worldId,
        name: name.trim(),
        width,
        height,
        metersPerPixel: Number.isFinite(mpp) ? mpp : null,
      });
    } catch (error) {
      logError('Map SVG upload failed', error, { filename: req.file?.filename });
      return res.status(500).json({ error: error.message });
    }
  });

  // --- Map Wizard: GeoJSON layer upload (Steps 1-5) ---
  router.post('/upload/map/:worldId/layer', upload.single('geojsonFile'), async (req, res) => {
    const { worldId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No GeoJSON file uploaded' });
    }

    const { layerType } = req.body ?? {};
    if (!layerType) {
      return res.status(400).json({ error: 'layerType is required (cells, burgs, routes, rivers, markers)' });
    }

    try {
      const world = await getWorldMapById(worldId);
      if (!world) {
        return res.status(404).json({ error: 'World map not found' });
      }

      const fileContent = await fs.readFile(req.file.path, 'utf8');
      const geojsonData = JSON.parse(fileContent);

      // If world doesn't have meters_per_pixel, try to extract from GeoJSON metadata
      if (!world.meters_per_pixel) {
        const mpp = extractMetersPerPixel(geojsonData);
        if (mpp !== null) {
          await updateWorldMetersPerPixel(worldId, mpp);
        }
      }

      const result = await ingestLayer(worldId, layerType, geojsonData);

      logInfo('Map layer ingested', {
        telemetryEvent: 'upload.map.layer',
        worldId,
        layerType,
        rowCount: result.rowCount,
      });

      return res.json({ worldId, layerType: result.layerType, rowCount: result.rowCount, status: 'complete' });
    } catch (error) {
      logError('Map layer upload failed', error, { worldId, layerType });
      return res.status(500).json({ error: error.message });
    }
  });

  app.use('/api', router);
};
