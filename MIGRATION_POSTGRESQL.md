# Migration to PostgreSQL-Only Architecture

This document outlines the complete migration from Supabase to PostgreSQL 17 with PostGIS.

## Changes Made

### ✅ Removed Supabase Dependencies

1. **Deleted** `/utils/supabase/` directory entirely
2. **Removed** `@supabase/supabase-js` from package.json
3. **Removed** all Supabase edge functions and references

### ✅ Created PostgreSQL-Only Database Layer

**New Structure:**
- `/utils/database/client.tsx` - PostgreSQL connection client
- `/utils/database/data-helpers.tsx` - Database operation helpers
- `/utils/database/data-structures.tsx` - TypeScript interfaces
- `/utils/database/production-helpers.tsx` - Production database functions
- `/utils/database/index.tsx` - Unified exports

### ✅ Updated Components

**Map Components:**
- `openlayers-map.tsx` - Uses new database client
- `map-data-loader.tsx` - PostgreSQL spatial queries only

**Authentication:**
- `login-modal.tsx` - PostgreSQL auth with demo fallback
- `register-modal.tsx` - PostgreSQL registration with demo fallback

### ✅ Backend Server Updates

**Database Server** (`/server/database-server.js`):
- Express.js middleware for PostgreSQL
- Spatial query endpoints for PostGIS
- Basic authentication endpoints
- Auto-schema creation for essential tables

### ✅ Environment Configuration

**Required Variables:**
```env
VITE_DATABASE_SERVER_URL=http://localhost:3001
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dnd_app
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
```

Use `https://quixote.tail3f19fe.ts.net:3001` (and enable TLS variables) if you prefer to serve the
database API over Tailscale.

## Architecture Changes

### Before (Supabase)
```
Frontend → Supabase Client → Supabase Cloud Database
```

### After (PostgreSQL)
```
Frontend → Database Client → Express Server → PostgreSQL 17 + PostGIS
```

## Key Benefits

1. **No External Dependencies**: Fully self-contained
2. **Full PostgreSQL Control**: Access to all PostgreSQL features
3. **PostGIS Integration**: Advanced spatial capabilities
4. **Local Development**: No cloud dependencies
5. **Cost Control**: No usage-based pricing

## Data Compatibility

All data structures remain the same:
- Characters, Campaigns, Users
- Map data (Burgs, Routes, Rivers, Cells)
- Chat messages and sessions

## Error Handling

The new architecture includes:
- **Graceful Fallbacks**: Demo accounts when database unavailable
- **Connection Resilience**: Auto-retry and error recovery
- **Development Mode**: Mock data when database not configured

## Migration Checklist

- [x] Remove all Supabase imports
- [x] Replace with PostgreSQL client
- [x] Update authentication flow
- [x] Migrate map data loading
- [x] Update environment configuration
- [x] Test demo accounts
- [x] Verify spatial queries
- [x] Update documentation

## Next Steps

1. **Install PostgreSQL 17** with PostGIS extension
2. **Set environment variables** from `.env.example`
3. **Run `npm run dev:local`** to start both frontend and backend
4. **Test with demo accounts** for immediate access
5. **Import world maps** from Azgaar's FMG for full mapping features

## Troubleshooting

**Environment Variable Error:**
- Ensure `.env` file exists with `VITE_DATABASE_SERVER_URL`
- Restart development server after changes

**Database Connection Issues:**
- Verify PostgreSQL is running
- Check database exists: `createdb dnd_app`
- Confirm credentials in environment variables

**PostGIS Features:**
- Install PostGIS extension for spatial features
- Spatial queries will fail gracefully if PostGIS unavailable

The application now runs entirely on PostgreSQL 17 with no external cloud dependencies.
