// Map data loader for PostGIS integration
// This component handles loading spatial data from the Supabase PostGIS database

import { useState, useCallback } from 'react';
import { supabase } from '../utils/supabase/production-helpers';
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
    try {
      const { data, error } = await supabase
        .from('maps_world')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading world maps:', error);
      return [];
    }
  }

  async loadBurgs(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    try {
      let query = supabase
        .from('maps_burgs')
        .select('*')
        .eq('world_id', worldMapId);

      // Add spatial filtering if bounds provided
      if (bounds) {
        query = query.rpc('get_burgs_in_bounds', {
          world_map_id: worldMapId,
          north: bounds.north,
          south: bounds.south,
          east: bounds.east,
          west: bounds.west
        });
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((burg: BurgData) => {
        const feature = new Feature({
          geometry: this.geoJsonFormat.readGeometry(burg.geom),
          id: burg.id,
          type: 'burg',
          name: burg.name,
          data: burg
        });
        return feature;
      });
    } catch (error) {
      console.error('Error loading burgs:', error);
      return [];
    }
  }

  async loadRoutes(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    try {
      let query = supabase
        .from('maps_routes')
        .select('*')
        .eq('world_id', worldMapId);

      if (bounds) {
        query = query.rpc('get_routes_in_bounds', {
          world_map_id: worldMapId,
          north: bounds.north,
          south: bounds.south,
          east: bounds.east,
          west: bounds.west
        });
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((route: RouteData) => {
        const feature = new Feature({
          geometry: this.geoJsonFormat.readGeometry(route.geom),
          id: route.id,
          type: 'route',
          name: route.name,
          data: route
        });
        return feature;
      });
    } catch (error) {
      console.error('Error loading routes:', error);
      return [];
    }
  }

  async loadRivers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    try {
      const { data, error } = await supabase.rpc('get_rivers_in_bounds', {
        world_map_id: worldMapId,
        north: bounds?.north || 90,
        south: bounds?.south || -90,
        east: bounds?.east || 180,
        west: bounds?.west || -180
      });

      if (error) throw error;

      return (data || []).map((river: RiverData) => {
        const feature = new Feature({
          geometry: this.geoJsonFormat.readGeometry(river.geom),
          id: river.id,
          type: 'river',
          name: river.name,
          data: river
        });
        return feature;
      });
    } catch (error) {
      console.error('Error loading rivers:', error);
      return [];
    }
  }

  async loadCells(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    try {
      // Only load cells for small areas to avoid performance issues
      if (!bounds) {
        console.warn('Bounds required for loading cells to avoid performance issues');
        return [];
      }

      // Calculate area to determine if it's safe to load cells
      const area = (bounds.east - bounds.west) * (bounds.north - bounds.south);
      if (area > 100) { // Arbitrary threshold
        console.warn('Area too large for cell loading');
        return [];
      }

      const { data, error } = await supabase
        .from('maps_cells')
        .select('*')
        .eq('world_id', worldMapId)
        .gte('geom', `POLYGON((${bounds.west} ${bounds.south}, ${bounds.east} ${bounds.south}, ${bounds.east} ${bounds.north}, ${bounds.west} ${bounds.north}, ${bounds.west} ${bounds.south}))`);

      if (error) throw error;

      return (data || []).map((cell: CellData) => {
        const feature = new Feature({
          geometry: this.geoJsonFormat.readGeometry(cell.geom),
          id: cell.id,
          type: 'cell',
          data: cell
        });
        return feature;
      });
    } catch (error) {
      console.error('Error loading cells:', error);
      return [];
    }
  }

  async loadMarkers(worldMapId: string, bounds?: WorldMapBounds): Promise<Feature[]> {
    try {
      let query = supabase
        .from('maps_markers')
        .select('*')
        .eq('world_id', worldMapId);

      if (bounds) {
        query = query.gte('geom', `POLYGON((${bounds.west} ${bounds.south}, ${bounds.east} ${bounds.south}, ${bounds.east} ${bounds.north}, ${bounds.west} ${bounds.north}, ${bounds.west} ${bounds.south}))`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((marker: MarkerData) => {
        const feature = new Feature({
          geometry: this.geoJsonFormat.readGeometry(marker.geom),
          id: marker.id,
          type: 'marker',
          name: marker.note || `${marker.type} marker`,
          data: marker
        });
        return feature;
      });
    } catch (error) {
      console.error('Error loading markers:', error);
      return [];
    }
  }

  async loadCampaignLocations(campaignId: string): Promise<Feature[]> {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select(`
          *,
          maps_burgs(name, population, capital)
        `)
        .eq('campaign_id', campaignId)
        .not('world_position', 'is', null);

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
    } catch (error) {
      console.error('Error loading campaign locations:', error);
      return [];
    }
  }

  async findNearbyBurgs(worldMapId: string, lat: number, lng: number, radiusKm: number = 50): Promise<BurgData[]> {
    try {
      const { data, error } = await supabase.rpc('get_burgs_near_point', {
        world_map_id: worldMapId,
        lat: lat,
        lng: lng,
        radius_km: radiusKm
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error finding nearby burgs:', error);
      return [];
    }
  }

  async getCellAtPoint(worldMapId: string, lat: number, lng: number): Promise<CellData | null> {
    try {
      const { data, error } = await supabase.rpc('get_cell_at_point', {
        world_map_id: worldMapId,
        lat: lat,
        lng: lng
      });

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('Error getting cell at point:', error);
      return null;
    }
  }

  async findRoutesBetween(worldMapId: string, startLat: number, startLng: number, endLat: number, endLng: number): Promise<RouteData[]> {
    try {
      const { data, error } = await supabase.rpc('get_routes_between_points', {
        world_map_id: worldMapId,
        start_lat: startLat,
        start_lng: startLng,
        end_lat: endLat,
        end_lng: endLng
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error finding routes between points:', error);
      return [];
    }
  }

  async loadTileSets(): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('tile_sets')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading tile sets:', error);
      return [];
    }
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