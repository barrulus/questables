import { Router } from 'express';
import { requireAuth } from '../auth-middleware.js';
import { logError } from '../utils/logger.js';
import { fetchTegola, fetchTegolaJson, getTegolaSettings } from '../utils/tegola-client.js';

const router = Router();

router.use(requireAuth);

router.get('/health', async (_req, res) => {
  try {
    const health = await fetchTegolaJson({ path: '/healthz' });
    return res.json({ healthy: true, details: health });
  } catch (error) {
    const status = error.status || 502;
    const payload = {
      healthy: false,
      error: error.message,
      body: error.body ?? null,
    };
    return res.status(status).json(payload);
  }
});

router.get('/capabilities', async (_req, res) => {
  try {
    const caps = await fetchTegolaJson({ path: '/capabilities' });
    return res.json(caps);
  } catch (error) {
    const status = error.status || 502;
    return res.status(status).json({ error: 'tegola_capabilities_failed', message: error.message });
  }
});

router.get('/vector/:map/:layer/:z/:x/:y.mvt', async (req, res) => {
  const { map, layer, z, x, y } = req.params;
  const { baseUrl } = getTegolaSettings();

  try {
    const response = await fetchTegola({
      path: `/maps/${encodeURIComponent(map)}/${encodeURIComponent(layer)}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(y)}.mvt`,
      query: req.query,
      headers: {
        accept: 'application/x-protobuf',
      },
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'application/x-protobuf');
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.send(buffer);
  } catch (error) {
    logError('Tegola vector tile fetch failed', error, {
      map,
      layer,
      z,
      x,
      y,
      tegolaBaseUrl: baseUrl,
    });
    const status = error.status || 502;
    return res.status(status).json({
      error: 'tegola_tile_failed',
      message: error.message,
      tegolaResponse: error.body ?? null,
    });
  }
});

export const registerTileRoutes = (app) => {
  app.use('/api/tiles', router);
};
