// Map data loader for PostGIS integration
// This component handles loading spatial data from the PostgreSQL PostGIS database

import {
  listWorldMaps,
  listWorldBurgs,
  listWorldBurgEntrances,
  listWorldRoutes,
  listWorldRivers,
  listWorldMarkers,
  listWorldCells,
  listTileSets,
  type MapBounds,
} from '../utils/api/maps';
import { fetchJson } from '../utils/api-client';
import { PIXEL_PROJECTION_CODE } from './map-projection';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';

export type WorldMapBounds = MapBounds;

/** World-wide (non bounds-scoped) GeoJSON entities served by the FMG full-JSON import. */
export type PolityEntity =
  | 'states'
  | 'provinces'
  | 'cultures'
  | 'religions'
  | 'zones'
  | 'regiments';

export class MapDataLoader {
  private tileSetCache: Record<string, unknown>[] | null = null;

  /**
   * Raw GeoJSON payloads for the world-wide polity/military entities, keyed
   * `${worldMapId}:${entity}` so nothing leaks across worlds. These endpoints
   * take no bounds and return the largest payloads in the app, while
   * `loadWorldMapData` re-runs on every map move — without this cache a pan
   * would re-download every state polygon.
   *
   * The *raw* payload is cached rather than the parsed `Feature[]`: each call
   * re-parses into fresh `Feature` instances, so an OpenLayers source never
   * receives feature objects that another source already owns, and callers
   * can safely mutate what they get back. Re-parsing is local CPU only.
   *
   * A fetch error is never cached (so a transient failure doesn't stick); a
   * genuinely empty FeatureCollection — a world imported before the full-JSON
   * pipeline existed — is a valid result and IS cached.
   */
  private polityGeoJsonCache = new Map<string, unknown>();

  private geoJsonFormat = new GeoJSON({
    dataProjection: PIXEL_PROJECTION_CODE,
    featureProjection: PIXEL_PROJECTION_CODE
  });

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static toRecordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(MapDataLoader.isRecord);
  }

  private static resolveString(record: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
    return null;
  }

  private static resolveNumericId(record: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
    return null;
  }

  private static notNull<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
  }

  private isGeoJsonGeometry(candidate: Record<string, unknown>): boolean {
    if (typeof candidate.type !== 'string') {
      return false;
    }

    if ('coordinates' in candidate) {
      return candidate.coordinates !== undefined;
    }

    if (candidate.type === 'GeometryCollection' && 'geometries' in candidate) {
      return Array.isArray((candidate as { geometries?: unknown }).geometries);
    }

    return false;
  }

  private readGeometry(input: unknown) {
    if (input === null || input === undefined) {
      return null;
    }

    let candidate: unknown = input;

    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch (error) {
        console.error('Failed to parse geometry from map data loader', error);
        return null;
      }
    }

    if (MapDataLoader.isRecord(candidate) && this.isGeoJsonGeometry(candidate)) {
      try {
        return this.geoJsonFormat.readGeometry(candidate as Record<string, unknown>);
      } catch (error) {
        console.error('Failed to read geometry from map data loader', error);
      }
    }

    return null;
  }

  async loadWorldMaps(): Promise<Record<string, unknown>[]> {
    const maps = await listWorldMaps();
    return maps || [];
  }

  async loadBurgs(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldBurgs(worldMapId, bounds as MapBounds | undefined);

    return MapDataLoader.toRecordArray(rows)
      .map((record, index) => {
        const geometry = this.readGeometry(record.geometry ?? record.geom);
        if (!geometry) return null;

        const id = MapDataLoader.resolveString(record, 'id')
          ?? MapDataLoader.resolveNumericId(record, 'burg_id', 'world_id', 'id')
          ?? `burg-${index}`;
        const name = MapDataLoader.resolveString(record, 'name') ?? `Burg ${index + 1}`;

        return new Feature({
          geometry,
          id,
          type: 'burg',
          name,
          data: record,
        });
      })
      .filter(MapDataLoader.notNull);
  }

  /** Parse a GeoJSON FeatureCollection payload into fresh OL features. */
  private featuresFromGeoJson(data: unknown): Feature[] {
    const features = MapDataLoader.isRecord(data) ? data.features : null;
    if (!Array.isArray(features)) return [];
    return features
      .map((f: Record<string, unknown>) => {
        const geometry = this.readGeometry(f.geometry);
        if (!geometry) return null;
        const feat = new Feature({ geometry });
        for (const [k, v] of Object.entries((f.properties as Record<string, unknown>) ?? {})) {
          feat.set(k, v);
        }
        const id = (f as { id?: unknown }).id ?? (f.properties as Record<string, unknown> | undefined)?.id;
        if (typeof id === 'string' || typeof id === 'number') feat.setId(id);
        return feat;
      })
      .filter(MapDataLoader.notNull);
  }

  /**
   * Cached fetch for the world-wide polity/military endpoints. Returns freshly
   * parsed features on every call; only the raw payload is memoised, and only
   * when the request actually succeeded.
   *
   * Returns `null` when the request failed (non-`ok` or thrown) so callers can
   * tell a failure apart from a genuinely empty world — an empty
   * FeatureCollection resolves to `[]`. Callers that cache or otherwise mark a
   * layer "done" must only do so for a non-`null` result, or a transient error
   * would be latched in permanently.
   */
  async loadPolity(worldMapId: string, entity: PolityEntity): Promise<Feature[] | null> {
    const key = `${worldMapId}:${entity}`;
    const cached = this.polityGeoJsonCache.get(key);
    if (cached !== undefined) {
      return this.featuresFromGeoJson(cached);
    }

    const url = `/api/maps/${worldMapId}/${entity}`;
    try {
      const res = await fetch(url);
      // Not cached: a 4xx/5xx is a failure, not a known-empty world.
      if (!res.ok) return null;
      const data = await res.json();
      this.polityGeoJsonCache.set(key, data);
      return this.featuresFromGeoJson(data);
    } catch (error) {
      console.error(`Failed to load GeoJSON from ${url}`, error);
      return null;
    }
  }

  /**
   * Drop cached polity payloads — for one world when `worldMapId` is given,
   * otherwise for every world. Call after re-importing/regenerating a world.
   */
  clearPolityCache(worldMapId?: string): void {
    if (!worldMapId) {
      this.polityGeoJsonCache.clear();
      return;
    }
    const prefix = `${worldMapId}:`;
    for (const key of Array.from(this.polityGeoJsonCache.keys())) {
      if (key.startsWith(prefix)) {
        this.polityGeoJsonCache.delete(key);
      }
    }
  }

  // Convenience wrappers keeping the plain `Promise<Feature[]>` contract for
  // callers that don't care why a layer is empty. Anything that caches the
  // result should call `loadPolity` directly and honour its `null`.
  async loadStates(worldMapId: string): Promise<Feature[]> {
    return (await this.loadPolity(worldMapId, 'states')) ?? [];
  }

  async loadProvinces(worldMapId: string): Promise<Feature[]> {
    return (await this.loadPolity(worldMapId, 'provinces')) ?? [];
  }

  async loadCultures(worldMapId: string): Promise<Feature[]> {
    return (await this.loadPolity(worldMapId, 'cultures')) ?? [];
  }

  async loadReligions(worldMapId: string): Promise<Feature[]> {
    return (await this.loadPolity(worldMapId, 'religions')) ?? [];
  }

  async loadZones(worldMapId: string): Promise<Feature[]> {
    return (await this.loadPolity(worldMapId, 'zones')) ?? [];
  }

  async loadRegiments(worldMapId: string): Promise<Feature[]> {
    return (await this.loadPolity(worldMapId, 'regiments')) ?? [];
  }

  async loadBurgEntrances(worldMapId: string): Promise<Feature[]> {
    const fc = await listWorldBurgEntrances(worldMapId);
    return (fc.features ?? [])
      .map((f) => {
        const geometry = this.readGeometry(f);
        if (!geometry) return null;
        const feat = new Feature({ geometry });
        for (const [k, v] of Object.entries(f.properties ?? {})) {
          feat.set(k, v);
        }
        const id = f.properties?.id;
        if (typeof id === 'string') feat.setId(id);
        return feat;
      })
      .filter(MapDataLoader.notNull);
  }

  async loadRoutes(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldRoutes(worldMapId, bounds as MapBounds | undefined);

    return MapDataLoader.toRecordArray(rows)
      .map((record, index) => {
        const geometry = this.readGeometry(record.geometry ?? record.geom);
        if (!geometry) return null;

        const id = MapDataLoader.resolveString(record, 'id')
          ?? MapDataLoader.resolveNumericId(record, 'route_id', 'world_id', 'id')
          ?? `route-${index}`;
        const name = MapDataLoader.resolveString(record, 'name') ?? `Route ${index + 1}`;

        return new Feature({
          geometry,
          id,
          type: 'route',
          name,
          data: record,
        });
      })
      .filter(MapDataLoader.notNull);
  }

  async loadRivers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldRivers(worldMapId, bounds as MapBounds | undefined);

    return MapDataLoader.toRecordArray(rows)
      .map((record, index) => {
        const geometry = this.readGeometry(record.geometry ?? record.geom);
        if (!geometry) return null;

        const id = MapDataLoader.resolveString(record, 'id')
          ?? MapDataLoader.resolveNumericId(record, 'river_id', 'world_id', 'id')
          ?? `river-${index}`;
        const name = MapDataLoader.resolveString(record, 'name') ?? `River ${index + 1}`;

        return new Feature({
          geometry,
          id,
          type: 'river',
          name,
          data: record,
        });
      })
      .filter(MapDataLoader.notNull);
  }

  async loadCells(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    // Only load cells for small areas to avoid performance issues
    if (!bounds) {
      throw new Error('Bounds required for loading cells to avoid performance issues');
    }

    // Calculate area to determine if it's safe to load cells
    const area = (bounds.east - bounds.west) * (bounds.north - bounds.south);
    if (area > 200000) { // Arbitrary threshold tuned for pixel coordinates
      throw new Error('Area too large for cell loading');
    }

    const rows = await listWorldCells(worldMapId, bounds as MapBounds);

    return MapDataLoader.toRecordArray(rows)
      .map((record, index) => {
        const geometry = this.readGeometry(record.geometry ?? record.geom);
        if (!geometry) return null;

        const id = MapDataLoader.resolveString(record, 'id')
          ?? MapDataLoader.resolveNumericId(record, 'cell_id', 'world_id', 'id')
          ?? `cell-${index}`;

        return new Feature({
          geometry,
          id,
          type: 'cell',
          data: record,
        });
      })
      .filter(MapDataLoader.notNull);
  }

  async loadMarkers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldMarkers(worldMapId, bounds as MapBounds | undefined);

    return MapDataLoader.toRecordArray(rows)
      .map((record, index) => {
        const geometry = this.readGeometry(record.geometry ?? record.geom);
        if (!geometry) return null;

        const id = MapDataLoader.resolveString(record, 'id')
          ?? MapDataLoader.resolveNumericId(record, 'marker_id', 'world_id', 'id')
          ?? `marker-${index}`;
        const name = MapDataLoader.resolveString(record, 'note', 'name', 'type') ?? `Marker ${index + 1}`;

        return new Feature({
          geometry,
          id,
          type: 'marker',
          name,
          data: record,
        });
      })
      .filter(MapDataLoader.notNull);
  }

  async loadCampaignLocations(campaignId: string): Promise<Feature[]> {
    const data = await fetchJson<Record<string, unknown>[]>(
      `/api/campaigns/${campaignId}/locations`,
      { method: 'GET' },
      'Failed to load campaign locations',
    );

    return (data || [])
      .map((rawLocation) => {
        const location = rawLocation as Record<string, unknown>;
        const geometry = this.readGeometry(location.world_position);
        if (!geometry) return null;

        return new Feature({
          geometry,
          id: String(location.id ?? ''),
          type: 'campaign_location',
          name: String(location.name ?? ''),
          data: location,
        });
      })
      .filter((feature): feature is Feature => !!feature);
  }

  async loadTileSets(): Promise<Record<string, unknown>[]> {
    if (this.tileSetCache) {
      return this.tileSetCache;
    }

    const tileSets = await listTileSets();
    this.tileSetCache = tileSets || [];
    return this.tileSetCache;
  }

  // Utility function to convert OpenLayers bounds to our bounds format
  getBoundsFromExtent(extent: number[]): WorldMapBounds {
    return {
      west: extent[0],
      south: extent[1],
      east: extent[2],
      north: extent[3]
    };
  }

  // Utility function to determine what data to load based on zoom level
  getDataTypesForZoom(zoom: number): string[] {
    // Load key layers at every zoom so we can validate alignment visually.
    const dataTypes: string[] = ['burgs', 'routes', 'rivers', 'markers'];

    // Burg gate markers render only at zoom ≥ 7 (see burg-entrance style factory).
    if (zoom >= 7) dataTypes.push('burgEntrances');

    // Cells remain opt-in at high zoom to avoid overwhelming the client.
    if (zoom >= 10) dataTypes.push('cells');     // Terrain cells visible from zoom 10+ (high detail)

    return dataTypes;
  }
}

// Singleton instance
export const mapDataLoader = new MapDataLoader();
