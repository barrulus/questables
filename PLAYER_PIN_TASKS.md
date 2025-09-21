# Player Token Integration Tasks

The goal is to render real player tokens on the world map, persisted in PostGIS, synchronized across clients, and fully aligned with the Questables Agent Charter (no dummy data, no silent fallbacks, audit every persistence). Each task finishes only when doubled-checked against live API behavior and recorded in `clearance_and_connect_tasks_documentation.md`.

## Phase 1 – Database & Schema Integrity
- **DB-001 – Add live player location columns**  
  Extend `public.campaign_players` with `loc_current geometry(Point, 4326)` and `last_located_at timestamptz` (default `now()`). Backfill existing rows with `NULL`, add a CHECK ensuring SRID 4326, and create a GIST index. Update migrations and regenerate ERD documentation. Confirm `schema.sql` matches deployed schema.
- **DB-002 – Location history table**  
  Create `public.campaign_player_locations` with foreign keys to `campaign_players`, `loc geometry(Point, 4326)`, `recorded_at timestamptz default now()`, and supporting GIST/indexes. Add trigger on `campaign_players` to write to history on `loc_current` updates. Document retention policy (keep last 100 entries per player) and create a cleanup job placeholder ticket.
- **DB-003 – Visible trails view**  
  Materialize `public.v_player_recent_trails` (last 30 points per player ordered by `recorded_at`). Expose view ownership to API role and ensure it enforces SRID and ordering. Regression-test with `EXPLAIN` to confirm index usage.

## Phase 2 – Service Layer & Authorization
- **API-010 – Movement contract**  
  Introduce `POST /api/campaigns/:campaignId/players/:playerId/move` with body `{ target: { lon, lat }, mode }`. Verify caller is DM or the player, validate target lies inside selected world map bounds, and enforce rate limits + distance clamps. Update OpenAPI/API docs.
- **API-011 – Visibility function & endpoint**  
  Implement `visible_player_positions` SQL (DM sees all, players see party members within configurable km radius). Surface via `GET /api/campaigns/:campaignId/players/visible` returning GeoJSON, no hidden data. Add tests covering DM vs player, distance cutoffs, stealth flag handling.
- **API-012 – Trail fetch**  
  Add `GET /api/campaigns/:campaignId/players/:playerId/trail` returning LineString for authorized viewers. Ensure 403 when viewer lacks access. Cache-control headers tuned for live data.
- **API-013 – Spawn management**  
  Provide DM-only CRUD for campaign spawns plus helper `POST /api/campaigns/:campaignId/players/:playerId/teleport`. Every mutation writes to movement audit log (see below).
- **API-014 – Movement audit log**  
  Create `public.player_movement_audit` capturing who moved whom, from/to coordinates, mode, and reason. Log every move/teleport and expose `/api/campaigns/:campaignId/movement-audit` to admins.

## Phase 3 – Frontend Integration (OpenLayers)
- **FE-020 – Player source & layer**  
  Add a dedicated vector source in `components/openlayers-map.tsx` that hits the GeoJSON endpoint with authenticated headers. Replace local `mapPins` usage when tool is in player mode. No local mock pins remain.
- **FE-021 – Token styling**  
  Render player avatars (fallback initial-based chips) with status badges (HP %, conditions, stealth). Respect server-provided visibility; never synthesize data. Provide hover popover reusing existing popup system.
- **FE-022 – Trail toggle**  
  Layer toggle to fetch `/trail` endpoint per visible player. Cache features per player ID and drop when out of scope. Handle 403 cleanly (show “trail hidden” message, no fake geometry).
- **FE-023 – Movement controls**  
  When DM selects Move tool, clicking map opens confirmation modal showing target lat/lon, distance, and mode selector. Submit to move API and refresh layer. For players, only their own token is movable (if rules allow). Handle API errors via toast + error badge—no silent fallback.
- **FE-024 – WebSocket sync**  
  Subscribe to campaign channel and patch live features on `player-moved` events. On disconnect, auto-refresh layer when socket reconnects. Ensure no speculative updates; rely on server payload.

## Phase 4 – Session Glue & Context Providers
- **CTX-030 – GameSession ↔ map bridge**  
  Extend `GameSessionContext` to expose active campaign ID + session for map fetches. Provide hook that resolves player visibility radius (from server settings) and passes to map controls. Remove any residual placeholder location data.
- **CTX-031 – Auth & error handling**  
  Ensure API client automatically attaches auth tokens and propagates 401/403 to UI. Force logout on 401 to comply with honest failure policy.

## Phase 5 – QA, Instrumentation, Documentation
- **QA-040 – Automated tests**  
  Add integration tests for movement endpoint, visibility filtering, and GeoJSON shape. Extend front-end e2e to move a player as DM and verify map updates. All tests run against live Postgres/PostGIS (no mocks). Update `lint_report.md` entries for touched files.
- **QA-041 – Observability**  
  Add structured logs for movement events, include geo coordinates. Hook into existing monitoring (docs/LLM_MONITORING.md if applicable) for anomaly alerts.
- **DOC-050 – Documentation updates**  
  Update README mapping section, API docs, and create a runbook for player token troubleshooting. Log completed slices in `clearance_and_connect_tasks_documentation.md` with evidence.
- **DOC-051 – Agent compliance checklist**  
  Before merge, audit touched files for dummy remnants, confirm `.env` instructions mention required SRID and migration steps, and record lint/test commands executed.

---

**Dependencies & Coordination**
- Collaborate with backend team on rate limiting and spawn defaults.  
- Notify AI DM owners about new movement event payloads for narrative triggers.

**Done Definition (per task)**
- No mocks or placeholder data.  
- API responses verified against live database.  
- Errors surfaced to UI and logged.  
- Tests + lint recorded in `lint_report.md`.  
- Progress documented in `clearance_and_connect_tasks_documentation.md`.
