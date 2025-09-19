import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { RefObject, ReactNode } from "react";
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
import 'ol/ol.css';
import TileGrid from 'ol/tilegrid/TileGrid';
import { defaults as defaultControls } from 'ol/control';
import { Overlay } from 'ol';
import { mapDataLoader, type WorldMapBounds } from './map-data-loader';
import { DEFAULT_PIXEL_EXTENT, questablesProjection, updateProjectionExtent } from './map-projection';

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

const HEIGHTMAP_TILESET_ID = 'fantasy-heightmap-relief';
const HEIGHTMAP_TILESET = {
  id: HEIGHTMAP_TILESET_ID,
  name: 'Heightmap Relief',
  base_url: '/tiles-hm/{z}/{x}/{y}.png',
  attribution: 'Heightmap Relief Tiles',
  min_zoom: 0,
  max_zoom: 14,
  tile_size: 256,
  wrapX: false
};

const BUILTIN_TILESETS = [FANTASY_TILESET, HEIGHTMAP_TILESET];

const LABEL_VISIBILITY = {
  burgs: 3,
  markers: 6,
  campaignLocations: 7,
  pins: 6
} as const;

const MARKER_TYPE_ICONS: Record<string, string> = {
  circuses: '🎪',
  mirage: '💦',
  caves: '🦇',
  jousts: '🤺',
  waterfalls: '⟱',
  inns: '🍻',
  'hot-springs': '♨️',
  dungeons: '🗝️',
  'hill-monsters': '👹',
  'water-sources': '💧',
  bridges: '🌉',
  'sea-monsters': '🦑',
  canoes: '🛶',
  'disturbed-burials': '💀',
  volcanoes: '🌋',
  libraries: '📚',
  pirates: '🏴‍☠️',
  rifts: '🎆',
  'sacred-pineries': '🌲',
  'lake-monsters': '🐉',
  battlefields: '⚔️',
  'sacred-forests': '🌳',
  brigands: '💰',
  lighthouses: '🚨',
  encounters: '🧙',
  statues: '🗿',
  necropolises: '🪦',
  migration: '🐗',
  ruins: '🏺',
  fairs: '🎠',
  mines: '⛏️',
  portals: '🌀'
};

const DEFAULT_ROUTE_STYLE = new Style({
  stroke: new Stroke({
    color: '#b07a57',
    width: 2,
    lineCap: 'round',
    lineJoin: 'round'
  })
});

const DEFAULT_ROUTE_STYLES = [DEFAULT_ROUTE_STYLE];

const ROUTE_STYLE_CONFIG: Record<string, { minZoom: number; styles: Style[] }> = {
  royal: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#FFD700',
          width: 3,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  majorSea: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#FFFFFF',
          width: 3,
          lineCap: 'round',
          lineJoin: 'round'
        })
      }),
      new Style({
        stroke: new Stroke({
          color: '#1D4ED8',
          width: 2,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  regional: {
    minZoom: 5,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#87CEEB',
          width: 2,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  market: {
    minZoom: 5,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#8B4513',
          width: 2,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  local: {
    minZoom: 6,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#5C4033',
          width: 1.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [8, 6]
        })
      })
    ]
  },
  footpath: {
    minZoom: 7,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#D2B48C',
          width: 1.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [1, 8]
        })
      })
    ]
  }
};

const BURG_ZOOM_RULES = [
  { minZoom: 6, minPopulation: 0 },
  { minZoom: 5, minPopulation: 250 },
  { minZoom: 4, minPopulation: 1000 },
  { minZoom: 3, minPopulation: 10000 }
] as const;

const BURG_CATEGORY_THRESHOLDS = [
  { minPopulation: 10000, category: 'city' },
  { minPopulation: 1000, category: 'town' },
  { minPopulation: 250, category: 'village' },
  { minPopulation: 0, category: 'hamlet' }
] as const;

type BurgCategory = typeof BURG_CATEGORY_THRESHOLDS[number]['category'];

const BURG_STYLE_CONFIG: Record<BurgCategory, { radius: number; fill: string; stroke: string; font: string }> = {
  city:    { radius: 9, fill: '#1f78ff', stroke: '#ffffff', font: 'bold 13px "Inter", sans-serif' },
  town:    { radius: 7, fill: '#4c9c2d', stroke: '#ffffff', font: 'bold 12px "Inter", sans-serif' },
  village: { radius: 6, fill: '#c17d25', stroke: '#ffffff', font: '12px "Inter", sans-serif' },
  hamlet:  { radius: 5, fill: '#7b7f8c', stroke: '#ffffff', font: '12px "Inter", sans-serif' }
};

function getMinPopulationForZoom(zoom: number): number {
  const rule = BURG_ZOOM_RULES.find(({ minZoom }) => zoom >= minZoom);
  return rule ? rule.minPopulation : Number.POSITIVE_INFINITY;
}

function getBurgCategory(population: number): BurgCategory {
  const match = BURG_CATEGORY_THRESHOLDS.find(({ minPopulation }) => population >= minPopulation);
  return match ? match.category : 'hamlet';
}

const TOGGLEABLE_LAYER_OPTIONS: Array<{
  key: keyof LayerVisibility;
  label: string;
  icon: ReactNode;
}> = [
  { key: 'burgs', label: 'Burgs', icon: <Crown className="w-3 h-3" /> },
  { key: 'routes', label: 'Routes', icon: <Navigation className="w-3 h-3" /> },
  { key: 'markers', label: 'Markers', icon: <MapPin className="w-3 h-3" /> },
];

const DEFAULT_TILE_SIZE = 256;

const createGeographicTileSource = (tileSet: any, worldBounds?: WorldMapBounds) => {
  const minZoom = Number.isFinite(tileSet?.min_zoom) ? tileSet.min_zoom : 0;
  const maxZoomCandidate = Number.isFinite(tileSet?.max_zoom) ? tileSet.max_zoom : 7;
  const maxZoom = Math.max(minZoom, maxZoomCandidate);
  const tileSize = Number.isFinite(tileSet?.tile_size) ? tileSet.tile_size : DEFAULT_TILE_SIZE;

  const extent = updateProjectionExtent(worldBounds ?? null);
  const width = extent[2] - extent[0];

  const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => width / tileSize / Math.pow(2, z));

  const tileGrid = new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    resolutions,
    tileSize
  });

  return new XYZ({
    projection: questablesProjection,
    url: tileSet.base_url,
    attributions: tileSet.attribution,
    tileGrid,
    wrapX: false,
    minZoom,
    maxZoom,
    transition: 0
  });
};

export function OpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const tileSetMinZoomRef = useRef<number>(0);
  const enforcedMinZoomRef = useRef<number>(0);
  const currentWorldBoundsRef = useRef<WorldMapBounds | null>(null);
  const currentZoomRef = useRef<number>(0);
  const hoveredFeatureIdRef = useRef<string | null>(null);

  // State
  const [mapMode, setMapMode] = useState<'world' | 'encounter'>('world');
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin' | 'measure' | 'info'>('move');
  const [selectedWorldMap, setSelectedWorldMap] = useState<string>('');
  const [selectedTileSet, setSelectedTileSet] = useState<string>(FANTASY_TILESET_ID);
  const [worldMaps, setWorldMaps] = useState<any[]>([]);
  const [tileSets, setTileSets] = useState<any[]>(BUILTIN_TILESETS);
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(0);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    burgs: false,
    routes: false,
    rivers: false,
    cells: false,
    markers: false,
    campaignLocations: true,
    userPins: true
  });
  const [popupContent, setPopupContent] = useState<any>(null);

  const applyTileSetConstraints = useCallback((tileSet: any) => {
    const view = mapInstanceRef.current?.getView();
    if (!view) return;

    const minZoom = typeof tileSet?.min_zoom === 'number' ? tileSet.min_zoom : 0;
    const maxZoom = typeof tileSet?.max_zoom === 'number' ? tileSet.max_zoom : 20;

    tileSetMinZoomRef.current = minZoom;
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

    currentWorldBoundsRef.current = bounds ?? null;
    const extent = updateProjectionExtent(bounds ?? null);

    // OpenLayers View does not expose a setter, so update the optional property directly
    view.setProperties({ extent });

    const targetCenter: [number, number] = [
      (extent[0] + extent[2]) / 2,
      (extent[1] + extent[3]) / 2
    ];
    view.setCenter(targetCenter);

    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) {
      requestAnimationFrame(() => updateViewExtent(bounds ?? null));
      return;
    }

    const width = extent[2] - extent[0];
    const height = extent[3] - extent[1];
    const requiredResolution = Math.max(width / size[0], height / size[1]);
    const extentZoom = view.getZoomForResolution(requiredResolution);

    if (typeof extentZoom === 'number' && Number.isFinite(extentZoom)) {
      const enforcedMinZoom = Math.max(tileSetMinZoomRef.current, extentZoom);
      enforcedMinZoomRef.current = enforcedMinZoom;
      view.setMinZoom(enforcedMinZoom);

      const currentZoom = view.getZoom();
      if (typeof currentZoom !== 'number' || currentZoom < enforcedMinZoom) {
        view.setZoom(enforcedMinZoom);
      }
    }

    map.renderSync();
  }, []);

  const getZoomForResolution = useCallback((resolution: number) => {
    const view = mapInstanceRef.current?.getView();
    if (!view) return currentZoomRef.current;
    const zoom = view.getZoomForResolution(resolution);
    return typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : currentZoomRef.current;
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
  const burgStyleCacheRef = useRef<Record<string, Style>>({});
  const markerIconCacheRef = useRef<Record<string, Style>>({});

  const getBurgStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data');
    const zoom = getZoomForResolution(resolution);
    if (!Number.isFinite(zoom)) return null;

    const effectiveZoom = Math.floor(zoom);
    const population = Number(
      data?.population ?? data?.populationraw ?? data?.populationRaw ?? 0
    );
    const minPopulation = getMinPopulationForZoom(effectiveZoom);

    if (population < minPopulation || effectiveZoom < 3) {
      return null;
    }

    const category = getBurgCategory(population);
    const cacheKey = `${category}-${data?.capital ? 'capital' : 'standard'}`;
    const showLabel = effectiveZoom >= LABEL_VISIBILITY.burgs;
    let style = burgStyleCacheRef.current[cacheKey];

    if (!style) {
      const config = BURG_STYLE_CONFIG[category];

      const radius = config.radius + (data?.capital ? 2 : 0);

      style = new Style({
        image: new CircleStyle({
          radius,
          fill: new Fill({ color: data?.capital ? '#FFD700' : config.fill }),
          stroke: new Stroke({ color: config.stroke, width: 2 })
        }),
        text: new Text({
          offsetY: -radius - 10,
          font: config.font,
          fill: new Fill({ color: '#1f2933' }),
          stroke: new Stroke({ color: '#ffffff', width: 3 }),
          placement: 'point'
        })
      });

      burgStyleCacheRef.current[cacheKey] = style;
    }

    const text = style.getText();
    if (text) {
      text.setText(showLabel ? data?.name || feature.get('name') || '' : '');
    }

    return style;
  }, [getZoomForResolution]);

  const getRouteStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);

    if (!Number.isFinite(zoom)) {
      return null;
    }

    const routeType = String(data?.type ?? feature.get('type') ?? '');
    const config = ROUTE_STYLE_CONFIG[routeType];

    if (config) {
      if ((zoom as number) < config.minZoom) {
        return null;
      }
      return config.styles;
    }

    return (zoom as number) >= 3 ? DEFAULT_ROUTE_STYLES : null;
  }, [getZoomForResolution]);

  const getMarkerStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);

    if (!Number.isFinite(zoom) || (zoom as number) < LABEL_VISIBILITY.markers) {
      return null;
    }

    const type = String(data?.type ?? feature.get('type') ?? '');
    const icon = MARKER_TYPE_ICONS[type] ?? '?';

    let iconStyle = markerIconCacheRef.current[type];
    if (!iconStyle) {
      iconStyle = new Style({
        text: new Text({
          text: icon,
          font: '20px sans-serif',
          textBaseline: 'middle',
          textAlign: 'center',
          fill: new Fill({ color: '#000' }),
          stroke: new Stroke({ color: '#FFF', width: 3 }),
          placement: 'point'
        })
      });
      markerIconCacheRef.current[type] = iconStyle;
    }

    const showLabel = (zoom as number) >= LABEL_VISIBILITY.markers;
    const labelText = showLabel ? data?.name || '' : '';
    if (!labelText) {
      return iconStyle;
    }

    const labelStyle = new Style({
      text: new Text({
        text: labelText,
        offsetY: -24,
        font: '10px sans-serif',
        fill: new Fill({ color: '#111827' }),
        stroke: new Stroke({ color: '#FFF', width: 3 }),
        textAlign: 'center',
        textBaseline: 'bottom',
        placement: 'point'
      })
    });

    return [iconStyle, labelStyle];
  }, [getZoomForResolution]);

  const getCampaignLocationStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);
    const showLabel = zoom >= LABEL_VISIBILITY.campaignLocations;

    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: '#9B59B6' }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      }),
      text: new Text({
        text: showLabel ? data?.name || '' : '',
        offsetY: -18,
        font: 'bold 12px sans-serif',
        fill: new Fill({ color: '#000' }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      })
    });
  }, [getZoomForResolution]);

  const getPinStyle = useCallback((feature: Feature, resolution: number) => {
    const type = feature.get('type');
    const zoom = getZoomForResolution(resolution);
    const showLabel = zoom >= LABEL_VISIBILITY.pins;

    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: getPinColor(type) }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      }),
      text: new Text({
        text: showLabel ? feature.get('name') || '' : '',
        offsetY: -20,
        font: '12px sans-serif',
        fill: new Fill({ color: '#000' }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      })
    });
  }, [getZoomForResolution]);

  const layerRefMap = useMemo<Record<keyof LayerVisibility, RefObject<VectorLayer | null>>>(() => ({
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
    const builtInIds = new Set(BUILTIN_TILESETS.map((ts) => ts.id));
    const mergedTileSets = [
      ...BUILTIN_TILESETS,
      ...sanitizedTileSets.filter((ts) => !builtInIds.has(ts.id))
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

    }
  }, [updateViewExtent]);

  // Initialize OpenLayers map

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
      const features = map.getFeaturesAtPixel(event.pixel) as Feature[];
      if (features.length > 0) {
        const feature = features[0];
        const coordinates = event.coordinate;
        const data = feature.get('data') ?? feature.getProperties();
        const featureId = feature.get('id') ?? data?.id ?? null;
        hoveredFeatureIdRef.current = featureId;

        setPopupContent({
          feature,
          data,
          coordinates
        });

        overlayRef.current?.setPosition(coordinates);
      } else {
        overlayRef.current?.setPosition(undefined);
        setPopupContent(null);
        hoveredFeatureIdRef.current = null;
      }
    }
  }, [selectedTool, mapPins]);

  const handleZoomChange = useCallback(() => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      const zoom = view.getZoom() || 0;
      setCurrentZoom(Math.round(zoom));
      currentZoomRef.current = zoom;

      const minZoom = enforcedMinZoomRef.current || tileSetMinZoomRef.current;
      if (zoom < minZoom) {
        view.setZoom(minZoom);
        setCurrentZoom(Math.round(minZoom));
        return;
      }

      // Auto-enable/disable cells layer based on zoom
      if (zoom >= 10 && !layerVisibility.cells) {
        toggleLayer('cells', true);
      } else if (zoom < 8 && layerVisibility.cells) {
        toggleLayer('cells', false);
      }

      burgsLayerRef.current?.changed();
    }
  }, [layerVisibility.cells, toggleLayer]);

  const handlePointerMove = useCallback((event: any) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const targetElement = map.getTargetElement();
    if (!targetElement) return;

    const features = map.getFeaturesAtPixel(event.pixel) as Feature[];
    targetElement.style.cursor = features.length > 0 ? 'pointer' : '';

    if (selectedTool !== 'info') return;

    if (features.length > 0) {
      const feature = features[0];
      const data = feature.get('data') ?? feature.getProperties();
      const featureId = feature.get('id') ?? data?.id ?? null;
      if (hoveredFeatureIdRef.current === featureId) {
        overlayRef.current?.setPosition(event.coordinate);
        return;
      }

      hoveredFeatureIdRef.current = featureId;
      setPopupContent({
        feature,
        data,
        coordinates: event.coordinate
      });
      overlayRef.current?.setPosition(event.coordinate);
    } else if (hoveredFeatureIdRef.current !== null) {
      hoveredFeatureIdRef.current = null;
      overlayRef.current?.setPosition(undefined);
      setPopupContent(null);
    }
  }, [selectedTool]);

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
  }, [selectedWorldMap, layerVisibility, mapMode]);

  const handleMapMoveEnd = useCallback(() => {
    if (mapMode === 'world') {
      loadWorldMapData();
    }
  }, [loadWorldMapData, mapMode]);

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
      style: (feature, resolution) => getBurgStyle(feature, resolution),
      visible: layerVisibility.burgs
    });
    burgsLayerRef.current = burgsLayer;

    const routesLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getRouteStyle(feature, resolution),
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
      style: (feature, resolution) => getMarkerStyle(feature, resolution),
      visible: layerVisibility.markers
    });
    markersLayerRef.current = markersLayer;

    const campaignLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getCampaignLocationStyle(feature, resolution),
      visible: layerVisibility.campaignLocations
    });
    campaignLayerRef.current = campaignLayer;

    const pinsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getPinStyle(feature, resolution),
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
        projection: questablesProjection,
        center: [
          (DEFAULT_PIXEL_EXTENT[0] + DEFAULT_PIXEL_EXTENT[2]) / 2,
          (DEFAULT_PIXEL_EXTENT[1] + DEFAULT_PIXEL_EXTENT[3]) / 2
        ],
        zoom: 2,
        minZoom: initialTileSet.min_zoom ?? 0,
        maxZoom: initialTileSet.max_zoom ?? 7,
        enableRotation: false,
        extent: DEFAULT_PIXEL_EXTENT,
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
    const view = map.getView();
    const mapClickListener = (event: any) => handleMapClick(event);
    const mapMoveEndListener = () => handleMapMoveEnd();
    const pointerMoveListener = (event: any) => handlePointerMove(event);
    const zoomChangeListener = () => handleZoomChange();

    map.on('click', mapClickListener);
    map.on('moveend', mapMoveEndListener);
    map.on('pointermove', pointerMoveListener);
    view.on('change:resolution', zoomChangeListener);

    // Load initial data
    loadInitialData();

    return () => {
      map.un('click', mapClickListener);
      map.un('moveend', mapMoveEndListener);
      map.un('pointermove', pointerMoveListener);
      view.un('change:resolution', zoomChangeListener);
      map.dispose();
      mapInstanceRef.current = null;
    };
  }, [applyTileSetConstraints, loadInitialData, handleMapClick, handleMapMoveEnd, handlePointerMove, handleZoomChange, layerVisibility.burgs, layerVisibility.routes, layerVisibility.rivers, layerVisibility.cells, layerVisibility.markers, layerVisibility.campaignLocations, layerVisibility.userPins, mapMode, getBurgStyle, getRouteStyle, getMarkerStyle, getCampaignLocationStyle, getPinStyle]);

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



  useEffect(() => {
    if (mapMode === 'world') {
      loadWorldMapData();
    }
  }, [layerVisibility, mapMode, loadWorldMapData]);

  useEffect(() => {
    const handleResize = () => {
      if (currentWorldBoundsRef.current) {
        updateViewExtent(currentWorldBoundsRef.current);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateViewExtent]);

  useEffect(() => {
    if (selectedTool !== 'info') {
      overlayRef.current?.setPosition(undefined);
      setPopupContent(null);
      hoveredFeatureIdRef.current = null;
    }
  }, [selectedTool]);

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
      const current = view.getZoom() || 0;
      const minZoom = enforcedMinZoomRef.current || tileSetMinZoomRef.current;
      const nextZoom = current - 1;
      view.animate({ zoom: nextZoom < minZoom ? minZoom : nextZoom, duration: 250 });
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
                  {popupContent.data && (
                    <div>
                      <pre className="whitespace-pre-wrap break-words">
                        {JSON.stringify(popupContent.data, null, 2)}
                      </pre>
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
