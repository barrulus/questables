import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { 
  MapPin, 
  ZoomIn, 
  ZoomOut, 
  Move, 
  Flag, 
  Users, 
  Skull, 
  Crown,
  Globe,
  Crosshair,
  Trees,
  Mountain,
  Waves,
  Castle,
  Home,
  Tent,
  Layers,
  Navigation,
  Info,
  Search,
  Settings
} from "lucide-react";

// OpenLayers imports
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import TileGrid from 'ol/tilegrid/TileGrid';
import { defaults as defaultControls } from 'ol/control';
import { Overlay } from 'ol';

import { mapDataLoader, type WorldMapBounds } from './map-data-loader';

interface MapPin {
  id: string;
  coordinates: [number, number];
  type: 'party' | 'enemy' | 'location' | 'treasure' | 'danger' | 'town' | 'dungeon' | 'burg' | 'marker';
  name: string;
  visible: boolean;
  description?: string;
  data?: any;
}

interface LayerVisibility {
  burgs: boolean;
  routes: boolean;
  rivers: boolean;
  cells: boolean;
  markers: boolean;
  campaignLocations: boolean;
  userPins: boolean;
}

const FANTASY_TILESET_ID = 'fantasy-atlas';
const FANTASY_TILESET = {
  id: FANTASY_TILESET_ID,
  name: 'Fantasy Atlas',
  base_url: '/tiles-states/{z}/{x}/{y}.png',
  attribution: 'Fantasy Atlas Tiles',
  min_zoom: 0,
  max_zoom: 7,
  tile_size: 256,
  wrapX: false
};

const TOGGLEABLE_LAYER_OPTIONS: Array<{
  key: keyof LayerVisibility;
  label: string;
  icon: ReactNode;
}> = [
  { key: 'burgs', label: 'Burgs', icon: <Crown className="w-3 h-3" /> },
  { key: 'routes', label: 'Routes', icon: <Navigation className="w-3 h-3" /> },
  { key: 'markers', label: 'Markers', icon: <MapPin className="w-3 h-3" /> },
];

const WORLD_EXTENT_4326: [number, number, number, number] = [-180, -90, 180, 90];

const DEFAULT_TILE_SIZE = 256;

const toExtent = (bounds?: WorldMapBounds | null): [number, number, number, number] | null => {
  if (!bounds) return null;

  const { west, south, east, north } = bounds;
  const values = [west, south, east, north];
  if (values.some((value) => typeof value !== 'number' || Number.isNaN(value))) {
    return null;
  }

  const width = east - west;
  const height = north - south;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return [west, south, east, north];
};

const createGeographicTileSource = (tileSet: any, worldBounds?: WorldMapBounds) => {
  const minZoom = Number.isFinite(tileSet?.min_zoom) ? tileSet.min_zoom : 0;
  const maxZoomCandidate = Number.isFinite(tileSet?.max_zoom) ? tileSet.max_zoom : 7;
  const maxZoom = Math.max(minZoom, maxZoomCandidate);
  const tileSize = Number.isFinite(tileSet?.tile_size) ? tileSet.tile_size : DEFAULT_TILE_SIZE;

  const extent = toExtent(worldBounds) ?? WORLD_EXTENT_4326;
  const width = extent[2] - extent[0];

  const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => width / tileSize / Math.pow(2, z));

  const tileGrid = new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    resolutions,
    tileSize
  });

  return new XYZ({
    projection: 'EPSG:4326',
    url: tileSet.base_url,
    attributions: tileSet.attribution,
    tileGrid,
    wrapX: false,
    minZoom,
    maxZoom,
    transition: 0
  });
};

export function EnhancedOpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  
  // State
  const [mapMode, setMapMode] = useState<'world' | 'encounter'>('world');
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin' | 'measure' | 'info'>('move');
  const [selectedWorldMap, setSelectedWorldMap] = useState<string>('');
  const [selectedTileSet, setSelectedTileSet] = useState<string>(FANTASY_TILESET_ID);
  const [worldMaps, setWorldMaps] = useState<any[]>([]);
  const [tileSets, setTileSets] = useState<any[]>([FANTASY_TILESET]);
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(2);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    burgs: true,
    routes: true,
    rivers: true,
    cells: false, // Initially off for performance
    markers: true,
    campaignLocations: true,
    userPins: true
  });
  const [popupContent, setPopupContent] = useState<any>(null);

  const applyTileSetConstraints = useCallback((tileSet: any) => {
    const view = mapInstanceRef.current?.getView();
    if (!view) return;

    const minZoom = typeof tileSet?.min_zoom === 'number' ? tileSet.min_zoom : 0;
    const maxZoom = typeof tileSet?.max_zoom === 'number' ? tileSet.max_zoom : 20;

    view.setMinZoom(minZoom);
    view.setMaxZoom(maxZoom);

    const currentZoom = view.getZoom();
    if (typeof currentZoom === 'number') {
      if (currentZoom < minZoom) {
        view.setZoom(minZoom);
      } else if (currentZoom > maxZoom) {
        view.setZoom(maxZoom);
      }
    }
  }, []);

  const updateViewExtent = useCallback((bounds?: WorldMapBounds | null) => {
    const map = mapInstanceRef.current;
    const view = map?.getView();
    if (!map || !view) return;

    const extent = toExtent(bounds) ?? WORLD_EXTENT_4326;

    // OpenLayers View does not expose a setter, so update the optional property directly
    view.setProperties({ extent });

    const center = view.getCenter();
    if (center) {
      const clampedCenter: [number, number] = [
        Math.min(Math.max(center[0], extent[0]), extent[2]),
        Math.min(Math.max(center[1], extent[1]), extent[3])
      ];

      if (clampedCenter[0] !== center[0] || clampedCenter[1] !== center[1]) {
        view.setCenter(clampedCenter);
      }
    }

    const size = map.getSize();
    if (size) {
      view.fit(extent, { size, duration: 0 });
    }
  }, []);

  // Layer references
  const baseLayerRef = useRef<TileLayer | null>(null);
  const burgsLayerRef = useRef<VectorLayer | null>(null);
  const routesLayerRef = useRef<VectorLayer | null>(null);
  const riversLayerRef = useRef<VectorLayer | null>(null);
  const cellsLayerRef = useRef<VectorLayer | null>(null);
  const markersLayerRef = useRef<VectorLayer | null>(null);
  const campaignLayerRef = useRef<VectorLayer | null>(null);
  const pinsLayerRef = useRef<VectorLayer | null>(null);
  const encounterLayerRef = useRef<VectorLayer | null>(null);

  const layerRefMap = useMemo<Record<keyof LayerVisibility, MutableRefObject<VectorLayer | null>>>(() => ({
    burgs: burgsLayerRef,
    routes: routesLayerRef,
    rivers: riversLayerRef,
    cells: cellsLayerRef,
    markers: markersLayerRef,
    campaignLocations: campaignLayerRef,
    userPins: pinsLayerRef,
  }), []);

  const toggleLayer = useCallback((layerName: keyof LayerVisibility, value?: boolean) => {
    setLayerVisibility(prev => {
      const nextValue = typeof value === 'boolean' ? value : !prev[layerName];

      if (!nextValue) {
        const layer = layerRefMap[layerName].current;
        layer?.getSource()?.clear();
      }

      return {
        ...prev,
        [layerName]: nextValue
      };
    });
  }, [layerRefMap]);

  const loadInitialData = useCallback(async () => {
    const [worldMapsData, tileSetsData] = await Promise.all([
      mapDataLoader.loadWorldMaps(),
      mapDataLoader.loadTileSets()
    ]);

    setWorldMaps(worldMapsData);
    const sanitizedTileSets = (tileSetsData || []).filter((ts) => ts && ts.id);
    const mergedTileSets = [
      FANTASY_TILESET,
      ...sanitizedTileSets.filter((ts) => ts.id !== FANTASY_TILESET_ID)
    ];
    setTileSets(mergedTileSets);

    if (worldMapsData.length > 0) {
      const initialWorldMap = worldMapsData[0];
      setSelectedWorldMap(initialWorldMap.id);

      if (baseLayerRef.current) {
        const newSource = createGeographicTileSource(FANTASY_TILESET, initialWorldMap.bounds);
        baseLayerRef.current.setSource(newSource);
      }

      updateViewExtent(initialWorldMap.bounds);

      const view = mapInstanceRef.current?.getView();
      const extent = toExtent(initialWorldMap.bounds);
      if (view && extent) {
        view.fit(extent, {
          padding: [50, 50, 50, 50],
          maxZoom: 4
        });
      }
    }
  }, [updateViewExtent]);

  // Initialize OpenLayers map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initialTileSet = FANTASY_TILESET;

    // Base tile layer
    const baseLayer = new TileLayer({
      source: createGeographicTileSource(initialTileSet),
      preload: 2
    });
    baseLayerRef.current = baseLayer;

    // Vector layers for different data types
    const burgsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getBurgStyle,
      visible: layerVisibility.burgs
    });
    burgsLayerRef.current = burgsLayer;

    const routesLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getRouteStyle,
      visible: layerVisibility.routes
    });
    routesLayerRef.current = routesLayer;

    const riversLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getRiverStyle,
      visible: layerVisibility.rivers
    });
    riversLayerRef.current = riversLayer;

    const cellsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getCellStyle,
      visible: layerVisibility.cells
    });
    cellsLayerRef.current = cellsLayer;

    const markersLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getMarkerStyle,
      visible: layerVisibility.markers
    });
    markersLayerRef.current = markersLayer;

    const campaignLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getCampaignLocationStyle,
      visible: layerVisibility.campaignLocations
    });
    campaignLayerRef.current = campaignLayer;

    const pinsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getPinStyle,
      visible: layerVisibility.userPins
    });
    pinsLayerRef.current = pinsLayer;

    const encounterLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getEncounterStyle,
      visible: mapMode === 'encounter'
    });
    encounterLayerRef.current = encounterLayer;

    // Create popup overlay
    const overlay = new Overlay({
      element: popupRef.current!,
      autoPan: {
        animation: {
          duration: 250,
        },
      },
    });
    overlayRef.current = overlay;

    // Create map
    const map = new Map({
      target: mapRef.current,
      layers: [
        baseLayer,
        cellsLayer,      // Bottom layer
        riversLayer,
        routesLayer,
        burgsLayer,
        markersLayer,
        campaignLayer,
        encounterLayer,
        pinsLayer        // Top layer
      ],
      overlays: [overlay],
      view: new View({
        projection: 'EPSG:4326',
        center: [0, 0],
        zoom: 2,
        minZoom: initialTileSet.min_zoom ?? 0,
        maxZoom: initialTileSet.max_zoom ?? 7,
        enableRotation: false,
        extent: WORLD_EXTENT_4326,
        constrainOnlyCenter: true
      }),
      controls: defaultControls({
        zoom: false,
        attribution: true
      })
    });

    mapInstanceRef.current = map;
    applyTileSetConstraints(initialTileSet);

    // Event handlers
    map.on('click', handleMapClick);
    map.on('moveend', handleMapMoveEnd);
    map.getView().on('change:resolution', handleZoomChange);

    // Load initial data
    loadInitialData();

    return () => {
      map.dispose();
      mapInstanceRef.current = null;
    };
  }, [applyTileSetConstraints, loadInitialData]);

  // Update tile source with current world bounds
  const updateTileSource = useCallback((tileSet: any) => {
    if (!baseLayerRef.current) return;

    const currentWorldMap = worldMaps.find(m => m.id === selectedWorldMap);
    const worldBounds = currentWorldMap?.bounds;
    
    const newSource = createGeographicTileSource(tileSet, worldBounds);
    baseLayerRef.current.setSource(newSource);
    updateViewExtent(worldBounds);
    applyTileSetConstraints(tileSet);
  }, [worldMaps, selectedWorldMap, applyTileSetConstraints, updateViewExtent]);

  useEffect(() => {
    const activeTileSet = tileSets.find(ts => ts.id === selectedTileSet);
    applyTileSetConstraints(activeTileSet ?? null);
  }, [selectedTileSet, tileSets, applyTileSetConstraints]);

  // Update tile source when world map or tileset changes
  useEffect(() => {
    if (!selectedWorldMap || worldMaps.length === 0) return;
    
    const activeTileSet = tileSets.find(ts => ts.id === selectedTileSet);
    if (activeTileSet) {
      updateTileSource(activeTileSet);
    }
  }, [selectedWorldMap, worldMaps, updateTileSource, selectedTileSet, tileSets]);

  // Handle map mode changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const worldLayers = [
      burgsLayerRef.current,
      routesLayerRef.current,
      riversLayerRef.current,
      cellsLayerRef.current,
      markersLayerRef.current,
      campaignLayerRef.current
    ];

    const encounterLayer = encounterLayerRef.current;

    worldLayers.forEach(layer => {
      if (layer) layer.setVisible(mapMode === 'world');
    });

    if (encounterLayer) {
      encounterLayer.setVisible(mapMode === 'encounter');
    }

    if (mapMode === 'encounter') {
      const view = mapInstanceRef.current?.getView();
      if (view) {
        const maxZoom = view.getMaxZoom();
        view.setZoom(Math.min(15, typeof maxZoom === 'number' ? maxZoom : 15));
      }
      loadEncounterData();
    } else {
      loadWorldMapData();
    }
  }, [mapMode]);

  // Handle layer visibility changes
  useEffect(() => {
    burgsLayerRef.current?.setVisible(layerVisibility.burgs && mapMode === 'world');
    routesLayerRef.current?.setVisible(layerVisibility.routes && mapMode === 'world');
    riversLayerRef.current?.setVisible(layerVisibility.rivers && mapMode === 'world');
    cellsLayerRef.current?.setVisible(layerVisibility.cells && mapMode === 'world');
    markersLayerRef.current?.setVisible(layerVisibility.markers && mapMode === 'world');
    campaignLayerRef.current?.setVisible(layerVisibility.campaignLocations && mapMode === 'world');
    pinsLayerRef.current?.setVisible(layerVisibility.userPins);
  }, [layerVisibility, mapMode]);



  // Load world map data
  const loadWorldMapData = useCallback(async () => {
    if (!selectedWorldMap || mapMode !== 'world') return;

    setLoading(true);
    try {
      const view = mapInstanceRef.current?.getView();
      if (!view) return;

      const extent = view.calculateExtent();
      const bounds = mapDataLoader.getBoundsFromExtent(extent);
      
      const zoom = view.getZoom() || 0;
      const dataTypes = mapDataLoader.getDataTypesForZoom(zoom);

      // Load real data from PostGIS
      const promises: Promise<Feature[]>[] = [];

      if (dataTypes.includes('burgs') && layerVisibility.burgs) {
        promises.push(mapDataLoader.loadBurgs(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('routes') && layerVisibility.routes) {
        promises.push(mapDataLoader.loadRoutes(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('rivers') && layerVisibility.rivers) {
        promises.push(mapDataLoader.loadRivers(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('cells') && layerVisibility.cells) {
        promises.push(mapDataLoader.loadCells(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('markers') && layerVisibility.markers) {
        promises.push(mapDataLoader.loadMarkers(selectedWorldMap, bounds));
      }

      const results = await Promise.all(promises);
      
      // Update layers with real data
      let index = 0;
      if (dataTypes.includes('burgs') && layerVisibility.burgs) {
        burgsLayerRef.current?.getSource()?.clear();
        burgsLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('routes') && layerVisibility.routes) {
        routesLayerRef.current?.getSource()?.clear();
        routesLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('rivers') && layerVisibility.rivers) {
        riversLayerRef.current?.getSource()?.clear();
        riversLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('cells') && layerVisibility.cells) {
        cellsLayerRef.current?.getSource()?.clear();
        cellsLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('markers') && layerVisibility.markers) {
        markersLayerRef.current?.getSource()?.clear();
        markersLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }

    } catch (error) {
      console.error('Error loading world map data:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [selectedWorldMap, layerVisibility, mapMode, worldMaps]);

  useEffect(() => {
    if (mapMode === 'world') {
      loadWorldMapData();
    }
  }, [layerVisibility, mapMode, loadWorldMapData]);

  // Load encounter data
  const loadEncounterData = useCallback(async () => {
    if (!encounterLayerRef.current) return;

    // For encounter mode, you would load tactical battle map data
    // This is a placeholder - in real implementation, load from campaign encounter data
    const source = encounterLayerRef.current.getSource();
    if (source) {
      source.clear();
      // Add encounter-specific features here
    }
  }, []);

  // Event handlers
  const handleMapClick = useCallback((event: any) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (selectedTool === 'pin') {
      const coordinate = event.coordinate as [number, number];
      const [lon, lat] = coordinate;
      const newPin: MapPin = {
        id: Date.now().toString(),
        coordinates: [lon, lat],
        type: 'location',
        name: `Pin ${mapPins.length + 1}`,
        visible: true
      };
      setMapPins(prev => [...prev, newPin]);
    } else if (selectedTool === 'info') {
      // Show feature info
      const features = map.getFeaturesAtPixel(event.pixel);
      if (features.length > 0) {
        const feature = features[0];
        const coordinates = event.coordinate;
        
        setPopupContent({
          feature,
          coordinates
        });
        
        overlayRef.current?.setPosition(coordinates);
      } else {
        overlayRef.current?.setPosition(undefined);
        setPopupContent(null);
      }
    }
  }, [selectedTool, mapPins]);

  const handleMapMoveEnd = useCallback(() => {
    if (mapMode === 'world') {
      loadWorldMapData();
    }
  }, [loadWorldMapData, mapMode]);

  const handleZoomChange = useCallback(() => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      const zoom = view.getZoom() || 0;
      setCurrentZoom(Math.round(zoom));
      
      // Auto-enable/disable cells layer based on zoom
      if (zoom >= 10 && !layerVisibility.cells) {
        toggleLayer('cells', true);
      } else if (zoom < 8 && layerVisibility.cells) {
        toggleLayer('cells', false);
      }
    }
  }, [layerVisibility.cells, toggleLayer]);

  // Update pins layer
  useEffect(() => {
    if (!pinsLayerRef.current) return;

    const features = mapPins
      .filter(pin => pin.visible)
      .map(pin => {
        const feature = new Feature({
          geometry: new Point(pin.coordinates),
          id: pin.id,
          type: pin.type,
          name: pin.name,
          data: pin
        });
        return feature;
      });

    const source = pinsLayerRef.current.getSource();
    if (source) {
      source.clear();
      source.addFeatures(features);
    }
  }, [mapPins]);

  // Zoom functions
  const zoomIn = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.animate({ zoom: (view.getZoom() || 0) + 1, duration: 250 });
    }
  };

  const zoomOut = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.animate({ zoom: (view.getZoom() || 0) - 1, duration: 250 });
    }
  };

  // Change tile set
  const changeTileSet = (tileSetId: string) => {
    const tileSet = tileSets.find(ts => ts.id === tileSetId);
    if (!tileSet) return;

    updateTileSource(tileSet);
    setSelectedTileSet(tileSetId);
  };

  const tools = [
    { id: 'move', name: 'Pan', icon: <Move className="w-4 h-4" /> },
    { id: 'pin', name: 'Add Pin', icon: <MapPin className="w-4 h-4" /> },
    { id: 'measure', name: 'Measure', icon: <Navigation className="w-4 h-4" /> },
    { id: 'info', name: 'Info', icon: <Info className="w-4 h-4" /> }
  ];

  return (
    <Card className="h-full rounded-none border-0 border-r">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            {mapMode === 'world' ? <Globe className="w-5 h-5" /> : <Crosshair className="w-5 h-5" />}
            {mapMode === 'world' ? 'World Map' : 'Encounter Map'}
            {loading && <Badge variant="secondary" className="ml-2">Loading...</Badge>}
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {/* Map Mode Toggle */}
            <Tabs value={mapMode} onValueChange={(value) => setMapMode(value as 'world' | 'encounter')}>
              <TabsList className="h-8">
                <TabsTrigger value="world" className="h-6 px-2 text-xs">
                  <Globe className="w-3 h-3 mr-1" />
                  World
                </TabsTrigger>
                <TabsTrigger value="encounter" className="h-6 px-2 text-xs">
                  <Crosshair className="w-3 h-3 mr-1" />
                  Encounter
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* World Map Selector */}
            {mapMode === 'world' && (
              <Select value={selectedWorldMap} onValueChange={setSelectedWorldMap}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue placeholder="Select Map" />
                </SelectTrigger>
                <SelectContent>
                  {worldMaps.map(map => (
                    <SelectItem key={map.id} value={map.id}>
                      {map.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Tile Set Selector */}
            {mapMode === 'world' && (
              <Select value={selectedTileSet} onValueChange={changeTileSet}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder="Select Tiles" />
                </SelectTrigger>
                <SelectContent>
                  {tileSets.map(tileSet => (
                    <SelectItem key={tileSet.id} value={tileSet.id}>
                      {tileSet.name || tileSet.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Tools */}
            <div className="flex items-center gap-1 border-l pl-2">
              {tools.map((tool) => (
                <Button
                  key={tool.id}
                  variant={selectedTool === tool.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTool(tool.id as any)}
                  className="h-8 px-2"
                  title={tool.name}
                >
                  {tool.icon}
                </Button>
              ))}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 border-l pl-2">
              <Button
                variant="outline"
                size="sm"
                onClick={zoomOut}
                className="h-8 px-2"
              >
                <ZoomOut className="w-3 h-3" />
              </Button>
              <span className="text-xs font-medium w-8 text-center">{currentZoom}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={zoomIn}
                className="h-8 px-2"
              >
                <ZoomIn className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0 relative">
        <div 
          ref={mapRef}
          className="w-full bg-blue-50"
          style={{ height: 'calc(100vh - 200px)' }}
        />

        {/* Popup */}
        <div ref={popupRef} className="ol-popup">
          {popupContent && (
            <Card className="min-w-64">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-sm">
                    {popupContent.feature.get('name') || 'Feature'}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      overlayRef.current?.setPosition(undefined);
                      setPopupContent(null);
                    }}
                    className="h-6 w-6 p-0"
                  >
                    ×
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xs space-y-1">
                  <div>Type: {popupContent.feature.get('type')}</div>
                  {popupContent.feature.get('data') && (
                    <div>
                      {JSON.stringify(popupContent.feature.get('data'), null, 2)}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>

      {/* Map Controls Panel */}
      <div className="border-t p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Zoom: {currentZoom}</span>
            <span>Pins: {mapPins.filter(p => p.visible).length}</span>
            <span>Mode: {mapMode === 'world' ? 'Exploration' : 'Tactical'}</span>
          </div>
          <div className="flex gap-1">
            {mapMode === 'world' && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs"
                  >
                    <Layers className="w-3 h-3 mr-1" />
                    Layers
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 p-3">
                  <div className="flex flex-col gap-1 text-xs">
                    {TOGGLEABLE_LAYER_OPTIONS.map((option) => (
                      <div
                        key={option.key}
                        role="button"
                        tabIndex={0}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => toggleLayer(option.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleLayer(option.key);
                          }
                        }}
                      >
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          {option.icon}
                          {option.label}
                        </span>
                        <Checkbox
                          checked={layerVisibility[option.key]}
                          onCheckedChange={(checked) => {
                            if (checked === 'indeterminate') return;
                            toggleLayer(option.key, checked === true);
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Search className="w-3 h-3 mr-1" />
              Search
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Style functions
function getBurgStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    image: new CircleStyle({
      radius: data?.capital ? 8 : 6,
      fill: new Fill({ color: data?.capital ? '#FFD700' : '#4A90E2' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    }),
    text: new Text({
      text: data?.name || '',
      offsetY: -15,
      font: '12px sans-serif',
      fill: new Fill({ color: '#000' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    })
  });
}

function getRouteStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    stroke: new Stroke({
      color: data?.type === 'highway' ? '#8B4513' : '#CD853F',
      width: data?.type === 'highway' ? 4 : 2,
      lineDash: data?.type === 'path' ? [5, 5] : undefined
    })
  });
}

function getRiverStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    stroke: new Stroke({
      color: '#4FC3F7',
      width: Math.max(2, (data?.width || 1) * 2)
    })
  });
}

function getCellStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    fill: new Fill({
      color: getBiomeColor(data?.biome)
    }),
    stroke: new Stroke({
      color: 'rgba(0,0,0,0.1)',
      width: 0.5
    })
  });
}

function getMarkerStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: '#FF6B6B' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    }),
    text: new Text({
      text: data?.note || '',
      offsetY: -15,
      font: '10px sans-serif',
      fill: new Fill({ color: '#000' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    })
  });
}

function getCampaignLocationStyle(feature: Feature) {
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: '#9B59B6' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    }),
    text: new Text({
      text: feature.get('name') || '',
      offsetY: -18,
      font: 'bold 12px sans-serif',
      fill: new Fill({ color: '#000' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    })
  });
}

function getPinStyle(feature: Feature) {
  const type = feature.get('type');
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: getPinColor(type) }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    }),
    text: new Text({
      text: feature.get('name') || '',
      offsetY: -20,
      font: '12px sans-serif',
      fill: new Fill({ color: '#000' }),
      stroke: new Stroke({ color: '#FFF', width: 2 })
    })
  });
}

function getEncounterStyle(feature: Feature) {
  return new Style({
    fill: new Fill({ color: 'rgba(128,128,128,0.7)' }),
    stroke: new Stroke({ color: '#666', width: 2 })
  });
}

function getBiomeColor(biome: number): string {
  switch (biome) {
    case 1: return 'rgba(34,139,34,0.3)';
    case 2: return 'rgba(218,165,32,0.3)';
    case 3: return 'rgba(70,130,180,0.3)';
    case 4: return 'rgba(128,128,128,0.3)';
    default: return 'rgba(144,238,144,0.3)';
  }
}

function getPinColor(type: string): string {
  switch (type) {
    case 'party': return '#4A90E2';
    case 'enemy': return '#E74C3C';
    case 'location': return '#2ECC71';
    case 'treasure': return '#F39C12';
    case 'danger': return '#E67E22';
    case 'town': return '#9B59B6';
    case 'dungeon': return '#95A5A6';
    default: return '#7F8C8D';
  }
}
