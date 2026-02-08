# Mapping System

Questables uses OpenLayers 10 for interactive map rendering with PostGIS-backed spatial data.

## Projection

Maps use a custom pixel-space projection (`QUESTABLES_PIXEL`, SRID 0) with no geographic coordinate system. Coordinates represent pixel positions from Azgaar's Fantasy Map Generator.

```typescript
// Defined in components/map-projection.ts
import { register } from 'ol/proj/proj4';
// SRID 0 projection — unitless pixel coordinates
export const PIXEL_PROJECTION_CODE = 'QUESTABLES_PIXEL';
```

## Map Components

### openlayers-map.tsx (Game Map)

The main map shown during active gameplay sessions. Features:

- Base tile layer from configurable tile sets
- Spatial layers: burgs, routes, rivers, markers, cells
- Player position tracking
- Click-to-select features with tooltips
- Zoom-dependent layer visibility rules
- Fog-of-war via `visibilityRadius`

### campaign-prep-map.tsx (DM Prep Map)

Used by DMs for campaign preparation. Additional features:

- All game map layers plus:
- Region drawing (polygons for encounters, rumors, notes)
- Spawn point placement
- Layer visibility toggles
- Debounced viewport-based data loading

## Data Loading

### MapDataLoader (Singleton)

`components/map-data-loader.tsx` centralizes all spatial data fetching:

```typescript
class MapDataLoader {
  loadBurgs(worldId: string, bounds: Extent): Promise<Feature[]>
  loadRoutes(worldId: string, bounds: Extent): Promise<Feature[]>
  loadRivers(worldId: string, bounds: Extent): Promise<Feature[]>
  loadMarkers(worldId: string, bounds: Extent): Promise<Feature[]>
  loadCells(worldId: string, bounds: Extent): Promise<Feature[]>
  loadTileSets(): Promise<TileSet[]>
  getDataTypesForZoom(zoom: number): string[]
}
```

Data flows from PostGIS → REST API → GeoJSON → OpenLayers Features.

**Important**: When passing `MapDataLoader` methods as callbacks, always wrap in arrow functions to preserve `this` context:

```typescript
// WRONG — loses `this` binding
loader: mapDataLoader.loadBurgs

// CORRECT — preserves `this`
loader: (id, bounds) => mapDataLoader.loadBurgs(id, bounds)
```

### Viewport-Based Loading

Spatial data endpoints accept a `bounds` parameter (`minX,minY,maxX,maxY`) for viewport filtering. The campaign prep map uses a `DebouncedExecutor` (200ms delay) to batch `moveend` events and avoid spamming the backend during rapid panning.

### Lazy Loading by Visibility

Layers only fetch data when both conditions are met:
1. The current zoom level requires the dataset (per `getDataTypesForZoom`)
2. The UI toggle for that layer is enabled

Toggling a layer off clears its vector source without network requests. Re-enabling schedules a fresh fetch.

## Layer Factories

All layer construction is centralized in `components/layers/`:

| Module | Layer | Geometry |
|--------|-------|----------|
| `burgs.ts` | Settlements | Point |
| `routes.ts` | Roads/trade routes | MultiLineString |
| `rivers.ts` | River systems | MultiLineString |
| `markers.ts` | Custom markers | Point |
| `cells.ts` | Terrain cells | MultiPolygon |
| `regions.ts` | DM annotations | MultiPolygon |
| `spawn.ts` | Campaign spawn points | Point |
| `draw.ts` | Interactive drawing | Variable |
| `highlight.ts` | Feature highlight | Point |

All modules are re-exported through `components/layers/index.ts`.

### Usage

```typescript
import { createBurgsLayer, createRoutesLayer } from '@/components/layers';

const burgsLayer = createBurgsLayer({ resolveZoom });
const routesLayer = createRoutesLayer({ resolveZoom });
map.addLayer(burgsLayer);
map.addLayer(routesLayer);
```

## Styling

### Style Factory

`components/maps/questables-style-factory.ts` provides zoom-aware styles for all layer types. Styles adapt at different zoom levels (e.g., burg labels appear only at higher zooms).

### Tile Sources

- `questables-tile-source.ts` — Configures tile layers from `tile_sets` table
- `settlement-tile-source.ts` — Serves individual settlement detail tiles via `/api/maps/settlements/:burgId/tiles/:z/:x/:y.png`

## Tooltips

`components/maps/feature-tooltip.ts` provides shared hover tooltip functionality used by both map components. It:

- Creates and positions a DOM overlay on the map
- Extracts feature properties for display (name, type, population, etc.)
- Supports different tooltip formats per layer type

## Viewport Cache

The campaign prep map caches viewport state per world map so the DM's zoom/center persists across dialog toggles and tile refreshes:

```typescript
interface ViewStateCache {
  center: [number, number];
  zoom: number | null;
  resolution: number | null;
  extent: [number, number, number, number];
  size: [number, number];
  boundsSignature: string;
  userAdjusted: boolean;
}
```

- Initial mount fits to world bounds
- Subsequent renders reuse cached position
- Manual pan/zoom sets `userAdjusted` flag, preventing auto-refit
- Tile set changes preserve camera position

## PostGIS Queries

The backend uses PostGIS spatial functions for efficient map data delivery:

```sql
-- Bounds-based filtering (used by all spatial endpoints)
WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 0))

-- Settlement search
WHERE world_map_id = $1 AND name ILIKE '%' || $2 || '%'
```

All spatial indexes use GIST for sub-millisecond query performance on large datasets.

## Related Documentation

- [Campaign Prep Map Layers](./campaign-prep-map-layers.md) — Layer helper details
- [Campaign Prep Layer Loading](./campaign-prep-layer-loading.md) — Debounced loading
- [Campaign Prep Viewport](./campaign-prep-viewport.md) — Viewport cache lifecycle
