// Local database server for PostgreSQL connection
// This server handles database queries when using local PostgreSQL instead of Supabase

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.DATABASE_SERVER_PORT || 3001;

// Enable CORS for frontend requests
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT) || 5432,
  database: process.env.DATABASE_NAME || 'dnd_app',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err);
    process.exit(1);
  } else {
    console.log('Connected to PostgreSQL database successfully');
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
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, username, email, role FROM user_profiles WHERE email = $1 AND password_hash = crypt($2, password_hash)',
      [email, password]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    res.json({ user });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, role = 'player' } = req.body;
  
  try {
    const client = await pool.connect();
    const result = await client.query(`
      INSERT INTO user_profiles (username, email, password_hash, role) 
      VALUES ($1, $2, crypt($3, gen_salt('bf')), $4) 
      RETURNING id, username, email, role
    `, [username, email, password, role]);
    client.release();

    const user = result.rows[0];
    res.json({ user });
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'User already exists' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

// Start server
app.listen(port, () => {
  console.log(`Local database server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});