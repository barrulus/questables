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

## 7. Change Mapping Architecture.
- **Goal:** Replace OpenLayers with: -
  * Client (browser):
  MapLibre GL JS for the base map, stacking your PNG pyramids with opacity & blend order. (maplibre.org)
  deck.gl overlays for tokens, movement trails, reach cones, grid/hex, and performant filtering/hover. (deck.gl)

  * Tile services:
  Tegola (config-rich) to emit MVT from PostGIS layers: regions, roads, encounter zones, LOS blockers. 

  * Additional VTT-specific touches:
  Layer ordering & blending: parchment → terrain → labels → effects (fog “mask”) → tokens (deck.gl).
  Fog of war: maintain a raster or vector mask layer; toggle via MapLibre layer visibility or render a deck.gl BitmapLayer/polygon mask.
  Hex/square grids: render a lightweight grid as a vector tile (cheap to draw at all zooms).
  Snap-to-grid movement + PostGIS writes: send token moves to a /move API; store paths in LINESTRINGZ with timestamps for replay.
