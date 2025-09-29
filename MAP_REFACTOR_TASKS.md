# MAP Refactor Execution Plan

Derived from TODO item 7: migrate the mapping stack away from OpenLayers to a MapLibre + deck.gl architecture backed by Tegola vector tiles and enhanced movement persistence.

- Inventory every OpenLayers feature in `components/openlayers-map.tsx` (layers, interactions, websocket listeners, health hooks) to guarantee parity while performing the rip-and-replace migration.
- Review PostGIS schema for the map datasets (terrain, regions, encounter zones, player tokens, fog masks) to ensure SRID 0 compliance and confirm each layer already exists with live data (no fixture generation permitted).
- Validate build constraints (Vite setup, bundle size budgets) for introducing MapLibre GL JS and deck.gl; raise blockers before implementation.
- Extract required runtime settings from `.env.local` instead of hardcoding defaults.

## 2. Tegola Vector-Tile Service
- Design Tegola configuration files that expose required layers as MVT with metadata for blending order (parchment → terrain → labels → effects) without altering the underlying data.
- Stand up Tegola alongside the existing API, wiring it to the live PostGIS instance using credentials from `.env.local`, and document any new env requirements.
- Add health/authorization gates for tile access and update `API_DOCUMENTATION.md` plus `schema.sql` if helper views or tables are introduced.
- Generate config via `server/tegola/generate-config.js`, keep the rendered file out of git, and expose Tegola through authenticated `/api/tiles/*` proxies so unauthorised clients cannot consume tiles directly.

## 3. Movement Persistence & APIs
- Enhance the movement endpoint (or add a dedicated route) to snap requests to the configured grid, persist paths as `LINESTRINGZ` with timestamps (`player_movement_paths`), and broadcast authoritative websocket updates.
- Wire snapping/grid parameters directly to `.env.local` (no implicit defaults) so misconfiguration surfaces as runtime errors instead of silent fallbacks.
- Document the contract changes (response now includes requested/snapped coordinates, grid metadata, and path id) in the API docs; avoid data migrations by appending new tables/views.

## 4. Frontend Mapping Architecture
- Build a replacement map container that mounts MapLibre GL JS, stacking Tegola tiles in the required order while preserving role gating and health-context behaviour.
- Ensure the viewport is always constrained to the displayed viewbox, prevents over-zoom revealing map edges, and reacts to container resize events.
- Implement deck.gl layers for tokens, trails, reach cones, fog masks, grids/hexes, and snapping UX, reusing existing state from contexts and sockets.
- Make every layer (including objectives, campaign settings, spawn points, gameplay overlays) accessible via always-visible toggles and replicate across all map views.

## 5. Fog of War & UI Controls
- Port fog-of-war toggles to MapLibre (layer visibility) or deck.gl (BitmapLayer/polygon mask) with backend-authoritative states; surface backend failures immediately.
- Recreate measurement tools, layer visibility controls, loading indicators, and add a collapse affordance so the map panel can yield screen real estate when not in use.
- Provide consistent layer toggles across all map contexts (objectives, campaign settings, spawn points, gameplay), ensuring they remain accessible for all modes (gameplay, campaign management etc).

## 6. Implementation Validation & Cleanup
- Remove OpenLayers dependencies once feature parity is verified; adjust bundler config and package manifests accordingly (no regression tests required, but ensure smoke validation aligns with charter).
- Add targeted smoke checks for map initialization, viewport resizing, layer toggles, movement telemetry, and fog handling; record lint/test runs in `lint_report.md` and log the slice in `clearance_and_connect_tasks_documentation.md`.
- Update user-facing documentation and operational runbooks to reflect the new map stack.

## 7. Rollout & Verification
- Profile performance (tile loading, deck.gl layer FPS) against production-sized campaigns; tune Tegola caching or client throttling as required.
- Sequence deployment across backend tile service, API updates, and frontend rollout with rollback plans, monitoring telemetry to confirm the viewport stays constrained, layer toggles function everywhere, and failures surface instead of falling back to mock data.
