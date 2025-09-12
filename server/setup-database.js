// Database setup script for local PostgreSQL
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import loadEnv from './env.js';

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT) || 5432,
  database: process.env.DATABASE_NAME || 'dnd_app',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function setupDatabase() {
  console.log('Setting up local PostgreSQL database...');
  
  try {
    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL');
    
    // Enable PostGIS extension
    console.log('Installing PostGIS extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    console.log('✓ PostGIS extension installed');
    
    // Read and execute schema file
    console.log('Creating database schema...');
    const schemaPath = join(__dirname, '..', 'database', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    // Split schema into individual statements and execute
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      try {
        await client.query(statement + ';');
      } catch (error) {
        if (error.code !== '42P07') { // Ignore "relation already exists" errors
          console.warn('Warning executing statement:', error.message);
        }
      }
    }
    
    console.log('✓ Database schema created');
    
    // Create default admin user if it doesn't exist
    console.log('Creating default admin user...');
    try {
      await client.query(`
        INSERT INTO user_profiles (username, email, password_hash, role)
        VALUES ('admin', 'admin@localhost', crypt('admin123', gen_salt('bf')), 'admin')
        ON CONFLICT (email) DO NOTHING
      `);
      console.log('✓ Default admin user created (admin@localhost / admin123)');
    } catch (error) {
      console.log('ℹ Default admin user already exists');
    }
    
    // Create sample data
    console.log('Creating sample data...');
    try {
      // Sample world map
      const worldMapResult = await client.query(`
        INSERT INTO maps_world (
          name, 
          description, 
          bounds, 
          default_zoom, 
          thumbnail_url
        ) VALUES (
          'Sample World',
          'A sample fantasy world for testing',
          ST_MakeEnvelope(-180, -90, 180, 90, 4326),
          3,
          'https://via.placeholder.com/300x200'
        ) ON CONFLICT (name) DO NOTHING
        RETURNING id
      `);
      
      if (worldMapResult.rows.length > 0) {
        const worldId = worldMapResult.rows[0].id;
        
        // Sample burgs (cities)
        await client.query(`
          INSERT INTO maps_burgs (world_id, name, population, type, geom)
          VALUES 
            ($1, 'Capital City', 50000, 'capital', ST_Point(0, 0)),
            ($1, 'Harbor Town', 15000, 'city', ST_Point(10, 5)),
            ($1, 'Mountain Village', 800, 'town', ST_Point(-15, 20))
          ON CONFLICT DO NOTHING
        `, [worldId]);
        
        console.log('✓ Sample world data created');
      }
    } catch (error) {
      console.log('ℹ Sample data creation skipped:', error.message);
    }
    
    client.release();
    console.log('\n🎉 Database setup complete!');
    console.log('You can now start the database server with: npm start');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup
setupDatabase();
