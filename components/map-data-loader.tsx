// Map data loader for PostGIS integration
// This component handles loading spatial data from the PostgreSQL PostGIS database

import {
  listWorldMaps,
  listWorldBurgs,
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

export class MapDataLoader {
  private tileSetCache: Record<string, unknown>[] | null = null;

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

    // Cells remain opt-in at high zoom to avoid overwhelming the client.
    if (zoom >= 10) dataTypes.push('cells');     // Terrain cells visible from zoom 10+ (high detail)

    return dataTypes;
  }
}

// Singleton instance
export const mapDataLoader = new MapDataLoader();
