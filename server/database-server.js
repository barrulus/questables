// Local database server for PostgreSQL connection
// This server handles database queries when using local PostgreSQL instead of Supabase

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import WebSocketServerClass from './websocket-server.js';
import { existsSync, readFileSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { body, param, query, validationResult } from 'express-validator';
import { 
  setDatabasePool, 
  hashPassword, 
  comparePassword,
  generateToken,
  requireAuth,
  requireCampaignOwnership,
  requireCampaignParticipation,
  requireCharacterOwnership,
  requireRole,
  authRateLimit
} from './auth-middleware.js';
import { 
  sanitizeChatMessage,
  sanitizeUserInput,
  sanitizeFilename
} from './utils/sanitization.js';
import { 
  logInfo,
  logError,
  logWarn,
  logDatabaseOperation,
  logUserActivity,
  logSecurityEvent,
  createRequestLogger,
  logApplicationStart,
  logApplicationShutdown
} from './utils/logger.js';

// Load env from multiple locations to support repo-root .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envFiles = [
  join(__dirname, '.env.local'),
  join(__dirname, '.env'),
  join(__dirname, '..', '.env.local'),
  join(__dirname, '..', '.env'),
];
for (const f of envFiles) {
  if (existsSync(f)) dotenv.config({ path: f, override: true });
}

const app = express();
const port = process.env.DATABASE_SERVER_PORT || 3001;

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

// Enable CORS for frontend requests
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());

// Request logging middleware
app.use(createRequestLogger());

// In-memory cache for frequently accessed data
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes in milliseconds

// Cache utility functions
const cacheSet = (key, data, ttl = CACHE_TTL) => {
  const expiresAt = Date.now() + ttl;
  cache.set(key, { data, expiresAt });
};

const cacheGet = (key) => {
  const cached = cache.get(key);
  if (!cached) return null;
  
  if (Date.now() > cached.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return cached.data;
};

// Cache cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (now > value.expiresAt) {
      cache.delete(key);
    }
  }
}, 60000); // Clean up every minute

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased limit for development
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 // seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all API routes
app.use('/api', limiter);

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// UUID validation middleware
const validateUUID = (field = 'id') => 
  param(field).isUUID().withMessage(`Invalid ${field} format`);

// Character validation rules
const validateCharacter = [
  body('name')
    .isLength({ min: 1, max: 50 })
    .withMessage('Character name must be 1-50 characters'),
  body('race')
    .isLength({ min: 1, max: 30 })
    .withMessage('Race must be 1-30 characters'),
  body('character_class')
    .isLength({ min: 1, max: 30 })
    .withMessage('Class must be 1-30 characters'),
  body('level')
    .isInt({ min: 1, max: 20 })
    .withMessage('Level must be between 1 and 20'),
  body('abilities.strength')
    .isInt({ min: 1, max: 30 })
    .withMessage('Strength must be between 1 and 30'),
  body('abilities.dexterity')
    .isInt({ min: 1, max: 30 })
    .withMessage('Dexterity must be between 1 and 30'),
  body('abilities.constitution')
    .isInt({ min: 1, max: 30 })
    .withMessage('Constitution must be between 1 and 30'),
  body('abilities.intelligence')
    .isInt({ min: 1, max: 30 })
    .withMessage('Intelligence must be between 1 and 30'),
  body('abilities.wisdom')
    .isInt({ min: 1, max: 30 })
    .withMessage('Wisdom must be between 1 and 30'),
  body('abilities.charisma')
    .isInt({ min: 1, max: 30 })
    .withMessage('Charisma must be between 1 and 30'),
  body('hit_points.max')
    .isInt({ min: 1 })
    .withMessage('Max HP must be at least 1'),
  body('hit_points.current')
    .isInt({ min: -100 })
    .withMessage('Current HP cannot be less than -100'),
  body('armor_class')
    .isInt({ min: 1, max: 30 })
    .withMessage('Armor Class must be between 1 and 30'),
  body('proficiency_bonus')
    .isInt({ min: 2, max: 6 })
    .withMessage('Proficiency bonus must be between 2 and 6')
];

// Campaign validation rules
const validateCampaign = [
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Campaign name must be 1-100 characters'),
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  body('max_players')
    .isInt({ min: 1, max: 20 })
    .withMessage('Max players must be between 1 and 20'),
  body('system')
    .optional()
    .isLength({ max: 50 })
    .withMessage('System name cannot exceed 50 characters')
];

// Chat message validation rules
const validateChatMessage = [
  body('content')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be 1-2000 characters'),
  body('message_type')
    .optional()
    .isIn(['text', 'dice_roll', 'system', 'ooc'])
    .withMessage('Invalid message type')
];

// Caching middleware for GET requests
const cacheMiddleware = (ttl = CACHE_TTL) => (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') {
    return next();
  }
  
  const key = req.originalUrl;
  const cached = cacheGet(key);
  
  if (cached) {
    console.log(`[Cache] Hit for ${key}`);
    return res.json(cached);
  }
  
  // Override res.json to cache the response
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    if (res.statusCode === 200) {
      console.log(`[Cache] Set for ${key}`);
      cacheSet(key, data, ttl);
    }
    return originalJson(data);
  };
  
  next();
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = join(process.cwd(), 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/json'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, JSON'));
    }
  }
});

// Serve uploaded files
app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

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
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Validation middleware for character data
const validateCharacterData = (req, res, next) => {
  const { name, character_class, race, background } = req.body;
  
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Character name is required and must be a non-empty string' });
  }
  
  if (!character_class || typeof character_class !== 'string') {
    return res.status(400).json({ error: 'Character class is required' });
  }
  
  if (!race || typeof race !== 'string') {
    return res.status(400).json({ error: 'Character race is required' });
  }
  
  if (!background || typeof background !== 'string') {
    return res.status(400).json({ error: 'Character background is required' });
  }
  
  // Validate abilities if provided
  if (req.body.abilities) {
    const requiredAbilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const abilities = req.body.abilities;
    
    for (const ability of requiredAbilities) {
      if (abilities[ability] && (typeof abilities[ability] !== 'number' || abilities[ability] < 1 || abilities[ability] > 30)) {
        return res.status(400).json({ error: `Invalid ${ability} score. Must be a number between 1 and 30` });
      }
    }
  }
  
  next();
};

// Authorization middleware to check character ownership
const checkCharacterOwnership = async (req, res, next) => {
  const { id } = req.params;
  const { user_id } = req.body; // For updates, user_id should be in body
  const userId = user_id || req.headers['x-user-id']; // Allow header for GET requests
  
  if (!userId) {
    return res.status(401).json({ error: 'User ID required for character access' });
  }
  
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT user_id FROM characters WHERE id = $1', [id]);
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }
    
    if (result.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied. You can only access your own characters' });
    }
    
    next();
  } catch (error) {
    console.error('[Auth] Character ownership check error:', error);
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

// Enhanced PostgreSQL connection pool with performance optimizations
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || process.env.PGDATABASE || 'dnd_app',
  user: process.env.DATABASE_USER || process.env.PGUSER || process.env.USER,
  password: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || '',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  
  // Optimized pool settings for performance
  max: 20,                    // Maximum connections
  min: 2,                     // Minimum connections
  idleTimeoutMillis: 30000,   // 30 seconds
  connectionTimeoutMillis: 5000, // 5 seconds
  acquireTimeoutMillis: 10000,   // 10 seconds
  
  // Query timeout
  query_timeout: 30000,       // 30 seconds
  
  // Enable connection validation
  allowExitOnIdle: true
});

// Set database pool for auth middleware
setDatabasePool(pool);

// Pool event handlers for monitoring
pool.on('connect', (client) => {
  console.log('[Database] Client connected to pool');
});

pool.on('error', (err, client) => {
  console.error('[Database] Pool error:', err);
});

pool.on('remove', (client) => {
  console.log('[Database] Client removed from pool');
});

// Enhanced query wrapper with retries and performance monitoring
const queryWithRetry = async (text, params, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const start = Date.now();
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        console.warn(`[Database] Slow query (${duration}ms):`, text.substring(0, 100));
      }
      
      return result;
    } catch (error) {
      console.error(`[Database] Query attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};

// Test database connection and setup basic schema
pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err);
    console.log('Note: Make sure PostgreSQL is running and the database exists');
    console.log('You can create the database with: createdb dnd_app');
    process.exit(1);
  } else {
    console.log('Connected to PostgreSQL database successfully');

    try {
      // Load and execute the full database schema
      const schemaPath = join(__dirname, '..', 'database', 'schema.sql');
      if (existsSync(schemaPath)) {
        const schemaSQL = readFileSync(schemaPath, 'utf8');
        await client.query(schemaSQL);
        console.log('Full database schema loaded successfully');
      } else {
        console.warn('Schema file not found, creating minimal schema...');
        
        // Fallback to minimal schema if file not found
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
        
        await client.query(`
          CREATE TABLE IF NOT EXISTS user_profiles (
            id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'player',
            status TEXT NOT NULL DEFAULT 'active',
            avatar_url TEXT,
            timezone TEXT DEFAULT 'UTC',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            last_login TIMESTAMP WITH TIME ZONE
          )
        `);
      }
      console.log('Database schema initialized');
    } catch (schemaError) {
      console.error('Error loading database schema:', schemaError);
      console.log('Continuing with existing schema...');
    }
    release();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'postgresql' });
});

// Database query endpoint
app.post('/api/database/query', async (req, res) => {
  const { sql, params = [] } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  try {
    console.log('[Database] Executing query:', sql.substring(0, 100) + '...');

    const client = await pool.connect();
    const result = await client.query(sql, params);
    client.release();

    res.json({
      rows: result.rows,
      rowCount: result.rowCount,
      command: result.command
    });
  } catch (error) {
    console.error('[Database] Query error:', error);
    res.status(500).json({
      error: error.message,
      code: error.code,
      detail: error.detail
    });
  }
});

// Spatial queries endpoint (PostGIS functions)
app.post('/api/database/spatial/:function', async (req, res) => {
  const { function: functionName } = req.params;
  const params = req.body;

  try {
    const client = await pool.connect();

    // Build the function call based on the function name
    let sql = '';
    let queryParams = [];

    switch (functionName) {
      case 'get_burgs_near_point':
        sql = 'SELECT * FROM get_burgs_near_point($1, $2, $3, $4)';
        queryParams = [params.world_map_id, params.lat, params.lng, params.radius_km];
        break;

      case 'get_routes_between_points':
        sql = 'SELECT * FROM get_routes_between_points($1, $2, $3, $4, $5)';
        queryParams = [params.world_map_id, params.start_lat, params.start_lng, params.end_lat, params.end_lng];
        break;

      case 'get_cell_at_point':
        sql = 'SELECT * FROM get_cell_at_point($1, $2, $3)';
        queryParams = [params.world_map_id, params.lat, params.lng];
        break;

      case 'get_rivers_in_bounds':
        sql = 'SELECT * FROM get_rivers_in_bounds($1, $2, $3, $4, $5)';
        queryParams = [params.world_map_id, params.north, params.south, params.east, params.west];
        break;

      case 'get_burgs_in_bounds': {
        const worldId = params.world_map_id;
        const north = Number(params.north);
        const south = Number(params.south);
        const east = Number(params.east);
        const west = Number(params.west);

        if (!worldId || Number.isNaN(north) || Number.isNaN(south) || Number.isNaN(east) || Number.isNaN(west)) {
          client.release();
          return res.status(400).json({ error: 'Invalid parameters for get_burgs_in_bounds' });
        }

        sql = `
          SELECT 
            id,
            world_id,
            burg_id,
            name,
            state,
            statefull,
            province,
            provincefull,
            culture,
            religion,
            population,
            populationraw,
            elevation,
            temperature,
            temperaturelikeness,
            capital,
            port,
            citadel,
            walls,
            plaza,
            temple,
            shanty,
            xworld,
            yworld,
            xpixel,
            ypixel,
            cell,
            ST_AsGeoJSON(geom)::json AS geometry
          FROM public.maps_burgs
          WHERE world_id = $1
            AND geom && ST_MakeEnvelope($2, $3, $4, $5, 0)
        `;
        queryParams = [worldId, west, south, east, north];
        break;
      }

      case 'get_routes_in_bounds': {
        const worldId = params.world_map_id;
        const north = Number(params.north);
        const south = Number(params.south);
        const east = Number(params.east);
        const west = Number(params.west);

        if (!worldId || Number.isNaN(north) || Number.isNaN(south) || Number.isNaN(east) || Number.isNaN(west)) {
          client.release();
          return res.status(400).json({ error: 'Invalid parameters for get_routes_in_bounds' });
        }

        sql = `
          SELECT 
            id,
            world_id,
            route_id,
            name,
            type,
            feature,
            ST_AsGeoJSON(geom)::json AS geometry
          FROM public.maps_routes
          WHERE world_id = $1
            AND ST_Intersects(
              geom,
              ST_MakeEnvelope($2, $3, $4, $5, 0)
            )
        `;
        queryParams = [worldId, west, south, east, north];
        break;
      }

      default:
        client.release();
        return res.status(400).json({ error: 'Unknown spatial function' });
    }

    console.log(`[Database] Calling spatial function: ${functionName}`);
    const result = await client.query(sql, queryParams);
    client.release();

    res.json({
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    console.error(`[Database] Spatial function error (${functionName}):`, error);
    res.status(500).json({
      error: error.message,
      code: error.code,
      detail: error.detail
    });
  }
});

// Authentication endpoints (basic implementation)
// Login validation
const validateLogin = [
  body('email')
    .isEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 1 })
    .withMessage('Password is required')
];

app.post('/api/auth/login', validateLogin, handleValidationErrors, async (req, res) => {
  const { email, password } = req.body;

  try {
    const client = await pool.connect();

    // Get user with password hash
    const result = await client.query(
      'SELECT id, username, email, password_hash, role, avatar_url, timezone, status FROM user_profiles WHERE email = $1',
      [email]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    const user = result.rows[0];
    
    // Check if user account is active
    if (user.status !== 'active') {
      return res.status(401).json({ 
        error: 'Account disabled',
        message: 'Your account has been disabled. Please contact support.'
      });
    }
    
    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }
    
    // Remove password hash from response
    delete user.password_hash;
    
    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role
    });
    
    // Update last_login
    const updateClient = await pool.connect();
    await updateClient.query(
      'UPDATE user_profiles SET last_login = NOW() WHERE id = $1',
      [user.id]
    );
    updateClient.release();

    res.json({ 
      user, 
      token,
      message: 'Login successful'
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    if (error.message === 'Password comparison failed') {
      res.status(500).json({ error: 'Authentication system error' });
    } else {
      res.status(500).json({ error: 'Login failed' });
    }
  }
});


// Registration validation
const validateRegistration = [
  body('username')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and dashes'),
  body('email')
    .isEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  body('role')
    .optional()
    .isIn(['player', 'dm'])
    .withMessage('Role must be player or dm')
];

app.post('/api/auth/register', validateRegistration, handleValidationErrors, async (req, res) => {
  const { username, email, password, role = 'player' } = req.body;

  try {
    // Hash password securely
    const passwordHash = await hashPassword(password);
    
    const client = await pool.connect();

    // Insert new user with hashed password
    const result = await client.query(`
      INSERT INTO user_profiles (username, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING id, username, email, role, avatar_url, timezone, created_at
    `, [username, email, passwordHash, role]);
    
    client.release();

    const user = result.rows[0];
    
    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role
    });

    res.status(201).json({ 
      user,
      token,
      message: 'Registration successful'
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    if (error.code === '23505') { // Unique violation
      const constraint = error.constraint;
      if (constraint.includes('username')) {
        res.status(409).json({ error: 'Username already exists' });
      } else if (constraint.includes('email')) {
        res.status(409).json({ error: 'Email already exists' });
      } else {
        res.status(409).json({ error: 'User already exists' });
      }
    } else if (error.message === 'Password hashing failed') {
      res.status(500).json({ error: 'Registration failed - password processing error' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

// Character management endpoints
app.post('/api/characters', requireAuth, validateCharacter, handleValidationErrors, async (req, res) => {
  const { user_id, name, character_class, level, race, background, hit_points, armor_class, speed, proficiency_bonus, abilities, saving_throws, skills, inventory, equipment, avatar_url, backstory, personality, ideals, bonds, flaws, spellcasting } = req.body;

  if (!user_id || !name || !character_class || !race || !background) {
    return res.status(400).json({ error: 'Required fields: user_id, name, character_class, race, background' });
  }

  try {
    const client = await pool.connect();
    const result = await client.query(`
      INSERT INTO characters (
        user_id, name, class, level, race, background, hit_points, armor_class, speed, 
        proficiency_bonus, abilities, saving_throws, skills, inventory, equipment, 
        avatar_url, backstory, personality, ideals, bonds, flaws, spellcasting
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `, [
      user_id, name, character_class, level || 1, race, background,
      JSON.stringify(hit_points || {current: 0, max: 0, temporary: 0}),
      armor_class || 10, speed || 30, proficiency_bonus || 2,
      JSON.stringify(abilities || {strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10}),
      JSON.stringify(saving_throws || {}), JSON.stringify(skills || {}),
      JSON.stringify(inventory || []), JSON.stringify(equipment || {}),
      avatar_url, backstory, personality, ideals, bonds, flaws,
      JSON.stringify(spellcasting)
    ]);
    client.release();

    res.json({ character: result.rows[0] });
  } catch (error) {
    console.error('[Characters] Create error:', error);
    res.status(500).json({ error: 'Failed to create character' });
  }
});

app.get('/api/characters/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM characters WHERE id = $1', [id]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ character: result.rows[0] });
  } catch (error) {
    console.error('[Characters] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch character' });
  }
});

app.get('/api/users/:userId/characters', async (req, res) => {
  const { userId } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    client.release();

    res.json({ characters: result.rows });
  } catch (error) {
    console.error('[Characters] Get user characters error:', error);
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

app.put('/api/characters/:id', requireAuth, validateUUID('id'), validateCharacter, handleValidationErrors, requireCharacterOwnership, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Remove id from updates to prevent modification
  delete updates.id;
  delete updates.created_at;
  
  // Add updated_at timestamp
  updates.updated_at = new Date().toISOString();

  try {
    const client = await pool.connect();
    
    // Build dynamic update query
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, index) => {
      // Handle JSONB fields
      if (['hit_points', 'abilities', 'saving_throws', 'skills', 'inventory', 'equipment', 'spellcasting'].includes(field)) {
        return `${field} = $${index + 1}::jsonb`;
      }
      return `${field} = $${index + 1}`;
    }).join(', ');

    const result = await client.query(
      `UPDATE characters SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, id]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ character: result.rows[0] });
  } catch (error) {
    console.error('[Characters] Update error:', error);
    res.status(500).json({ error: 'Failed to update character' });
  }
});

app.delete('/api/characters/:id', checkCharacterOwnership, async (req, res) => {
  const { id } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query('DELETE FROM characters WHERE id = $1 RETURNING *', [id]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ message: 'Character deleted successfully' });
  } catch (error) {
    console.error('[Characters] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete character' });
  }
});

// Campaign management endpoints
app.post('/api/campaigns', requireAuth, validateCampaign, handleValidationErrors, async (req, res) => {
  const { name, description, dmUserId, system, setting, status, maxPlayers, levelRange, isPublic } = req.body;

  if (!name || !dmUserId) {
    return res.status(400).json({ error: 'Campaign name and DM user ID are required' });
  }

  try {
    const client = await pool.connect();
    const result = await client.query(`
      INSERT INTO campaigns (name, description, dm_user_id, system, setting, status, max_players, level_range, is_public)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [name, description, dmUserId, system || 'D&D 5e', setting || 'Fantasy', 
        status || 'recruiting', maxPlayers || 6, 
        JSON.stringify(levelRange || { min: 1, max: 20 }), isPublic || false]);
    client.release();

    res.json({ campaign: result.rows[0] });
  } catch (error) {
    console.error('[Campaigns] Create error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT c.*, u.username as dm_username
      FROM campaigns c
      JOIN user_profiles u ON c.dm_user_id = u.id
      WHERE c.id = $1
    `, [id]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ campaign: result.rows[0] });
  } catch (error) {
    console.error('[Campaigns] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

app.get('/api/users/:userId/campaigns', async (req, res) => {
  const { userId } = req.params;

  try {
    const client = await pool.connect();
    
    // Get campaigns where user is DM
    const dmCampaigns = await client.query(`
      SELECT c.*, COUNT(cp.user_id) as current_players
      FROM campaigns c
      LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
      WHERE c.dm_user_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [userId]);
    
    // Get campaigns where user is a player
    const playerCampaigns = await client.query(`
      SELECT c.*, u.username as dm_username, cp.character_id, ch.name as character_name
      FROM campaigns c
      JOIN campaign_players cp ON c.id = cp.campaign_id
      JOIN user_profiles u ON c.dm_user_id = u.id
      LEFT JOIN characters ch ON cp.character_id = ch.id
      WHERE cp.user_id = $1 AND cp.status = 'active'
      ORDER BY c.created_at DESC
    `, [userId]);
    
    client.release();

    res.json({ 
      dmCampaigns: dmCampaigns.rows, 
      playerCampaigns: playerCampaigns.rows 
    });
  } catch (error) {
    console.error('[Campaigns] Get user campaigns error:', error);
    res.status(500).json({ error: 'Failed to fetch user campaigns' });
  }
});

app.get('/api/campaigns/public', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT c.*, u.username as dm_username, 
             COUNT(cp.user_id) as current_players
      FROM campaigns c
      LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
      JOIN user_profiles u ON c.dm_user_id = u.id
      WHERE c.is_public = true AND c.status = 'recruiting'
      GROUP BY c.id, u.username
      ORDER BY c.created_at DESC
    `);
    client.release();

    res.json(result.rows);
  } catch (error) {
    console.error('[Campaigns] Get public campaigns error:', error);
    res.status(500).json({ error: 'Failed to fetch public campaigns' });
  }
});

app.post('/api/campaigns/:campaignId/players', async (req, res) => {
  const { campaignId } = req.params;
  const { userId, characterId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const client = await pool.connect();
    
    // Check if campaign exists and has space
    const campaignCheck = await client.query(`
      SELECT c.max_players, COUNT(cp.user_id) as current_players
      FROM campaigns c
      LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
      WHERE c.id = $1
      GROUP BY c.id, c.max_players
    `, [campaignId]);
    
    if (campaignCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const { max_players, current_players } = campaignCheck.rows[0];
    if (current_players >= max_players) {
      client.release();
      return res.status(400).json({ error: 'Campaign is full' });
    }
    
    // Check if user is already a player
    const existingPlayer = await client.query(
      'SELECT * FROM campaign_players WHERE campaign_id = $1 AND user_id = $2',
      [campaignId, userId]
    );
    
    if (existingPlayer.rows.length > 0) {
      client.release();
      return res.status(400).json({ error: 'User is already in this campaign' });
    }
    
    // Add player to campaign
    await client.query(`
      INSERT INTO campaign_players (campaign_id, user_id, character_id, status, role)
      VALUES ($1, $2, $3, 'active', 'player')
    `, [campaignId, userId, characterId]);
    
    client.release();
    res.json({ message: 'Successfully joined campaign' });
  } catch (error) {
    console.error('[Campaigns] Join campaign error:', error);
    res.status(500).json({ error: 'Failed to join campaign' });
  }
});

app.delete('/api/campaigns/:campaignId/players/:userId', async (req, res) => {
  const { campaignId, userId } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query(
      'DELETE FROM campaign_players WHERE campaign_id = $1 AND user_id = $2 RETURNING *',
      [campaignId, userId]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found in campaign' });
    }

    res.json({ message: 'Successfully left campaign' });
  } catch (error) {
    console.error('[Campaigns] Leave campaign error:', error);
    res.status(500).json({ error: 'Failed to leave campaign' });
  }
});

app.put('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Remove id and timestamps from updates
  delete updates.id;
  delete updates.created_at;
  updates.updated_at = new Date().toISOString();

  try {
    const client = await pool.connect();
    
    // Build dynamic update query
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, index) => {
      // Handle JSONB fields
      if (['level_range', 'campaign_settings'].includes(field)) {
        return `${field} = $${index + 1}::jsonb`;
      }
      return `${field} = $${index + 1}`;
    }).join(', ');

    const result = await client.query(
      `UPDATE campaigns SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, id]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ campaign: result.rows[0] });
  } catch (error) {
    console.error('[Campaigns] Update error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { dmUserId } = req.body;

  if (!dmUserId) {
    return res.status(400).json({ error: 'DM user ID required for campaign deletion' });
  }

  try {
    const client = await pool.connect();
    
    // Verify user is the DM
    const campaignCheck = await client.query(
      'SELECT dm_user_id FROM campaigns WHERE id = $1',
      [id]
    );
    
    if (campaignCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaignCheck.rows[0].dm_user_id !== dmUserId) {
      client.release();
      return res.status(403).json({ error: 'Only the DM can delete this campaign' });
    }
    
    const result = await client.query('DELETE FROM campaigns WHERE id = $1 RETURNING *', [id]);
    client.release();

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('[Campaigns] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Chat system endpoints
app.post('/api/campaigns/:campaignId/messages', requireAuth, requireCampaignParticipation, validateUUID('campaignId'), validateChatMessage, handleValidationErrors, async (req, res) => {
  const { campaignId } = req.params;
  const { content, type, sender_id, sender_name, character_id, dice_roll } = req.body;

  if (!content || !sender_id || !sender_name) {
    return res.status(400).json({ error: 'Content, sender ID, and sender name are required' });
  }

  try {
    // Sanitize user inputs to prevent XSS
    const sanitizedContent = sanitizeChatMessage(content);
    const sanitizedSenderName = sanitizeUserInput(sender_name, 50);
    
    if (!sanitizedContent.trim()) {
      return res.status(400).json({ error: 'Message content cannot be empty after sanitization' });
    }

    const client = await pool.connect();
    
    const result = await client.query(`
      INSERT INTO chat_messages (campaign_id, content, message_type, sender_id, sender_name, character_id, dice_roll)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [campaignId, sanitizedContent, type || 'text', sender_id, sanitizedSenderName, character_id, JSON.stringify(dice_roll)]);
    
    client.release();
    res.json({ message: result.rows[0] });
  } catch (error) {
    console.error('[Chat] Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.get('/api/campaigns/:campaignId/messages', async (req, res) => {
  const { campaignId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const client = await pool.connect();
    
    const result = await client.query(`
      SELECT cm.*, up.username, c.name as character_name
      FROM chat_messages cm
      JOIN user_profiles up ON cm.sender_id = up.id
      LEFT JOIN characters c ON cm.character_id = c.id
      WHERE cm.campaign_id = $1
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3
    `, [campaignId, limit, offset]);
    
    client.release();
    
    // Return messages in chronological order (oldest first)
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('[Chat] Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get recent messages for a campaign (for polling)
app.get('/api/campaigns/:campaignId/messages/recent', async (req, res) => {
  const { campaignId } = req.params;
  const { since } = req.query; // ISO timestamp

  try {
    const client = await pool.connect();
    
    let query = `
      SELECT cm.*, up.username, c.name as character_name
      FROM chat_messages cm
      JOIN user_profiles up ON cm.sender_id = up.id
      LEFT JOIN characters c ON cm.character_id = c.id
      WHERE cm.campaign_id = $1
    `;
    const params = [campaignId];
    
    if (since) {
      query += ' AND cm.created_at > $2';
      params.push(since);
    }
    
    query += ' ORDER BY cm.created_at ASC';
    
    const result = await client.query(query, params);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Chat] Get recent messages error:', error);
    res.status(500).json({ error: 'Failed to fetch recent messages' });
  }
});

// Delete a chat message (only by sender or DM)
app.delete('/api/campaigns/:campaignId/messages/:messageId', async (req, res) => {
  const { campaignId, messageId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const client = await pool.connect();
    
    // Check if user is the sender or campaign DM
    const messageResult = await client.query(
      'SELECT sender_id FROM chat_messages WHERE id = $1 AND campaign_id = $2',
      [messageId, campaignId]
    );
    
    const campaignResult = await client.query(
      'SELECT dm_user_id FROM campaigns WHERE id = $1',
      [campaignId]
    );
    
    if (messageResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const isMessageSender = messageResult.rows[0].sender_id === userId;
    const isCampaignDM = campaignResult.rows[0]?.dm_user_id === userId;
    
    if (!isMessageSender && !isCampaignDM) {
      client.release();
      return res.status(403).json({ error: 'You can only delete your own messages or messages in campaigns you DM' });
    }
    
    await client.query(
      'DELETE FROM chat_messages WHERE id = $1',
      [messageId]
    );
    
    client.release();
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('[Chat] Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// PostGIS World Map API Endpoints (Phase 3 - Task 1)

// POST /api/maps/world - Upload and create world map
app.post('/api/maps/world', async (req, res) => {
  try {
    const { name, description, bounds, layers, uploaded_by } = req.body;
    
    if (!name || !uploaded_by) {
      return res.status(400).json({ error: 'Name and uploaded_by are required' });
    }
    
    const client = await pool.connect();
    const result = await client.query(`
      INSERT INTO maps_world (name, description, bounds, layers, uploaded_by, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
    `, [name, description, JSON.stringify(bounds), JSON.stringify(layers), uploaded_by]);
    client.release();
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Maps] Create world map error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/maps/world - Get all world maps
app.get('/api/maps/world', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT mw.*, up.username as uploaded_by_username
      FROM maps_world mw
      LEFT JOIN user_profiles up ON mw.uploaded_by = up.id
      WHERE mw.is_active = true
      ORDER BY mw.created_at DESC
    `);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Maps] Get world maps error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/maps/world/:id - Get specific world map
app.get('/api/maps/world/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM maps_world WHERE id = $1', [id]);
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'World map not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Maps] Get world map error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/maps/:worldId/burgs - Get burgs for world map
app.get('/api/maps/:worldId/burgs', async (req, res) => {
  try {
    const { worldId } = req.params;
    const { bounds } = req.query; // Optional bounding box filter
    
    const client = await pool.connect();
    let query = 'SELECT * FROM maps_burgs WHERE world_id = $1';
    let params = [worldId];
    
    if (bounds) {
      try {
        const { north, south, east, west } = JSON.parse(bounds);
        query += ` AND ST_Within(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))`;
        params.push(west, south, east, north);
      } catch (parseError) {
        client.release();
        return res.status(400).json({ error: 'Invalid bounds format' });
      }
    }
    
    const result = await client.query(query, params);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Maps] Get burgs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/maps/:worldId/rivers - Get rivers for world map
app.get('/api/maps/:worldId/rivers', async (req, res) => {
  try {
    const { worldId } = req.params;
    const { bounds } = req.query;
    
    const client = await pool.connect();
    let query = `
      SELECT 
        id,
        world_id,
        river_id,
        name,
        type,
        discharge,
        length,
        width,
        ST_AsGeoJSON(geom)::json AS geometry
      FROM maps_rivers 
      WHERE world_id = $1`;
    let params = [worldId];
    
    if (bounds) {
      try {
        const { north, south, east, west } = JSON.parse(bounds);
        query += ` AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))`;
        params.push(west, south, east, north);
      } catch (parseError) {
        client.release();
        return res.status(400).json({ error: 'Invalid bounds format' });
      }
    }
    
    const result = await client.query(query, params);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Maps] Get rivers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/maps/:worldId/routes - Get routes for world map  
app.get('/api/maps/:worldId/routes', async (req, res) => {
  try {
    const { worldId } = req.params;
    const { bounds } = req.query;
    
    const client = await pool.connect();
    let query = 'SELECT * FROM routes WHERE world_id = $1';
    let params = [worldId];
    
    if (bounds) {
      try {
        const { north, south, east, west } = JSON.parse(bounds);
        query += ` AND ST_Intersects(route_path, ST_MakeEnvelope($2, $3, $4, $5, 0))`;
        params.push(west, south, east, north);
      } catch (parseError) {
        client.release();
        return res.status(400).json({ error: 'Invalid bounds format' });
      }
    }
    
    const result = await client.query(query, params);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Maps] Get routes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:campaignId/locations - Create campaign location
app.post('/api/campaigns/:campaignId/locations', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { name, description, type, world_map_id, world_position, parent_location_id } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    
    const client = await pool.connect();
    let query = `
      INSERT INTO locations (campaign_id, name, description, type, world_map_id, parent_location_id, is_discovered
    `;
    let values = [campaignId, name, description, type, world_map_id, parent_location_id, false];
    let paramCount = 6;
    
    if (world_position && world_position.lng && world_position.lat) {
      query += `, world_position) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 0))`;
      values.push(world_position.lng, world_position.lat);
    } else {
      query += `) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    }
    
    query += ` RETURNING *`;
    
    const result = await client.query(query, values);
    client.release();
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Locations] Create location error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:campaignId/locations - Get campaign locations
app.get('/api/campaigns/:campaignId/locations', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT *, 
             CASE WHEN world_position IS NOT NULL THEN ST_X(world_position) END as lng, 
             CASE WHEN world_position IS NOT NULL THEN ST_Y(world_position) END as lat
      FROM locations 
      WHERE campaign_id = $1
      ORDER BY name
    `, [campaignId]);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Locations] Get locations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Session Management API Endpoints (Phase 3 - Task 3)

// POST /api/campaigns/:campaignId/sessions - Create session
app.post('/api/campaigns/:campaignId/sessions', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { title, summary, dm_notes, scheduled_at } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Session title is required' });
    }
    
    const client = await pool.connect();
    
    // Get next session number for campaign
    const sessionCountResult = await client.query(
      'SELECT COALESCE(MAX(session_number), 0) + 1 as next_number FROM sessions WHERE campaign_id = $1',
      [campaignId]
    );
    const sessionNumber = sessionCountResult.rows[0].next_number;

    const result = await client.query(`
      INSERT INTO sessions (campaign_id, session_number, title, summary, dm_notes, scheduled_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
      RETURNING *
    `, [campaignId, sessionNumber, title, summary, dm_notes, scheduled_at]);
    
    client.release();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Sessions] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:campaignId/sessions - Get campaign sessions
app.get('/api/campaigns/:campaignId/sessions', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT s.*, 
             COUNT(sp.user_id) as participant_count
      FROM sessions s
      LEFT JOIN session_participants sp ON s.id = sp.session_id
      WHERE s.campaign_id = $1
      GROUP BY s.id
      ORDER BY s.session_number DESC
    `, [campaignId]);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Sessions] Get sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:sessionId - Update session
app.put('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status, started_at, ended_at, duration, experience_awarded, summary } = req.body;
    
    const client = await pool.connect();
    const result = await client.query(`
      UPDATE sessions 
      SET status = COALESCE($1, status),
          started_at = COALESCE($2, started_at),
          ended_at = COALESCE($3, ended_at), 
          duration = COALESCE($4, duration),
          experience_awarded = COALESCE($5, experience_awarded),
          summary = COALESCE($6, summary),
          updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [status, started_at, ended_at, duration, experience_awarded, summary, sessionId]);
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Sessions] Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:sessionId/participants - Add session participant
app.post('/api/sessions/:sessionId/participants', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { user_id, character_id, character_level_start } = req.body;
    
    if (!user_id || !character_id) {
      return res.status(400).json({ error: 'User ID and character ID are required' });
    }
    
    const client = await pool.connect();
    await client.query(`
      INSERT INTO session_participants (session_id, user_id, character_id, character_level_start, character_level_end, attendance_status)
      VALUES ($1, $2, $3, $4, $4, 'present')
      ON CONFLICT (session_id, user_id) DO UPDATE SET
      character_id = EXCLUDED.character_id,
      character_level_start = EXCLUDED.character_level_start,
      attendance_status = EXCLUDED.attendance_status
    `, [sessionId, user_id, character_id, character_level_start || 1]);
    
    client.release();
    res.json({ success: true });
  } catch (error) {
    console.error('[Sessions] Add participant error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:sessionId/participants - Get session participants
app.get('/api/sessions/:sessionId/participants', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT sp.*, up.username, c.name as character_name
      FROM session_participants sp
      JOIN user_profiles up ON sp.user_id = up.id
      LEFT JOIN characters c ON sp.character_id = c.id
      WHERE sp.session_id = $1
      ORDER BY up.username
    `, [sessionId]);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Sessions] Get participants error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Combat Encounter System API Endpoints (Phase 3 - Task 4)

// POST /api/campaigns/:campaignId/encounters - Create encounter
app.post('/api/campaigns/:campaignId/encounters', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { name, description, type, difficulty, session_id, location_id } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ error: 'Encounter name and type are required' });
    }
    
    const client = await pool.connect();
    const result = await client.query(`
      INSERT INTO encounters (campaign_id, session_id, location_id, name, description, type, difficulty, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned')
      RETURNING *
    `, [campaignId, session_id, location_id, name, description, type, difficulty || 'medium']);
    
    client.release();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Encounters] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:campaignId/encounters - Get campaign encounters
app.get('/api/campaigns/:campaignId/encounters', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT e.*, 
             COUNT(ep.id) as participant_count,
             l.name as location_name,
             s.title as session_title
      FROM encounters e
      LEFT JOIN encounter_participants ep ON e.id = ep.encounter_id
      LEFT JOIN locations l ON e.location_id = l.id
      LEFT JOIN sessions s ON e.session_id = s.id
      WHERE e.campaign_id = $1
      GROUP BY e.id, l.name, s.title
      ORDER BY e.created_at DESC
    `, [campaignId]);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Encounters] Get encounters error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/encounters/:encounterId/participants - Add encounter participant
app.post('/api/encounters/:encounterId/participants', async (req, res) => {
  try {
    const { encounterId } = req.params;
    const { participant_id, participant_type, name, hit_points, armor_class, initiative } = req.body;
    
    if (!name || !hit_points || !armor_class) {
      return res.status(400).json({ error: 'Name, hit points, and armor class are required' });
    }
    
    const client = await pool.connect();
    const result = await client.query(`
      INSERT INTO encounter_participants (encounter_id, participant_id, participant_type, name, hit_points, armor_class, initiative)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [encounterId, participant_id, participant_type || 'npc', name, 
        JSON.stringify(hit_points), armor_class, initiative || 0]);
    
    client.release();
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Encounters] Add participant error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/encounters/:encounterId/participants - Get encounter participants
app.get('/api/encounters/:encounterId/participants', async (req, res) => {
  try {
    const { encounterId } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT ep.*, 
             CASE 
               WHEN ep.participant_type = 'character' THEN c.name
               ELSE ep.name 
             END as display_name
      FROM encounter_participants ep
      LEFT JOIN characters c ON ep.participant_id = c.id AND ep.participant_type = 'character'
      WHERE ep.encounter_id = $1
      ORDER BY ep.initiative DESC, ep.name
    `, [encounterId]);
    client.release();
    
    res.json(result.rows);
  } catch (error) {
    console.error('[Encounters] Get participants error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/encounters/:encounterId - Update encounter (start combat, advance round)
app.put('/api/encounters/:encounterId', async (req, res) => {
  try {
    const { encounterId } = req.params;
    const { status, current_round, initiative_order, current_turn } = req.body;
    
    const client = await pool.connect();
    const result = await client.query(`
      UPDATE encounters 
      SET status = COALESCE($1, status),
          current_round = COALESCE($2, current_round),
          initiative_order = COALESCE($3, initiative_order),
          current_turn = COALESCE($4, current_turn),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [status, current_round, JSON.stringify(initiative_order), current_turn, encounterId]);
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Encounter not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Encounters] Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/encounter-participants/:participantId - Update participant HP/conditions
app.put('/api/encounter-participants/:participantId', async (req, res) => {
  try {
    const { participantId } = req.params;
    const { hit_points, conditions, has_acted, initiative } = req.body;
    
    const client = await pool.connect();
    const result = await client.query(`
      UPDATE encounter_participants 
      SET hit_points = COALESCE($1, hit_points),
          conditions = COALESCE($2, conditions),
          has_acted = COALESCE($3, has_acted),
          initiative = COALESCE($4, initiative)
      WHERE id = $5
      RETURNING *
    `, [
      hit_points ? JSON.stringify(hit_points) : null,
      conditions ? JSON.stringify(conditions) : null,
      has_acted,
      initiative,
      participantId
    ]);
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Encounters] Update participant error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/encounter-participants/:participantId - Remove participant
app.delete('/api/encounter-participants/:participantId', async (req, res) => {
  try {
    const { participantId } = req.params;
    
    const client = await pool.connect();
    const result = await client.query(
      'DELETE FROM encounter_participants WHERE id = $1 RETURNING *',
      [participantId]
    );
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    
    res.json({ message: 'Participant removed successfully' });
  } catch (error) {
    console.error('[Encounters] Remove participant error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
// ===== NPC MANAGEMENT ENDPOINTS =====

// POST /api/campaigns/:campaignId/npcs - Create NPC
app.post('/api/campaigns/:campaignId/npcs', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { name, description, race, occupation, personality, appearance, motivations, secrets, current_location_id, stats } = req.body;
    
    const result = await pool.query(`
      INSERT INTO npcs (campaign_id, name, description, race, occupation, personality, appearance, motivations, secrets, current_location_id, stats)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [campaignId, name, description, race, occupation, personality, appearance, motivations, secrets, current_location_id, JSON.stringify(stats)]);
    
    console.log('[NPCs] Created NPC:', result.rows[0].name);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[NPCs] Create NPC error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:campaignId/npcs - Get campaign NPCs
app.get('/api/campaigns/:campaignId/npcs', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const result = await pool.query(`
      SELECT n.*, l.name as location_name
      FROM npcs n
      LEFT JOIN locations l ON n.current_location_id = l.id
      WHERE n.campaign_id = $1
      ORDER BY n.name
    `, [campaignId]);
    
    console.log(`[NPCs] Retrieved ${result.rows.length} NPCs for campaign ${campaignId}`);
    res.json(result.rows);
  } catch (error) {
    console.error('[NPCs] Get NPCs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/npcs/:npcId - Update NPC
app.put('/api/npcs/:npcId', async (req, res) => {
  try {
    const { npcId } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at') {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(typeof updates[key] === 'object' ? JSON.stringify(updates[key]) : updates[key]);
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    fields.push('updated_at = NOW()');
    values.push(npcId);

    const result = await pool.query(
      `UPDATE npcs SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    console.log('[NPCs] Updated NPC:', result.rows[0].name);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[NPCs] Update NPC error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/npcs/:npcId - Delete NPC
app.delete('/api/npcs/:npcId', async (req, res) => {
  try {
    const { npcId } = req.params;
    const result = await pool.query('DELETE FROM npcs WHERE id = $1 RETURNING name', [npcId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NPC not found' });
    }
    
    console.log('[NPCs] Deleted NPC:', result.rows[0].name);
    res.json({ success: true, name: result.rows[0].name });
  } catch (error) {
    console.error('[NPCs] Delete NPC error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/npcs/:npcId/relationships - Add NPC relationship
app.post('/api/npcs/:npcId/relationships', async (req, res) => {
  try {
    const { npcId } = req.params;
    const { target_id, target_type, relationship_type, description, strength } = req.body;
    
    const result = await pool.query(`
      INSERT INTO npc_relationships (npc_id, target_id, target_type, relationship_type, description, strength)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (npc_id, target_id) DO UPDATE SET
      relationship_type = EXCLUDED.relationship_type,
      description = EXCLUDED.description,
      strength = EXCLUDED.strength
      RETURNING *
    `, [npcId, target_id, target_type, relationship_type, description, strength]);
    
    console.log('[NPCs] Added/updated relationship for NPC:', npcId);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[NPCs] Add relationship error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/npcs/:npcId/relationships - Get NPC relationships
app.get('/api/npcs/:npcId/relationships', async (req, res) => {
  try {
    const { npcId } = req.params;
    const result = await pool.query(`
      SELECT nr.*, 
             CASE 
               WHEN nr.target_type = 'npc' THEN n.name
               WHEN nr.target_type = 'character' THEN c.name
               ELSE nr.target_id
             END as target_name
      FROM npc_relationships nr
      LEFT JOIN npcs n ON nr.target_type = 'npc' AND nr.target_id = n.id
      LEFT JOIN characters c ON nr.target_type = 'character' AND nr.target_id = c.id
      WHERE nr.npc_id = $1
      ORDER BY nr.strength DESC
    `, [npcId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('[NPCs] Get relationships error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== FILE STORAGE ENDPOINTS =====

// POST /api/upload/avatar - Upload character/user avatar
app.post('/api/upload/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, filename: req.file.filename });
  } catch (error) {
    console.error('[Upload] Avatar upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/upload/map - Upload world map file
app.post('/api/upload/map', upload.single('mapFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, uploaded_by } = req.body;
    
    // For Azgaar's FMG files, parse the JSON to extract bounds and metadata
    if (req.file.mimetype === 'application/json') {
      const fileContent = await fs.readFile(req.file.path, 'utf8');
      const mapData = JSON.parse(fileContent);
      
      // Extract bounds from Azgaar's format
      const bounds = {
        north: mapData.info?.mapHeight || 100,
        south: 0,
        east: mapData.info?.mapWidth || 100,
        west: 0
      };

      // Create world map record
      const result = await pool.query(`
        INSERT INTO maps_world (name, description, geojson_url, bounds, uploaded_by, file_size)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [name, description, `/uploads/${req.file.filename}`, JSON.stringify(bounds), uploaded_by, req.file.size]);

      res.json({ worldMap: result.rows[0], fileUrl: `/uploads/${req.file.filename}` });
    } else {
      // Handle regular image files
      const fileUrl = `/uploads/${req.file.filename}`;
      res.json({ url: fileUrl, filename: req.file.filename });
    }
  } catch (error) {
    console.error('[Upload] Map upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:campaignId/assets - Upload campaign asset
app.post('/api/campaigns/:campaignId/assets', upload.single('asset'), async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, type = 'image' } = req.body;
    const fileUrl = `/uploads/${req.file.filename}`;

    // For now, store asset info in campaign's assets array
    // In a full implementation, you'd create a separate assets table
    const result = await pool.query(`
      UPDATE campaigns 
      SET assets = COALESCE(assets, '[]'::jsonb) || $1::jsonb
      WHERE id = $2
      RETURNING assets
    `, [JSON.stringify([{
      id: req.file.filename,
      name,
      description,
      type,
      url: fileUrl,
      size: req.file.size,
      uploadedAt: new Date().toISOString()
    }]), campaignId]);

    res.json({ 
      asset: {
        id: req.file.filename,
        name,
        description, 
        type,
        url: fileUrl,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('[Upload] Campaign asset upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:campaignId/assets - Get campaign assets
app.get('/api/campaigns/:campaignId/assets', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const result = await pool.query('SELECT assets FROM campaigns WHERE id = $1', [campaignId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(result.rows[0].assets || []);
  } catch (error) {
    console.error('[Upload] Get campaign assets error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create HTTP(S) server for both Express and WebSocket
const server = httpsOptions ? createHttpsServer(httpsOptions, app) : createHttpServer(app);
const accessProtocol = httpsOptions ? 'https' : 'http';
const websocketProtocol = httpsOptions ? 'wss' : 'ws';
const publicHost = process.env.DATABASE_SERVER_PUBLIC_HOST || 'localhost';
const portSegment = (port === 80 || port === 443) ? '' : `:${port}`;
const healthCheckUrl = `${accessProtocol}://${publicHost}${portSegment}/health`;
const websocketUrl = `${websocketProtocol}://${publicHost}${portSegment}/socket.io/`;

// Initialize Socket.io WebSocket server
const wsServer = new WebSocketServerClass(server);

// Add WebSocket health check endpoint
app.get('/api/websocket/status', (req, res) => {
  const status = wsServer.getStatus();
  res.json({
    status: 'active',
    ...status
  });
});

// Start server with WebSocket support
server.listen(port, () => {
  const config = {
    port,
    protocol: accessProtocol,
    tlsEnabled: Boolean(httpsOptions),
    databaseHost: process.env.DATABASE_HOST || 'localhost',
    databasePort: process.env.DATABASE_PORT || '5432',
    databaseName: process.env.DATABASE_NAME || 'dnd_app',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV || 'development',
  };
  if (tlsMetadata) {
    config.tls = tlsMetadata;
  }
  
  logApplicationStart(config);
  
  console.log(`Local database server running on port ${port}`);
  console.log(`Health check: ${healthCheckUrl}`);
  console.log(`WebSocket available at ${websocketUrl}`);
  const wsStatus = wsServer.getStatus();
  console.log(`WebSocket connections: ${wsStatus.connected}`);
  
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
