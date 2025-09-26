# Database Layer Reference

This document tracks the authoritative structure for the Questables database layer across the server and frontend clients. Every cleanup task must update the relevant sections to reflect the live architecture, keeping parity with the Zero-Dummy Policy and the Questables Agent Charter.

## Module Overview

| Area | Current Status | Owner Notes |
| --- | --- | --- |
| Server bootstrap & configuration | Blueprint defined | Split into `server/config/env.js`, `server/config/tls.js`, and `server/app/bootstrap.js` responsible for Express creation, middleware registration, and server wiring without feature logic. |
| PostgreSQL pool & transaction helpers | Implemented | `server/db/pool.js` owns pool config plus `getClient`, `withClient`, and `withTransaction` helpers with telemetry/log wrappers; modules consume these instead of `pool.connect()`. |
| Shared middleware & validators | Blueprint defined | `server/middleware/` (logging, rate limits, CORS, auth guards, uploads, cache) and `server/validation/` (campaign, character, chat, common schemas) house reusable request guards. |
| Domain services (campaigns, characters, maps, etc.) | In progress | Campaign utilities and movement helpers moved to `server/services/campaigns/`; remaining domains still pending extraction. |
| HTTP API routers | In progress | Characters and campaigns registered via `server/routes/*.routes.js`; chat scaffolding added. Remaining feature areas still awaiting extraction. |
| WebSocket integration | Blueprint aligned | `server/realtime/` consumes domain services for push updates; initialization occurs in `server/app/server.js` after Express bootstrap. |
| Frontend database client | Implemented | `utils/api-client.ts` centralises authenticated fetch/retry logic; domain adapters in `utils/api/{auth,users,characters,maps}.ts` consume REST routers exclusively. |
| Frontend data mappers/helpers | Implemented | Domain adapters expose dedicated mapping helpers (e.g., `mapUserFromServer`, `mapCharacterFromServer`) alongside request builders, replacing the legacy `data-helpers.tsx` / `production-helpers.tsx` modules. |


## Router Extraction Progress

| Domain | Router File | Service Module(s) | Status | Notes |
| --- | --- | --- | --- | --- |
| Characters | `server/routes/characters.routes.js` | n/a (DB helpers only) | Done | Routes registered via `registerCharacterRoutes(app)` |
| Campaigns | `server/routes/campaigns.routes.js` | `server/services/campaigns/*` | Done | Router + services fully extracted; residual validation polish tracked elsewhere |
| Chat | `server/routes/chat.routes.js` | `server/services/chat/service.js` | Done | Chat message CRUD/deletion handled via service helpers; realtime wiring tracked outside DB-03 |
| Narratives | `server/routes/narratives.routes.js` | `server/services/narratives/service.js` | Done | Narrative endpoints rely on shared service for LLM orchestration + persistence |
| Maps & World Data | `server/routes/maps.routes.js` | `server/services/maps/service.js` | Done | Router delegates spatial queries to service helpers; schema docs refreshed |
| Sessions | `server/routes/sessions.routes.js` | `server/services/sessions/service.js` | Done | Session flows run through service helpers with shared validation |
| Encounters | `server/routes/encounters.routes.js` | `server/services/encounters/service.js` | Done | Encounter CRUD/initiative backed by services; telemetry consolidated |
| NPCs | `server/routes/npcs.routes.js` | `server/services/npcs/service.js` | Done | NPC CRUD, sentiment, and relationships consume service helpers |
| Uploads / Assets | `server/routes/uploads.routes.js` | `server/services/uploads/service.js` | Done | Upload endpoints use upload/map services; storage follow-up documented separately |
| Users | `server/routes/users.routes.js` | `server/services/users/service.js` | Done | Authenticated profile fetch/update endpoints replace direct client SQL access |

## Target Architecture Blueprint

### Server Layer
- **Configuration**: `server/config/env.js` loads `.env.local` / `.env` variants; `server/config/tls.js` resolves TLS assets and metadata. Both modules log via `utils/logger` and never suppress failures silently.
- **Application Bootstrap**: `server/app/bootstrap.js` builds the Express instance, attaches global middleware (request logging, JSON body parsing, rate limiting), and injects dependencies (pool, telemetry, websocket registry) into `app.locals`.
- **Database Access**: `server/db/pool.js` initializes the `pg` Pool, registers instrumentation hooks, and exports `query`, `withClient`, and `withTransaction`. All route/service code must use these helpers to guarantee release-on-error semantics and consistent logging through `logDatabaseOperation`.
- **Shared Middleware & Validation**: `server/middleware/` hosts reusable Express middleware (auth, rate limiting, uploads, cache), while `server/validation/` centralizes express-validator chains and custom sanitizers. No domain file redefines these guards.
- **Domain Services**: Each domain module (`campaigns`, `characters`, `chat`, `maps`, `sessions`, `encounters`, `npcs`, `uploads`, `users`, `analytics`, `health`) contains:
  - `service.js` (business logic + SQL via helpers)
  - optional `transformers.js` for payload shaping
  - unit tests hitting a live DB where feasible.
  Services accept explicit context (user/session) and surface structured errors for honest UI feedback.
- **HTTP Routers**: Domain routers under `server/routes/` import services + middleware. `server/routes/index.js` mounts them on `/api/...`, while `server/app/server.js` creates the HTTP/HTTPS server, attaches Socket.IO, and registers graceful shutdown handlers. `/api/users/*` now serves profile fetch/update flows, and the maps router exposes `/tilesets` + `/cells` listings so the client no longer touches `/api/database/spatial/*` directly.
- **Realtime Integration**: `server/realtime/` modules subscribe to service events or database notifications, broadcasting via Socket.IO and respecting authentication. WebSocket health endpoints reuse shared telemetry metrics.

### Frontend Layer
- **HTTP Client Wrapper**: `utils/api-client.ts` resolves `VITE_DATABASE_SERVER_URL`, manages auth headers/tokens, enforces timeouts + exponential backoff, and surfaces typed errors via `HttpError`. It never issues raw SQL requests.
- **Shared Mappers**: Domain adapters expose `map*FromServer` helpers (e.g., `utils/api/users.ts`, `utils/api/characters.ts`) that normalise roles, JSON columns, and camelCase↔snake_case keys, replacing the removed `data-helpers.tsx` / `production-helpers.tsx` modules.
- **Domain Adapters**: Each adapter (`utils/api/auth.ts`, `utils/api/users.ts`, `utils/api/characters.ts`, `utils/api/maps.ts`, etc.) wraps REST endpoints, applies shared mapping helpers, and documents request/response schemas inline with `API_DOCUMENTATION.md`. Adapters forward telemetry context where required and never fabricate placeholder data.
- **Data Structures**: `utils/database/data-structures.tsx` remains the single source of TypeScript interfaces; redundant helpers are removed once domain adapters land.

## Conventions

- All modules must avoid dummy data, mock fallbacks, or unauthenticated shortcuts.
- SRID for geom fields remains `0` for all spatial helpers.
- Logger utilities replace direct `console.*` use in shared code.
- Any new helper must document request/response contracts here and in `API_DOCUMENTATION.md`.

## Update Checklist

When completing a cleanup task:
1. Update the relevant rows in the table above (status, notes).
2. Record API surface changes or new helpers in the appropriate sections.
3. Link to supporting docs (e.g., `API_DOCUMENTATION.md`, `schema.sql`, `clearance_and_connect_tasks_documentation.md`) if they changed.
4. Confirm linting results are captured in `lint_report.md` for touched files.
