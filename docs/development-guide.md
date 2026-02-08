# Development Guide

## Prerequisites

- **Node.js 18+**
- **PostgreSQL 17** with PostGIS extension
- **Git**
- **Ollama** (optional, for narrative generation)

## Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd questables
npm install

# 2. Create database
createdb dnd_app
psql -d dnd_app -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d dnd_app -c "CREATE EXTENSION IF NOT EXISTS citext;"
psql -d dnd_app -f database/schema.sql

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 4. Install server dependencies
npm run db:setup

# 5. Start both servers
npm run dev:local
```

Application endpoints:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **Health Check:** http://localhost:3001/api/health

## Environment Variables

Create `.env` in the project root:

```env
# Required
VITE_DATABASE_SERVER_URL=http://localhost:3001
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dnd_app
DATABASE_USER=your_username
DATABASE_PASSWORD=your_password
DATABASE_SERVER_PORT=3001
FRONTEND_URL=http://localhost:3000

# Optional: HTTPS
# DATABASE_SERVER_USE_TLS=true
# DATABASE_SERVER_TLS_CERT=/path/to/cert.pem
# DATABASE_SERVER_TLS_KEY=/path/to/key.pem
# DEV_SERVER_USE_TLS=true
# DEV_SERVER_TLS_CERT=/path/to/cert.pem
# DEV_SERVER_TLS_KEY=/path/to/key.pem

# Optional: LLM (for narrative features)
LLM_PROVIDER=ollama
LLM_OLLAMA_HOST=http://localhost:11434
LLM_OLLAMA_MODEL=qwen3:8b
```

**Important:** The application will fail to start if `VITE_DATABASE_SERVER_URL` is not set.

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (frontend only, port 3000) |
| `npm run db:server` | Start Express backend (port 3001) |
| `npm run dev:local` | Start both frontend and backend concurrently |
| `npm run db:setup` | Install server dependencies and initialize database |
| `npm run build` | TypeScript check + Vite production build |
| `npm test` | Run Jest test suite |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:coverage` | Jest with coverage report |
| `npm run test:ci` | Jest in CI mode |

## Project Structure

```
questables/
├── App.tsx                  # Root component
├── main.tsx                 # Vite entry point
├── components/              # React components
│   ├── ui/                  # ShadCN/Radix primitives
│   ├── layers/              # OpenLayers layer factories
│   ├── maps/                # Map utilities
│   └── character-wizard/    # Character creation wizard
├── contexts/                # React contexts (User, GameSession)
├── utils/                   # Frontend utilities
│   ├── api-client.ts        # HTTP client
│   └── srd/                 # D&D SRD types and constants
├── styles/                  # Global styles
├── server/                  # Express backend
│   ├── database-server.js   # Server entry point
│   ├── auth-middleware.js    # JWT auth
│   ├── websocket-server.js  # Socket.io
│   ├── routes/              # API routes
│   ├── services/            # Business logic
│   ├── llm/                 # LLM provider layer
│   ├── db/                  # Database pool
│   └── validation/          # Input validation
├── database/
│   └── schema.sql           # Full database schema
├── tests/                   # Test files
├── public/                  # Static assets
├── docs/                    # Documentation
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
└── package.json
```

## Testing

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test -- --runTestsByPath tests/campaign-manager.test.tsx

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Test Structure

```
tests/
├── campaign-manager.test.tsx                 # Campaign CRUD UI
├── campaign-prep-map-viewport.test.tsx       # Map viewport persistence
├── campaign-prep-layer-visibility.test.tsx   # Layer toggle behavior
├── campaign-prep-map-tile-refresh.test.ts    # Tile refresh logic
├── campaign-shared.test.ts                   # Shared campaign utilities
├── combat-tracker.test.tsx                   # Combat tracker UI
├── dm-sidebar.test.tsx                       # DM sidebar navigation
├── objectives-panel.test.tsx                 # Quest objectives UI
├── world-map-cache.test.ts                   # Map data caching
├── live-api.integration.test.js              # API smoke tests (requires running backend)
├── narrative-api.integration.test.js         # Narrative endpoint tests
├── ollama-provider.integration.test.js       # LLM provider tests
├── context-manager.integration.test.js       # Context service tests
└── npc-interaction-utils.test.js             # NPC interaction helpers
```

### Integration Tests

Integration tests require a running backend:

```bash
LIVE_API_BASE_URL=http://localhost:3001 \
LIVE_API_ADMIN_EMAIL=admin@questables.example \
LIVE_API_ADMIN_PASSWORD=changeme \
npm test -- --runTestsByPath tests/live-api.integration.test.js
```

### Type Checking

```bash
npx tsc --noEmit
```

Run this before committing to catch type errors not caught by Vite's dev server.

## Code Conventions

### Database

- **Column names:** `snake_case`
- **API responses:** `camelCase`
- **Primary keys:** UUID (`gen_random_uuid()`)
- **Timestamps:** `created_at` / `updated_at` with auto-trigger

### TypeScript

- **Strict mode** enabled
- **Path aliases:** `@/` → project root
- **Imports:** Prefer `@/components/...` over relative paths

### Components

- **UI primitives** in `components/ui/` — do not add business logic here
- **ShadCN convention:** composable via `className`, styled with Tailwind
- **`cn()` helper** for conditional class merging

### OpenLayers

- **Layer factories** in `components/layers/` — never instantiate layers inline
- **Stable callbacks** using refs for event handlers
- **Arrow wrappers** when passing `MapDataLoader` methods as callbacks

## Common Development Tasks

### Adding a New API Endpoint

1. Create route handler in `server/routes/<domain>.routes.js`
2. Add business logic in `server/services/<domain>/service.js`
3. Wire route in `server/database-server.js`
4. Add TypeScript types in `utils/` if needed
5. Update `docs/api-reference.md`

### Adding a New Map Layer

1. Create layer factory in `components/layers/<layer>.ts`
2. Export from `components/layers/index.ts`
3. Add data loading method to `MapDataLoader`
4. Add backend endpoint in `server/routes/maps.routes.js`
5. Add layer to map component(s)
6. Update `docs/mapping-system.md`

### Adding a New UI Component

```bash
# ShadCN CLI (if configured)
npx shadcn-ui@latest add <component-name>

# Or manually create in components/ui/
```

### Importing SRD Data

SRD data is loaded into `srd_*` tables. The import process:

```bash
cd server
npm run import-srd
```

This fetches data from Open5e and populates species, classes, backgrounds, spells, items, feats, and conditions.

## Troubleshooting

### Database Connection Issues

```bash
# Verify PostgreSQL is running
pg_isready

# Check database exists
psql -l | grep dnd_app

# Verify PostGIS
psql -d dnd_app -c "SELECT PostGIS_version();"

# Check health endpoint
curl http://localhost:3001/api/health
```

### Frontend Build Issues

```bash
# Clear Vite cache
rm -rf node_modules/.vite

# Full clean rebuild
rm -rf node_modules && npm install
```

### OpenLayers Issues

- **Blank map:** Check tile set configuration and `tile_sets` table
- **Layers not loading:** Verify `MapDataLoader` method binding (use arrow wrappers)
- **Stale tooltips:** Check that event listeners use stable callback refs

### LLM Issues

```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# Test provider connectivity (see llm-integration.md)
```
