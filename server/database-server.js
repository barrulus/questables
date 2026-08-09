// Local database server for PostgreSQL connection
// This server handles database queries when using local PostgreSQL instead of Supabase

import './config/load-env.js';
import express from 'express';
// logInfo, logError imported below with other logger utilities
import { pool, query as dbQuery } from './db/pool.js';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import WebSocketServerClass from './websocket-server.js';
import { existsSync, readFileSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  setDatabasePool,
  requireAuth,
  requireRole,
} from './auth-middleware.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerCharacterRoutes } from './routes/characters.routes.js';
import { registerCampaignRoutes } from './routes/campaigns.routes.js';
import { registerChatRoutes } from './routes/chat.routes.js';
import { registerNarrativeRoutes } from './routes/narratives.routes.js';
import { registerMapRoutes } from './routes/maps.routes.js';
import { registerSessionRoutes } from './routes/sessions.routes.js';
import { registerEncounterRoutes } from './routes/encounters.routes.js';
import { registerNpcRoutes } from './routes/npcs.routes.js';
import { registerUploadRoutes } from './routes/uploads.routes.js';
import { registerUserRoutes } from './routes/users.routes.js';
import { registerSrdRoutes } from './routes/srd.routes.js';
import { registerGameStateRoutes } from './routes/game-state.routes.js';
import { registerActionRoutes } from './routes/actions.routes.js';
import { registerRestRoutes } from './routes/rest.routes.js';
import { registerLevellingRoutes } from './routes/levelling.routes.js';
import { registerShopRoutes } from './routes/shop.routes.js';
import { registerLootRoutes } from './routes/loot.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerAdminLLMRoutes } from './routes/admin-llm.routes.js';
import { registerModerationRoutes } from './routes/moderation.routes.js';
import { registerWorldBuildingRoutes } from './routes/world-building.routes.js';
import { ensureLLMService } from './llm/request-helpers.js';
import {
  logInfo,
  logError,
  logWarn,
  createRequestLogger,
  logApplicationStart,
  logApplicationShutdown
} from './utils/logger.js';
import {
  setGauge,
  getTelemetrySnapshot,
} from './utils/telemetry.js';
import {
  initializeLLMService,
  createContextualLLMService,
} from './llm/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = process.env.DATABASE_SERVER_PORT || 5101;

const defaultTlsCertPath = process.env.DATABASE_SERVER_TLS_CERT
  || join(__dirname, '..', 'quixote.tail3f19fe.ts.net.crt');
const defaultTlsKeyPath = process.env.DATABASE_SERVER_TLS_KEY
  || join(__dirname, '..', 'quixote.tail3f19fe.ts.net.key');

const tlsPreference = process.env.DATABASE_SERVER_USE_TLS;
const hasDefaultTlsFiles = existsSync(defaultTlsCertPath) && existsSync(defaultTlsKeyPath);
const shouldUseTls = tlsPreference === 'true'
  || (tlsPreference === undefined && hasDefaultTlsFiles && process.env.NODE_ENV !== 'test');

let httpsOptions = null;
let tlsMetadata = null;

if (shouldUseTls) {
  const certPath = tlsPreference === 'true' && process.env.DATABASE_SERVER_TLS_CERT
    ? process.env.DATABASE_SERVER_TLS_CERT
    : defaultTlsCertPath;
  const keyPath = tlsPreference === 'true' && process.env.DATABASE_SERVER_TLS_KEY
    ? process.env.DATABASE_SERVER_TLS_KEY
    : defaultTlsKeyPath;

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    logWarn('TLS enabled but certificate files are missing, falling back to HTTP', {
      certPath,
      keyPath,
    });
  } else {
    try {
      httpsOptions = {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      };
      tlsMetadata = { certPath, keyPath };
      logInfo('TLS enabled for database server', { certPath, keyPath });
    } catch (error) {
      logWarn('Failed to load TLS certificates, falling back to HTTP', {
        error: error instanceof Error ? error.message : String(error),
        certPath,
        keyPath,
      });
      httpsOptions = null;
    }
  }
}

// Security headers (F11). helmet sets X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, HSTS, etc. and removes x-powered-by. We disable
// contentSecurityPolicy globally because the static /uploads handler below
// sets its own stricter CSP, and a default CSP on a JSON API offers no real
// XSS protection.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.disable('x-powered-by');

// Enable CORS for frontend requests
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

app.use(express.json());

// Request logging middleware
app.use(createRequestLogger());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

// Configure multer for file uploads.
//
// Security notes:
// - SVG is intentionally NOT allowed. SVGs can contain <script> and would
//   execute as XSS if served back from the same origin via /uploads.
// - The on-disk extension is derived from a trusted mime→ext map, NEVER from
//   user-supplied originalname (which could be `evil.html`, `.php`, `.svg`,
//   or any extension that a downstream static server would honour).
const MIME_EXT_MAP = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/json': 'json',
  'application/geo+json': 'geojson',
};
const ALLOWED_UPLOAD_MIMETYPES = Object.keys(MIME_EXT_MAP);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = join(process.cwd(), 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = MIME_EXT_MAP[file.mimetype] || 'bin';
    cb(null, `${file.fieldname}-${uniqueSuffix}.${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, JSON, GeoJSON'));
    }
  }
});

// Scoped multer for the map-wizard SVG ingestion path only. The persisted file
// is read once to extract dimensions and then deleted by the route handler, so
// it never appears under /uploads — eliminating the stored-XSS vector.
const svgStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = join(process.cwd(), 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${file.fieldname}-${uniqueSuffix}.svg`);
  }
});

const uploadSvg = multer({
  storage: svgStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/svg+xml') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: SVG only on this endpoint.'));
    }
  }
});

// Scoped multer for the FMG Full JSON import path only. FMG "Full" exports
// scale with map size and routinely run well past the 50MB image/asset
// limit above, so this path gets its own, much larger ceiling. Only JSON
// mimetypes are accepted here — never images — since this is a data import,
// not an asset upload.
const fullJsonStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = join(process.cwd(), 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = MIME_EXT_MAP[file.mimetype] || 'json';
    cb(null, `${file.fieldname}-${uniqueSuffix}.${ext}`);
  }
});

const FULL_JSON_ALLOWED_MIMETYPES = ['application/json', 'application/geo+json'];

const uploadFullJson = multer({
  storage: fullJsonStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (_req, file, cb) => {
    if (FULL_JSON_ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('Invalid file type. Allowed: JSON, GeoJSON only on this endpoint.');
      err.status = 415;
      err.code = 'invalid_file_type';
      cb(err);
    }
  }
});

// Serve uploaded files. CSP + nosniff are defence-in-depth: even if a
// malicious file made it past the upload filter, the browser will refuse to
// execute scripts on this origin and will not MIME-sniff its way around the
// declared Content-Type.
app.use('/uploads', express.static(join(process.cwd(), 'uploads'), {
  setHeaders: (res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Test database connection with a simple query
    await pool.query('SELECT 1 as health_check');
    
    const endTime = Date.now();
    const latency = endTime - startTime;
    
    res.json({ 
      status: 'healthy',
      database: 'connected',
      latency: latency,
      timestamp: new Date().toISOString(),
      pool: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }
    });
  } catch (error) {
    logError('Health check failed', error);
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Administrative analytics endpoints
app.get('/api/admin/metrics', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const [userStatsResult, campaignStatsResult, sessionStatsResult] = await Promise.all([
      dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive,
          COUNT(*) FILTER (WHERE status = 'banned')::int AS banned,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_last_seven_days
        FROM user_profiles
      `),
      dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'recruiting')::int AS recruiting,
          COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_last_seven_days
        FROM campaigns
      `),
      dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          AVG(duration)::numeric AS average_duration_minutes
        FROM sessions
      `)
    ]);

    const userRow = userStatsResult.rows[0] ?? {};
    const campaignRow = campaignStatsResult.rows[0] ?? {};
    const sessionRow = sessionStatsResult.rows[0] ?? {};

    res.json({
      generatedAt: new Date().toISOString(),
      users: {
        total: Number(userRow.total) || 0,
        active: Number(userRow.active) || 0,
        inactive: Number(userRow.inactive) || 0,
        banned: Number(userRow.banned) || 0,
        newLastSevenDays: Number(userRow.new_last_seven_days) || 0,
      },
      campaigns: {
        total: Number(campaignRow.total) || 0,
        active: Number(campaignRow.active) || 0,
        recruiting: Number(campaignRow.recruiting) || 0,
        paused: Number(campaignRow.paused) || 0,
        completed: Number(campaignRow.completed) || 0,
        newLastSevenDays: Number(campaignRow.new_last_seven_days) || 0,
      },
      sessions: {
        total: Number(sessionRow.total) || 0,
        completed: Number(sessionRow.completed) || 0,
        scheduled: Number(sessionRow.scheduled) || 0,
        active: Number(sessionRow.active) || 0,
        cancelled: Number(sessionRow.cancelled) || 0,
        averageDurationMinutes: sessionRow.average_duration_minutes === null || sessionRow.average_duration_minutes === undefined
          ? null
          : Number(sessionRow.average_duration_minutes),
      }
    });
  } catch (error) {
    logError('Admin metrics fetch failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'Failed to load admin metrics',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get('/api/admin/llm/metrics', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const llmService = ensureLLMService(req);
    const metrics = llmService.getMetrics();
    res.json(metrics);
  } catch (error) {
    logError('Failed to load LLM metrics snapshot', error, {
      userId: req.user?.id,
    });
    res.status(500).json({ error: 'Failed to load LLM metrics snapshot' });
  }
});

app.get('/api/admin/telemetry', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const snapshot = getTelemetrySnapshot();
    res.json(snapshot);
  } catch (error) {
    logError('Failed to load telemetry snapshot', error, {
      userId: req.user?.id,
    });
    res.status(500).json({ error: 'Failed to load telemetry snapshot' });
  }
});

app.get('/api/admin/llm/cache', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const llmService = ensureLLMService(req);
    const snapshot = llmService.getCacheSnapshot();
    res.json(snapshot);
  } catch (error) {
    logError('Failed to load LLM cache snapshot', error, {
      userId: req.user?.id,
    });
    res.status(500).json({ error: 'Failed to load LLM cache snapshot' });
  }
});

app.delete('/api/admin/llm/cache', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const llmService = ensureLLMService(req);
    const removed = llmService.clearCache();
    logInfo('LLM cache cleared by admin', {
      userId: req.user?.id,
      removed,
    });
    res.json({ cleared: removed });
  } catch (error) {
    logError('Failed to clear LLM cache', error, {
      userId: req.user?.id,
    });
    res.status(500).json({ error: 'Failed to clear LLM cache' });
  }
});

app.delete('/api/admin/llm/cache/:cacheKey', requireAuth, requireRole('admin'), (req, res) => {
  const { cacheKey } = req.params;
  try {
    const llmService = ensureLLMService(req);
    const removed = llmService.deleteCacheEntry(cacheKey);
    if (!removed) {
      return res.status(404).json({ error: 'Cache entry not found' });
    }
    logInfo('LLM cache entry invalidated', {
      userId: req.user?.id,
      cacheKey,
    });
    res.json({ removed: true });
  } catch (error) {
    logError('Failed to invalidate LLM cache entry', error, {
      userId: req.user?.id,
      cacheKey,
    });
    res.status(500).json({ error: 'Failed to invalidate cache entry' });
  }
});

app.get('/api/admin/llm/providers', requireAuth, requireRole('admin'), async (req, res) => {
  const registry = req.app?.locals?.llmRegistry;
  const inMemoryConfigs = req.app?.locals?.llmProviderConfigs || [];
  const defaultProvider = req.app?.locals?.defaultLLMProvider || null;

  if (!registry) {
    return res.status(503).json({
      error: 'llm_service_unavailable',
      message: 'The Enhanced LLM service is not initialized',
    });
  }

  // Read saved config from DB so edits are reflected immediately
  let dbConfigs = [];
  try {
    const { rows } = await pool.query(
      `SELECT name, adapter, host, model, timeout_ms, options, enabled, default_provider
         FROM public.llm_providers ORDER BY default_provider DESC, created_at ASC`
    );
    dbConfigs = rows.map((r) => ({
      name: r.name,
      adapter: r.adapter,
      host: r.host,
      model: r.model,
      timeoutMs: r.timeout_ms,
      options: r.options ?? {},
      enabled: r.enabled,
      defaultProvider: r.default_provider,
    }));
  } catch {
    // Table may not exist; fall back to in-memory configs
  }

  const providerNames = registry.list();

  const providers = await Promise.all(providerNames.map(async (name) => {
    const provider = registry.get(name);
    // Prefer DB config (reflects edits), fall back to in-memory
    const config = dbConfigs.find((c) => c.name === name)
      || inMemoryConfigs.find((cfg) => cfg.name === name)
      || {};
    let health;
    try {
      health = await provider.checkHealth();
    } catch (error) {
      health = {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      name,
      adapter: config.adapter || 'ollama',
      default: name === defaultProvider,
      enabled: config.enabled !== false,
      host: config.host || null,
      model: config.model || null,
      timeoutMs: config.timeoutMs || null,
      options: config.options || {},
      health,
    };
  }));

  res.json({
    providers,
    defaultProvider,
  });
});

// Set database pool for auth middleware
setDatabasePool(pool);

registerAuthRoutes(app);
registerUserRoutes(app);
registerCharacterRoutes(app);
registerCampaignRoutes(app);
registerChatRoutes(app);
registerNarrativeRoutes(app);
registerMapRoutes(app);
registerSessionRoutes(app);
registerEncounterRoutes(app);
registerNpcRoutes(app);
registerUploadRoutes(app, { upload, uploadSvg, uploadFullJson });
registerSrdRoutes(app);
registerGameStateRoutes(app);
registerActionRoutes(app);
registerRestRoutes(app);
registerLevellingRoutes(app);
registerShopRoutes(app);
registerLootRoutes(app);
registerAdminRoutes(app);
registerAdminLLMRoutes(app);
registerModerationRoutes(app);
registerWorldBuildingRoutes(app);

const loadProviderConfigurations = async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, adapter, host, model, api_key, timeout_ms, options, enabled, default_provider
         FROM public.llm_providers
        WHERE enabled = true
        ORDER BY default_provider DESC, created_at ASC`
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      adapter: row.adapter,
      host: row.host,
      model: row.model,
      apiKey: row.api_key,
      timeoutMs: row.timeout_ms,
      options: row.options,
      enabled: row.enabled,
      defaultProvider: row.default_provider,
    }));
  } catch (error) {
    if (error?.code === '42P01') {
      logWarn('llm_providers table not found; falling back to environment configuration');
      return [];
    }
    throw error;
  }
};

const bootstrapLLMServices = async () => {
  try {
    const providerConfigs = await loadProviderConfigurations();
    const {
      service: enhancedLLMService,
      registry: llmRegistry,
      defaultProvider,
      providers,
    } = initializeLLMService({
      env: process.env,
      providerConfigs,
    });

    app.locals.llmService = enhancedLLMService;
    app.locals.llmRegistry = llmRegistry;

    // Enable automatic lore extraction after LLM narration
    const { setLLMService } = await import('./services/chat/dm-narrator.js');
    setLLMService(enhancedLLMService);
    app.locals.llmProviderConfigs = providers.map((provider) => {
      const sanitizedProvider = { ...provider };
      delete sanitizedProvider.apiKey;
      return sanitizedProvider;
    });
    app.locals.defaultLLMProvider = defaultProvider;

    try {
      const contextualLLMService = createContextualLLMService({
        pool,
        llmService: enhancedLLMService,
        providerName: defaultProvider,
        providerRegistry: llmRegistry,
      });
      app.locals.contextualLLMService = contextualLLMService;
    } catch (contextError) {
      logError('Failed to initialize contextual LLM service', contextError, {
        provider: defaultProvider,
      });
      app.locals.contextualLLMService = null;
    }

    logInfo('Enhanced LLM service initialized', {
      providers: llmRegistry.list(),
      defaultProvider,
    });
  } catch (error) {
    logError('Failed to initialize Enhanced LLM service', error, {
      provider: process.env.LLM_PROVIDER || 'ollama',
    });
    app.locals.llmService = null;
    app.locals.llmRegistry = null;
    app.locals.contextualLLMService = null;
    app.locals.llmProviderConfigs = [];
  }
};

await bootstrapLLMServices();
app.locals.bootstrapLLMServices = bootstrapLLMServices;

// Pool event handlers for monitoring
pool.on('connect', () => {
  logInfo('[Database] Client connected to pool');
});

pool.on('error', (err) => {
  logError('[Database] Pool error', err);
});

pool.on('remove', () => {
  logInfo('[Database] Client removed from pool');
});

// Enhanced query wrapper with retries and performance monitoring

// Create HTTP(S) server for both Express and WebSocket
const shouldStartServer = process.env.NODE_ENV !== 'test';
const server = httpsOptions ? createHttpsServer(httpsOptions, app) : createHttpServer(app);
const accessProtocol = httpsOptions ? 'https' : 'http';
const websocketProtocol = httpsOptions ? 'wss' : 'ws';
const publicHost = process.env.DATABASE_SERVER_PUBLIC_HOST || 'localhost';
const portSegment = (port === 80 || port === 443) ? '' : `:${port}`;
const healthCheckUrl = `${accessProtocol}://${publicHost}${portSegment}/health`;
const websocketUrl = `${websocketProtocol}://${publicHost}${portSegment}/socket.io/`;

// Initialize Socket.io WebSocket server when running normally
const wsServer = shouldStartServer ? new WebSocketServerClass(server) : null;
app.locals.wsServer = wsServer;

// WebSocket health check endpoint.
//
// Anonymous callers see only an aggregate health signal. The full
// getStatus() result includes live `campaign-<uuid>` room names and socket
// IDs which let attackers enumerate every active campaign UUID — combined
// with other read endpoints that lookup-by-uuid, this was the bootstrapping
// primitive in the pentest report (F10). Detailed status is now admin-only.
app.get('/api/websocket/status', (req, res) => {
  if (!wsServer) {
    setGauge('websocket.connections', 0);
    return res.json({ status: 'inactive', connected: 0 });
  }
  const status = wsServer.getStatus();
  if (typeof status?.connected === 'number') {
    setGauge('websocket.connections', status.connected);
  }
  res.json({
    status: 'active',
    connected: status.connected,
    uptime: status.uptime,
  });
});

app.get('/api/admin/websocket/status', requireAuth, requireRole('admin'), (req, res) => {
  if (!wsServer) {
    return res.json({ status: 'inactive', connected: 0 });
  }
  res.json({ status: 'active', ...wsServer.getStatus() });
});

// Generic error handler (F11). Routes that throw or pass an error to next()
// land here. We log the full error server-side (including stack and any
// Postgres metadata) and return a generic envelope to the client so that
// driver error text like `null value in column "x" of relation "y"
// violates not-null constraint` never leaks. Routes are still free to send
// shaped 4xx responses; this only catches the unhandled case.
//
// eslint-disable-next-line no-unused-vars -- Express recognises 4-arg sig
app.use((err, req, res, _next) => {
  if (res.headersSent) {
    return _next(err);
  }
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const requestId = req.id || crypto.randomBytes(8).toString('hex');
  logError('Unhandled route error', err, {
    requestId,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
  });
  if (status >= 500) {
    return res.status(status).json({ error: 'internal_error', requestId });
  }
  // 4xx errors thrown intentionally — pass through a sanitised message
  res.status(status).json({
    error: err.code || 'request_failed',
    message: typeof err.publicMessage === 'string' ? err.publicMessage : 'Request failed.',
    requestId,
  });
});

if (shouldStartServer) {
  // Start server with WebSocket support
  server.listen(port, () => {
    const config = {
      port,
      protocol: accessProtocol,
      tlsEnabled: Boolean(httpsOptions),
      databaseHost: process.env.DATABASE_HOST,
      databasePort: process.env.DATABASE_PORT,
      databaseName: process.env.DATABASE_NAME,
      frontendUrl: process.env.FRONTEND_URL,
      nodeEnv: process.env.NODE_ENV,
    };
    if (tlsMetadata) {
      config.tls = tlsMetadata;
    }

    logApplicationStart(config);

    logInfo(`Local database server running on port ${port}`);
    logInfo(`Health check: ${healthCheckUrl}`);
    logInfo(`WebSocket available at ${websocketUrl}`);
    const wsStatus = wsServer ? wsServer.getStatus() : { connected: 0 };
    logInfo(`WebSocket connections: ${wsStatus.connected}`);

    logInfo('Database server ready', {
      port,
      healthCheck: healthCheckUrl,
      webSocketUrl: websocketUrl,
      connections: wsStatus.connected
    });
  });

  // Graceful shutdown handling
  const gracefulShutdown = (signal) => {
    logApplicationShutdown(`Received ${signal}`);

    logInfo('Closing HTTP server...');
    server.close(() => {
      logInfo('HTTP server closed.');

      logInfo('Closing database connections...');
      pool.end(() => {
        logInfo('Database pool closed.');
        process.exit(0);
      });
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logError('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  // Handle different shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logError('Uncaught Exception', error, {
      stack: error.stack,
      pid: process.pid
    });
    gracefulShutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection at Promise', reason, {
      promise: promise.toString()
    });
  });
}

export { app, pool, server };
