import { useCallback, useMemo, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import type TileLayer from "ol/layer/Tile";
import VectorSource from "ol/source/Vector";
import Polygon from "ol/geom/Polygon";
import MultiPolygon from "ol/geom/MultiPolygon";
import GeoJSON from "ol/format/GeoJSON";
import Draw from "ol/interaction/Draw";
import type { DrawEvent } from "ol/interaction/Draw";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { defaults as defaultControls } from "ol/control";
import { toast } from "sonner";

import { mapDataLoader, type WorldMapBounds } from "./map-data-loader";
import {
  PIXEL_PROJECTION_CODE,
  questablesProjection,
  DEFAULT_PIXEL_EXTENT,
} from "./map-projection";
import { type ZoomResolver } from "./maps/questables-style-factory";
import {
  createQuestablesTileSource,
  type TileSetConfig as QuestablesTileSetConfig,
} from "./maps/questables-tile-source";
import {
  createBaseTileLayer,
  createBurgsLayer,
  createCellsLayer,
  createDrawLayer,
  createHighlightLayer,
  createMarkersLayer,
  createRegionLayer,
  createRiversLayer,
  createRoutesLayer,
  createSpawnLayer,
  type GeometryFeature,
  type GeometryLayer,
  type GeometrySource,
  type HighlightLayer,
  type SpawnLayer,
} from "./layers";
import { type DebouncedExecutor } from "./campaign-prep-debounce";
import { type LayerVisibilityState } from "./campaign-prep-layer-visibility";
import { refreshTileLayerSource } from "./campaign-prep-map-tile-refresh";
import type { SpawnPoint, CampaignRegion } from "../utils/api-client";
import {
  type MapContextDetails,
  type BaseWorldMap,
  padExtent,
  convertSpawnToFeature,
} from "./campaign-prep-map-types";
import type { UseMapViewReturn } from "./campaign-prep-map-view";

// ── Hook: useMapInit ─────────────────────────────────────────────────
// Map creation, layers, tile management, data loading, region drawing.

export interface UseMapInitOptions {
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  mapInstanceRef: React.RefObject<Map | null>;
  worldMap: BaseWorldMap;
  layerVisibility: LayerVisibilityState;
  onRegionDrawComplete?: (
    _payload: { geometry: Record<string, unknown>; context: MapContextDetails | null },
  ) => void;
  view: UseMapViewReturn;
}

export interface UseMapInitReturn {
  // State
  tileSets: QuestablesTileSetConfig[];
  setTileSets: React.Dispatch<React.SetStateAction<QuestablesTileSetConfig[]>>;
  selectedTileSetId: string;
  setSelectedTileSetId: React.Dispatch<React.SetStateAction<string>>;
  loadingTiles: boolean;
  setLoadingTiles: React.Dispatch<React.SetStateAction<boolean>>;
  mapReady: boolean;
  mapError: string | null;
  setMapError: React.Dispatch<React.SetStateAction<string | null>>;
  isDrawingRegion: boolean;
  // Refs
  baseLayerRef: React.RefObject<TileLayer | null>;
  burgLayerRef: React.RefObject<GeometryLayer | null>;
  routesLayerRef: React.RefObject<GeometryLayer | null>;
  riversLayerRef: React.RefObject<GeometryLayer | null>;
  markersLayerRef: React.RefObject<GeometryLayer | null>;
  cellsLayerRef: React.RefObject<GeometryLayer | null>;
  spawnLayerRef: React.RefObject<SpawnLayer | null>;
  regionsLayerRef: React.RefObject<GeometryLayer | null>;
  highlightLayerRef: React.RefObject<HighlightLayer | null>;
  drawLayerRef: React.RefObject<GeometryLayer | null>;
  drawInteractionRef: React.RefObject<Draw | null>;
  drawSourceRef: React.RefObject<GeometrySource | null>;
  debouncedLayerLoaderRef: React.RefObject<DebouncedExecutor | null>;
  currentWorldMapIdRef: React.RefObject<string | null>;
  loadingDataRef: React.RefObject<boolean>;
  resizeObserverRef: React.RefObject<ResizeObserver | null>;
  mapReadyRef: React.RefObject<boolean>;
  pendingFrameRef: React.RefObject<number | null>;
  regionSeedContextRef: React.RefObject<MapContextDetails | null>;
  // Memos
  geoJsonReader: GeoJSON;
  geoJsonWriter: GeoJSON;
  highlightStyle: Style;
  tileSetOptions: Array<{ id: string; label: string }>;
  // Callbacks
  setMapReady: (value: boolean) => void;
  getRegionStyle: (region: CampaignRegion) => Style;
  applyTileSetConstraints: (tileSet: QuestablesTileSetConfig | null) => void;
  updateSpawnFeature: (spawnPoint: SpawnPoint | null) => void;
  applyLayerVisibility: () => void;
  startRegionDraw: (seedContext: MapContextDetails) => void;
  createMapInstance: () => void;
  initializeMap: () => void;
  refreshMapTileSource: (tileSet: QuestablesTileSetConfig | null) => void;
  loadWorldLayers: () => Promise<void>;
}

export function useMapInit({
  mapContainerRef,
  mapInstanceRef,
  worldMap,
  layerVisibility,
  onRegionDrawComplete,
  view,
}: UseMapInitOptions): UseMapInitReturn {
  const { updateViewExtent, handleMapError } = view;

  // ── Layer refs ───────────────────────────────────────────────────────
  const baseLayerRef = useRef<TileLayer | null>(null);
  const burgLayerRef = useRef<GeometryLayer | null>(null);
  const routesLayerRef = useRef<GeometryLayer | null>(null);
  const riversLayerRef = useRef<GeometryLayer | null>(null);
  const markersLayerRef = useRef<GeometryLayer | null>(null);
  const cellsLayerRef = useRef<GeometryLayer | null>(null);
  const spawnLayerRef = useRef<SpawnLayer | null>(null);
  const regionsLayerRef = useRef<GeometryLayer | null>(null);
  const highlightLayerRef = useRef<HighlightLayer | null>(null);
  const drawLayerRef = useRef<GeometryLayer | null>(null);
  const drawInteractionRef = useRef<Draw | null>(null);
  const drawSourceRef = useRef<GeometrySource | null>(null);
  const debouncedLayerLoaderRef = useRef<DebouncedExecutor | null>(null);
  const regionSeedContextRef = useRef<MapContextDetails | null>(null);

  // ── Internal refs ──────────────────────────────────────────────────
  const currentWorldMapIdRef = useRef<string | null>(null);
  const loadingDataRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mapReadyRef = useRef(false);
  const pendingFrameRef = useRef<number | null>(null);
  const regionStyleCacheRef = useRef<Record<string, Style>>({});

  // ── State ──────────────────────────────────────────────────────────
  const [tileSets, setTileSets] = useState<QuestablesTileSetConfig[]>([]);
  const [selectedTileSetId, setSelectedTileSetId] = useState<string>("");
  const [loadingTiles, setLoadingTiles] = useState(true);
  const [mapReady, setMapReadyState] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isDrawingRegion, setIsDrawingRegion] = useState(false);

  // ── Stable helpers ─────────────────────────────────────────────────
  const setMapReady = useCallback(
    (value: boolean) => {
      mapReadyRef.current = value;
      setMapReadyState(value);
    },
    [],
  );

  const geoJsonReader = useMemo(
    () =>
      new GeoJSON({
        dataProjection: PIXEL_PROJECTION_CODE,
        featureProjection: PIXEL_PROJECTION_CODE,
      }),
    [],
  );

  const geoJsonWriter = useMemo(
    () =>
      new GeoJSON({
        dataProjection: PIXEL_PROJECTION_CODE,
        featureProjection: PIXEL_PROJECTION_CODE,
      }),
    [],
  );

  const highlightStyle = useMemo(
    () =>
      new Style({
        image: new CircleStyle({
          radius: 9,
          fill: new Fill({ color: "rgba(59,130,246,0.65)" }),
          stroke: new Stroke({ color: "#1d4ed8", width: 3 }),
        }),
      }),
    [],
  );

  const getRegionStyle = useCallback((region: CampaignRegion) => {
    const key = `${region.id}:${region.color ?? "default"}`;
    const cached = regionStyleCacheRef.current[key];
    if (cached) return cached;
    const fillColor = region.color ?? "rgba(14,165,233,0.24)";
    const strokeColor = region.color ?? "#0ea5e9";
    const style = new Style({
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: strokeColor, width: 2 }),
    });
    regionStyleCacheRef.current[key] = style;
    return style;
  }, []);

  const tileSetOptions = useMemo(() => {
    if (tileSets.length === 0) {
      return [{ id: "__none__", label: "No tile sets configured" }];
    }
    return tileSets.map((ts) => ({ id: ts.id, label: ts.name }));
  }, [tileSets]);

  // ── Tile set constraints ───────────────────────────────────────────
  const applyTileSetConstraints = useCallback(
    (tileSet: QuestablesTileSetConfig | null) => {
      const mapView = mapInstanceRef.current?.getView();
      if (!mapView) return;

      const rawMinZoom = tileSet?.min_zoom;
      const rawMaxZoom = tileSet?.max_zoom;
      const minZoom =
        typeof rawMinZoom === "number" && Number.isFinite(rawMinZoom) ? rawMinZoom : 0;
      const maxZoom =
        typeof rawMaxZoom === "number" && Number.isFinite(rawMaxZoom) ? rawMaxZoom : 9;

      if (maxZoom < minZoom) {
        const identifier = tileSet?.name ?? tileSet?.id ?? "selected tile set";
        const message = `${identifier} reports max_zoom (${maxZoom}) below min_zoom (${minZoom}). Update the tileset metadata to restore zoom controls.`;
        handleMapError(message);
        mapView.setMinZoom(0);
        mapView.setMaxZoom(20);
        return;
      }

      setMapError((prev) => (prev && prev.includes("reports max_zoom") ? null : prev));
      mapView.setMinZoom(minZoom);
      mapView.setMaxZoom(maxZoom);

      const currentZoom = mapView.getZoom();
      if (typeof currentZoom === "number") {
        if (currentZoom < minZoom) mapView.setZoom(minZoom);
        else if (currentZoom > maxZoom) mapView.setZoom(maxZoom);
      }
    },
    [handleMapError, mapInstanceRef],
  );

  // ── Spawn ──────────────────────────────────────────────────────────
  const updateSpawnFeature = useCallback((spawnPoint: SpawnPoint | null) => {
    const layer = spawnLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    const feature = convertSpawnToFeature(spawnPoint);
    if (feature) source.addFeature(feature);
  }, []);

  // ── Layer visibility ───────────────────────────────────────────────
  const applyLayerVisibility = useCallback(() => {
    burgLayerRef.current?.setVisible(layerVisibility.burgs);
    routesLayerRef.current?.setVisible(layerVisibility.routes);
    riversLayerRef.current?.setVisible(layerVisibility.rivers);
    markersLayerRef.current?.setVisible(layerVisibility.markers);
    cellsLayerRef.current?.setVisible(layerVisibility.cells);
  }, [layerVisibility]);

  // ── Region drawing ─────────────────────────────────────────────────
  const startRegionDraw = useCallback(
    (seedContext: MapContextDetails) => {
      if (!mapInstanceRef.current) return;

      const map = mapInstanceRef.current;
      if (drawInteractionRef.current) {
        map.removeInteraction(drawInteractionRef.current);
        drawInteractionRef.current = null;
      }
      regionSeedContextRef.current = seedContext;
      setIsDrawingRegion(true);
      let drawSource = drawSourceRef.current;
      if (!drawSource) {
        const layerSource = drawLayerRef.current?.getSource() as
          | GeometrySource
          | null
          | undefined;
        if (layerSource) {
          drawSource = layerSource;
        } else {
          drawSource = new VectorSource<GeometryFeature>({ wrapX: false });
          drawLayerRef.current?.setSource(drawSource);
        }
        drawSourceRef.current = drawSource;
      } else {
        drawSource.clear();
      }

      if (!drawSource) return;

      const draw = new Draw({
        source: drawSource,
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

        const geoJsonGeometry = geoJsonWriter.writeGeometryObject(multi) as Record<
          string,
          unknown
        >;
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
      toast.info(
        "Drawing mode enabled. Click to add vertices, double-click to finish.",
      );
    },
    [geoJsonWriter, mapInstanceRef, onRegionDrawComplete],
  );

  // ── Map instance creation ──────────────────────────────────────────
  const createMapInstance = useCallback(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    setMapReady(false);
    view.initialFitDoneRef.current = false;
    view.lastFittedExtentRef.current = null;
    view.lastFittedSizeRef.current = null;
    view.isProgrammaticViewUpdateRef.current = false;
    view.lastAppliedBoundsSignatureRef.current = null;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.setTarget(undefined);
      mapInstanceRef.current.dispose();
      (mapInstanceRef as { current: Map | null }).current = null;
    }

    const mapView = new View({
      projection: questablesProjection,
      center: [
        (DEFAULT_PIXEL_EXTENT[0] + DEFAULT_PIXEL_EXTENT[2]) / 2,
        (DEFAULT_PIXEL_EXTENT[1] + DEFAULT_PIXEL_EXTENT[3]) / 2,
      ],
      zoom: 2,
      minZoom: 0,
      maxZoom: 20,
      extent: padExtent(DEFAULT_PIXEL_EXTENT),
      enableRotation: false,
    });

    const getZoomForResolution: ZoomResolver = (_resolution: number) => {
      const current = mapView.getZoom();
      if (typeof current === "number" && Number.isFinite(current)) return current;
      const derived = mapView.getZoomForResolution(_resolution);
      return Number.isFinite(derived as number) ? (derived as number) : 0;
    };

    const burgLayer = createBurgsLayer({
      resolveZoom: getZoomForResolution,
      visible: layerVisibility.burgs,
    });
    const routesLayer = createRoutesLayer({
      resolveZoom: getZoomForResolution,
      visible: layerVisibility.routes,
    });
    const riversLayer = createRiversLayer({ visible: layerVisibility.rivers });
    const markersLayer = createMarkersLayer({
      resolveZoom: getZoomForResolution,
      visible: layerVisibility.markers,
    });
    const cellsLayer = createCellsLayer({ visible: layerVisibility.cells });
    const regionLayer = createRegionLayer({
      worldMapId: worldMap.id,
      getRegionStyle,
    });
    const { layer: drawLayer, source: drawSource } = createDrawLayer();
    drawSourceRef.current = drawSource;
    const spawnLayer = createSpawnLayer();
    const highlightLayer = createHighlightLayer({ style: highlightStyle });
    const baseLayer = createBaseTileLayer();

    const map = new Map({
      target: container,
      layers: [
        baseLayer,
        cellsLayer,
        riversLayer,
        routesLayer,
        regionLayer,
        burgLayer,
        markersLayer,
        drawLayer,
        spawnLayer,
        highlightLayer,
      ],
      view: mapView,
      controls: defaultControls({ zoom: false, attribution: true }),
    });

    (mapInstanceRef as { current: Map | null }).current = map;
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

    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }

    const tryFinalizeSizing = () => {
      if (!mapInstanceRef.current) return false;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return false;
      mapInstanceRef.current.updateSize();
      updateViewExtent(worldMap.bounds);
      if (!mapReadyRef.current) {
        if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
          console.debug("[CampaignPrepMap] Map ready", { width, height });
        }
        setMapReady(true);
      }
      return true;
    };

    if (!tryFinalizeSizing()) {
      setMapReady(false);
    }

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        void tryFinalizeSizing();
      });
      observer.observe(container);
      resizeObserverRef.current = observer;
    } else if (!view.initialFitDoneRef.current) {
      pendingFrameRef.current = requestAnimationFrame(() => {
        if (!view.initialFitDoneRef.current) {
          tryFinalizeSizing();
        }
        pendingFrameRef.current = null;
      });
    }
  }, [
    getRegionStyle,
    highlightStyle,
    layerVisibility,
    mapContainerRef,
    mapInstanceRef,
    setMapReady,
    updateViewExtent,
    view,
    worldMap,
  ]);

  const initializeMap = useCallback(() => {
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }

    debouncedLayerLoaderRef.current?.cancel();

    const ensureSized = () => {
      const container = mapContainerRef.current;
      if (!container) return;
      const { clientWidth, clientHeight } = container;
      if (clientWidth <= 0 || clientHeight <= 0) {
        pendingFrameRef.current = requestAnimationFrame(ensureSized);
        return;
      }
      pendingFrameRef.current = null;
      createMapInstance();
    };

    ensureSized();
  }, [createMapInstance, mapContainerRef]);

  // ── Tile source refresh ────────────────────────────────────────────
  const refreshMapTileSource = useCallback(
    (tileSet: QuestablesTileSetConfig | null) => {
      const currentBaseLayer = baseLayerRef.current;
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[CampaignPrepMap] refreshMapTileSource", {
          tileSetId: tileSet?.id ?? null,
          tileSetName: tileSet?.name ?? null,
          hasBaseLayer: Boolean(currentBaseLayer),
          hasSource: Boolean(currentBaseLayer?.getSource?.()),
        });
      }

      const pixelDims =
        worldMap.width_pixels && worldMap.height_pixels && worldMap.meters_per_pixel
          ? {
              widthPixels: worldMap.width_pixels,
              heightPixels: worldMap.height_pixels,
              metersPerPixel: worldMap.meters_per_pixel,
            }
          : null;

      refreshTileLayerSource({
        baseLayer: baseLayerRef.current,
        tileSet,
        worldBounds: worldMap.bounds,
        createSource: (ts, bounds) => createQuestablesTileSource(ts, bounds, pixelDims),
        applyConstraints: (config) => applyTileSetConstraints(config),
        clearError: () => setMapError(null),
        onFailure: (error) => {
          console.error("[CampaignPrepMap] Failed to initialise tile source", error);
          handleMapError(
            "Failed to initialise map tiles. Upload or configure tile sets before using the map.",
          );
        },
      });
    },
    [applyTileSetConstraints, handleMapError, worldMap],
  );

  // ── World layer loading ────────────────────────────────────────────
  const loadWorldLayers = useCallback(async () => {
    if (!mapInstanceRef.current) return;
    if (loadingDataRef.current) return;
    loadingDataRef.current = true;

    const map = mapInstanceRef.current;
    const mapView = map.getView();
    const size = map.getSize();
    if (!size || size[0] <= 0 || size[1] <= 0) {
      loadingDataRef.current = false;
      return;
    }

    const zoom = mapView.getZoom() ?? 0;
    const extent = mapView.calculateExtent(size);
    if (!extent || extent.some((v) => !Number.isFinite(v))) {
      if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
        console.warn(
          "[CampaignPrepMap] Skipping world layer load due to invalid extent",
          extent,
        );
      }
      loadingDataRef.current = false;
      return;
    }

    let bounds = mapDataLoader.getBoundsFromExtent(extent);
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
      console.debug("[CampaignPrepMap] Loading world layers", {
        zoom: Number(zoom).toFixed(2),
        bounds,
        visibility: layerVisibility,
      });
    }
    if (Object.values(bounds).some((v) => !Number.isFinite(v))) {
      const fallback = worldMap.bounds;
      if (Object.values(fallback).every((v) => Number.isFinite(v))) {
        bounds = fallback;
      } else {
        if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
          console.warn(
            "[CampaignPrepMap] Skipping world layer load due to invalid bounds",
            bounds,
            fallback,
          );
        }
        loadingDataRef.current = false;
        return;
      }
    }

    const dataTypes = mapDataLoader.getDataTypesForZoom(Math.floor(zoom));

    const layerLoaders: Array<{
      type: keyof LayerVisibilityState;
      visible: boolean;
      loader: (_worldId: string, _bounds: WorldMapBounds) => Promise<GeometryFeature[]>;
      layerRef: React.RefObject<GeometryLayer | null>;
    }> = [
      {
        type: "burgs",
        visible: layerVisibility.burgs,
        loader: (id, b) => mapDataLoader.loadBurgs(id, b),
        layerRef: burgLayerRef,
      },
      {
        type: "routes",
        visible: layerVisibility.routes,
        loader: (id, b) => mapDataLoader.loadRoutes(id, b),
        layerRef: routesLayerRef,
      },
      {
        type: "rivers",
        visible: layerVisibility.rivers,
        loader: (id, b) => mapDataLoader.loadRivers(id, b),
        layerRef: riversLayerRef,
      },
      {
        type: "markers",
        visible: layerVisibility.markers,
        loader: (id, b) => mapDataLoader.loadMarkers(id, b),
        layerRef: markersLayerRef,
      },
      {
        type: "cells",
        visible: layerVisibility.cells,
        loader: (id, b) => mapDataLoader.loadCells(id, b),
        layerRef: cellsLayerRef,
      },
    ];

    const requests: Array<
      Promise<{
        type: keyof LayerVisibilityState;
        features: GeometryFeature[];
        layer: GeometryLayer | null;
      }>
    > = [];

    layerLoaders.forEach(({ type, visible, loader, layerRef }) => {
      if (!visible) return;
      if (!dataTypes.includes(type)) {
        const layer = layerRef.current;
        const source = layer?.getSource();
        source?.clear();
        return;
      }

      requests.push(
        loader(worldMap.id, bounds).then((features) => ({
          type,
          features,
          layer: layerRef.current,
        })),
      );
    });

    try {
      const results = await Promise.allSettled(requests);
      let loadedFeatureCount = 0;
      results.forEach((result) => {
        if (result.status !== "fulfilled") {
          if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
            console.warn(
              "[CampaignPrepMap] World layer load rejected",
              result.reason,
            );
          }
          return;
        }
        const { layer, features, type } = result.value as unknown as {
          layer: GeometryLayer | null;
          features: GeometryFeature[];
          type?: string;
        };
        const source = layer?.getSource();
        if (!source) return;
        source.clear();
        if (Array.isArray(features) && features.length) {
          loadedFeatureCount += features.length;
        }
        source.addFeatures(features);
        if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
          console.debug("[CampaignPrepMap] Applied layer features", {
            type,
            count: features?.length ?? 0,
          });
        }
      });
      if (
        loadedFeatureCount === 0
        && typeof process !== "undefined"
        && process.env?.NODE_ENV === "development"
      ) {
        console.warn(
          "[CampaignPrepMap] No world features loaded at current zoom/bounds",
        );
      }
    } catch (error) {
      console.error("[CampaignPrepMap] Failed to load world layers", error);
      handleMapError("Unable to load world data for this map.");
    } finally {
      loadingDataRef.current = false;
    }
  }, [handleMapError, layerVisibility, mapInstanceRef, worldMap.bounds, worldMap.id]);

  // ── Tile set fetch effect is triggered from orchestrator ───────────
  // We expose setTileSets + setLoadingTiles via the returned state.

  return {
    // State
    tileSets,
    setTileSets,
    selectedTileSetId,
    setSelectedTileSetId,
    loadingTiles,
    setLoadingTiles,
    mapReady,
    mapError,
    setMapError,
    isDrawingRegion,
    // Refs
    baseLayerRef,
    burgLayerRef,
    routesLayerRef,
    riversLayerRef,
    markersLayerRef,
    cellsLayerRef,
    spawnLayerRef,
    regionsLayerRef,
    highlightLayerRef,
    drawLayerRef,
    drawInteractionRef,
    drawSourceRef,
    debouncedLayerLoaderRef,
    currentWorldMapIdRef,
    loadingDataRef,
    resizeObserverRef,
    mapReadyRef,
    pendingFrameRef,
    regionSeedContextRef,
    // Memos
    geoJsonReader,
    geoJsonWriter,
    highlightStyle,
    tileSetOptions,
    // Callbacks
    setMapReady,
    getRegionStyle,
    applyTileSetConstraints,
    updateSpawnFeature,
    applyLayerVisibility,
    startRegionDraw,
    createMapInstance,
    initializeMap,
    refreshMapTileSource,
    loadWorldLayers,
  };
}
