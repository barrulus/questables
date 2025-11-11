# Campaign Prep Layer Loading

World layer fetches (`/api/maps/:worldId/...`) now use a debounced executor so
rapid `moveend` bursts do not spam the backend. The debouncer lives in
`components/campaign-prep-debounce.ts` and is configured with a 200 ms delay.

## Trigger Mechanics

- `moveend` events schedule a debounced load via `DebouncedExecutor.trigger()`.
- Manual viewport changes continue to record cached zoom/center before the
  debounced call runs.
- `DebouncedExecutor.cancel()` is invoked when the map unmounts or reinitialises,
  ensuring no orphaned timers survive component teardown.
- Initial loads and tile-set changes still call `loadWorldLayers` immediately so
  the first paint is not delayed.
- Tile-set refreshes no longer re-fit the view; the existing camera position is
  preserved while constraints such as min/max zoom are re-applied.

## Lazy Loading by Visibility

- Layers now fetch only when both the current zoom level requires the dataset
  (per `mapDataLoader.getDataTypesForZoom`) **and** the UI toggle is enabled.
- Toggling a layer off clears its vector source without making any network
  request. Re-enabling schedules a fresh fetch through the same debounced loader.
- Bounds-based cache keys ensure each visible layer is requested only once per
  viewport, even if other layers remain disabled.

## Verification

Run the debounced move-end test to confirm the loader fires once despite rapid
pans:

```
npm test -- --runTestsByPath tests/campaign-prep-map-viewport.test.tsx --runInBand
```

Use `npx eslint components/campaign-prep-map.tsx components/layers --ext ts,tsx`
to validate lint coverage after editing the loader or debounce helper.
