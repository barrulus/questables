// Map data loader for PostGIS integration
// This component handles loading spatial data from the PostgreSQL PostGIS database

import { useState, useCallback } from 'react';
import { db } from '../utils/database/production-helpers';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import { fromLonLat } from 'ol/proj';

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
  geom: any;
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
  geom: any;
}

export class MapDataLoader {
  private geoJsonFormat = new GeoJSON({
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });

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
        SELECT * FROM maps_burgs 
        WHERE world_map_id = $1
      `, [worldMapId]);
    }

    const { data, error } = result;
    if (error) throw error;

    return (data || []).map((burg: BurgData) => {
      const feature = new Feature({
        geometry: this.geoJsonFormat.readGeometry(burg.geometry || burg.geom),
        id: burg.id,
        type: 'burg',
        name: burg.name,
        data: burg
      });
      return feature;
    });
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
        SELECT * FROM maps_routes 
        WHERE world_map_id = $1
      `, [worldMapId]);
    }

    const { data, error } = result;
    if (error) throw error;

    return (data || []).map((route: RouteData) => {
      const feature = new Feature({
        geometry: this.geoJsonFormat.readGeometry(route.geometry || route.geom),
        id: route.id,
        type: 'route',
        name: route.name,
        data: route
      });
      return feature;
    });
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

    return (data || []).map((river: RiverData) => {
      const feature = new Feature({
        geometry: this.geoJsonFormat.readGeometry(river.geometry || river.geom),
        id: river.id,
        type: 'river',
        name: river.name,
        data: river
      });
      return feature;
    });
  }

  async loadCells(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    // Only load cells for small areas to avoid performance issues
    if (!bounds) {
      throw new Error('Bounds required for loading cells to avoid performance issues');
    }

    // Calculate area to determine if it's safe to load cells
    const area = (bounds.east - bounds.west) * (bounds.north - bounds.south);
    if (area > 100) { // Arbitrary threshold
      throw new Error('Area too large for cell loading');
    }

    const { data, error } = await db.query(`
      SELECT * FROM maps_cells 
      WHERE world_map_id = $1 
      AND geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
    `, [worldMapId, bounds.west, bounds.south, bounds.east, bounds.north]);

    if (error) throw error;

    return (data || []).map((cell: CellData) => {
      const feature = new Feature({
        geometry: this.geoJsonFormat.readGeometry(cell.geometry || cell.geom),
        id: cell.id,
        type: 'cell',
        data: cell
      });
      return feature;
    });
  }

  async loadMarkers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    let result;
    
    if (bounds) {
      result = await db.query(`
        SELECT * FROM maps_markers 
        WHERE world_map_id = $1 
        AND geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
      `, [worldMapId, bounds.west, bounds.south, bounds.east, bounds.north]);
    } else {
      result = await db.query(`
        SELECT * FROM maps_markers 
        WHERE world_map_id = $1
      `, [worldMapId]);
    }

    const { data, error } = result;
    if (error) throw error;

    return (data || []).map((marker: MarkerData) => {
      const feature = new Feature({
        geometry: this.geoJsonFormat.readGeometry(marker.geometry || marker.geom),
        id: marker.id,
        type: 'marker',
        name: marker.note || `${marker.type} marker`,
        data: marker
      });
      return feature;
    });
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

    return (data || []).map((location: any) => {
      const feature = new Feature({
        geometry: this.geoJsonFormat.readGeometry(location.world_position),
        id: location.id,
        type: 'campaign_location',
        name: location.name,
        data: location
      });
      return feature;
    });
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
    const dataTypes: string[] = [];
    
    if (zoom >= 3) dataTypes.push('burgs');      // Cities visible from zoom 3+
    if (zoom >= 5) dataTypes.push('routes');     // Roads visible from zoom 5+
    if (zoom >= 4) dataTypes.push('rivers');     // Rivers visible from zoom 4+
    if (zoom >= 7) dataTypes.push('markers');    // Markers visible from zoom 7+
    if (zoom >= 10) dataTypes.push('cells');     // Terrain cells visible from zoom 10+ (high detail)
    
    return dataTypes;
  }
}

// Singleton instance
export const mapDataLoader = new MapDataLoader();