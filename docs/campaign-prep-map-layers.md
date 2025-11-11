# Campaign Prep Map Layer Helpers

The `components/layers/` namespace centralises OpenLayers layer construction shared by the Campaign Prep map and future map surfaces. Each helper returns a fully configured layer (or layer + source bundle) so consumers avoid duplicating style factories, visibility defaults, or vector source plumbing.

## Module Overview

- `base-tile.ts` — Produces the base `TileLayer` with the preload/z-index defaults expected by Questables tile sets.
- `burgs.ts` — Creates the burg vector layer, applying the zoom-sensitive style factory for burg icons and labels.
- `cells.ts` — Provides the terrain cell layer with the shared fill/outline styling.
- `draw.ts` — Returns both the draw layer and its `VectorSource`; the caller should persist the returned source to co-ordinate draw interactions.
- `highlight.ts` — Builds a point highlight layer using a supplied `Style`. Keeps the source internal so call-sites only pass features to highlight.
- `markers.ts` — Exposes the marker layer wired to the shared marker style factory.
- `regions.ts` — Normalises `CampaignRegion` payloads (including feature fallbacks) before passing them to the caller’s style resolver.
- `rivers.ts` — Configures the river segment layer with the shared river stroke styling.
- `routes.ts` — Generates the route layer with zoom-aware styling.
- `spawn.ts` — Supplies the spawn marker layer used to render or clear default campaign spawns.
- `types.ts` — Shared `GeometryFeature`, `GeometrySource`, `GeometryLayer`, `SpawnFeature`, etc. to keep component code consistent.

All modules are re-exported through `components/layers/index.ts` for ergonomic imports.

## Usage Guidelines

1. Import helpers from `components/layers` instead of instantiating `new VectorLayer` / `new TileLayer` directly.
2. Pass the `resolveZoom` callback (see `CampaignPrepMap`) to any helper that needs zoom-aware styling (`createBurgsLayer`, `createRoutesLayer`, `createMarkersLayer`).
3. Always persist references to the returned layers so visibility toggles continue to operate (`useRef<GeometryLayer>` in `CampaignPrepMap`).
4. For draw interactions, persist the `source` returned by `createDrawLayer()` in tandem with the layer ref. When the map tears down, clear both to avoid stale state.
5. When adding a new layer helper, export it via `index.ts`, document the module here, and add targeted eslint coverage to `lint_report.md`.

## Invalidation & Error Handling

- Region features that arrive without `CampaignRegion` metadata fall back to a sanitised placeholder keyed by `worldMapId`. This ensures the style resolver never receives undefined properties.
- Layer visibility remains the responsibility of the consuming component; helpers only establish the initial `visible` default.
- Helper modules do not swallow API errors—callers must continue surfacing backend failures through existing toast/banner mechanisms.

## Verification

When updating or consuming these helpers, run:

```
npx eslint components/campaign-prep-map.tsx components/layers --ext ts,tsx
```

The command output is tracked in `lint_report.md`.
