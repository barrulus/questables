import { Router } from 'express';
import { promises as fs } from 'fs';
import { logError, logInfo } from '../utils/logger.js';
import {
  createWorldMapFromUpload,
  appendCampaignAsset,
  listCampaignAssets,
} from '../services/uploads/service.js';

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

  app.use('/api', router);
};
