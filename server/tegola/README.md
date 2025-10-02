# Tegola Vector Tile Service

This directory holds the configuration assets for the Questables Tegola instance. The
goal is to expose PostGIS-backed layers (world geography, campaign overlays, tokens,
and NPCs) as OpenLayers-ready vector tiles without introducing mock data. The
earlier MapLibre/Deck.gl rollout plan is paused because the stack cannot honour the
Questables custom projection.

## Environment Variables

All configuration is driven from `.env.local`; no defaults are assumed. The generator
expects the following keys (see `.env.local` for the current values):

```
TEGOLA_DATABASE_HOST
TEGOLA_DATABASE_PORT
TEGOLA_DATABASE_NAME
TEGOLA_DATABASE_USER
TEGOLA_DATABASE_PASSWORD
TEGOLA_DATABASE_SSLMODE
TEGOLA_DATABASE_MAX_CONNECTIONS
TEGOLA_WEB_LISTEN
TEGOLA_PUBLIC_URL
TEGOLA_CACHE_DIR
TEGOLA_CACHE_MAX_FEATURES
TEGOLA_MAX_ZOOM
TEGOLA_CONFIG_PATH
```

The database credentials intentionally mirror the live PostGIS instance; Tegola reads
directly from production data and does not use fixtures.

## Generating the Config

```
cd server
node tegola/generate-config.js
```

The script renders `tegola.template.toml` into `TEGOLA_CONFIG_PATH` (by default
`server/tegola/tegola.toml`) and ensures the on-disk cache directory exists. The
generated file is git-ignored because it contains environment-specific values.

## Running Tegola

Install the Tegola binary (https://tegola.io/) and serve the generated config:

```
tegola serve --config $(realpath server/tegola/tegola.toml)
```

`TEGOLA_WEB_LISTEN` controls the bind address (default `0.0.0.0:9090`). The Questables
API proxies requests to Tegola and enforces authentication; keep the Tegola listener
bound to localhost or a protected network segment to prevent unauthorised tile access.

## Health Checks & Proxies

The Express API exposes `/api/tiles/health` and `/api/tiles/vector/...` endpoints that
proxy to Tegola using the credentials above. Any Tegola failure surfaces as a 5xx so
OpenLayers clients never fall back to mock data.

## Layer Coverage

The generated configuration publishes the following provider layers, all filtered to
SRID 0 geometries:

- `world_cells`, `world_routes`, `world_rivers`, `world_markers`, `world_burgs`
- `campaign_spawns`, `locations` (player-created pins)
- `campaign_objectives` (resolved to burg/marker/pin geometries)
- `campaign_player_positions` (current token locations)
- `campaign_recent_trails` (recent movement lines)
- `npc_positions`

Keep these layers in sync with any future schema changes—`tegola.template.toml` is the
single source of truth for vector layer definitions.
