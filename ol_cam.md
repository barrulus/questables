# OpenLayers Parity Review

## components/openlayers-map.tsx (reference implementation)
- **Structure**  
  - Builds a single `OLMap` instance with a tile base layer plus vector layers for rivers, routes, burgs, markers, campaign locations, player tokens, trails, and encounters.  
  - Keeps long-lived refs (`mapInstanceRef`, individual layer refs, handler refs) so callbacks stay stable across renders.  
  - Creates one `View` configured with `questablesProjection`, hard-coded zoom bounds, `extent: DEFAULT_PIXEL_EXTENT`, and `constrainOnlyCenter: true`. Rotation is disabled.
- **Extent + Tile Handling**  
  - `updateViewExtent` writes the new projection extent, recenters, computes a “fit” zoom, promotes that into the view’s `minZoom`, and synchronously calls `map.renderSync()`.  
  - `applyTileSetConstraints` simply copies backend `min_zoom`/`max_zoom` into the view (storing `min` in `tileSetMinZoomRef`). No validation is performed; the map trusts backend metadata.  
  - `updateTileSource` always calls `updateViewExtent` after swapping tile sources so the camera snaps back to the world bounds.  
  - Because `constrainOnlyCenter` remains true, panning at the fit zoom is locked until the user zooms in, but the component compensates by letting scroll zoom immediately.
- **Event/Interaction Flow**  
  - Exposes map lifecycle through refs (`handleMapClickRef`, `handleMapMoveEndRef`, etc.), letting parent hooks wire behaviour without re-subscribing OL listeners.  
  - Uses overlays for popovers; no custom interaction bundle (relies on OpenLayers defaults).

## Gap Analysis vs components/campaign-prep-map.tsx
- **View/Extent Management**  
  - `CampaignPrepMap` now tracks `lastFittedExtentRef` and skips re-fitting after the first run, whereas the reference map always fits when tiles or bounds change. This preserves DM-driven zoom but also means width/height or tileset changes no longer recentre automatically.  
  - We removed `constrainOnlyCenter` to restore panning freedom; the reference still has it enabled. Keeping the constraint while widening the extent by a small padding might match the feel of the live map without eliminating guardrails.  
  - `CampaignPrepMap` no longer sets the view centre directly. If the map mounts before `map.getSize()` returns a valid array, the delayed `fit` may never run (e.g., if `updateViewExtent` gets short-circuited because the extent hasn’t changed yet). The reference code explicitly retries via `requestAnimationFrame` and always recentres even before fitting.
- **Tile Set Constraints**  
  - We now surface backend zoom inconsistencies by setting `mapError` and falling back to `[0,20]`. The working map silently adjusts the zoom range. If a tileset ships `max_zoom < min_zoom`, the new guard leaves `baseLayer` sourced but shows an error overlay—which matches policy, but it also blocks the initial fit.  
  - `CampaignPrepMap` removed the shared `tileSetMinZoomRef` concept. Without caching the fit zoom, we rely entirely on backend values even when the viewport is broader than allowed; this may expose tiles outside the official range when zooming out.
- **Layer + Interaction Wiring**  
  - Campaign prep includes hover overlays, context menus, draw layers, and highlight layers that the reference map lacks. Those features depend on consistent view/extent behaviour—resetting the camera mid-interaction clears highlights, while the new “don’t refit” rule may leave drawings offscreen if the world bounds change.  
  - Neither component customises the interaction set (`defaultInteractions`). If zoom remains unresponsive in prep, check that nothing upstream disables mouse-wheel or drag interactions; the reference map explicitly adds zoom buttons on the UI but still relies on OL defaults under the hood.
- **Lifecycle Differences**  
  - OpenLayers map caches handler refs and updates them whenever props change; campaign prep rebinds listeners via React effects. Review `attachEventListeners` to ensure the latest callbacks (especially `loadWorldLayers`) pick up campaign state just like the ref-based approach does.  
  - The reference map calls `updateTileSource` during world-map changes and guard rails against missing bounds; prep currently trusts incoming `worldMap.bounds`. Aligning the guard (e.g., bail if east <= west) would keep both maps consistent.

## Potential Causes for the Blank Map
- If a tileset reports bad zoom metadata, the new error path in `applyTileSetConstraints` emits an overlay and leaves the base layer at `[0,20]`, meaning no tiles may load if the backend also gates by zoom. The reference map never errored in this scenario, so this code path is newly exercised.  
- Deferring `view.fit` until `size` is known but skipping re-fit once `initialFitDoneRef` is true means a resize or tileset swap that resolves within the same RAF won’t ever trigger the fit. The working component always recentres immediately.  
- Removing `constrainOnlyCenter` allows the camera to drift outside bounds; if downstream fetches rely on `view.calculateExtent` staying inside `updateProjectionExtent`, data loaders may now request out-of-range tiles (returning empty responses and presenting as a blank map). Consider matching the reference behaviour by keeping the constraint but adding padding/zoom slack.  
- `mapError` state now doubles as both user-facing alert and internal flag. When we set an error (e.g., zoom mismatch), the overlay persists even after the condition is fixed, unlike the reference, which only toasts. Ensure `mapError` clears once tiles load successfully.

## Recommendations
1. Mirror the reference map’s retry loop: run `view.setCenter` before the fit and continue scheduling `updateViewExtent` until the map reports a valid size.  
2. Reintroduce a padded extent constraint rather than disabling `constrainOnlyCenter`; this preserves prep draw tooling while avoiding the reference map’s “stuck at min zoom” feel.  
3. Keep the new zoom metadata validation, but move the toast to a non-blocking path and clear `mapError` when a valid tileset is applied—otherwise the overlay hides the map completely.  
4. Compare `loadWorldLayers` triggering logic with the ref-based listener setup in `openlayers-map.tsx`; switching to ref-backed handlers could remove timing issues when React effects re-register listeners during tile-source refreshes.
