// Map data loader for PostGIS integration
// This component handles loading spatial data from the PostgreSQL PostGIS database

import { useState, useCallback } from 'react';
import { db } from '../utils/database/production-helpers';
import { PIXEL_PROJECTION_CODE } from './map-projection';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';

export interface WorldMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

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
  geom: any;
}

export interface RouteData {
  id: string;
  world_id: string;
  route_id: number;
  name: string;
  type: string;
  geom: any;
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
  geom?: any;
  geometry?: any;
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
  geom: any;
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
  geom: any;
}

export class MapDataLoader {
  private geoJsonFormat = new GeoJSON({
    dataProjection: PIXEL_PROJECTION_CODE,
    featureProjection: PIXEL_PROJECTION_CODE
  });

  private readGeometry(geometry: any) {
    if (!geometry) return null;

    try {
      const geometryObject = typeof geometry === 'string' ? JSON.parse(geometry) : geometry;
      if (geometryObject && geometryObject.type && geometryObject.coordinates) {
        return this.geoJsonFormat.readGeometry(geometryObject);
      }
      return null;
    } catch (error) {
      console.error('Failed to parse geometry from map data loader', error);
      return null;
    }
  }

  async loadWorldMaps(): Promise<any[]> {
    const { data, error } = await db.query(`
      SELECT * FROM maps_world 
      WHERE is_active = true 
      ORDER BY created_at DESC
    `);

    if (error) throw error;
    return data || [];
  }

  async loadBurgs(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    let result;
    
    // Add spatial filtering if bounds provided
    if (bounds) {
      result = await db.spatial('get_burgs_in_bounds', {
        world_map_id: worldMapId,
        north: bounds.north,
        south: bounds.south,
        east: bounds.east,
        west: bounds.west
      });
    } else {
      result = await db.query(`
        SELECT 
          id,
          world_id,
          burg_id,
          name,
          state,
          statefull,
          province,
          provincefull,
          culture,
          religion,
          population,
          populationraw,
          elevation,
          temperature,
          temperaturelikeness,
          capital,
          port,
          citadel,
          walls,
          plaza,
          temple,
          shanty,
          xworld,
          yworld,
          xpixel,
          ypixel,
          cell,
          ST_AsGeoJSON(geom)::json AS geometry
        FROM maps_burgs 
        WHERE world_id = $1
      `, [worldMapId]);
    }

    const { data, error } = result;
    if (error) throw error;

    return (data || [])
      .map((burg: BurgData) => {
        const geometry = this.readGeometry((burg as any).geometry || (burg as any).geom);
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
    let result;
    
    if (bounds) {
      result = await db.spatial('get_routes_in_bounds', {
        world_map_id: worldMapId,
        north: bounds.north,
        south: bounds.south,
        east: bounds.east,
        west: bounds.west
      });
    } else {
      result = await db.query(`
        SELECT 
          id,
          world_id,
          route_id,
          name,
          type,
          feature,
          ST_AsGeoJSON(geom)::json AS geometry
        FROM maps_routes 
        WHERE world_id = $1
      `, [worldMapId]);
    }

    const { data, error } = result;
    if (error) throw error;

    return (data || [])
      .map((route: RouteData) => {
        const geometry = this.readGeometry((route as any).geometry || (route as any).geom);
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
    const { data, error } = await db.spatial('get_rivers_in_bounds', {
      world_map_id: worldMapId,
      north: bounds?.north || 90,
      south: bounds?.south || -90,
      east: bounds?.east || 180,
      west: bounds?.west || -180
    });

    if (error) throw error;

    return (data || [])
      .map((river: RiverData) => {
        const geometry = this.readGeometry((river as any).geometry || (river as any).geom);
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

    const { data, error } = await db.query(`
      SELECT 
        id,
        world_id,
        cell_id,
        biome,
        type,
        population,
        state,
        culture,
        religion,
        height,
        ST_AsGeoJSON(geom)::json AS geometry
      FROM maps_cells 
      WHERE world_id = $1 
        AND geom && ST_MakeEnvelope($2, $3, $4, $5, 0)
    `, [worldMapId, bounds.west, bounds.south, bounds.east, bounds.north]);

    if (error) throw error;

    return (data || [])
      .map((cell: CellData) => {
        const geometry = this.readGeometry((cell as any).geometry || (cell as any).geom);
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
    let result;
    
    if (bounds) {
      result = await db.query(`
        SELECT 
          id,
          world_id,
          marker_id,
          type,
          icon,
          x_px,
          y_px,
          note,
          ST_AsGeoJSON(geom)::json AS geometry
        FROM maps_markers 
        WHERE world_id = $1 
          AND geom && ST_MakeEnvelope($2, $3, $4, $5, 0)
      `, [worldMapId, bounds.west, bounds.south, bounds.east, bounds.north]);
    } else {
      result = await db.query(`
        SELECT 
          id,
          world_id,
          marker_id,
          type,
          icon,
          x_px,
          y_px,
          note,
          ST_AsGeoJSON(geom)::json AS geometry
        FROM maps_markers 
        WHERE world_id = $1
      `, [worldMapId]);
    }

    const { data, error } = result;
    if (error) throw error;

    return (data || [])
      .map((marker: MarkerData) => {
        const geometry = this.readGeometry((marker as any).geometry || (marker as any).geom);
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
    const { data, error } = await db.query(`
      SELECT l.*, b.name as burg_name, b.population, b.capital 
      FROM locations l
      LEFT JOIN maps_burgs b ON l.linked_burg_id = b.id
      WHERE l.campaign_id = $1 
      AND l.world_position IS NOT NULL
    `, [campaignId]);

    if (error) throw error;

    return (data || [])
      .map((location: any) => {
        const geometry = this.readGeometry(location.world_position);
        if (!geometry) return null;

        return new Feature({
          geometry,
          id: location.id,
          type: 'campaign_location',
          name: location.name,
          data: location
        });
      })
      .filter((feature): feature is Feature => !!feature);
  }

  async findNearbyBurgs(worldMapId: string, lat: number, lng: number, radiusKm: number = 50): Promise<BurgData[]> {
    const { data, error } = await db.spatial('get_burgs_near_point', {
      world_map_id: worldMapId,
      lat: lat,
      lng: lng,
      radius_km: radiusKm
    });

    if (error) throw error;
    return data || [];
  }

  async getCellAtPoint(worldMapId: string, lat: number, lng: number): Promise<CellData | null> {
    const { data, error } = await db.spatial('get_cell_at_point', {
      world_map_id: worldMapId,
      lat: lat,
      lng: lng
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  }

  async findRoutesBetween(worldMapId: string, startLat: number, startLng: number, endLat: number, endLng: number): Promise<RouteData[]> {
    const { data, error } = await db.spatial('get_routes_between_points', {
      world_map_id: worldMapId,
      start_lat: startLat,
      start_lng: startLng,
      end_lat: endLat,
      end_lng: endLng
    });

    if (error) throw error;
    return data || [];
  }

  async loadTileSets(): Promise<any[]> {
    const { data, error } = await db.query(`
      SELECT * FROM tile_sets 
      WHERE is_active = true 
      ORDER BY name
    `);

    if (error) throw error;
    return data || [];
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
