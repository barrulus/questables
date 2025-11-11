# Campaign Prep Map Viewport Cache

The Campaign Prep map stores per-world viewport state so the DM's zoom and center
persist across dialog toggles, tile refreshes, and subsequent renders. The cache
lives in a simple ref-backed object (`viewStateCacheRef`) keyed by `worldMap.id`
with the following shape:

- `center`: the last known `[x, y]` center in SRID-0 coordinates
- `zoom`: OpenLayers zoom level (nullable when resolution is used)
- `resolution`: fallback resolution recorded when zoom is unavailable
- `extent`: `[minX, minY, maxX, maxY]` bounds used during the last fit
- `size`: `[width, height]` of the map when the cache entry was captured
- `boundsSignature`: hash of the raw world map bounds
- `userAdjusted`: boolean flag indicating that the DM moved the viewport manually

## Cache Lifecycle

1. **Initial fit** – When a world map is mounted without an existing cache entry,
   the map fits to the padded world bounds and writes the resulting view state.
2. **Rerenders** – Subsequent renders reuse the cached center/zoom unless a forced
   refresh is requested (e.g., the world bounds changed).
3. **Manual adjustments** – `moveend` events mark the cache entry as `userAdjusted`;
   scheduled refreshes respect this flag and avoid re-fitting unless explicitly
   forced.
4. **Tile refresh** – The tile source scheduler triggers an extent update but the
   cached view prevents the map from re-fitting after the user has interacted.

## Error Handling

If the cached center or zoom is missing (e.g., due to legacy data), the map falls
back to the bounds-derived fit and overwrites the cache entry with sane values.
Errors during tile source initialization surface through the usual toast handler.

## Constraint Configuration

- The OpenLayers `View` no longer sets `constrainOnlyCenter`; instead the padded
  world-map extent is assigned directly via `view.setProperties({ extent })` so
  the camera stays within bounds while still allowing free panning/zooming.
- Removing the center constraint resolves the previous lock-up where the map
  froze after tileset swaps because the center and extent constraints conflicted.

## Testing

Run the viewport integration test to verify zoom persistence across rerenders:

```
npm test -- --runTestsByPath tests/campaign-prep-map-viewport.test.tsx --runInBand
```

The test uses module mocks for OpenLayers so the suite can run in CI without a
browser-backed canvas implementation.
