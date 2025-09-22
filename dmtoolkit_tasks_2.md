# DM Toolkit Integration — Sequential Tasks (Wave 2)

All tasks below must be executed in order. Each task explicitly references the live PostgreSQL instance using the credentials in `.env.local`, enforces the Questables Agent Charter in `AGENTS.md`, and requires an evidence entry in `clearance_and_connect_tasks_documentation.md` when the work is completed. Do not introduce dummy data or mock fallbacks at any point.

1. **Environment Verification & Charter Alignment**
   - **Actions:** Load the environment variables from `.env.local`, connect to the local PostgreSQL instance on the configured host/port via `psql`, run `SELECT version();` and `SELECT PostGIS_Full_Version();`, and capture the outputs (without leaking secrets) in `docs/dmtoolkit_environment_check.md` alongside an acknowledgment of the zero-dummy policy from `AGENTS.md`.
   - **Deliverables:** `docs/dmtoolkit_environment_check.md` summarizing the live DB check; updated `clearance_and_connect_tasks_documentation.md` entry for the verification.
   - **Done When:** Connection succeeds, PostGIS is confirmed, and the documentation reflects the verified environment details with no secrets exposed.

2. **Schema Gap Analysis Blueprint**
   - **Actions:** Diff the DM Toolkit requirements (`dmtoolkit.md`, `dmtoolkit.yaml`) against the current canonical schema in `database/schema.sql` and the live tables (using `psql \d` introspection). Document every discrepancy—including the missing `(dm_user_id, lower(name))` unique index, `campaign_spawns` column mismatches (`description` vs `note`), absent `campaign_objectives`, and missing `sessions.dm_focus`/`dm_context_md`—in `docs/dmtoolkit_schema_gaps.md`, with proposed resolution notes for each item.
   - **Deliverables:** `docs/dmtoolkit_schema_gaps.md` detailing all schema deltas plus the order they must be addressed; clearance log update summarizing findings.
   - **Done When:** Every schema change required by the DM Toolkit spec is enumerated with remediation guidance and no unresolved unknowns remain.

3. **Migration Framework & Guardrails**
   - **Actions:** Establish a migrations directory under `database/migrations/`, author a README section in `DATABASE_SETUP.md` that explains how to apply migrations against the live PostgreSQL instance, and create template scripts for running `psql` with credentials from `.env.local`. Ensure the framework supports paired up/down sections and records applied migrations (e.g., via a `migrations_log` table if one does not already exist).
   - **Deliverables:** `database/migrations/` (with initial README or template migration), updated `DATABASE_SETUP.md`, and, if needed, a new migration bookkeeping table definition in `database/schema.sql`; clearance log entry describing the migration process now available.
   - **Done When:** Engineers can run a documented command to apply/rollback migrations safely against the local DB, and the schema documentation reflects the framework.

4. **DM Toolkit Migration — Campaign Constraints & Session Columns**
   - **Actions:** Write a concrete migration file (e.g., `database/migrations/2025XXXX_dmtoolkit_core.sql`) that adds the unique index on `(dm_user_id, lower(name))`, introduces `dm_focus TEXT` and `dm_context_md TEXT` to `public.sessions`, and updates `database/schema.sql` accordingly. Before applying, query for conflicting campaign names and document any blockers in the clearance log. Provide a rollback section that drops the index and columns.
   - **Deliverables:** Migration SQL file with explicit up/down statements, updated `database/schema.sql`, and clearance log entry noting duplicate-name validation results.
   - **Done When:** Migration applies cleanly on the local database, `schema.sql` mirrors the new structure, and rollback has been tested on a disposable database.

5. **DM Toolkit Migration — Campaign Spawns Alignment**
   - **Actions:** Extend the migration to rename `public.campaign_spawns.description` to `note`, enforce `name TEXT NOT NULL DEFAULT 'Default Spawn'`, maintain the `is_default` uniqueness constraint, add a `CHECK (ST_SRID(world_position) = 0)` safeguard, and backfill existing rows to keep data consistent. Update `schema.sql` to match, and verify live data via `SELECT` statements.
   - **Deliverables:** Migration additions covering the spawn changes, updated `database/schema.sql`, and clearance log entry summarizing data backfill results.
   - **Done When:** Table columns reflect the new naming/constraints, existing spawn rows remain valid, and PostGIS SRID enforcement is confirmed.

6. **DM Toolkit Migration — Campaign Objectives Table**
   - **Actions:** In the same migration file, create `public.campaign_objectives` exactly as specified (UUID PK, `parent_id`, location union fields, markdown columns, `order_index`, timestamps, SRID 0 enforcement for `location_pin`, and supporting indexes). Implement a `CHECK` constraint or trigger ensuring only one location field is populated and matches `location_type`. Update `schema.sql` to include the DDL plus comment on the constraint logic.
   - **Deliverables:** New table definition within the migration and `schema.sql`, plus clearance documentation noting constraint coverage.
   - **Done When:** The table exists in the local DB with all constraints/indexes verified via `psql \d+ public.campaign_objectives` and sample inserts confirming validation.

7. **Migration Smoke Test & Schema Documentation Sync**
   - **Actions:** Apply the full migration sequence on a fresh local database, record the output, and update `DATABASE_SETUP.md` with the exact commands (including rollback instructions). Ensure `API_DOCUMENTATION.md` references the new schema elements where relevant. Capture the test results in `docs/dmtoolkit_environment_check.md` or an addendum.
   - **Deliverables:** Updated `DATABASE_SETUP.md`, amended `API_DOCUMENTATION.md` schema notes, and clearance log entry referencing the successful migration test run.
   - **Done When:** Migration/rollback scripts execute without errors on a clean database, and all documentation mirrors the live structure.

8. **Campaign API Hardening & Constraint Handling**
   - **Actions:** Update `server/database-server.js` campaign handlers to: (a) rely on `req.user.id` for `dm_user_id`, (b) validate `max_players` (1–20) and `level_range` bounds server-side, (c) surface a 409 with structured JSON when the unique-name constraint is hit, (d) remove placeholder defaults for `system`/`setting` unless explicitly provided, and (e) ensure every branch logs via the shared logger utilities. Add input validation updates where appropriate and adjust any TypeScript/shared model definitions.
   - **Deliverables:** Patched `server/database-server.js`, updated validation helpers (e.g., `utils/validation`), refreshed TypeScript interfaces, `lint_report.md` entry for touched files, and clearance log describing the behavioral changes.
   - **Done When:** Campaign create/update requests enforce the new rules, automated/server tests cover the error paths, and lint passes on modified files.

9. **Spawn Endpoint Realignment**
   - **Actions:** Replace the existing spawn REST handlers with the DM Toolkit contract (`PUT /api/campaigns/:campaignId/spawn` for upsert) while preserving historical list endpoints as needed. Ensure responses include `note` and GeoJSON coordinates, enforce SRID 0 on writes, and restrict access to DMs/co-DMs via `requireCampaignOwnership`. Update WebSocket broadcasts (if used) to emit the new payload shape.
   - **Deliverables:** Updated spawn route definitions in `server/database-server.js`, revised helper utilities, associated TypeScript/client typings, `API_DOCUMENTATION.md` endpoint entry, lint report addition, and clearance log notes.
   - **Done When:** Spawn upsert flows succeed end-to-end against the live DB, non-DM access is blocked with 403, and documentation/tests cover the new behavior.

10. **Objective Domain Utilities**
   - **Actions:** Introduce reusable validation helpers (e.g., `server/objectives/objective-validation.js`) that enforce the single-location rule, markdown field sanitation, and tree constraints. Include unit tests using the live database testing harness where possible.
   - **Deliverables:** New validation module with tests, lint report updates, and clearance documentation explaining the helper coverage.
   - **Done When:** Helpers are exported and ready for use by the upcoming objective endpoints, with tests proving they reject invalid payloads.

11. **Objective CRUD Endpoints**
   - **Actions:** Implement the endpoints defined in `dmtoolkit.md` (`POST/GET /api/campaigns/:campaignId/objectives`, `PUT/DELETE /api/objectives/:objectiveId`) using transactions, the validation utilities, and full permission checks. Ensure tree reorder operations update `order_index`, and deletes cascade to children via SQL or explicit logic. Return consistent JSON payloads with markdown fields and location metadata.
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
   - **Actions:** Add typed client methods in `utils/api-client.ts` (and any related hooks) covering the new campaign, spawn, objective, assist, and sidebar endpoints. Ensure they attach auth headers, respect abort signals, and raise errors transparently. Update shared TypeScript types to mirror backend payloads.
   - **Deliverables:** Updated client utilities, TypeScript definitions, lint report updates, and clearance log entry.
   - **Done When:** Frontend code can call the new endpoints through shared helpers with TypeScript support and lint passes.

16. **Campaign CRUD UI Enhancements**
   - **Actions:** Update the campaign create/edit flows (e.g., `components/campaign-manager.tsx`) to include world map selection, max player & level range validation, public toggle, and honest error states sourced from the backend. Remove any hardcoded defaults conflicting with the charter. Add form tests via React Testing Library.
   - **Deliverables:** Updated components, tests, lint report additions, user-facing copy adjustments, and clearance documentation.
   - **Done When:** UI forms reflect the live schema, surface backend validation errors, and tests cover validation scenarios.

17. **Campaign Prep Map & Spawn Tooling**
   - **Actions:** Build or enhance a campaign prep view that renders the selected world map via OpenLayers, allows DM-only spawn placement/editing via the new API, and displays the persisted spawn pin. Ensure geometry is read from the live API and no local mock state remains.
   - **Deliverables:** Prep view components, map integration updates, tests/mocks aligned with live API, lint report line, and clearance log notes.
   - **Done When:** Spawn placement works end-to-end in the UI using the real backend, with loading/error/empty states handled gracefully.

18. **Objectives Panel & Tree Management**
   - **Actions:** Implement the objectives sidebar/panel with single and multi-objective creation, tree visualization (drag/drop reordering persisted to `order_index`), markdown editors for all content fields, and location selectors tied to live map/burg/marker data. Hook all operations to the real endpoints and present honest error feedback.
   - **Deliverables:** UI components, supporting hooks, drag/drop integration, tests, lint report update, and clearance documentation.
   - **Done When:** Objectives can be created, reordered, edited, and deleted through the UI against the live backend with no placeholder data.

19. **LLM Assist UI Integration**
   - **Actions:** Wire assist buttons in the objectives UI to the live assist endpoints, showing pending states, throttling feedback, and injecting responses into the appropriate markdown fields only after the backend confirms success. Log assist usage in the UI analytics pipeline if present.
   - **Deliverables:** Updated UI logic, UX copy for errors/throttling, tests covering success/failure, lint report entry, and clearance log update.
   - **Done When:** LLM-assisted drafting works via the real backend with clear user feedback on success or failure.

20. **DM Sidebar Interface**
   - **Actions:** Extend or create the DM Sidebar component to capture focus/context updates, unplanned encounters, NPC sentiment adjustments, and teleport controls. Ensure every control calls the real API client methods, handles optimistic vs confirmed updates carefully, and displays audit feedback where relevant.
   - **Deliverables:** Sidebar components, state management updates, tests, lint report entry, and clearance log notes.
   - **Done When:** A DM can manage session state through the sidebar in the UI with all actions reflected in the backend and UI states kept in sync.

21. **Backend Regression & Integration Tests**
   - **Actions:** Add Supertest suites covering the new campaign, spawn, objective, assist, and sidebar endpoints, running against a seeded PostgreSQL instance (no mocks). Include failure cases (permission denied, invalid payloads, SRID violations). Document test setup in `DATABASE_SETUP.md` if additional fixtures are required.
   - **Deliverables:** New tests in `tests/server/`, scripts in `package.json` if needed, lint report update, and clearance documentation summarizing coverage.
   - **Done When:** Tests pass locally, cover core success/failure paths, and are referenced in CI instructions.

22. **Frontend Testing & QA Harness**
   - **Actions:** Add React Testing Library (and Cypress/E2E if available) coverage for campaign forms, spawn interactions, objective tree flows, LLM assist UX, and sidebar operations. Replace any legacy mock servers with real API calls spun up in test mode or document unavoidable constraints transparently.
   - **Deliverables:** Test suites under `tests/frontend/` (or equivalent), updated test utilities, lint report entry, and clearance log update.
   - **Done When:** UI tests validate the critical DM Toolkit flows without relying on dummy data, and failures surface actionable messages.

23. **Telemetry, Logging, and Monitoring Updates**
   - **Actions:** Ensure all new backend actions emit structured logs and, if observability tooling exists, metrics/events for campaign/objective/sidebar interactions. Update operations documentation (e.g., `docs/monitoring.md`) to reflect new signals and alert thresholds.
   - **Deliverables:** Logger/telemetry code updates, documentation of new metrics/events, lint report update, and clearance log notes.
   - **Done When:** Key flows are observable in logs/metrics, and ops documentation explains how to monitor them.

24. **Documentation, Linting, and Release Checklist**
   - **Actions:** Update `README.md`, `API_DOCUMENTATION.md`, `DATABASE_SETUP.md`, and any onboarding docs with the DM Toolkit workflows, endpoints, environment variables, and migration steps. Run ESLint on all touched files (`npx eslint …`) and record the command/results in `lint_report.md`. Draft release notes capturing migrations, new env vars, and manual verification steps.
   - **Deliverables:** Documentation updates, `lint_report.md` entry, release checklist, and clearance log summary.
   - **Done When:** Docs are current, lint passes, release notes exist, and the clearance log links to the evidence.

25. **End-to-End Validation & Handoff**
   - **Actions:** Launch the full stack against the live local backend, execute the DM Toolkit flow (campaign creation, spawn placement, objective tree management, sidebar actions), validate persisted records via SQL queries, and capture screenshots/logs as evidence. Compile any residual risks/blockers and share them with stakeholders for sign-off.
   - **Deliverables:** Validation notes (e.g., appended to `docs/dmtoolkit_environment_check.md`), evidence assets, final clearance log entry, and stakeholder handoff summary.
   - **Done When:** Every DM Toolkit feature functions against the live backend without dummy data, evidence is archived, and outstanding risks are documented and communicated.

