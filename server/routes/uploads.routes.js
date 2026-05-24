import { Router } from 'express';
import { promises as fs } from 'fs';
import {
  requireAuth,
  requireCampaignOwnership,
  requireCampaignParticipation,
} from '../auth-middleware.js';
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

export const registerUploadRoutes = (app, { upload, uploadSvg }) => {
  if (!upload) {
    throw new Error('registerUploadRoutes requires an upload middleware instance');
  }
  if (!uploadSvg) {
    throw new Error('registerUploadRoutes requires an uploadSvg middleware instance');
  }

  const router = Router();

  // All upload endpoints require authentication. Pre-pentest, every upload
  // route was anonymous — anyone on the network could persist files to /uploads.
  //
  // requireAuth is applied per-route rather than via `router.use` because
  // this router is mounted at `/api`. A router-wide `router.use(requireAuth)`
  // applies to every request that reaches the router, including `/api/*`
  // paths that have no handler here — so any *later-registered* public
  // route under `/api` (e.g. `/api/websocket/status`, `/api/srd/*`) would
  // 401 instead of being served. Keep this list and the per-route guards
  // in sync.

  router.post('/upload/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    logInfo('Avatar uploaded', {
      telemetryEvent: 'upload.avatar',
      filename: req.file.filename,
      size: req.file.size,
      userId: req.user.id,
    });

    return res.json({ url: fileUrl, filename: req.file.filename });
  });

  router.post('/upload/map', requireAuth, upload.single('mapFile'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description } = req.body ?? {};
    const uploadedBy = req.user.id;

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
        uploadedBy,
      });
      return res.json({ url: fileUrl, filename: req.file.filename });
    } catch (error) {
      logError('Map upload failed', error, { filename: req.file?.filename });
      return res.status(500).json({ error: error.message });
    }
  });

  router.post(
    '/campaigns/:campaignId/assets',
    requireAuth,
    requireCampaignOwnership,
    upload.single('asset'),
    async (req, res) => {
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
          uploadedBy: req.user.id,
        }];

        await appendCampaignAsset(campaignId, payload[0]);

        logInfo('Campaign asset uploaded', {
          telemetryEvent: 'upload.campaign_asset',
          campaignId,
          filename: req.file.filename,
          userId: req.user.id,
        });

        return res.json({ asset: payload[0] });
      } catch (error) {
        logError('Campaign asset upload failed', error, { campaignId });
        return res.status(500).json({ error: error.message });
      }
    },
  );

  router.get(
    '/campaigns/:campaignId/assets',
    requireAuth,
    requireCampaignParticipation,
    async (req, res) => {
      const { campaignId } = req.params;

      try {
        const assets = await listCampaignAssets(campaignId);
        return res.json(assets);
      } catch (error) {
        logError('Campaign asset listing failed', error, { campaignId });
        const status = error.status || 500;
        return res.status(status).json({ error: error.code || 'campaign_assets_failed', message: error.message });
      }
    },
  );

  // --- Map Wizard: SVG upload (Step 0) ---
  // Uses scoped uploadSvg middleware. The SVG is parsed for dimensions and
  // then deleted, so it never appears under /uploads — neutralising the
  // stored-XSS vector for the only path that legitimately accepts SVG.
  router.post('/upload/map/svg', requireAuth, uploadSvg.single('svgFile'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No SVG file uploaded' });
    }

    const { name, description, metersPerPixel } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      await fs.unlink(req.file.path).catch(() => {});
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
        uploadedBy: req.user.id,
      });

      logInfo('Map SVG uploaded', {
        telemetryEvent: 'upload.map.svg',
        worldId,
        width,
        height,
        userId: req.user.id,
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
    } finally {
      await fs.unlink(req.file.path).catch(() => {});
    }
  });

  // --- FMG Full JSON import: accept whole FMG export, start async ingest ---
  router.post('/upload/map/full-json', requireAuth, upload.single('jsonFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'jsonFile is required' });
    try {
      const { peekFmgHeader } = await import('../services/maps/fmg-full-json/peek-header.js');
      const { startImportJob } = await import('../services/maps/fmg-full-json/job-runner.js');

      const info = await peekFmgHeader(req.file.path);
      const worldName = (req.body?.worldName || info.mapName || 'Untitled FMG world').slice(0, 200);
      const worldId = await createOrUpdateWorld({
        name: worldName,
        description: req.body?.description || null,
        widthPixels: info.width,
        heightPixels: info.height,
        metersPerPixel: null,
        uploadedBy: req.user?.id ?? null,
      });
      const { jobId } = await startImportJob({
        worldId, filePath: req.file.path,
        uploadedBy: req.user?.id ?? null,
        fileSizeBytes: req.file.size,
      });
      logInfo('FMG full JSON import started', {
        telemetryEvent: 'upload.map.full_json',
        worldId,
        jobId,
        userId: req.user?.id,
      });
      return res.status(202).json({ worldId, jobId });
    } catch (err) {
      logError('FMG full JSON upload failed', err, { filename: req.file?.filename });
      return res.status(500).json({ error: err.message });
    }
  });

  // --- FMG Full JSON import: delete world (rollback partially-ingested world) ---
  router.delete('/upload/map/:worldId', requireAuth, async (req, res) => {
    try {
      const { query } = await import('../db/pool.js');
      const result = await query(
        `DELETE FROM public.maps_world WHERE id = $1`,
        [req.params.worldId],
        { label: 'fmg.world.delete' },
      );
      logInfo('World deleted', {
        telemetryEvent: 'upload.map.delete',
        worldId: req.params.worldId,
        userId: req.user?.id,
      });
      return res.json({ deleted: result.rowCount });
    } catch (err) {
      logError('World delete failed', err, { worldId: req.params.worldId });
      return res.status(500).json({ error: err.message });
    }
  });

  // --- FMG Full JSON import: poll job status ---
  router.get('/upload/map/jobs/:jobId', requireAuth, async (req, res) => {
    try {
      const { getJobStatus } = await import('../services/maps/fmg-full-json/job-runner.js');
      const status = await getJobStatus(req.params.jobId);
      if (!status) return res.status(404).json({ error: 'job not found' });
      return res.json(status);
    } catch (err) {
      logError('Job status fetch failed', err, { jobId: req.params.jobId });
      return res.status(500).json({ error: err.message });
    }
  });

  // --- Map Wizard: GeoJSON layer upload (Steps 1-5) ---
  router.post('/upload/map/:worldId/layer', requireAuth, upload.single('geojsonFile'), async (req, res) => {
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
        userId: req.user.id,
      });

      return res.json({ worldId, layerType: result.layerType, rowCount: result.rowCount, status: 'complete' });
    } catch (error) {
      logError('Map layer upload failed', error, { worldId, layerType });
      return res.status(500).json({ error: error.message });
    }
  });

  app.use('/api', router);
};
