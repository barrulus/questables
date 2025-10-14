import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import MultiPolygon from "ol/geom/MultiPolygon";
import type Geometry from "ol/geom/Geometry";
import GeoJSON from "ol/format/GeoJSON";
import Draw from "ol/interaction/Draw";
import type { DrawEvent } from "ol/interaction/Draw";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { defaults as defaultControls } from "ol/control";
import { Overlay } from "ol";
import type { Coordinate } from "ol/coordinate";
import type { FeatureLike } from "ol/Feature";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import { toast } from "sonner";

import { mapDataLoader, type WorldMapBounds } from "./map-data-loader";
import { PIXEL_PROJECTION_CODE, questablesProjection, updateProjectionExtent } from "./map-projection";
import {
  createBurgStyleFactory,
  createMarkerStyleFactory,
  createRouteStyleFactory,
  getCellStyle,
  getRiverStyle,
  type ZoomResolver,
} from "./maps/questables-style-factory";
import {
  createQuestablesTileSource,
  type TileSetConfig as QuestablesTileSetConfig,
} from "./maps/questables-tile-source";
import { cn } from "./ui/utils";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { LoadingSpinner } from "./ui/loading-spinner";
import { type SpawnPoint, type CampaignRegion } from "../utils/api-client";

type GeometryFeature = Feature<Geometry>;
type GeometrySource = VectorSource<GeometryFeature>;
type GeometryLayer = VectorLayer<GeometrySource>;

export interface MapContextDetails {
  coordinate: [number, number];
  feature: GeometryFeature | null;
  featureType: string | null;
  pixel: Coordinate;
  originalEvent: MouseEvent;
}

export interface MapContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: (_context: MapContextDetails) => void;
  disabled?: boolean;
}

interface BaseWorldMap {
  id: string;
  name: string;
  bounds: WorldMapBounds;
}

export interface MapFeatureDetails {
  id: string | null;
  type: string | null;
  name: string;
  coordinate: [number, number] | null;
  properties: Record<string, unknown>;
}

export interface CampaignPrepMapProps {
  worldMap: BaseWorldMap;
  spawn: SpawnPoint | null;
  editingSpawn: boolean;
  canEditSpawn: boolean;
  onSelectSpawn?: (_position: { x: number; y: number }) => void;
  onRequestLinkObjective?: (_context: MapContextDetails) => void;
  onRegionDrawComplete?: (_payload: { geometry: Record<string, unknown>; context: MapContextDetails | null }) => void;
  contextActionBuilder?: (_context: MapContextDetails, _defaults: MapContextAction[]) => MapContextAction[];
  onFeatureSelected?: (_details: MapFeatureDetails | null) => void;
  highlightPoint?: { coordinate: [number, number]; label?: string | null } | null;
  regions?: CampaignRegion[];
  className?: string;
  onError?: (_message: string) => void;
}

interface LayerVisibilityState {
  burgs: boolean;
  routes: boolean;
  rivers: boolean;
  markers: boolean;
  cells: boolean;
}

const INITIAL_LAYER_VISIBILITY: LayerVisibilityState = {
  burgs: true,
  routes: true,
  rivers: false,
  markers: true,
  cells: false,
};

type SpawnVectorLayer = VectorLayer<VectorSource<Feature<Point>>>;
type HighlightVectorLayer = VectorLayer<VectorSource<Feature<Point>>>;

const spawnStyle = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: "#f97316" }),
    stroke: new Stroke({ color: "#fff", width: 2 }),
  }),
  text: new Text({
    text: "Spawn",
    offsetY: -22,
    font: 'bold 12px "Inter", sans-serif',
    fill: new Fill({ color: "#111827" }),
    stroke: new Stroke({ color: "#FFFFFF", width: 3 }),
  }),
});

const convertSpawnToFeature = (spawn: SpawnPoint | null): Feature<Point> | null => {
  if (!spawn?.geometry?.coordinates || spawn.geometry.coordinates.length < 2) {
    return null;
  }
  const [x, y] = spawn.geometry.coordinates.map(Number);
  const feature = new Feature<Point>({
    geometry: new Point([x, y]),
    id: spawn.id ?? "campaign-spawn",
    data: spawn,
  });
  feature.setStyle(spawnStyle);
  return feature;
};

const castGeometryFeature = (feature: FeatureLike | undefined): GeometryFeature | null => {
  if (!feature) return null;
  return feature as GeometryFeature;
};

const featureTypeFromProperties = (feature: GeometryFeature | null): string | null => {
  if (!feature) return null;
  const rawType = feature.get("type") ?? feature.get("featureType");
  if (typeof rawType === "string" && rawType.trim().length > 0) {
    return rawType.trim();
  }
  const data = feature.get("data");
  if (data && typeof data === "object" && "type" in data && typeof data.type === "string") {
    return data.type.trim();
  }
  return null;
};

const buildFeatureDetails = (feature: GeometryFeature | null, coordinate: Coordinate | null): MapFeatureDetails | null => {
  if (!feature) return null;
  const data = feature.get("data");
  const featureIdCandidate = feature.getId();
  const dataId = data && typeof data === "object" && "id" in data && typeof (data as Record<string, unknown>).id === "string"
    ? (data as Record<string, unknown>).id as string
    : null;
  const featureId = typeof featureIdCandidate === "string" && featureIdCandidate.trim()
    ? featureIdCandidate.trim()
    : dataId;

  const type = featureTypeFromProperties(feature);
  const nameProperty = feature.get("name");
  const derivedName = typeof nameProperty === "string" && nameProperty.trim()
    ? nameProperty.trim()
    : data && typeof data === "object" && "name" in data && typeof (data as Record<string, unknown>).name === "string"
      ? ((data as Record<string, unknown>).name as string)
      : type ?? "Feature";

  const properties = data && typeof data === "object"
    ? { ...(data as Record<string, unknown>) }
    : {};

  return {
    id: featureId,
    type,
    name: derivedName,
    coordinate: coordinate ? [coordinate[0], coordinate[1]] : null,
    properties,
  };
};

const useLayerVisibility = (initial: LayerVisibilityState) => {
  const [visibility, setVisibility] = useState(initial);
  const toggle = useCallback(
    (key: keyof LayerVisibilityState, explicit?: boolean) => {
      setVisibility((prev) => ({
        ...prev,
        [key]: typeof explicit === "boolean" ? explicit : !prev[key],
      }));
    },
    [],
  );
  return { visibility, toggle, setVisibility };
};

export function CampaignPrepMap({
  worldMap,
  spawn,
  editingSpawn,
  canEditSpawn,
  onSelectSpawn,
  onRequestLinkObjective,
  onRegionDrawComplete,
  contextActionBuilder,
  onFeatureSelected,
  highlightPoint,
  regions,
  className,
  onError,
}: CampaignPrepMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const burgLayerRef = useRef<GeometryLayer | null>(null);
  const routesLayerRef = useRef<GeometryLayer | null>(null);
  const riversLayerRef = useRef<GeometryLayer | null>(null);
  const markersLayerRef = useRef<GeometryLayer | null>(null);
  const cellsLayerRef = useRef<GeometryLayer | null>(null);
  const spawnLayerRef = useRef<SpawnVectorLayer | null>(null);
  const regionsLayerRef = useRef<GeometryLayer | null>(null);
  const highlightLayerRef = useRef<HighlightVectorLayer | null>(null);
  const drawLayerRef = useRef<GeometryLayer | null>(null);
  const drawInteractionRef = useRef<Draw | null>(null);
  const drawSourceRef = useRef<VectorSource<GeometryFeature> | null>(null);
  const regionSeedContextRef = useRef<MapContextDetails | null>(null);
  const hoverOverlayRef = useRef<Overlay | null>(null);
  const hoverElementRef = useRef<HTMLDivElement | null>(null);
  const contextMenuContainerRef = useRef<HTMLDivElement | null>(null);

  const [tileSets, setTileSets] = useState<QuestablesTileSetConfig[]>([]);
  const [selectedTileSetId, setSelectedTileSetId] = useState<string>("");
  const [loadingTiles, setLoadingTiles] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const { visibility: layerVisibility, toggle: toggleLayer } =
    useLayerVisibility(INITIAL_LAYER_VISIBILITY);
  const [isDrawingRegion, setIsDrawingRegion] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<MapFeatureDetails | null>(null);

  const [hoverInfo, setHoverInfo] = useState<{
    title: string;
    subtitle: string | null;
    screenX: number;
    screenY: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    actions: MapContextAction[];
    position: { x: number; y: number };
    context: MapContextDetails;
  } | null>(null);

  const currentWorldMapIdRef = useRef<string | null>(null);
  const loadingDataRef = useRef(false);
  const geoJsonReader = useMemo(() => new GeoJSON({
    dataProjection: PIXEL_PROJECTION_CODE,
    featureProjection: PIXEL_PROJECTION_CODE,
  }), []);
  const geoJsonWriter = useMemo(() => new GeoJSON({
    dataProjection: PIXEL_PROJECTION_CODE,
    featureProjection: PIXEL_PROJECTION_CODE,
  }), []);
  const regionStyleCacheRef = useRef<Record<string, Style>>({});
  const highlightStyle = useMemo(() => new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: "rgba(59,130,246,0.65)" }),
      stroke: new Stroke({ color: "#1d4ed8", width: 3 }),
    }),
  }), []);
  const getRegionStyle = useCallback((region: CampaignRegion) => {
    const key = `${region.id}:${region.color ?? "default"}`;
    const cached = regionStyleCacheRef.current[key];
    if (cached) {
      return cached;
    }
    const fillColor = region.color ?? "rgba(14,165,233,0.24)";
    const strokeColor = region.color ?? "#0ea5e9";
    const style = new Style({
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: strokeColor, width: 2 }),
    });
    regionStyleCacheRef.current[key] = style;
    return style;
  }, []);

  const updateSpawnFeature = useCallback(
    (spawnPoint: SpawnPoint | null) => {
      const layer = spawnLayerRef.current;
      if (!layer) return;
      const source = layer.getSource();
      if (!source) return;
      source.clear();
      const feature = convertSpawnToFeature(spawnPoint);
      if (feature) {
        source.addFeature(feature);
      }
    },
    [],
  );

  const applyLayerVisibility = useCallback(() => {
    burgLayerRef.current?.setVisible(layerVisibility.burgs);
    routesLayerRef.current?.setVisible(layerVisibility.routes);
    riversLayerRef.current?.setVisible(layerVisibility.rivers);
    markersLayerRef.current?.setVisible(layerVisibility.markers);
    cellsLayerRef.current?.setVisible(layerVisibility.cells);
  }, [layerVisibility]);

  const handleMapError = useCallback(
    (message: string) => {
      if (onError) {
        onError(message);
      } else {
        toast.error(message);
      }
    },
    [onError],
  );

  const startRegionDraw = useCallback((seedContext: MapContextDetails) => {
    if (!mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    if (drawInteractionRef.current) {
      map.removeInteraction(drawInteractionRef.current);
      drawInteractionRef.current = null;
    }
    regionSeedContextRef.current = seedContext;
    setIsDrawingRegion(true);
    if (!drawSourceRef.current) {
      drawSourceRef.current = new VectorSource<GeometryFeature>({ wrapX: false });
    } else {
      drawSourceRef.current.clear();
    }

    const draw = new Draw({
      source: drawSourceRef.current,
      type: "Polygon",
      stopClick: true,
    });

    draw.on("drawstart", () => {
      drawSourceRef.current?.clear();
    });

    draw.on("drawend", (event: DrawEvent) => {
      const geometry = event.feature.getGeometry();
      drawSourceRef.current?.clear();
      setIsDrawingRegion(false);
      map.removeInteraction(draw);
      drawInteractionRef.current = null;

      if (!geometry) {
        regionSeedContextRef.current = null;
        return;
      }

      let multi: MultiPolygon;
      if (geometry instanceof Polygon) {
        multi = new MultiPolygon([geometry.getCoordinates()]);
      } else {
        multi = geometry as MultiPolygon;
      }

      const geoJsonGeometry = geoJsonWriter.writeGeometryObject(multi) as Record<string, unknown>;
      onRegionDrawComplete?.({
        geometry: geoJsonGeometry,
        context: regionSeedContextRef.current,
      });
      regionSeedContextRef.current = null;
      toast.success("Region captured from campaign map.");
    });

    draw.on("drawabort", () => {
      drawSourceRef.current?.clear();
      setIsDrawingRegion(false);
      map.removeInteraction(draw);
      drawInteractionRef.current = null;
      regionSeedContextRef.current = null;
    });

    drawInteractionRef.current = draw;
    map.addInteraction(draw);
    toast.info("Drawing mode enabled. Click to add vertices, double-click to finish.");
  }, [geoJsonWriter, onRegionDrawComplete]);

  const buildContextActions = useCallback(
    (context: MapContextDetails): MapContextAction[] => {
      const actions: MapContextAction[] = [];

      if (canEditSpawn && onSelectSpawn) {
        actions.push({
          id: "set-spawn",
          label: "Set spawn point",
          onSelect: ({ coordinate }) => onSelectSpawn({ x: coordinate[0], y: coordinate[1] }),
        });
      }

      if (onRequestLinkObjective) {
        actions.push({
          id: "link-objective",
          label: "Link to objective",
          onSelect: (ctx) => onRequestLinkObjective(ctx),
        });
      }

      if (onRegionDrawComplete && !isDrawingRegion) {
        actions.push({
          id: "select-region",
          label: "Select area",
          onSelect: (ctx) => startRegionDraw(ctx),
        });
      }

      let finalActions = actions;
      if (contextActionBuilder) {
        try {
          const custom = contextActionBuilder(context, actions);
          if (Array.isArray(custom) && custom.length > 0) {
            finalActions = custom;
          }
        } catch (error) {
          console.warn("[CampaignPrepMap] contextActionBuilder failed", error);
        }
      }

      return finalActions;
    },
    [canEditSpawn, contextActionBuilder, isDrawingRegion, onRegionDrawComplete, onRequestLinkObjective, onSelectSpawn, startRegionDraw],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const initializeMap = useCallback(() => {
    if (!mapContainerRef.current) {
      return;
    }

    // Clean up existing map when switching worlds
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setTarget(undefined);
      mapInstanceRef.current.dispose();
      mapInstanceRef.current = null;
    }

    const [west, south, east, north] = [
      worldMap.bounds.west,
      worldMap.bounds.south,
      worldMap.bounds.east,
      worldMap.bounds.north,
    ];

    const view = new View({
      projection: questablesProjection,
      center: [(west + east) / 2, (south + north) / 2],
      zoom: 3,
      minZoom: 0,
      maxZoom: 20,
      extent: [west, south, east, north],
      constrainOnlyCenter: true,
      enableRotation: false,
    });

    const getZoomForResolution: ZoomResolver = (resolution: number) => {
      const zoom = view.getZoomForResolution(resolution);
      return typeof zoom === "number" ? zoom : 0;
    };

    const burgLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: createBurgStyleFactory(getZoomForResolution),
      visible: layerVisibility.burgs,
    });

    const routesLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: createRouteStyleFactory(getZoomForResolution),
      visible: layerVisibility.routes,
    });

    const riversLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getRiverStyle,
      visible: layerVisibility.rivers,
    });

    const markersLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: createMarkerStyleFactory(getZoomForResolution),
      visible: layerVisibility.markers,
    });

    const cellsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getCellStyle,
      visible: layerVisibility.cells,
    });

    const regionLayer = new VectorLayer({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature) => {
        const data = feature.get("data") as CampaignRegion | undefined;
        return getRegionStyle(data ?? {
          id: "placeholder",
          campaignId: "",
          worldMapId: worldMap.id,
          name: String(feature.get("name") ?? "Region"),
          description: null,
          category: "custom",
          color: feature.get("color") ?? null,
          metadata: {},
          geometry: {},
          createdAt: "",
          updatedAt: "",
        });
      },
      visible: true,
    });

    const drawSource = new VectorSource<GeometryFeature>({ wrapX: false });
    drawSourceRef.current = drawSource;
    const drawLayer = new VectorLayer({
      source: drawSource,
      style: new Style({
        fill: new Fill({ color: "rgba(16,185,129,0.2)" }),
        stroke: new Stroke({ color: "#0f766e", width: 2, lineDash: [6, 4] }),
      }),
      visible: true,
    });

    const spawnLayer = new VectorLayer({
      source: new VectorSource<Feature<Point>>({ wrapX: false }),
    });

    const highlightLayer = new VectorLayer({
      source: new VectorSource<Feature<Point>>({ wrapX: false }),
      style: highlightStyle,
      visible: true,
    });

    const baseLayer = new TileLayer({ preload: 2 });

    const map = new Map({
      target: mapContainerRef.current,
      layers: [
        baseLayer,
        cellsLayer,
        riversLayer,
        routesLayer,
        burgLayer,
        markersLayer,
        regionLayer,
        drawLayer,
        spawnLayer,
        highlightLayer,
      ],
      view,
      controls: defaultControls({ zoom: false, attribution: true }),
    });

    const hoverElement = document.createElement("div");
    hoverElement.className =
      "pointer-events-none rounded-md bg-slate-900/90 text-white shadow px-3 py-1 text-xs";
    const hoverOverlay = new Overlay({
      element: hoverElement,
      offset: [12, 12],
      positioning: "bottom-left",
    });
    map.addOverlay(hoverOverlay);

    hoverOverlayRef.current = hoverOverlay;
    hoverElementRef.current = hoverElement;
    mapInstanceRef.current = map;
    baseLayerRef.current = baseLayer;
    burgLayerRef.current = burgLayer;
    routesLayerRef.current = routesLayer;
    riversLayerRef.current = riversLayer;
    markersLayerRef.current = markersLayer;
    cellsLayerRef.current = cellsLayer;
    spawnLayerRef.current = spawnLayer;
    regionsLayerRef.current = regionLayer;
    drawLayerRef.current = drawLayer;
    highlightLayerRef.current = highlightLayer;
    currentWorldMapIdRef.current = worldMap.id;
    setMapReady(true);

    view.fit([west, south, east, north], {
      size: map.getSize(),
      duration: 0,
      padding: [48, 48, 48, 48],
    });
  }, [layerVisibility, worldMap]);

  const refreshMapTileSource = useCallback(
    (tileSet: QuestablesTileSetConfig | null) => {
      if (!baseLayerRef.current) return;
      try {
        if (tileSet) {
          const source = createQuestablesTileSource(tileSet, worldMap.bounds);
          baseLayerRef.current.setSource(source);
          updateProjectionExtent(worldMap.bounds);
        } else {
          baseLayerRef.current.setSource(null);
        }
      } catch (error) {
        console.error("[CampaignPrepMap] Failed to initialise tile source", error);
        handleMapError("Failed to initialise map tiles. Upload or configure tile sets before using the map.");
      }
    },
    [handleMapError, worldMap.bounds],
  );

  const loadWorldLayers = useCallback(async () => {
    if (!mapInstanceRef.current) return;
    if (loadingDataRef.current) return;
    loadingDataRef.current = true;

    const map = mapInstanceRef.current;
    const view = map.getView();
    const zoom = view.getZoom() ?? 0;
    const extent = view.calculateExtent(map.getSize());
    const bounds = mapDataLoader.getBoundsFromExtent(extent);
    const dataTypes = mapDataLoader.getDataTypesForZoom(Math.floor(zoom));

    const requests: Array<Promise<GeometryFeature[]>> = [];
    const layerAssignments: Array<{ type: string; layer: GeometryLayer | null }> = [];

    if (dataTypes.includes("burgs")) {
      requests.push(mapDataLoader.loadBurgs(worldMap.id, bounds));
      layerAssignments.push({ type: "burgs", layer: burgLayerRef.current });
    }
    if (dataTypes.includes("routes")) {
      requests.push(mapDataLoader.loadRoutes(worldMap.id, bounds));
      layerAssignments.push({ type: "routes", layer: routesLayerRef.current });
    }
    if (dataTypes.includes("rivers")) {
      requests.push(mapDataLoader.loadRivers(worldMap.id, bounds));
      layerAssignments.push({ type: "rivers", layer: riversLayerRef.current });
    }
    if (dataTypes.includes("markers")) {
      requests.push(mapDataLoader.loadMarkers(worldMap.id, bounds));
      layerAssignments.push({ type: "markers", layer: markersLayerRef.current });
    }
    if (dataTypes.includes("cells")) {
      requests.push(mapDataLoader.loadCells(worldMap.id, bounds));
      layerAssignments.push({ type: "cells", layer: cellsLayerRef.current });
    }

    try {
      const results = await Promise.allSettled(requests);
      results.forEach((result, index) => {
        const assignment = layerAssignments[index];
        if (!assignment?.layer) {
          return;
        }
        const source = assignment.layer.getSource();
        if (!source) {
          return;
        }
        source.clear();
        if (result.status === "fulfilled" && Array.isArray(result.value)) {
          source.addFeatures(result.value);
        }
      });
    } catch (error) {
      console.error("[CampaignPrepMap] Failed to load world layers", error);
      handleMapError("Unable to load world data for this map.");
    } finally {
      loadingDataRef.current = false;
    }
  }, [handleMapError, worldMap.id]);

  const handlePointerMove = useCallback(
    (event: MapBrowserEvent<MouseEvent>) => {
      if (!mapInstanceRef.current) return;
      const map = mapInstanceRef.current;

      if (isDrawingRegion) {
        map.getTargetElement().style.cursor = "crosshair";
        return;
      }

      const featureLike = map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
      const feature = castGeometryFeature(featureLike);

      if (!feature) {
        setHoverInfo(null);
        map.getTargetElement().style.cursor = editingSpawn && canEditSpawn ? "crosshair" : "";
        if (hoverOverlayRef.current) {
          hoverOverlayRef.current.setPosition(undefined);
        }
        return;
      }

      const data = feature.get("data") ?? feature.getProperties();
      const title = data?.name
        ?? feature.get("name")
        ?? featureTypeFromProperties(feature)
        ?? "Feature";
      const typeLabel = featureTypeFromProperties(feature);
      const screenPosition = event.pixel;
      map.getTargetElement().style.cursor = "pointer";

      setHoverInfo({
        title,
        subtitle: typeLabel ? typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1) : null,
        screenX: screenPosition[0],
        screenY: screenPosition[1],
      });

      if (hoverOverlayRef.current) {
        const coordinate = map.getCoordinateFromPixel(event.pixel);
        if (coordinate) {
          hoverOverlayRef.current.setPosition(coordinate);
          if (hoverElementRef.current) {
            hoverElementRef.current.textContent = title;
          }
        }
      }
    },
    [canEditSpawn, editingSpawn, isDrawingRegion],
  );

  const handleMapClick = useCallback(
    (event: MapBrowserEvent<MouseEvent>) => {
      closeContextMenu();

      if (!mapInstanceRef.current) return;
      const map = mapInstanceRef.current;
      const coordinate = event.coordinate as [number, number];

       if (isDrawingRegion) {
        return;
      }

      if (editingSpawn && canEditSpawn && onSelectSpawn) {
        onSelectSpawn({ x: coordinate[0], y: coordinate[1] });
        return;
      }

      const feature = castGeometryFeature(
        map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate),
      );
      const details = buildFeatureDetails(feature, coordinate);
      setSelectedFeature(details);
      if (!feature && hoverOverlayRef.current) {
        hoverOverlayRef.current.setPosition(undefined);
      }
    },
    [canEditSpawn, closeContextMenu, editingSpawn, isDrawingRegion, onSelectSpawn],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!mapInstanceRef.current) return;
      event.preventDefault();

      const map = mapInstanceRef.current;
      const pixel = map.getEventPixel(event);
      const coordinate = map.getCoordinateFromPixel(pixel);
      if (!coordinate) {
        return;
      }

      const feature = castGeometryFeature(
        map.forEachFeatureAtPixel(pixel, (candidate) => candidate),
      );

      const context: MapContextDetails = {
        coordinate: [coordinate[0], coordinate[1]],
        feature,
        featureType: featureTypeFromProperties(feature),
        pixel,
        originalEvent: event,
      };

      const actions = buildContextActions(context).filter((action) => !action.disabled);
      if (actions.length === 0) {
        return;
      }

      setContextMenu({
        actions,
        context,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [buildContextActions],
  );

  const attachEventListeners = useCallback(() => {
    const map = mapInstanceRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    map.on("pointermove", handlePointerMove);
    map.on("moveend", loadWorldLayers);
    map.on("click", handleMapClick);
    container.addEventListener("contextmenu", handleContextMenu);

    return () => {
      map.un("pointermove", handlePointerMove);
      map.un("moveend", loadWorldLayers);
      map.un("click", handleMapClick);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [handleContextMenu, handleMapClick, handlePointerMove, loadWorldLayers]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTiles(true);
    (async () => {
      try {
        const tileSetRecords = await mapDataLoader.loadTileSets();
        if (cancelled) return;
        const normalized = (tileSetRecords ?? [])
          .filter((entry): entry is QuestablesTileSetConfig => Boolean(entry?.id && entry?.base_url))
          .map((entry) => ({
            id: String(entry.id),
            name: typeof entry.name === "string" && entry.name.trim() ? entry.name : String(entry.id),
            base_url: entry.base_url,
            attribution: entry.attribution ?? undefined,
            min_zoom: Number.isFinite(entry.min_zoom) ? Number(entry.min_zoom) : undefined,
            max_zoom: Number.isFinite(entry.max_zoom) ? Number(entry.max_zoom) : undefined,
            tile_size: Number.isFinite(entry.tile_size) ? Number(entry.tile_size) : undefined,
            wrapX: Boolean(entry.wrapX),
          }));
        setTileSets(normalized);
        if (normalized.length > 0) {
          setSelectedTileSetId((prev) => (prev && normalized.some((ts) => ts.id === prev) ? prev : normalized[0].id));
        } else {
          setSelectedTileSetId("");
        }
      } catch (error) {
        const derivedMessage =
          error instanceof Error && error.message
            ? error.message
            : "Failed to load available tile sets.";
        setMapError(derivedMessage);
        handleMapError(derivedMessage);
      } finally {
        if (!cancelled) {
          setLoadingTiles(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handleMapError]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (currentWorldMapIdRef.current === worldMap.id && mapInstanceRef.current) {
      // Ensure bounds update when world map metadata changes
      const [west, south, east, north] = [
        worldMap.bounds.west,
        worldMap.bounds.south,
        worldMap.bounds.east,
        worldMap.bounds.north,
      ];
      const view = mapInstanceRef.current.getView();
      view.fit([west, south, east, north], {
        size: mapInstanceRef.current.getSize(),
        duration: 0,
        padding: [48, 48, 48, 48],
      });
      return;
    }
    initializeMap();
  }, [initializeMap, worldMap]);

  useEffect(() => () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setTarget(undefined);
      mapInstanceRef.current.dispose();
      mapInstanceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    applyLayerVisibility();
  }, [applyLayerVisibility, mapReady, layerVisibility]);

  useEffect(() => {
    if (!mapReady) return;
    const detach = attachEventListeners();
    return () => {
      detach?.();
    };
  }, [attachEventListeners, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    if (!selectedTileSetId) {
      baseLayerRef.current?.setSource(null);
      return;
    }
    const tileSet = tileSets.find((ts) => ts.id === selectedTileSetId) ?? null;
    refreshMapTileSource(tileSet);
  }, [mapReady, refreshMapTileSource, selectedTileSetId, tileSets]);

  useEffect(() => {
    if (!mapReady) return;
    void loadWorldLayers();
  }, [loadWorldLayers, mapReady, selectedTileSetId, layerVisibility]);

  useEffect(() => {
    updateSpawnFeature(spawn);
  }, [spawn, updateSpawnFeature]);

  useEffect(() => {
    if (!mapReady) return;
    const layer = regionsLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    (regions ?? []).forEach((region) => {
      try {
        const feature = geoJsonReader.readFeature(region.geometry);
        feature.setId(region.id);
        feature.set("data", region);
        feature.set("type", "region");
        feature.set("name", region.name);
        feature.setStyle(getRegionStyle(region));
        source.addFeature(feature as GeometryFeature);
      } catch (error) {
        console.warn("[CampaignPrepMap] Failed to render region", region.id, error);
      }
    });
  }, [geoJsonReader, getRegionStyle, mapReady, regions]);

  useEffect(() => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    if (!highlightPoint) {
      return;
    }

    const feature = new Feature<Point>({
      geometry: new Point(highlightPoint.coordinate),
      id: "highlight-location",
    });
    feature.setStyle(highlightStyle);
    source.addFeature(feature);

    if (mapInstanceRef.current) {
      mapInstanceRef.current.getView().animate({
        center: highlightPoint.coordinate,
        duration: 250,
      });
    }
  }, [highlightPoint, highlightStyle]);

  useEffect(() => {
    if (onFeatureSelected) {
      onFeatureSelected(selectedFeature);
    }
  }, [onFeatureSelected, selectedFeature]);

  useEffect(() => {
    const target = mapInstanceRef.current?.getTargetElement();
    if (!target) return;
    target.style.cursor = editingSpawn && canEditSpawn ? "crosshair" : "";
    return () => {
      target.style.cursor = "";
    };
  }, [canEditSpawn, editingSpawn]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !contextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!contextMenuContainerRef.current) return;
      if (!contextMenuContainerRef.current.contains(event.target as Node)) {
        closeContextMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [closeContextMenu, contextMenu]);

  const tileSetOptions = useMemo(() => {
    if (tileSets.length === 0) {
      return [{ id: "__none__", label: "No tile sets configured" }];
    }
    return tileSets.map((tileSet) => ({
      id: tileSet.id,
      label: tileSet.name,
    }));
  }, [tileSets]);

  return (
    <div className={cn("relative flex h-full flex-col rounded-md border bg-background", className)}>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-medium">
            World map
          </Badge>
          <span className="text-sm font-semibold">{worldMap.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-muted-foreground">Tile Set</span>
            {loadingTiles ? (
              <Skeleton className="h-8 w-40 rounded-sm" />
            ) : (
              <Select
                value={selectedTileSetId || (tileSets[0]?.id ?? "__none__")}
                onValueChange={(value) => {
                  if (value === "__none__") {
                    setSelectedTileSetId("");
                    return;
                  }
                  setSelectedTileSetId(value);
                }}
                disabled={tileSets.length === 0}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Select tile set" />
                </SelectTrigger>
                <SelectContent>
                  {tileSetOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id} disabled={option.id === "__none__"}>
                      {option.label}
                    </SelectItem>
                  ))}
                  {tileSets.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No tile sets configured
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(["burgs", "routes", "markers", "rivers", "cells"] as Array<keyof LayerVisibilityState>).map((layerKey) => (
              <label key={layerKey} className="flex items-center gap-1 rounded border px-2 py-1">
                <Checkbox
                  checked={layerVisibility[layerKey]}
                  onCheckedChange={(checked) => toggleLayer(layerKey, Boolean(checked))}
                />
                <span className="capitalize">{layerKey}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="relative flex-1">
        <div ref={mapContainerRef} className="h-full w-full rounded-b-md bg-muted" />

        {isDrawingRegion && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 text-sm font-semibold text-foreground">
            Drawing region… double-click to finish
          </div>
        )}

        {mapError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="max-w-sm rounded border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {mapError}
            </div>
          </div>
        ) : null}

        {!mapReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <LoadingSpinner className="mr-2 h-4 w-4" />
            <span className="text-sm font-medium text-muted-foreground">Preparing campaign map…</span>
          </div>
        ) : null}

        {contextMenu ? (
          <div
            ref={contextMenuContainerRef}
            className="fixed z-50 min-w-[180px] rounded-md border bg-background p-1 shadow-lg"
            style={{ left: contextMenu.position.x, top: contextMenu.position.y }}
          >
            {contextMenu.actions.map((action) => (
              <Button
                key={action.id}
                variant="ghost"
                className="w-full justify-start px-2 py-1 text-sm"
                onClick={() => {
                  action.onSelect(contextMenu.context);
                  closeContextMenu();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        {hoverInfo ? (
          <div
            className="pointer-events-none fixed z-40 rounded-md bg-slate-900/90 px-3 py-1 text-xs text-white shadow"
            style={{ left: hoverInfo.screenX + 16, top: hoverInfo.screenY + 16 }}
          >
            <div className="font-medium">{hoverInfo.title}</div>
            {hoverInfo.subtitle ? <div className="text-[10px] uppercase text-slate-300">{hoverInfo.subtitle}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
