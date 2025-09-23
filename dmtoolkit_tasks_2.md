# DM Toolkit Integration — Sequential Tasks (Wave 2)

All tasks below must be executed in order. Each task explicitly references the live PostgreSQL instance using the credentials in `.env.local`, enforces the Questables Agent Charter in `AGENTS.md`, and requires an evidence entry in `clearance_and_connect_tasks_documentation.md` when the work is completed. Do not introduce dummy data or mock fallbacks at any point.

**Recurring Requirements (apply to every task):**
- Update `database/schema.sql` directly for any schema adjustments—no migration files are permitted. Note the review outcome (even if "no change") in the task log.
- Audit the current implementation in `server/database-server.js` and the live entries in `API_DOCUMENTATION.md` before coding, then update `API_DOCUMENTATION.md` to reflect the verified contract after the slice ships.
- Record the lint command(s) for touched files in `lint_report.md` and document the slice in `clearance_and_connect_tasks_documentation.md` with verifiable evidence.
- Surface backend errors honestly and purge any dummy fixtures encountered while completing the task.

1. **Environment Verification & Charter Alignment**
   - **Actions:** Load the environment variables from `.env.local`, connect to the local PostgreSQL instance on the configured host/port via `psql`, run `SELECT version();` and `SELECT PostGIS_Full_Version();`, and capture the outputs (without leaking secrets) in `docs/dmtoolkit_environment_check.md` alongside an acknowledgment of the zero-dummy policy from `AGENTS.md`.
   - **Deliverables:** `docs/dmtoolkit_environment_check.md` summarizing the live DB check; updated `clearance_and_connect_tasks_documentation.md` entry for the verification.
   - **Done When:** Connection succeeds, PostGIS is confirmed, and the documentation reflects the verified environment details with no secrets exposed.

2. **Schema Gap Analysis Blueprint**
   - **Actions:** Diff the DM Toolkit requirements (`dmtoolkit.md`, `dmtoolkit.yaml`) against the canonical schema in `database/schema.sql`, confirm the live tables via `psql \d`, and cross-check the current handlers in `server/database-server.js` plus their entries in `API_DOCUMENTATION.md`. Document every discrepancy—including the missing `(dm_user_id, lower(name))` unique index, `campaign_spawns` column mismatches (`description` vs `note`), absent `campaign_objectives`, and missing `sessions.dm_focus`/`dm_context_md`—in `docs/dmtoolkit_schema_gaps.md`, with proposed resolution notes for each item and whether the fix belongs in `database/schema.sql`, the API layer, or both.
   - **Deliverables:** `docs/dmtoolkit_schema_gaps.md` detailing all schema and API deltas, the exact `database/schema.sql` changes required (no migrations), and the sequence they must be addressed in; clearance log update summarizing findings.
   - **Done When:** Every schema/API change required by the DM Toolkit spec is enumerated with remediation guidance, direct references to the lines that must change in `database/schema.sql`, and no unresolved unknowns remain.

3. **Schema.sql Authoring & Verification**
   - **Actions:** Apply the DM Toolkit schema additions directly to `database/schema.sql`: add the `(dm_user_id, lower(name))` unique index, align `campaign_spawns` columns with the spec (`note`, SRID 0 point, default flags), create `campaign_objectives` with the tree/location fields and spatial indexes, and append `dm_focus`/`dm_context_md` to `sessions`. Run the file against an empty database (`psql -f database/schema.sql`) to confirm it succeeds without relying on migrations and update any helper triggers or indexes uncovered during the run.
   - **Deliverables:** Updated `database/schema.sql` reflecting the new objects with inline comments referencing `dmtoolkit.md`, recorded validation steps/output (scrubbed of secrets) in `docs/dmtoolkit_schema_gaps.md` or a linked appendix, and the standard clearance/API/lint updates.
   - **Done When:** The canonical schema file can initialize an empty database with all DM Toolkit structures in place, spatial indexes use SRID 0, and the verification run plus documentation updates are complete.


8. **Campaign API Hardening & Constraint Handling**
   - **Actions:** Audit the existing campaign endpoints in `server/database-server.js` and `API_DOCUMENTATION.md`, then update the handlers to: (a) rely on `req.user.id` for `dm_user_id`, (b) validate `max_players` (1–20) and `level_range` bounds server-side, (c) surface a 409 with structured JSON when the unique-name constraint is hit, (d) remove placeholder defaults for `system`/`setting` unless explicitly provided, and (e) ensure every branch logs via the shared logger utilities. Add input validation updates where appropriate and adjust any TypeScript/shared model definitions.
   - **Deliverables:** Patched `server/database-server.js`, updated validation helpers (e.g., `utils/validation`), refreshed TypeScript interfaces, updated `API_DOCUMENTATION.md` entries reflecting the hardened behavior, `lint_report.md` entry for touched files, and clearance log describing the behavioral changes.
   - **Done When:** Campaign create/update requests enforce the new rules against the live database, automated/server tests cover the error paths, lint passes on modified files, and the API documentation matches the shipped contract.

9. **Spawn Endpoint Realignment**
   - **Actions:** Confirm `database/schema.sql` reflects the authoritative spawn schema, audit the current spawn handlers in `server/database-server.js`/`API_DOCUMENTATION.md`, then replace the REST handlers with the DM Toolkit contract (`PUT /api/campaigns/:campaignId/spawn` for upsert) while preserving historical list endpoints as needed. Ensure responses include `note` and GeoJSON coordinates, enforce SRID 0 on writes, and restrict access to DMs/co-DMs via `requireCampaignOwnership`. Update WebSocket broadcasts (if used) to emit the new payload shape.
   - **Deliverables:** Updated spawn route definitions in `server/database-server.js`, revised helper utilities, associated TypeScript/client typings, `API_DOCUMENTATION.md` endpoint entry, lint report addition, and clearance log notes.
   - **Done When:** Spawn upsert flows succeed end-to-end against the live DB, non-DM access is blocked with 403, and documentation/tests cover the new behavior.

10. **Objective Domain Utilities**
   - **Actions:** Audit existing objective-related validation (if any) inside `server/database-server.js`, then introduce reusable helpers (e.g., `server/objectives/objective-validation.js`) that enforce the single-location rule, markdown field sanitation, and tree constraints. Include unit tests using the live database testing harness where possible and note their contracts in the API doc for future consumers.
   - **Deliverables:** New validation module with tests, documented validation expectations added to `API_DOCUMENTATION.md` (or a linked developer note referenced there), lint report updates, and clearance documentation explaining the helper coverage.
   - **Done When:** Helpers are exported and ready for use by the upcoming objective endpoints, tests prove they reject invalid payloads, and the API/clearance documentation reflects the validated constraints.

11. **Objective CRUD Endpoints**
   - **Actions:** Ensure `database/schema.sql` contains the required objective tables/indexes, then implement the endpoints defined in `dmtoolkit.md` (`POST/GET /api/campaigns/:campaignId/objectives`, `PUT/DELETE /api/objectives/:objectiveId`) using transactions, the validation utilities, and full permission checks. Ensure tree reorder operations update `order_index`, and deletes cascade to children via SQL or explicit logic. Return consistent JSON payloads with markdown fields and location metadata.
   - **Deliverables:** Route handlers, accompanying SQL queries, Supertest coverage in `tests/server/objectives.test.ts`, API docs updates, lint report entry, and clearance log update.
   - **Done When:** All objective operations work against the live DB, tests cover success/failure paths, and API docs mirror the final contract.

12. **Objective LLM Assist Routes**
   - **Actions:** Add the five assist endpoints, wiring them to the existing LLM service (`server/llm`). Persist LLM outputs to the appropriate storage (e.g., `llm_narratives`) and update the objective record atomically. Implement rate limiting/error propagation consistent with the charter and log each call. Provide integration tests that hit the LLM service in a controlled manner or document any dependency blockers honestly.
   - **Deliverables:** New routes, LLM service adjustments if required, tests or documented blockers, API documentation updates, lint report line, and clearance log notes.
   - **Done When:** Assist buttons can fetch real completions without mock data, errors bubble to the client, and documentation covers request/response formats.

13. **DM Sidebar Endpoint Suite**
   - **Actions:** Implement/align endpoints for session focus/context updates, unplanned encounters, NPC sentiment adjustments, and teleport actions exactly as specified. Ensure teleport writes to `campaign_players.loc_current` and `player_movement_audit` within a transaction, and that sentiment/encounter routes validate campaign ownership. Update or replace existing endpoints so routes match the new URLs without leaving dead code.
   - **Deliverables:** Updated route handlers, supporting SQL, tests for each action, API documentation entries, lint report updates, and clearance log coverage.
   - **Done When:** A DM can drive all sidebar actions against the live backend with correct auditing, and API docs/tests confirm permission enforcement.

14. **Realtime & Logging Hooks**
   - **Actions:** Extend `server/websocket-server.js` (or polling fallbacks) to broadcast spawn/objective/sidebar changes. Add structured log statements for each critical action (create/update/delete) using the shared logger. Ensure logs include campaign/objective IDs without exposing private narrative text. Update monitoring/alerting configuration if applicable.
   - **Deliverables:** WebSocket/polling updates, logger calls, documentation of event types in `API_DOCUMENTATION.md` or a new ops note, lint report entry, and clearance log summary.
   - **Done When:** Realtime updates work locally, logs show the new events, and monitoring expectations are documented.

15. **API Client Expansion**
   - **Actions:** Audit the existing client methods that call campaign-adjacent routes, then add typed client methods in `utils/api-client.ts` (and any related hooks) covering the new campaign, spawn, objective, assist, and sidebar endpoints. Ensure they attach auth headers, respect abort signals, and raise errors transparently. Update shared TypeScript types to mirror backend payloads and sync the public request/response shapes with `API_DOCUMENTATION.md`.
   - **Deliverables:** Updated client utilities, TypeScript definitions, refreshed `API_DOCUMENTATION.md` examples where payloads changed or were newly exposed to clients, lint report updates, and clearance log entry.
   - **Done When:** Frontend code can call the new endpoints through shared helpers with TypeScript support, lint passes, and the API docs show the verified client contract.

16. **Campaign CRUD UI Enhancements**
   - **Actions:** Update the campaign create/edit flows (e.g., `components/campaign-manager.tsx`) to include world map selection, max player & level range validation, public toggle, and honest error states sourced from the backend. Remove any hardcoded defaults conflicting with the charter and confirm the UI messaging matches the contracts documented in `API_DOCUMENTATION.md`. Add form tests via React Testing Library.
   - **Deliverables:** Updated components, tests, lint report additions, user-facing copy adjustments, and clearance documentation that links to the confirmed API contract (updating `API_DOCUMENTATION.md` if new error cases are surfaced).
   - **Done When:** UI forms reflect the live schema, surface backend validation errors in parity with the documented responses, and tests cover validation scenarios.

17. **Campaign Prep Map & Spawn Tooling**
   - **Actions:** Build or enhance a campaign prep view that renders the selected world map via OpenLayers, allows DM-only spawn placement/editing via the new API, and displays the persisted spawn pin. Ensure geometry is read from the live API, reference the documented spawn contract in `API_DOCUMENTATION.md`, and remove any local mock state.
   - **Deliverables:** Prep view components, map integration updates, tests/mocks aligned with the live API, lint report line, and clearance log notes that cite the verified spawn contract (updating `API_DOCUMENTATION.md` if UI feedback reveals missing details).
   - **Done When:** Spawn placement works end-to-end in the UI using the real backend, the documented API contract matches the final payloads, and loading/error/empty states are handled gracefully.

18. **Objectives Panel & Tree Management**
   - **Actions:** Implement the objectives sidebar/panel with single and multi-objective creation, tree visualization (drag/drop reordering persisted to `order_index`), markdown editors for all content fields, and location selectors tied to live map/burg/marker data. Hook all operations to the real endpoints, reference the documented request/response shapes in `API_DOCUMENTATION.md`, and present honest error feedback.
   - **Deliverables:** UI components, supporting hooks, drag/drop integration, tests, lint report update, and clearance documentation that records any API documentation updates triggered by new UI requirements.
   - **Done When:** Objectives can be created, reordered, edited, and deleted through the UI against the live backend with no placeholder data, and `API_DOCUMENTATION.md` reflects the exact payloads consumed by the UI.

19. **LLM Assist UI Integration**
   - **Actions:** Wire assist buttons in the objectives UI to the live assist endpoints, showing pending states, throttling feedback, and injecting responses into the appropriate markdown fields only after the backend confirms success. Reference the assist contracts in `API_DOCUMENTATION.md`, feed real errors back to the UI, and log assist usage in the UI analytics pipeline if present.
   - **Deliverables:** Updated UI logic, UX copy for errors/throttling, tests covering success/failure, lint report entry, and clearance log update that links to any adjustments made in `API_DOCUMENTATION.md`.
   - **Done When:** LLM-assisted drafting works via the real backend with clear user feedback on success or failure, and the API documentation mirrors the observed request/response cycle.

20. **DM Sidebar Interface**
   - **Actions:** Extend or create the DM Sidebar component to capture focus/context updates, unplanned encounters, NPC sentiment adjustments, and teleport controls. Ensure every control calls the real API client methods, handles optimistic vs confirmed updates carefully, and displays audit feedback where relevant while matching the contracts in `API_DOCUMENTATION.md`.
   - **Deliverables:** Sidebar components, state management updates, tests, lint report entry, and clearance log notes that cite any API documentation revisions required by the new UI flows.
   - **Done When:** A DM can manage session state through the sidebar in the UI with all actions reflected in the backend, UI states kept in sync, and the documented API contract covering each sidebar action.

23. **Telemetry, Logging, and Monitoring Updates**
   - **Actions:** Ensure all new backend actions emit structured logs and, if observability tooling exists, metrics/events for campaign/objective/sidebar interactions. Update operations documentation (e.g., `docs/monitoring.md`) to reflect new signals and alert thresholds.
   - **Deliverables:** Logger/telemetry code updates, documentation of new metrics/events, lint report update, and clearance log notes.
   - **Done When:** Key flows are observable in logs/metrics, and ops documentation explains how to monitor them.
