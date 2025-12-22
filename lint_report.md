# Lint & Verification Report

2025-11-11
- `npx eslint standalone/campaign-prep-map.entry.tsx --ext ts,tsx` (pass; standalone entry to render CampaignPrepMap in isolation)
- `npx eslint standalone/campaign-prep-harness.entry.tsx --ext ts,tsx` (pass; harness with toggles to add editor components incrementally)
  - Added SessionManager toggle; requires providers and ?campaignId= in URL.
  - Added DM actions toggle to pass isDM to SessionManager without URL params.
- `npx eslint components/ui/dialog.tsx --ext ts,tsx` (pass; prevent closed Radix DialogOverlay from intercepting clicks by adding data-[state=closed]:pointer-events-none and transparent background)
- `npx eslint components/ui/alert-dialog.tsx --ext ts,tsx` (pass; same closed-overlay guard as Dialog)
- `npx eslint components/ui/drawer.tsx --ext ts,tsx` (pass; same closed-overlay guard for Drawer overlay)
- `npx eslint components/campaign-prep.tsx --ext ts,tsx` (pass; pass min-h to CampaignPrepMap to ensure map initializes and remains visible)

2025-10-31
- `npx eslint vite.config.ts --ext ts,tsx` (pass; enabled Vue MCP plugin for dev server SSE export)

2025-10-30
- `npx eslint components/campaign-prep-map.tsx --ext ts,tsx` (pass; added refreshMapTileSource instrumentation and updated listener targets to avoid blocking base map)

2025-10-29
- `npx eslint components/campaign-prep-map.tsx components/layers --ext ts,tsx` (pass; Campaign Prep Map now sources shared layer helpers)
- `npx eslint components/campaign-prep-map.tsx components/layers --ext ts,tsx` (pass; viewport cache refactor to object-backed storage)
- `npx eslint components/campaign-prep-map.tsx components/campaign-prep-debounce.ts --ext ts,tsx` (pass; debounced world-layer loader integration)
- `npx eslint components/campaign-prep-map.tsx components/campaign-prep-map-tile-refresh.ts components/campaign-prep-debounce.ts --ext ts,tsx` (pass; tileset refresh no longer refits view and respects lazy loading)
- `npx eslint components/campaign-prep-map.tsx components/campaign-prep-layer-visibility.ts tests/campaign-prep-layer-visibility.test.tsx --ext ts,tsx` (pass; layer visibility controller extraction and hook-level coverage)
- `npx eslint components/campaign-prep-map.tsx components/campaign-prep-map-tile-refresh.ts components/campaign-prep-layer-visibility.ts tests/campaign-prep-map-tile-refresh.test.ts tests/campaign-prep-layer-visibility.test.tsx --ext ts,tsx` (pass; tile refresh helper + scheduler and visibility hook regression suite)

2025-10-25
- `npx eslint components/campaign-manager.tsx components/campaign-shared.ts components/dm-dashboard.tsx components/player-dashboard.tsx tests/campaign-shared.test.ts` (pass; campaign description null handling across manager and dashboards)
- `npx eslint components/campaign-manager.tsx components/campaign-shared.ts tests/campaign-shared.test.ts` (pass; campaign edit world map defaults + resolver tests)
- `npx eslint components/campaign-shared.ts components/campaign-manager.tsx components/settings.tsx utils/world-map-cache.ts tests/campaign-shared.test.ts tests/world-map-cache.test.ts` (pass; sentinel helper centralization, edit dialog persistence, shared system options, world map caching, and reducer-driven campaign forms)

2025-10-03
- `npx eslint server/database-server.js server/db/config.js server/db/pool.js --ext js` (pass; cleanup after removing Tegola integration and tile proxy code)
- `npx eslint server/services/maps/service.js server/routes/maps.routes.js server/objectives/objective-validation.js server/routes/campaigns.routes.js --ext js` (pass; campaign map region + objective location endpoints)
- `npx eslint components/campaign-prep.tsx components/campaign-prep-map.tsx components/openlayers-map.tsx components/objectives-panel.tsx components/maps/questables-style-factory.ts components/maps/questables-tile-source.ts --ext ts,tsx` (pass; DM toolkit map consolidation)
- `./node_modules/.bin/eslint components/objectives-panel.tsx components/ui/accordion.tsx components/campaign-prep.tsx` (pass; Phase 4 accordion refactor + layout update)
- `./node_modules/.bin/eslint components/campaign-prep-map.tsx` (pass; enforce non-zero map container sizing after layout shift)
- `npx eslint components/campaign-prep-map.tsx` (pass; default tileset initialization, z-index cleanup, invalid extent/coordinate guardrails, view extent enforcement, and ol/ol.css import)
- `npx eslint components/map-projection.ts` (pass; normalize extents to [minX,minY,maxX,maxY])
- `npx eslint components/maps/questables-tile-source.ts` (pass; top-left tileGrid origin + dev tile logging + CORS)
- `npx eslint components/campaign-prep.tsx` (pass; reject degenerate world map bounds metadata)
- `npx eslint server/services/campaigns/service.js --ext js` (pass; enforce server-side bounds validation)
- `npx eslint components/campaign-prep-map.tsx --ext ts,tsx` (pass; padded extent constraint, size-aware initial fit, and non-blocking tileset zoom validation)
