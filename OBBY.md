# DM Toolkit Campaign Map Refactor (OBBY)

This plan tracks the refactor required to unify all DM Toolkit map workflows under a single, production-aligned campaign map. All phases honor the Questables Agent Charter: no mock data, surface live backend truth, keep `API_DOCUMENTATION.md` and `database/schema.sql` synchronized, and lint everything we touch.

## Phase 0 · Discovery & Alignment
- Inventory every DM Toolkit map usage (`campaign-prep`, `campaign-spawn-map`, `objective-pin-map`, any spawn/objective dialogs) and document data dependencies and render lifecycles.
- Compare DM Toolkit map capabilities against the in-game `components/openlayers-map.tsx` feature set to enumerate the deltas we must close (layers, tile switching, zoom-driven styling, player overlays, etc.).
- Trace the health-check→state updates that currently trigger map re-initialization; capture a repro checklist and decide which subscribers must decouple from map state. The in game map does not suffer from this problem so you may find answers there.
- Confirm backend endpoints, database tables, and websocket events that the new map must leverage; file capability gaps (e.g., burg search, polygon storage) with backend owners if blockers surface.
- Align with design/product on required UI layout: single “Campaign Prep Map” canvas with a persistent accordion objective editor, click-driven spawn/objective tooling, and no residual modals or duplicate maps.

## Phase 1 · Backend Surface Expansion _(Status: ✅ Completed — 2025-10-03)_
- Design and document a `POST /api/maps/:worldId/burg-search` (or similar) endpoint that executes a bounded, parameterized PostGIS query (ILIKE + LIMIT) instead of returning full burg lists; update `API_DOCUMENTATION.md`.
- Extend schema and services to persist campaign-specific spatial annotations:
  - Add tables for spawn overrides (reuse existing) plus new polygon/area selections (`campaign_map_regions` with `geometry(Polygon, 0)` and metadata).
  - Provide CRUD endpoints for these regions and for objective/location linkage events initiated from the map.
  - Ensure every new table and constraint lands in `database/schema.sql` with SRID 0 enforcement.
- Review and adjust objective/location update endpoints so the map can assign pins/burgs/markers via explicit API calls without relying on legacy modal forms.
- Add defensive rate limiting / validation where map actions may be spammed (e.g., repeat spawn writes) to keep telemetry reliable.

_Notes:_ Live burg search endpoint available at `GET /api/maps/:worldId/burgs/search`; campaign regions stored in `campaign_map_regions` (SRID 0 multipolygons) with secured CRUD routes and a dedicated objective location API for DM Toolkit interactions. Documentation and lint report updated alongside schema changes.

## Phase 2 · Shared Map Infrastructure _(Status: ✅ Completed — 2025-10-03)_
- Extracted reusable OpenLayers infrastructure (tile grid builder, layer style factories) into `components/maps/questables-*.ts` so both in-game and DM Toolkit maps share identical styling and zoom rules.
- Replaced `CampaignSpawnMap`/`ObjectivePinMap` with the unified `CampaignPrepMap`, wired into `CampaignPrep` with spawn editing, live layer toggles, and tile-set selection that mirrors the player map.
- Ensured persistent map instances per world (no reinitialisation on health checks) and added hover/cursor handling plus context-menu primitives for spawn, objective link, and region selection actions.

## Phase 3 · Map Interaction Features _(Status: ✅ Completed — 2025-10-03)_
- Context menu now offers spawn placement, objective linking, and polygon capture; spawn writes reuse the existing API while objective links flow through `PUT /api/objectives/:id/location`.
- Added campaign region drawing with OpenLayers `Draw` → persisted immediately via the new `/api/campaigns/:campaignId/map-regions` endpoints and rendered alongside highlight overlays.
- Integrated burg search UI that issues debounced `/api/maps/:worldId/burgs/search` queries, highlights matches on the prep map, and surfaces key metadata in the details panel.
- Map clicks populate a live feature inspector card (burgs, rivers, routes, markers, regions) while ObjectivesPanel consumes the new region links and refresh hooks after map-driven updates.
- Campaign prep map + panel share the refreshed data (regions + objective refresh key) so linking and area creation stay in sync without legacy modal workflows.

## Phase 4 · Objective Editor Refactor
- Convert `ObjectivesPanel` into a permanent accordion alongside the map (no dialogs); restructure layout within `campaign-prep.tsx` to dedicate map width while keeping objectives scrollable.
- Remove legacy location controls from the objective form; instead, subscribe to map-driven location updates and reflect current linkage state within the accordion panels.
- Ensure objective create/update/delete flows still call the authenticated APIs and reconcile optimistic updates with websocket broadcasts where applicable.
- Update any tests, stories, or fixtures that assumed modal-based editing to cover the new accordion experience.

## Phase 5 · Quality, Docs, and Release Prep
- Add backend integration tests covering burg search and polygon CRUD (verify SRID 0, bounds filtering, and authorization). Add frontend tests for the new map menu and objective accordion interactions where feasible (JSDOM + OpenLayers stubs).
- Run targeted lint (`npx eslint …`) on all touched files; record the command and outcome in `lint_report.md`.
- Update `API_DOCUMENTATION.md` and any developer runbooks to reflect new endpoints, search usage, and removal of objective location fields in the UI.
- Validate the health-check no longer reinitializes the map (regression test or manual watch with logging). Document verification steps in commit notes / task log.
- Coordinate with backend partners on deployment order (schema first, then services, then frontend). Prepare rollback notes in case new endpoints require feature gating.

## Risks & Mitigations
- **OpenLayers parity regression:** Maintain automated snapshot/interaction tests mirroring key in-game behaviors before refactor; iterate in feature flags if necessary.
- **Performance of polygon tooling:** Profile draw/edit interactions with large campaigns and apply throttling or server-side simplification as needed.
- **No mock data:** Allow failure to surface noisily so that we can address it, no graceful failures or mock data.
