# Development Guide

## Prerequisites

- **Node.js 20+** (the `flake.nix` dev shell pins Node 24)
- **PostgreSQL 17** with the `postgis`, `citext`, and `uuid-ossp` extensions
- **Git**
- **Ollama** (or another configured provider — required for every narrative feature)

`nix develop` provides a shell with Node and the Postgres client already available.

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

# 4. Install server dependencies, apply schema, seed the admin user
npm run db:setup

# 5. Start both servers
npm run dev:local
```

`npm install` already runs `postinstall`, which installs `server/` dependencies; `db:setup`
repeats that and then initialises the database.

Application endpoints:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:5101
- **Health Check:** http://localhost:5101/api/health

## Environment Variables

Create `.env` in the project root. `.env.example` is the annotated reference; the essentials:

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dnd_app
DATABASE_USER=your_username
DATABASE_PASSWORD=your_password
DATABASE_SSL=false
# or a single DATABASE_URL=postgresql://...

# PII encryption (AES-256-GCM), 32 hex-encoded random bytes: openssl rand -hex 32
# Rotating or losing this key invalidates every encrypted field.
ENCRYPTION_KEY=

# WebAuthn / passkeys
WEBAUTHN_RP_NAME=Questables
WEBAUTHN_RP_ID=localhost          # bare registrable domain, no scheme or port
WEBAUTHN_ORIGIN=http://localhost:3000   # must match the browser origin exactly

# Server
DATABASE_SERVER_PORT=5101
FRONTEND_URL=http://localhost:3000

# LLM provider
LLM_PROVIDER=ollama
LLM_OLLAMA_HOST=http://localhost:11434
LLM_OLLAMA_MODEL=qwen3:8b

# Optional: HTTPS
# DATABASE_SERVER_USE_TLS=true
# DATABASE_SERVER_TLS_CERT=/path/to/cert.pem
# DATABASE_SERVER_TLS_KEY=/path/to/key.pem
# DEV_SERVER_USE_TLS=true
# DEV_SERVER_TLS_CERT=/path/to/cert.pem
# DEV_SERVER_TLS_KEY=/path/to/key.pem
```

### AGPL §13 source offer

Two build-time variables feed the permanent "Source" link rendered by
`components/source-notice.tsx`:

| Variable | Purpose |
|----------|---------|
| `VITE_SOURCE_URL` | Repository serving this build's source. Defaults to upstream. |
| `VITE_SOURCE_REVISION` | Commit SHA of the build; shown abbreviated next to the link. |

These are baked in at build time, so they must be set **before** `npm run build` — changing them
afterwards has no effect. If you deploy a modified Questables, `VITE_SOURCE_URL` must point at your
own source; leaving it at upstream does not discharge the AGPL §13 obligation. The link is mounted
at the app root, outside both `AppContent` and `ErrorBoundary`, so it survives every state change
and render crash — do not relocate it into a branch.

**No frontend API URL is configured.** The client issues same-origin requests
(`getApiBaseUrl()` returns `""`) and the Vite dev server proxies `/api` and `/socket.io` to
`DATABASE_SERVER_PORT` — see `vite.config.ts`.

## Schema and Migrations

`database/schema.sql` is the **final-state** schema and is re-applied idempotently by
`server/setup-database.js` on every server start — that is what a fresh install gets.
`database/migrations/*.sql` roll an *existing* database forward and are applied by hand:

```bash
psql -d dnd_app -f database/migrations/017_fmg_full_json_schema_indexes.sql
```

Each migration ships a matching `.rollback.sql`. When a migration adds a table or column, fold
the same shape into `schema.sql` — the two must stay in sync, and every statement in `schema.sql`
must be idempotent (`CREATE … IF NOT EXISTS`, `ALTER … ADD COLUMN IF NOT EXISTS`, etc.).

`server/migrations/encrypt-user-pii.js` is a JS migration run automatically *before* the schema
on server start; it reshapes `user_profiles` on an existing database and no-ops on a fresh one.

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (frontend only, port 3000) |
| `npm run db:server` | Start Express backend (port 5101) |
| `npm run db:dev` | Start backend with nodemon auto-reload |
| `npm run dev:local` | Start both frontend and backend concurrently |
| `npm run db:setup` | Install server dependencies and initialize database |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint` | ESLint — zero warnings tolerated |
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
│   ├── character-wizard/    # Character creation wizard
│   ├── action-panel/        # Action declaration, rolls, rests, death saves
│   ├── game-state/          # Phase indicator, turn banner
│   ├── compendium/          # SRD browser, shops, loot tables
│   └── live-state/          # Session-scoped HP/conditions UI
├── contexts/                # User, GameSession, GameState, Action, LiveState
├── hooks/                   # Shared React hooks
├── shared/                  # Code shared between client and server
├── utils/                   # Frontend utilities
│   ├── api-client.ts        # fetch wrapper + typed API functions
│   └── srd/                 # D&D SRD types and constants
├── styles/                  # Global styles
├── server/                  # Express backend
│   ├── database-server.js   # Server entry point
│   ├── auth-middleware.js   # JWT auth
│   ├── websocket-server.js  # Socket.io
│   ├── crypto.js            # AES-256-GCM PII encryption
│   ├── routes/              # API routes (22 domain modules)
│   ├── services/            # Business logic
│   ├── llm/                 # LLM provider layer
│   ├── db/                  # Database pool
│   ├── validation/          # Input validation
│   ├── migrations/          # JS migrations run at startup
│   └── scripts/             # SRD import, admin enrolment, backfills, smoke tests
├── database/
│   ├── schema.sql           # Final-state schema (idempotent)
│   └── migrations/          # Forward + rollback SQL pairs
├── scripts/                 # Session reset / intro seeding helpers
├── tests/                   # Test files, grouped by domain
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
npm test -- --runTestsByPath tests/movement/travel-planner.test.js

# A whole domain
npm test -- tests/maps

# Watch mode / coverage
npm run test:watch
npm run test:coverage
```

### Test Structure

Tests are grouped by domain rather than kept flat:

```
tests/
├── fixtures/            # Shared fixtures (FMG tiny.json, settlemaker GeoJSON, LLM contexts)
├── llm/                 # Context manager, prompt builders, cache invalidation
├── maps/                # Scale extraction and the FMG full-JSON import pipeline
│   └── fmg-full-json/   # Parser, validators, geometry builder, orchestrator, per-ingester suites
├── movement/            # Narrative movement, travel planning, gate/burg snapping
├── plan3b/              # Settlement ingestion
├── security/            # Auth and access-control checks
├── settlemaker/         # settlemaker contract conformance
├── shared/              # Shared utility suites
└── world-building/      # World-building pipeline
```

### Database-backed Tests

Suites that touch Postgres call `describeWithDb` (`tests/maps/fmg-full-json/db-harness.js`), which
**skips itself** unless `PGUSER`, `PGDATABASE`, or `DATABASE_URL` is set. When they do run, each
opens a transaction and rolls it back, so they leave no residue:

```bash
PGUSER=$USER PGDATABASE=dnd_app npm test -- tests/maps/fmg-full-json
```

Some suites target specific rows in a seeded database via `TEST_CAMPAIGN_ID`, `TEST_SESSION_ID`,
`TEST_BURG_ID`, `TEST_BURG_NAME`, and `TEST_ACTING_CHAR_ID`. `TEST_DATABASE_URL` overrides the
connection for tests only.

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
4. Add TypeScript types and a typed wrapper in `utils/api-client.ts` if the client calls it

Routes handle HTTP concerns only (parsing, validation, status codes); services own the business
logic and every database query.

### Adding a New Map Layer

1. Create layer factory in `components/layers/<layer>.ts`
2. Export from `components/layers/index.ts`
3. Add data loading method to `MapDataLoader`
4. Add backend endpoint in `server/routes/maps.routes.js`
5. Add layer to map component(s)
6. Update [Mapping System](./mapping-system.md)

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
npm run import-srd          # both document sets
npm run import-srd:2014     # srd-2014 only
npm run import-srd:2024     # srd-2024 only
```

This fetches data from Open5e and populates species, classes, backgrounds, spells, items, feats,
and conditions.

### Other Server Scripts

| Script | Purpose |
|--------|---------|
| `npm run enrol-admin` | Grant the `admin` role to an existing account |
| `node scripts/backfill-plan3b.js` | Backfill settlement sidecar data for existing burgs |
| `node scripts/smoke-plan3c.js` | Smoke-check burg entrances / multi-route gates |

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
curl http://localhost:5101/api/health
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
