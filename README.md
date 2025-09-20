# D&D 5e Campaign Manager

A comprehensive web application for managing D&D 5e campaigns, characters, and gameplay sessions with integrated world mapping and PostgreSQL database support.

## Features

### Connected Dashboards
- Player dashboard loads the signed-in user's characters and campaign membership from `/api/users/:id/*` and `/api/campaigns/public`, failing visibly if the backend is unreachable.
- DM dashboard consumes the same live data sources for campaign administration.
- Admin dashboard calls `/api/admin/metrics`; a valid admin session is required and the UI now reflects errors when metrics are unavailable.

### Character & Campaign Management
- Character sheets, spellbooks, and inventory panels read and write directly to the PostgreSQL backend via the shared database helpers.
- Campaign join/leave actions call the live Express endpoints and refresh UI state from server responses.
- Session manager uses `/api/campaigns/:id/sessions` for lifecycle operations and surfaces backend validation errors.

### Messaging & Real-Time Hooks
- Chat components persist party messages and dice rolls through `/api/campaigns/:id/messages` and respect the configured WebSocket host.
- Standalone dice and exploration utilities are intentionally disabled with `FeatureUnavailable` notices until backed services ship, preventing dummy data from reappearing.

### Mapping & Spatial Data
- OpenLayers map viewer loads world metadata and spatial layers from `/api/maps/world` and related PostGIS-powered routes.
- Campaign location overlays rely on live responses; failures present actionable error states instead of silent fallbacks.

### Operational Transparency
- `/api/health` exposes basic pool statistics for the database server and is covered by automated smoke tests (`tests/live-api.integration.test.js`).
- UI-level error boundaries and toasts communicate authentication issues, missing configuration, and backend outages without fabricating success states.

## Technology Stack

- **Frontend**: React + TypeScript + Tailwind CSS v4
- **Backend**: Express.js + PostgreSQL 17 + PostGIS
- **Database Architecture**: UUID primary keys, JSONB fields, field mapping utilities
- **Real-time Features**: Polling-based updates, database health monitoring
- **Error Handling**: Centralized error boundaries and standardized patterns
- **Mapping**: OpenLayers with spatial data support
- **UI Components**: ShadCN/UI component library

## Phase 2 Architecture

The application now features a complete database integration with:

### API Endpoints
- **Health Monitoring**: `/api/health` - Database connection status and metrics
- **Characters**: Full CRUD operations with validation and ownership checks
- **Campaigns**: Campaign lifecycle management with player membership
- **Chat Messages**: Real-time messaging with character-based communication
- **User Management**: Profile management and authentication

### Database Features
- **Field Mapping**: Automatic snake_case ↔ camelCase conversion
- **JSONB Storage**: Flexible storage for D&D-specific data structures
- **Connection Pooling**: Optimized database connections (max 20, timeout 2s)
- **Health Monitoring**: Real-time connection status with retry logic
- **Transaction Safety**: Proper error handling and rollback mechanisms

### Frontend Architecture
- **Live Data Sync**: Character sheet updates automatically reflect inventory/spell changes
- **Error Boundaries**: Application-wide error catching with user-friendly recovery
- **Loading States**: Consistent loading indicators across all components
- **Offline Mode**: Graceful degradation when database is unavailable
- **Health Indicators**: Real-time database status in the UI

## Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 17 with PostGIS extension
- Git

### Fast Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd questables
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Database Setup**
   
   **📖 For detailed setup instructions, see [DATABASE_SETUP.md](./DATABASE_SETUP.md)**
   
   Quick setup:
   ```bash
   # Create database
   createdb dnd_app
   
   # Import schema
   psql -d dnd_app -f database/schema.sql
   
   # Create environment file
   cp .env.example .env.local
   # Edit .env.local with your database credentials
   ```

4. **Start the application**
   ```bash
   # Start database server (backend)
   npm run db:server
   
   # In another terminal, start frontend
   npm run dev
   ```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001 *(or https://quixote.tail3f19fe.ts.net:3001 when TLS is enabled)*
- Health Check: http://localhost:3001/api/health *(or https://quixote.tail3f19fe.ts.net:3001/health)*

### ⚠️ Important Notes

- **Database Required**: This application requires a properly configured PostgreSQL database
- **No Demo Mode**: There are no fallback modes - database setup is mandatory
- **Environment Variables**: Must be configured in `.env.local` (not tracked by git)
- **Health Monitoring**: Check the database status indicator in the UI for connection health

## Database Setup

**IMPORTANT**: This application requires a properly configured database to function. There are no demo accounts or fallback modes - the application will fail if the database is not properly set up.

1. **Create PostgreSQL Database**
   ```bash
   createdb dnd_app
   ```

2. **Install PostGIS Extension** (for spatial features)
   ```bash
   psql dnd_app -c "CREATE EXTENSION IF NOT EXISTS postgis;"
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database configuration
   ```

The application will automatically create required tables on first startup.

## Database Setup

The application automatically creates basic database tables on first run. For full spatial mapping features, ensure PostGIS is installed:

```sql
-- Connect to your database and run:
CREATE EXTENSION IF NOT EXISTS postgis;
```

## Environment Configuration

**Required Environment Variables:**

Create a `.env` file in the project root (copy from `.env.example`):

```env
# REQUIRED: Database Server URL (frontend to backend communication)
VITE_DATABASE_SERVER_URL=http://localhost:3001

# PostgreSQL Connection (backend)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dnd_app
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_SSL=false

# Server Configuration  
DATABASE_SERVER_PORT=3001
FRONTEND_URL=http://localhost:3000

# Optional HTTPS configuration
# DATABASE_SERVER_USE_TLS=true
# DATABASE_SERVER_TLS_CERT=../quixote.tail3f19fe.ts.net.crt
# DATABASE_SERVER_TLS_KEY=../quixote.tail3f19fe.ts.net.key
# DATABASE_SERVER_PUBLIC_HOST=quixote.tail3f19fe.ts.net
# VITE_DATABASE_SERVER_URL=https://quixote.tail3f19fe.ts.net:3001
# When enabling HTTPS for the frontend dev server, update FRONTEND_URL and set:
# FRONTEND_URL=https://quixote.tail3f19fe.ts.net:3000
# DEV_SERVER_USE_TLS=true
# DEV_SERVER_TLS_CERT=./quixote.tail3f19fe.ts.net.crt
# DEV_SERVER_TLS_KEY=./quixote.tail3f19fe.ts.net.key
```

**The application will fail to start if `VITE_DATABASE_SERVER_URL` is not set.** Player and DM dashboards now surface an explicit configuration error rather than falling back to dummy data when this variable is missing.

## Development Scripts

```bash
# Start frontend only
npm run dev

# Start backend only  
npm run db:server

# Start both frontend and backend
npm run dev:local

# Set up database server dependencies
npm run db:setup

# Build for production
npm run build
```

## Testing

- Run the live smoke suite once the backend is accessible:

  ```bash
  LIVE_API_BASE_URL=https://quixote.tail3f19fe.ts.net:3001 \
  LIVE_API_ADMIN_EMAIL=admin@questables.example\
  LIVE_API_ADMIN_PASSWORD=thepassword \
  npm test -- --runTestsByPath tests/live-api.integration.test.js
  ```

- If you seed different admin credentials, set `LIVE_API_ADMIN_EMAIL` and `LIVE_API_ADMIN_PASSWORD` to match (the suite also respects the `DEFAULT_ADMIN_*` values used by `npm run db:setup`).

## Project Structure

```
├── components/          # React components
│   ├── ui/             # ShadCN UI components
│   ├── openlayers-map.tsx
│   ├── player-dashboard.tsx
│   └── ...
├── utils/
│   └── database/       # PostgreSQL client and helpers
├── server/             # Express.js backend
│   ├── database-server.js
│   └── setup-database.js
├── styles/
│   └── globals.css     # Tailwind v4 configuration
└── database/
    └── schema.sql      # Full database schema
```

## Mapping Features

The application supports:

- **World Maps**: Import from Azgaar's Fantasy Map Generator
- **Spatial Queries**: PostGIS-powered location searches
- **Interactive Layers**: Cities, roads, rivers, terrain, markers
- **Campaign Integration**: Link campaign locations to world positions

## Authentication

- **Database Auth**: Accounts are created through the live API and stored in PostgreSQL.
- **No Demo Accounts**: The app does not provide fallback users; resolve backend issues instead of fabricating access.
- **Role-based Access**: Player, DM, and Admin permission levels

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

**Database Connection Issues:**
- Ensure PostgreSQL is running
- Check database credentials in `.env`
- Verify database exists: `createdb dnd_app`

**PostGIS Not Available:**
- Spatial features will be limited but app will still work
- Install PostGIS: `apt-get install postgresql-postgis` (Ubuntu)

**Environment Variables:**
- Ensure `.env` file exists and contains required variables
- Restart server after changing environment variables

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- ShadCN/UI for the component library
- OpenLayers for mapping capabilities  
- Azgaar's Fantasy Map Generator for world map support
- D&D 5e SRD for game mechanics reference
