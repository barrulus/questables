import { Router } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
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
import { createOrUpdateWorld } from '../services/maps/ingestion-service.js';
import { saveWorldSvg, removeWorldBaseMap, computeMaxZoom } from '../services/maps/world-tile-service.js';
import { upsertWorldTileset, isUuid } from '../services/maps/service.js';

export const registerUploadRoutes = (app, { upload, uploadSvg, uploadFullJson }) => {
  if (!upload) {
    throw new Error('registerUploadRoutes requires an upload middleware instance');
  }
  if (!uploadSvg) {
    throw new Error('registerUploadRoutes requires an uploadSvg middleware instance');
  }
  if (!uploadFullJson) {
    throw new Error('registerUploadRoutes requires an uploadFullJson middleware instance');
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

  // --- FMG Full JSON import: accept whole FMG export, start async ingest ---
  router.post('/upload/map/full-json', requireAuth, uploadFullJson.single('jsonFile'), async (req, res) => {
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
  },
  // Route-scoped error handler: catches errors thrown by uploadFullJson
  // (the middleware above) before the handler ever runs — e.g. the file
  // exceeding the 500MB limit. Without this, a MulterError would fall
  // through to the app-wide error handler and surface as an opaque 500.
  // eslint-disable-next-line no-unused-vars -- Express recognises 4-arg sig
  (err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: 'FMG Full JSON export exceeds the maximum upload size (max 500MB).',
      });
    }
    if (err?.status === 415 || err?.code === 'invalid_file_type') {
      return res.status(415).json({
        error: 'invalid_file_type',
        message: err.message || 'Invalid file type. Allowed: JSON, GeoJSON only on this endpoint.',
      });
    }
    return next(err);
  });

  // --- FMG Full JSON import: delete world (rollback partially-ingested world) ---
  router.delete('/upload/map/:worldId', requireAuth, async (req, res) => {
    try {
      if (!isUuid(req.params.worldId)) {
        return res.status(400).json({ error: 'invalid_world_id', message: 'worldId must be a UUID' });
      }
      const { query } = await import('../db/pool.js');
      const uploadDir = resolve(join(process.cwd(), 'uploads'));
      const jobRows = await query(
        `SELECT file_path FROM public.maps_import_jobs WHERE world_id = $1 AND file_path IS NOT NULL`,
        [req.params.worldId],
        { label: 'fmg.world.delete.jobs' },
      );
      await Promise.all(
        jobRows.rows.map(async ({ file_path: filePath }) => {
          if (!filePath) return;
          const resolvedPath = resolve(filePath);
          if (resolvedPath !== uploadDir && !resolvedPath.startsWith(uploadDir + '/')) return;
          await fs.unlink(resolvedPath).catch(() => {});
        }),
      );

      const result = await query(
        `DELETE FROM public.maps_world WHERE id = $1`,
        [req.params.worldId],
        { label: 'fmg.world.delete' },
      );
      // Base-map artifacts on disk (tile_sets row dies via FK cascade).
      await removeWorldBaseMap(req.params.worldId);
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

  // --- FMG Full JSON import: attach the world's base-map SVG ---
  // Persists the SVG under map_data/world-svg/, purges any cached tiles, and
  // upserts the world's single "Base map" tile_sets row. Replacement is the
  // same call. Tiles render lazily via GET /api/maps/:worldId/tiles/....
  router.post('/upload/map/:worldId/svg', requireAuth, uploadSvg.single('svgFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'svgFile is required' });
    const { worldId } = req.params;
    try {
      // worldId feeds a filesystem path — reject anything that is not a UUID.
      if (!isUuid(worldId)) {
        return res.status(400).json({ error: 'invalid_world_id', message: 'worldId must be a UUID' });
      }
      const { query } = await import('../db/pool.js');
      const { rows } = await query(
        `SELECT id, width_pixels, height_pixels FROM public.maps_world WHERE id = $1`,
        [worldId],
        { label: 'fmg.svg.attach.world' },
      );
      if (rows.length === 0) return res.status(404).json({ error: 'world_not_found' });

      const maxZoom = computeMaxZoom(rows[0].width_pixels, rows[0].height_pixels);
      if (maxZoom == null) {
        return res.status(422).json({
          error: 'world_missing_dimensions',
          message: 'World has no width_pixels/height_pixels; re-import the Full JSON before attaching an SVG.',
        });
      }

      await saveWorldSvg(worldId, req.file.path);
      const tileset = await upsertWorldTileset({ worldId, maxZoom, uploadedBy: req.user?.id ?? null });

      logInfo('World base map SVG attached', {
        telemetryEvent: 'upload.map.svg_attach',
        worldId,
        userId: req.user?.id,
        maxZoom,
      });
      return res.json({ tileset });
    } catch (err) {
      logError('SVG attach failed', err, { worldId, filename: req.file?.filename });
      return res.status(500).json({ error: err.message });
    } finally {
      // saveWorldSvg moves the staged file on success; this only cleans up
      // the staged copy on the failure paths.
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    }
  });

  app.use('/api', router);
};
