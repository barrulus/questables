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
import type { Geometry as GeoJsonGeometry } from 'geojson';

export type WorldMapBounds = MapBounds;

export interface BurgData {
  id: string;
  world_id: string;
  burg_id: number;
  name: string;
  state: string;
  province: string;
  culture: string;
  religion: string;
  population: number;
  capital: boolean;
  port: boolean;
  xworld: number;
  yworld: number;
  geom?: unknown;
  geometry?: unknown;
}

export interface RouteData {
  id: string;
  world_id: string;
  route_id: number;
  name: string;
  type: string;
  geom?: unknown;
  geometry?: unknown;
}

export interface RiverData {
  id: string;
  world_id: string;
  river_id: number;
  name: string;
  type: string;
  discharge: number;
  length: number;
  width: number;
  geom?: unknown;
  geometry?: unknown;
}

export interface CellData {
  id: string;
  world_id: string;
  cell_id: number;
  biome: number;
  type: string;
  population: number;
  state: number;
  culture: number;
  religion: number;
  height: number;
  geom?: unknown;
  geometry?: unknown;
}

export interface MarkerData {
  id: string;
  world_id: string;
  marker_id: number;
  type: string;
  icon: string;
  note: string;
  x_px?: number;
  y_px?: number;
  geom?: unknown;
  geometry?: unknown;
}

export class MapDataLoader {
  private tileSetCache: Record<string, unknown>[] | null = null;

  private geoJsonFormat = new GeoJSON({
    dataProjection: PIXEL_PROJECTION_CODE,
    featureProjection: PIXEL_PROJECTION_CODE
  });

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

    if (typeof candidate === 'object' && candidate !== null) {
      const geometryObject = candidate as Partial<GeoJsonGeometry> & { coordinates?: unknown };
      if (typeof geometryObject.type === 'string' && geometryObject.coordinates !== undefined) {
        return this.geoJsonFormat.readGeometry(geometryObject as GeoJsonGeometry);
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

    return (rows || [])
      .map((burg: BurgData) => {
        const geometry = this.readGeometry(burg.geometry ?? burg.geom);
        if (!geometry) return null;

        const feature = new Feature({
          geometry,
          id: burg.id,
          type: 'burg',
          name: burg.name,
          data: burg
        });
        
        
        return feature;
      })
      .filter((feature): feature is Feature => !!feature);
  }

  async loadRoutes(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldRoutes(worldMapId, bounds as MapBounds | undefined);

    return (rows || [])
      .map((route: RouteData) => {
        const geometry = this.readGeometry(route.geometry ?? route.geom);
        if (!geometry) return null;

        return new Feature({
          geometry,
          id: route.id,
          type: 'route',
          name: route.name,
          data: route
        });
      })
      .filter((feature): feature is Feature => !!feature);
  }

  async loadRivers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldRivers(worldMapId, bounds as MapBounds | undefined);

    return (rows || [])
      .map((river: RiverData) => {
        const geometry = this.readGeometry(river.geometry ?? river.geom);
        if (!geometry) return null;

        return new Feature({
          geometry,
          id: river.id,
          type: 'river',
          name: river.name,
          data: river
        });
      })
      .filter((feature): feature is Feature => !!feature);
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

    return (rows || [])
      .map((cell: CellData) => {
        const geometry = this.readGeometry(cell.geometry ?? cell.geom);
        if (!geometry) return null;

        return new Feature({
          geometry,
          id: cell.id,
          type: 'cell',
          data: cell
        });
      })
      .filter((feature): feature is Feature => !!feature);
  }

  async loadMarkers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    const rows = await listWorldMarkers(worldMapId, bounds as MapBounds | undefined);

    return (rows || [])
      .map((marker: MarkerData) => {
        const geometry = this.readGeometry(marker.geometry ?? marker.geom);
        if (!geometry) return null;

        return new Feature({
          geometry,
          id: marker.id,
          type: 'marker',
          name: marker.note || `${marker.type} marker`,
          data: marker
        });
      })
      .filter((feature): feature is Feature => !!feature);
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
