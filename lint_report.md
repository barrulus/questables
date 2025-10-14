# Lint & Verification Report

2025-10-03
- `npx eslint server/database-server.js server/db/config.js server/db/pool.js --ext js` (pass; cleanup after removing Tegola integration and tile proxy code)
- `npx eslint server/services/maps/service.js server/routes/maps.routes.js server/objectives/objective-validation.js server/routes/campaigns.routes.js --ext js` (pass; campaign map region + objective location endpoints)
- `npx eslint components/campaign-prep.tsx components/campaign-prep-map.tsx components/openlayers-map.tsx components/objectives-panel.tsx components/maps/questables-style-factory.ts components/maps/questables-tile-source.ts --ext ts,tsx` (pass; DM toolkit map consolidation)
