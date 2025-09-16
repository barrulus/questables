# Local PostgreSQL Setup Guide

This guide will help you set up a local PostgreSQL database with PostGIS for your D&D web app instead of using Supabase.

## Prerequisites

### 1. Install PostgreSQL with PostGIS

**macOS (using Homebrew):**
```bash
brew install postgresql postgis
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgis postgresql-14-postgis-3
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**Windows:**
- Download PostgreSQL from https://www.postgresql.org/download/windows/
- During installation, include the PostGIS extension via Stack Builder
- Or download PostGIS separately from https://postgis.net/windows_downloads/

### 2. Create Database and User

Connect to PostgreSQL as superuser:
```bash
sudo -u postgres psql
```

Create database and user:
```sql
CREATE DATABASE dnd_app;
CREATE USER dnd_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE dnd_app TO dnd_user;
ALTER USER dnd_user CREATEDB;  -- For running migrations
\q
```

## Project Setup

### 1. Environment Configuration

Copy the environment template:
```bash
cp .env.example .env.local
```

Edit `.env.local` to use local PostgreSQL (comment out Supabase variables):
```env
# Option 2: Local PostgreSQL (Self-hosted)
VITE_DATABASE_URL=postgresql://dnd_user:your_secure_password@localhost:5432/dnd_app

# Local database server configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dnd_app
DATABASE_USER=dnd_user
DATABASE_PASSWORD=your_secure_password
DATABASE_SSL=false
DATABASE_SERVER_PORT=3001
FRONTEND_URL=http://localhost:3000
```

### 2. Install Dependencies

Install main project dependencies:
```bash
npm install
```

Install database server dependencies:
```bash
npm run db:setup
```

This will:
- Install server dependencies
- Create database schema with PostGIS extensions
- Set up spatial functions
- Create sample data
- Create default admin user (barrulus@localhost / barrulus123)

> **Tip:** You can override the default admin credentials by setting `DEFAULT_ADMIN_USERNAME`,
> `DEFAULT_ADMIN_EMAIL`, and `DEFAULT_ADMIN_PASSWORD` in `.env.local` before running
> `npm run db:setup`.

#### Optional: Enable HTTPS with Tailscale certificates

If you're exposing the database API over Tailscale, you can enable TLS by adding the
following to `.env.local` before starting the server:

```env
DATABASE_SERVER_USE_TLS=true
DATABASE_SERVER_TLS_CERT=../quixote.tail3f19fe.ts.net.crt
DATABASE_SERVER_TLS_KEY=../quixote.tail3f19fe.ts.net.key
DATABASE_SERVER_PUBLIC_HOST=quixote.tail3f19fe.ts.net
VITE_DATABASE_SERVER_URL=https://quixote.tail3f19fe.ts.net:3001
FRONTEND_URL=https://quixote.tail3f19fe.ts.net:3000
DEV_SERVER_USE_TLS=true
DEV_SERVER_TLS_CERT=./quixote.tail3f19fe.ts.net.crt
DEV_SERVER_TLS_KEY=./quixote.tail3f19fe.ts.net.key
```

The server will automatically fall back to HTTP if the certificate files are missing or
TLS is disabled.

### 3. Start Development Environment

Run both the frontend and database server:
```bash
npm run dev:local
```

Or run them separately:
```bash
# Terminal 1: Database server
npm run db:server

# Terminal 2: Frontend development server
npm run dev
```

## Database Management

### Viewing Data

Connect to your database:
```bash
psql postgresql://dnd_user:your_secure_password@localhost:5432/dnd_app
```

Useful queries:
```sql
-- List all tables
\dt

-- View sample world maps
SELECT id, name, description FROM maps_world;

-- View sample cities/towns (burgs)
SELECT name, population, type, ST_AsText(geom) as location FROM maps_burgs;

-- Check PostGIS installation
SELECT PostGIS_Version();
```

### Importing Azgaar's FMG Data

1. Export your world from Azgaar's Fantasy Map Generator as geoJSON
2. Use the import scripts in `/database/` to load the data
3. The schema supports all FMG data types: burgs, routes, rivers, cells, markers

### Database Schema Updates

The schema file is located at `/database/schema.sql`. To apply updates:

```bash
# Re-run setup (will skip existing tables)
npm run db:setup

# Or manually apply changes
psql postgresql://dnd_user:your_secure_password@localhost:5432/dnd_app < database/schema.sql
```

## Production Deployment

### Docker Setup

Create a `docker-compose.yml` for production:
```yaml
version: '3.8'
services:
  postgres:
    image: postgis/postgis:15-3.3
    environment:
      POSTGRES_DB: dnd_app
      POSTGRES_USER: dnd_user
      POSTGRES_PASSWORD: your_secure_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql
  
  db-server:
    build: ./server
    environment:
      DATABASE_HOST: postgres
      DATABASE_NAME: dnd_app
      DATABASE_USER: dnd_user
      DATABASE_PASSWORD: your_secure_password
    ports:
      - "3001:3001"
    depends_on:
      - postgres

volumes:
  postgres_data:
```

Start with Docker:
```bash
docker-compose up -d
```

### VPS Deployment

1. Install PostgreSQL and PostGIS on your server
2. Set up database and user as above
3. Copy your application files
4. Set environment variables
5. Use PM2 or similar to manage the database server process
6. Set up reverse proxy (nginx) to handle requests

## Troubleshooting

### Common Issues

**Connection refused:**
- Check if PostgreSQL is running: `pg_ctl status`
- Verify port 5432 is available: `netstat -an | grep 5432`
- Check PostgreSQL configuration: `/etc/postgresql/*/main/postgresql.conf`

**PostGIS not found:**
- Install PostGIS extension: `sudo apt install postgresql-14-postgis-3`
- Enable in database: `CREATE EXTENSION postgis;`

**Permission denied:**
- Check database user permissions
- Verify password in connection string
- Check pg_hba.conf for authentication settings

### Performance Optimization

For better performance with spatial queries:
```sql
-- Create spatial indexes (these are in the schema already)
CREATE INDEX CONCURRENTLY idx_burgs_geom ON maps_burgs USING GIST (geom);
CREATE INDEX CONCURRENTLY idx_routes_geom ON maps_routes USING GIST (geom);
CREATE INDEX CONCURRENTLY idx_rivers_geom ON maps_rivers USING GIST (geom);
CREATE INDEX CONCURRENTLY idx_cells_geom ON maps_cells USING GIST (geom);

-- Analyze tables for query planner
ANALYZE maps_burgs;
ANALYZE maps_routes;
ANALYZE maps_rivers;
ANALYZE maps_cells;
```

## Migration from Supabase

If you're moving from Supabase to local PostgreSQL:

1. Export your data from Supabase:
   ```bash
   pg_dump "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres" > supabase_backup.sql
   ```

2. Import to local database:
   ```bash
   psql postgresql://dnd_user:password@localhost:5432/dnd_app < supabase_backup.sql
   ```

3. Update environment variables to use local PostgreSQL
4. Test all functionality to ensure compatibility

## Backup and Restore

Regular backups:
```bash
# Create backup
pg_dump postgresql://dnd_user:password@localhost:5432/dnd_app > backup_$(date +%Y%m%d).sql

# Restore backup
psql postgresql://dnd_user:password@localhost:5432/dnd_app < backup_20241212.sql
```

Automated backups with cron:
```bash
# Add to crontab (crontab -e)
0 2 * * * pg_dump postgresql://dnd_user:password@localhost:5432/dnd_app > /path/to/backups/dnd_app_$(date +\%Y\%m\%d).sql
```
