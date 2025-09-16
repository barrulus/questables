import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
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
  Info
} from "lucide-react";

// OpenLayers imports
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import OSM from 'ol/source/OSM';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { Style, Fill, Stroke, Circle as CircleStyle, Text, Icon } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import { defaults as defaultControls } from 'ol/control';
import GeoJSON from 'ol/format/GeoJSON';
import { Overlay } from 'ol';

interface MapPin {
  id: string;
  coordinates: [number, number]; // [longitude, latitude]
  type: 'party' | 'enemy' | 'location' | 'treasure' | 'danger' | 'town' | 'dungeon' | 'burg' | 'marker';
  name: string;
  visible: boolean;
  description?: string;
  data?: any; // Additional data from PostGIS
}

interface WorldMapData {
  id: string;
  name: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  layers: {
    political: boolean;
    terrain: boolean;
    climate: boolean;
    cultures: boolean;
    religions: boolean;
    provinces: boolean;
  };
}

interface TileSetData {
  id: string;
  name: string;
  base_url: string;
  format: string;
  min_zoom: number;
  max_zoom: number;
  attribution?: string;
}

export function OpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const [mapMode, setMapMode] = useState<'world' | 'encounter'>('world');
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin' | 'measure'>('move');
  const [selectedWorldMap, setSelectedWorldMap] = useState<string>('');
  const [selectedTileSet, setSelectedTileSet] = useState<string>('osm');
  const [worldMaps, setWorldMaps] = useState<WorldMapData[]>([]);
  const [tileSets, setTileSets] = useState<TileSetData[]>([]);
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [loading, setLoading] = useState(false);

  // Layer references
  const baseLayerRef = useRef<TileLayer | null>(null);
  const worldDataLayerRef = useRef<VectorLayer | null>(null);
  const pinsLayerRef = useRef<VectorLayer | null>(null);
  const encounterLayerRef = useRef<VectorLayer | null>(null);

  // Initialize OpenLayers map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Base tile layer (OSM as default)
    const baseLayer = new TileLayer({
      source: new OSM(),
      preload: 2
    });
    baseLayerRef.current = baseLayer;

    // World data vector layer (for PostGIS data)
    const worldDataLayer = new VectorLayer({
      source: new VectorSource(),
      style: getWorldDataStyle,
      visible: mapMode === 'world'
    });
    worldDataLayerRef.current = worldDataLayer;

    // Pins vector layer
    const pinsLayer = new VectorLayer({
      source: new VectorSource(),
      style: getPinStyle
    });
    pinsLayerRef.current = pinsLayer;

    // Encounter layer (for tactical maps)
    const encounterLayer = new VectorLayer({
      source: new VectorSource(),
      style: getEncounterStyle,
      visible: mapMode === 'encounter'
    });
    encounterLayerRef.current = encounterLayer;

    // Create map
    const map = new Map({
      target: mapRef.current,
      layers: [baseLayer, worldDataLayer, encounterLayer, pinsLayer],
      view: new View({
        center: fromLonLat([0, 0]), // Default to world center
        zoom: 2,
        minZoom: 1,
        maxZoom: 20
      }),
      controls: defaultControls({
        zoom: false, // We'll use custom controls
        attribution: true
      })
    });

    mapInstanceRef.current = map;

    // Add click handler
    map.on('click', handleMapClick);

    return () => {
      map.dispose();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle map mode changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const worldLayer = worldDataLayerRef.current;
    const encounterLayer = encounterLayerRef.current;

    if (worldLayer && encounterLayer) {
      worldLayer.setVisible(mapMode === 'world');
      encounterLayer.setVisible(mapMode === 'encounter');

      if (mapMode === 'encounter') {
        // Switch to tactical view with grid
        mapInstanceRef.current.getView().setZoom(15);
        loadEncounterData();
      } else {
        // Switch to world view
        mapInstanceRef.current.getView().setZoom(6);
        loadWorldMapData();
      }
    }
  }, [mapMode]);

  // Load world map data from PostGIS
  const loadWorldMapData = useCallback(async () => {
    if (!selectedWorldMap || !worldDataLayerRef.current) return;

    setLoading(true);
    try {
      // In a real app, these would be API calls to your Supabase backend
      // For now, we'll simulate the data structure
      
      // Load burgs (cities)
      const burgs = await loadBurgsData(selectedWorldMap);
      const burgFeatures = burgs.map(burg => {
        const feature = new Feature({
          geometry: new Point(fromLonLat([burg.xworld, burg.yworld])),
          id: burg.id,
          type: 'burg',
          data: burg
        });
        return feature;
      });

      // Load routes (roads)
      const routes = await loadRoutesData(selectedWorldMap);
      const routeFeatures = routes.map(route => {
        // Convert GeoJSON to OpenLayers geometry
        const geometry = new GeoJSON().readGeometry(route.geom);
        const feature = new Feature({
          geometry: geometry,
          id: route.id,
          type: 'route',
          data: route
        });
        return feature;
      });

      // Load rivers
      const rivers = await loadRiversData(selectedWorldMap);
      const riverFeatures = rivers.map(river => {
        const geometry = new GeoJSON().readGeometry(river.geom);
        const feature = new Feature({
          geometry: geometry,
          id: river.id,
          type: 'river',
          data: river
        });
        return feature;
      });

      // Load cells (terrain)
      const cells = await loadCellsData(selectedWorldMap);
      const cellFeatures = cells.map(cell => {
        const geometry = new GeoJSON().readGeometry(cell.geom);
        const feature = new Feature({
          geometry: geometry,
          id: cell.id,
          type: 'cell',
          data: cell
        });
        return feature;
      });

      // Add all features to the world data layer
      const source = worldDataLayerRef.current.getSource();
      if (source) {
        source.clear();
        source.addFeatures([...cellFeatures, ...riverFeatures, ...routeFeatures, ...burgFeatures]);
      }

      // Fit view to world map bounds
      const worldMap = worldMaps.find(m => m.id === selectedWorldMap);
      if (worldMap) {
        const extent = [
          worldMap.bounds.west,
          worldMap.bounds.south,
          worldMap.bounds.east,
          worldMap.bounds.north
        ];
        mapInstanceRef.current?.getView().fit(fromLonLat(extent), {
          padding: [50, 50, 50, 50]
        });
      }

    } catch (error) {
      console.error('Error loading world map data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedWorldMap, worldMaps]);

  // Load encounter/tactical map data
  const loadEncounterData = useCallback(async () => {
    if (!encounterLayerRef.current) return;

    // Load encounter-specific features (combat grid, obstacles, etc.)
    const encounterFeatures = [
      // Example tactical features - in real app, load from campaign data
      new Feature({
        geometry: new Polygon([[
          fromLonLat([-0.1, 51.5]),
          fromLonLat([-0.09, 51.5]),
          fromLonLat([-0.09, 51.51]),
          fromLonLat([-0.1, 51.51]),
          fromLonLat([-0.1, 51.5])
        ]]),
        type: 'obstacle',
        data: { name: 'Stone Wall' }
      })
    ];

    const source = encounterLayerRef.current.getSource();
    if (source) {
      source.clear();
      source.addFeatures(encounterFeatures);
    }
  }, []);

  // Simulated data loading functions (replace with real API calls)
  const loadBurgsData = async (worldMapId: string) => {
    // This would be a real API call to get_burgs_by_world_map
    return [
      {
        id: '1',
        name: 'Rivendell',
        xworld: -2.0,
        yworld: 52.0,
        population: 5000,
        capital: false,
        port: false
      },
      {
        id: '2',
        name: 'Minas Tirith',
        xworld: 1.0,
        yworld: 51.0,
        population: 50000,
        capital: true,
        port: false
      }
    ];
  };

  const loadRoutesData = async (worldMapId: string) => {
    return [
      {
        id: '1',
        name: 'Great West Road',
        type: 'highway',
        geom: {
          type: 'LineString',
          coordinates: [[-2.0, 52.0], [1.0, 51.0]]
        }
      }
    ];
  };

  const loadRiversData = async (worldMapId: string) => {
    return [
      {
        id: '1',
        name: 'Anduin',
        type: 'river',
        geom: {
          type: 'LineString',
          coordinates: [[-1.5, 52.5], [-1.0, 51.5], [0.5, 50.5]]
        }
      }
    ];
  };

  const loadCellsData = async (worldMapId: string) => {
    return []; // Cells might be too numerous for initial load
  };

  // Map click handler
  const handleMapClick = useCallback((event: any) => {
    if (selectedTool === 'pin') {
      const coordinate = toLonLat(event.coordinate);
      const newPin: MapPin = {
        id: Date.now().toString(),
        coordinates: [coordinate[0], coordinate[1]],
        type: 'location',
        name: `Pin ${mapPins.length + 1}`,
        visible: true
      };
      setMapPins(prev => [...prev, newPin]);
      updatePinsLayer([...mapPins, newPin]);
    }
  }, [selectedTool, mapPins]);

  // Update pins layer
  const updatePinsLayer = useCallback((pins: MapPin[]) => {
    if (!pinsLayerRef.current) return;

    const features = pins
      .filter(pin => pin.visible)
      .map(pin => {
        const feature = new Feature({
          geometry: new Point(fromLonLat(pin.coordinates)),
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
  }, []);

  // Update pins when mapPins changes
  useEffect(() => {
    updatePinsLayer(mapPins);
  }, [mapPins, updatePinsLayer]);

  // Style functions
  const getWorldDataStyle = (feature: Feature) => {
    const type = feature.get('type');
    
    switch (type) {
      case 'burg':
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
      
      case 'route':
        return new Style({
          stroke: new Stroke({
            color: '#8B4513',
            width: 3,
            lineDash: [5, 5]
          })
        });
      
      case 'river':
        return new Style({
          stroke: new Stroke({
            color: '#4FC3F7',
            width: 4
          })
        });
      
      case 'cell':
        const cellData = feature.get('data');
        return new Style({
          fill: new Fill({
            color: getBiomeColor(cellData?.biome)
          }),
          stroke: new Stroke({
            color: 'rgba(0,0,0,0.1)',
            width: 1
          })
        });
      
      default:
        return new Style();
    }
  };

  const getPinStyle = (feature: Feature) => {
    const type = feature.get('type');
    const name = feature.get('name');
    
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: getPinColor(type) }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      }),
      text: new Text({
        text: name || '',
        offsetY: -20,
        font: '12px sans-serif',
        fill: new Fill({ color: '#000' }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      })
    });
  };

  const getEncounterStyle = (feature: Feature) => {
    const type = feature.get('type');
    
    switch (type) {
      case 'obstacle':
        return new Style({
          fill: new Fill({ color: 'rgba(128,128,128,0.7)' }),
          stroke: new Stroke({ color: '#666', width: 2 })
        });
      
      default:
        return new Style();
    }
  };

  const getBiomeColor = (biome: number): string => {
    switch (biome) {
      case 1: return 'rgba(34,139,34,0.3)'; // Forest
      case 2: return 'rgba(218,165,32,0.3)'; // Desert
      case 3: return 'rgba(70,130,180,0.3)'; // Water
      case 4: return 'rgba(128,128,128,0.3)'; // Mountain
      default: return 'rgba(144,238,144,0.3)'; // Grassland
    }
  };

  const getPinColor = (type: string): string => {
    switch (type) {
      case 'party': return '#4A90E2';
      case 'enemy': return '#E74C3C';
      case 'location': return '#2ECC71';
      case 'treasure': return '#F39C12';
      case 'danger': return '#E67E22';
      case 'town': return '#9B59B6';
      case 'dungeon': return '#95A5A6';
      case 'burg': return '#3498DB';
      default: return '#7F8C8D';
    }
  };

  // Zoom functions
  const zoomIn = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.setZoom((view.getZoom() || 0) + 1);
    }
  };

  const zoomOut = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.setZoom((view.getZoom() || 0) - 1);
    }
  };

  // Change tile set
  const changeTileSet = (tileSetId: string) => {
    if (!baseLayerRef.current || !mapInstanceRef.current) return;

    let newSource;
    if (tileSetId === 'osm') {
      newSource = new OSM();
    } else {
      const tileSet = tileSets.find(ts => ts.id === tileSetId);
      if (tileSet) {
        newSource = new XYZ({
          url: tileSet.base_url,
          attributions: tileSet.attribution
        });
      }
    }

    if (newSource) {
      baseLayerRef.current.setSource(newSource);
      setSelectedTileSet(tileSetId);
    }
  };

  const tools = [
    { id: 'move', name: 'Pan', icon: <Move className="w-4 h-4" /> },
    { id: 'pin', name: 'Add Pin', icon: <MapPin className="w-4 h-4" /> },
    { id: 'measure', name: 'Measure', icon: <Navigation className="w-4 h-4" /> }
  ];

  return (
    <Card className="h-full rounded-none border-0 border-r">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            {mapMode === 'world' ? <Globe className="w-5 h-5" /> : <Crosshair className="w-5 h-5" />}
            {mapMode === 'world' ? 'World Map' : 'Encounter Map'}
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
                  <SelectValue placeholder="World Map" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Middle Earth</SelectItem>
                  <SelectItem value="faerun">Faerûn</SelectItem>
                  <SelectItem value="custom">Custom World</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* Tile Set Selector */}
            <Select value={selectedTileSet} onValueChange={changeTileSet}>
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="osm">OSM</SelectItem>
                <SelectItem value="satellite">Satellite</SelectItem>
                <SelectItem value="terrain">Terrain</SelectItem>
              </SelectContent>
            </Select>

            {/* Tools */}
            <div className="flex items-center gap-1 border-l pl-2">
              {tools.map((tool) => (
                <Button
                  key={tool.id}
                  variant={selectedTool === tool.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTool(tool.id as any)}
                  className="h-8 px-2"
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
      
      <CardContent className="p-0">
        <div 
          ref={mapRef}
          className="w-full bg-blue-50"
          style={{ height: 'calc(100vh - 140px)' }}
        >
          {loading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-50">
              <div className="text-sm">Loading map data...</div>
            </div>
          )}
        </div>
      </CardContent>

      {/* Map Info Panel */}
      <div className="border-t p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Pins: {mapPins.filter(p => p.visible).length}</span>
            <span>Mode: {mapMode === 'world' ? 'Exploration' : 'Tactical'}</span>
            {selectedWorldMap && <span>Map: {selectedWorldMap}</span>}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Layers className="w-3 h-3 mr-1" />
              Layers
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Info className="w-3 h-3 mr-1" />
              Info
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}