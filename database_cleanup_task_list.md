# Database Cleanup Task List

All work must obey the Questables Agent Charter and Zero-Dummy Policy. Every task below requires an accompanying update to `docs/database_layer_reference.md`, as well as a status refresh in this file when the task moves forward.

| Task ID | Description | Key Dependencies | Required Outputs | Status |
| --- | --- | --- | --- | --- |
| DB-01 | Draft the target database layer blueprint: document the planned module boundaries for server bootstrap, pool helpers, feature services, and client adapters. | Complete review of `server/database-server.js` and `utils/database/*`. | Updated sections in `docs/database_layer_reference.md` capturing the agreed module map; entry added to `clearance_and_connect_tasks_documentation.md`. | Done |
| DB-02 | Implement dedicated pool/transaction helpers and remove direct `pool.connect()` usage from routes. Ensure leak-safe patterns and logger integration. | DB-01 | Updated `docs/database_layer_reference.md` noting new helpers; refactored server modules with lint results recorded in `lint_report.md`; API docs amended if signatures shift. | Done |
| DB-03 | Carve the monolithic endpoints into feature routers (campaigns, characters, chat, maps, sessions, encounters, NPCs, uploads) backed by shared services. Replace console logging with structured loggers and enforce honest error surfacing. | DB-01, DB-02 | `docs/database_layer_reference.md` table rows updated per feature area; `API_DOCUMENTATION.md` and `schema.sql` adjusted; new router summaries in `clearance_and_connect_tasks_documentation.md`. | Done |
| DB-04 | Decommission `/api/database/query` and `/api/database/spatial/*` passthrough endpoints. Replace frontend usage with typed client adapters that call the new feature routers, consolidating `client.tsx`, `data-helpers.tsx`, and `production-helpers.tsx` into a single source of truth. | DB-01, DB-03 | `docs/database_layer_reference.md` updated to reflect REST-only access; helper consolidation documented; UI call sites transitioned with no dummy fallbacks; lint + tests logged. | Done |
| DB-05 | Finalize telemetry, docs, and verification: ensure logger, metrics, and WebSocket integrations align with the refactored services; backfill documentation and lint/test logs. | DB-01–DB-04 | `docs/database_layer_reference.md` marked as current; `API_DOCUMENTATION.md`, `schema.sql`, and `clearance_and_connect_tasks_documentation.md` contain evidence; `lint_report.md` updated post-run. | Not Started |

## DB-03 Progress Notes

- Extracted maps, sessions, encounters, NPCs, and upload endpoints into dedicated routers (`server/routes/{maps,sessions,encounters,npcs,uploads}.routes.js`) with shared helpers. Main server now registers these routers via `register*Routes` and delegates multer setup through `registerUploadRoutes`.
- Added `server/services/maps/service.js` so map/world/location routes call shared query helpers instead of embedding SQL inside the router.
- Migrated chat message endpoints onto `server/services/chat/service.js`, removing inline SQL and centralising deletion/authorization checks.
- Introduced `server/services/narratives/service.js` and rewired `server/routes/narratives.routes.js` to centralise LLM orchestration, campaign validation, and persistence for the narrative endpoints.
- Added `server/services/npcs/service.js` and `server/services/uploads/service.js`, eliminating the remaining router-level SQL for NPC CRUD/sentiment and campaign asset uploads.

## Task Status Protocol

1. Change the `Status` column to `In Progress`, `Blocked`, or `Done` as work advances.
2. After each change, capture the same status update in this file’s git history and ensure `docs/database_layer_reference.md` stays in sync.
3. Record blockers immediately instead of introducing temporary workarounds or dummy data.
