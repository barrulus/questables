# Follow-up Tasks for Session Management

## 1. Wire Session Manager into DM Toolkit
- **Goal:** Replace the DM prep placeholder with the live `SessionManager` component so DMs can create/start/end sessions using real backend data.
- **Steps:**
  1. Identify the location in the DM interface (e.g., `components/dm-dashboard.tsx` or `components/campaign-prep.tsx`) where session controls belong.
  2. Fix the `SessionManager` state bug (`setSelectedSession` → `setSelectedSessionId`) and import the component into the chosen view.
  3. Ensure the UI is gated by DM/co-DM roles in line with `AGENTS.md` zero-dummy expectations.
  4. Update `API_DOCUMENTATION.md` if new user flows require additional context.
  5. Document the slice in `clearance_and_connect_tasks_documentation.md`. Include lint/test commands in `lint_report.md`.

## 2. Harden Session Endpoints
- **Goal:** Apply auth/role checks and validation to session CRUD endpoints so only authorized users can mutate session state.
- **Steps:**
  1. Wrap the create/update/participant routes in `requireAuth` and enforce DM/co-DM/Admin checks using `getViewerContextOrThrow`.
  2. Add payload validation (title, status transitions, participant input) before writing to Postgres.
  3. Update `API_DOCUMENTATION.md` to reflect required auth and validation errors.
  4. Cover new behavior with tests (Jest or integration) and record results per charter.
  5. Log the maintenance work and lint runs in the standard documentation files.

## 3. Implement Participant Management UI
- **Goal:** Provide add/remove and attendance controls in the session detail view so DMs can manage participants truthfully.
- **Steps:**
  1. Extend `SessionManager` to expose participant CRUD/attendance updates using live endpoints (`POST /api/sessions/:id/participants`, future PATCH/DELETE as needed).
  2. Surface honest errors and loading states; avoid placeholder text per `AGENTS.md`.
  3. Add tests covering participant manipulation.
  4. Document UI changes and API adjustments in `API_DOCUMENTATION.md` and the charter logs.

## 4. Emit Session Websocket Events
- **Goal:** Keep connected clients in sync without manual refresh by broadcasting session updates.
- **Steps:**
  1. Hook create/update/end flows to emit websocket events via `wsServer.emit...`.
  2. Subscribe interested front-end components (SessionManager, DM sidebar, narrative console) to update state.
  3. Update docs to describe the new realtime payloads.
  4. Capture verification steps in `clearance_and_connect_tasks_documentation.md` and lint/test output in `lint_report.md`.

## 5. Clean Up Legacy <think> Content
- **Goal:** Regenerate or sanitize existing objective markdown fields that still contain `<think>` tags.
- **Steps:**
  1. Write a one-off script or admin endpoint to find `description_md`/`treasure_md` etc. containing `<think>`.
  2. Strip or regenerate the content using the updated assist flow.
  3. Document the data cleanup process and outcomes in the clearance log.
  4. Note any lint/tests executed.

## 6. Prevent Health Check from Reinitialising Map (Completed)
- **Goal:** Ensure periodic `/api/health` polling doesn’t tear down and rebuild the map (currently triggered by `DatabaseProvider` re-renders).
- **Steps:**
  1. Decouple the `OpenLayersMap` mount effect from volatile dependencies—e.g., move initialization into a ref-driven effect that runs once and updates handlers via mutable refs.
  2. Verify that health status changes still surface in the UI without forcing map reinitialization.
  3. Add regression coverage (manual or automated) confirming the map doesn’t reload during health checks.
  4. Log the change and associated lint/tests per the charter requirements.
- **Status:** ✅ Addressed by MAP-06 refactor (2025-09-27); see `clearance_and_connect_tasks_documentation.md`.

## 7. Change Mapping Architecture (Deferred)
- **Goal:** Evaluate a non-OpenLayers mapping stack once we can retain our custom projection end-to-end.
- **Status:** Blocked. MapLibre GL JS + deck.gl cannot honour the Questables projection, so the client remains on OpenLayers.
- **Near-Term:** Continue investing in OpenLayers layers, fog, grids, and movement tooling so gameplay stays production-accurate while Tegola and movement persistence mature in the backend.
- **Deferred Tasks:** When a projection-compatible client is identified, revisit the MapLibre/deck.gl plan: stack Tegola tiles with precise layer ordering, deliver fog-of-war masks, render grids, and stream snap-to-grid movement history without introducing dummy data.

## 8. Re-enable Campaign Prep Tests (Deferred)
- **Goal:** Restore `tests/campaign-prep.test.tsx` with a stable live API harness that can create campaigns, seed spawn data, and authenticate deterministically.
- **Blocker:** Current backend flow requires tightly-coupled session/campaign state that flakes under automation; repeated attempts exhausted the charter budget.
- **Next Steps:** Pair with backend to expose a deterministic fixture endpoint or seed script, then swap the `describe.skip` placeholder for a full end-to-end test. Log lint/test commands when re-enabled.

## 9. Re-enable Combat Tracker Tests (Deferred)
- **Goal:** Bring back `tests/combat-tracker.test.tsx` once the component can be exercised without stubbing fetch.
- **Blocker:** Existing implementation wires directly into fetch-bound helpers; per charter we disabled the suite instead of leaning on mocks.
- **Next Steps:** Refactor combat tracker to accept injected data sources or server-provided fixtures, then rebuild the end-to-end test flow.

## 10. Re-enable DM Sidebar Tests (Deferred)
- **Goal:** Restore `tests/dm-sidebar.test.tsx` after introducing a fetch-free harness for sidebar workflows.
- **Blocker:** Current test relies on fetch-based mocks that violate the charter directive.
- **Next Steps:** Once the sidebar exposes injectable data sources or fixtures, replace the skip placeholder with real coverage.

## 11. Re-enable DM Toolkit UI Tests (Deferred)
- **Goal:** Bring back `tests/frontend/dm-toolkit.ui.integration.test.tsx` when a deterministic integration harness exists without direct fetch usage.
- **Blocker:** Test bootstraps express/pg mocks and fetch-heavy flows; currently disabled per charter.
- **Next Steps:** Coordinate with backend to provide seeded environment or service doubles, then rewrite the suite.

## 12. Re-enable Objectives Panel Tests (Deferred)
- **Goal:** Restore `tests/objectives-panel.test.tsx` with a fetch-free testing strategy.
- **Blocker:** Current implementation relies on mocked fetch flows; removed per directive.
- **Next Steps:** Once objectives panel accepts injectable data sources, rebuild the suite and document results.

## 13. Re-enable Campaign Manager Tests (Deferred)
- **Goal:** Reinstate `tests/campaign-manager.test.tsx` after introducing a fetch-free harness for campaign management flows.
- **Blocker:** Existing suite leans on fetch-based mocks; disabled per directive.
- **Next Steps:** Refactor component/testing setup to inject data sources and author new coverage.
