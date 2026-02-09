import { useCallback, useEffect, useRef, useState } from "react";
import type Map from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import { getCenter } from "ol/extent";

import { buildHoverTooltipInfo } from "./maps/feature-tooltip";
import type { DebouncedExecutor } from "./campaign-prep-debounce";
import { createDebouncedExecutor } from "./campaign-prep-debounce";
import type { LayerVisibilityState } from "./campaign-prep-layer-visibility";
import type { GeometryLayer } from "./layers";
import {
  type MapContextDetails,
  type MapContextAction,
  type MapFeatureDetails,
  castGeometryFeature,
  featureTypeFromProperties,
  buildFeatureDetails,
} from "./campaign-prep-map-types";
import type { UseMapViewReturn } from "./campaign-prep-map-view";

// ── Hook: useMapEvents ───────────────────────────────────────────────
// All OL event handlers, ref-based handler stability, and the UI state
// they produce (context menu, hover info, selected feature, zoom).

export interface UseMapEventsOptions {
  mapInstanceRef: React.RefObject<Map | null>;
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  // Props
  editingSpawn: boolean;
  canEditSpawn: boolean;
  onSelectSpawn?: (_pos: { x: number; y: number }) => void;
  onRequestLinkObjective?: (_ctx: MapContextDetails) => void;
  onRegionDrawComplete?: (_payload: {
    geometry: Record<string, unknown>;
    context: MapContextDetails | null;
  }) => void;
  contextActionBuilder?: (
    _ctx: MapContextDetails,
    _defaults: MapContextAction[],
  ) => MapContextAction[];
  onFeatureSelected?: (_details: MapFeatureDetails | null) => void;
  // From view hook
  view: UseMapViewReturn;
  // From init hook
  isDrawingRegion: boolean;
  startRegionDraw: (seedContext: MapContextDetails) => void;
  loadWorldLayers: () => Promise<void>;
  debouncedLayerLoaderRef: React.RefObject<DebouncedExecutor | null>;
  currentWorldMapIdRef: React.RefObject<string | null>;
  burgLayerRef: React.RefObject<GeometryLayer | null>;
  routesLayerRef: React.RefObject<GeometryLayer | null>;
  markersLayerRef: React.RefObject<GeometryLayer | null>;
  // Layer visibility
  layerVisibility: LayerVisibilityState;
  toggleLayer: (key: keyof LayerVisibilityState, explicit?: boolean) => void;
}

export interface UseMapEventsReturn {
  contextMenu: {
    actions: MapContextAction[];
    position: { x: number; y: number };
    context: MapContextDetails;
  } | null;
  closeContextMenu: () => void;
  contextMenuContainerRef: React.RefObject<HTMLDivElement | null>;
  hoverInfo: {
    title: string;
    subtitle: string | null;
    details: string[] | null;
    screenX: number;
    screenY: number;
  } | null;
  selectedFeature: MapFeatureDetails | null;
  setSelectedFeature: React.Dispatch<React.SetStateAction<MapFeatureDetails | null>>;
  currentZoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  attachEventListeners: () => (() => void) | undefined;
  loadWorldLayersHandlerRef: React.RefObject<(() => Promise<void>) | null>;
}

export function useMapEvents({
  mapInstanceRef,
  mapContainerRef,
  editingSpawn,
  canEditSpawn,
  onSelectSpawn,
  onRequestLinkObjective,
  onRegionDrawComplete,
  contextActionBuilder,
  view,
  isDrawingRegion,
  startRegionDraw,
  loadWorldLayers,
  debouncedLayerLoaderRef,
  currentWorldMapIdRef,
  burgLayerRef,
  routesLayerRef,
  markersLayerRef,
  layerVisibility,
  toggleLayer,
}: UseMapEventsOptions): UseMapEventsReturn {
  const {
    storeCurrentViewState,
    isProgrammaticViewUpdateRef,
    lastAppliedBoundsSignatureRef,
    scheduleProgrammaticReset,
  } = view;

  const contextMenuContainerRef = useRef<HTMLDivElement | null>(null);

  // ── State ──────────────────────────────────────────────────────────
  const [selectedFeature, setSelectedFeature] = useState<MapFeatureDetails | null>(null);
  const [currentZoom, setCurrentZoom] = useState(2);
  const currentZoomRef = useRef(2);
  const [hoverInfo, setHoverInfo] = useState<{
    title: string;
    subtitle: string | null;
    details: string[] | null;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    actions: MapContextAction[];
    position: { x: number; y: number };
    context: MapContextDetails;
  } | null>(null);

  // ── Zoom controls ──────────────────────────────────────────────────
  const handleZoomChange = useCallback(() => {
    const mapView = mapInstanceRef.current?.getView();
    if (!mapView) return;

    const zoom = mapView.getZoom() || 0;
    setCurrentZoom(Math.round(zoom));
    currentZoomRef.current = zoom;

    if (zoom >= 10 && !layerVisibility.cells) {
      toggleLayer("cells", true);
    } else if (zoom < 8 && layerVisibility.cells) {
      toggleLayer("cells", false);
    }

    burgLayerRef.current?.changed();
    routesLayerRef.current?.changed();
    markersLayerRef.current?.changed();
  }, [
    burgLayerRef,
    layerVisibility.cells,
    mapInstanceRef,
    markersLayerRef,
    routesLayerRef,
    toggleLayer,
  ]);

  const zoomIn = useCallback(() => {
    const mapView = mapInstanceRef.current?.getView();
    if (mapView) {
      mapView.animate({ zoom: (mapView.getZoom() || 0) + 1, duration: 250 });
    }
  }, [mapInstanceRef]);

  const zoomOut = useCallback(() => {
    const mapView = mapInstanceRef.current?.getView();
    if (mapView) {
      const current = mapView.getZoom() || 0;
      const minZoom = mapView.getMinZoom();
      const next = current - 1;
      mapView.animate({ zoom: next < minZoom ? minZoom : next, duration: 250 });
    }
  }, [mapInstanceRef]);

  // ── Context actions ────────────────────────────────────────────────
  const buildContextActions = useCallback(
    (context: MapContextDetails): MapContextAction[] => {
      const actions: MapContextAction[] = [];

      if (canEditSpawn && onSelectSpawn) {
        actions.push({
          id: "set-spawn",
          label: "Set spawn point",
          onSelect: ({ coordinate }) =>
            onSelectSpawn({ x: coordinate[0], y: coordinate[1] }),
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
    [
      canEditSpawn,
      contextActionBuilder,
      isDrawingRegion,
      onRegionDrawComplete,
      onRequestLinkObjective,
      onSelectSpawn,
      startRegionDraw,
    ],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ── Event handlers ─────────────────────────────────────────────────
  const handleMapClick = useCallback(
    (event: MapBrowserEvent) => {
      closeContextMenu();
      const map = mapInstanceRef.current;
      if (!map) return;

      const [x, y] = event.coordinate as [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
          console.warn(
            "[CampaignPrepMap] Ignoring map click with invalid coordinate",
            event.coordinate,
          );
        }
        return;
      }

      if (isDrawingRegion) return;

      if (editingSpawn && canEditSpawn && onSelectSpawn) {
        onSelectSpawn({ x, y });
        return;
      }

      const feature = castGeometryFeature(
        map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate),
      );
      const details = buildFeatureDetails(feature, [x, y]);
      setSelectedFeature(details);
    },
    [canEditSpawn, closeContextMenu, editingSpawn, isDrawingRegion, mapInstanceRef, onSelectSpawn],
  );

  const handlePointerMove = useCallback(
    (event: MapBrowserEvent) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      if (isDrawingRegion) {
        map.getTargetElement().style.cursor = "crosshair";
        return;
      }

      const featureLike = map.forEachFeatureAtPixel(event.pixel, (f) => f);
      const feature = castGeometryFeature(featureLike);

      if (!feature) {
        setHoverInfo(null);
        map.getTargetElement().style.cursor =
          editingSpawn && canEditSpawn ? "crosshair" : "";
        return;
      }

      const tooltip = buildHoverTooltipInfo(feature);
      map.getTargetElement().style.cursor = "pointer";

      setHoverInfo({
        title: tooltip.title,
        subtitle: tooltip.subtitle,
        details: tooltip.details,
        screenX: event.pixel[0],
        screenY: event.pixel[1],
      });
    },
    [canEditSpawn, editingSpawn, isDrawingRegion, mapInstanceRef],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!mapInstanceRef.current) return;
      event.preventDefault();

      const map = mapInstanceRef.current;
      let coordinate = map.getEventCoordinate(event) as [number, number] | undefined;
      const pixel = coordinate ? map.getPixelFromCoordinate(coordinate) : undefined;

      const feature = castGeometryFeature(
        pixel
          ? map.forEachFeatureAtPixel(pixel, (candidate) => candidate)
          : undefined,
      );

      if (!coordinate || coordinate.some((v) => !Number.isFinite(v))) {
        if (feature?.getGeometry()) {
          const center = getCenter(feature.getGeometry()!.getExtent());
          if (center && center.every((v) => Number.isFinite(v))) {
            coordinate = center as [number, number];
          }
        }
      }

      if (!coordinate || coordinate.some((v) => !Number.isFinite(v))) {
        const center = map.getView().getCenter();
        if (center && center.every((v) => Number.isFinite(v))) {
          coordinate = center as [number, number];
        } else {
          if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
            console.warn(
              "[CampaignPrepMap] Ignoring context menu with invalid coordinate",
              coordinate,
            );
          }
          return;
        }
      }

      const context: MapContextDetails = {
        coordinate: [coordinate[0], coordinate[1]],
        feature,
        featureType: featureTypeFromProperties(feature),
        pixel: pixel ?? map.getPixelFromCoordinate(coordinate),
        originalEvent: event,
      };

      const actions = buildContextActions(context).filter((action) => !action.disabled);
      if (actions.length === 0) return;

      setContextMenu({
        actions,
        context,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [buildContextActions, mapInstanceRef],
  );

  // ── Handler refs for stable OL event registration ──────────────────
  const pointerMoveHandlerRef = useRef(handlePointerMove);
  useEffect(() => {
    pointerMoveHandlerRef.current = handlePointerMove;
  }, [handlePointerMove]);

  const mapClickHandlerRef = useRef(handleMapClick);
  useEffect(() => {
    mapClickHandlerRef.current = handleMapClick;
  }, [handleMapClick]);

  const loadWorldLayersHandlerRef = useRef(loadWorldLayers);
  useEffect(() => {
    loadWorldLayersHandlerRef.current = loadWorldLayers;
  }, [loadWorldLayers]);

  // Debounced layer loader setup (runs once)
  useEffect(() => {
    const executor = createDebouncedExecutor(() => {
      loadWorldLayersHandlerRef.current?.();
    }, 200);

    debouncedLayerLoaderRef.current?.cancel();
    (debouncedLayerLoaderRef as { current: DebouncedExecutor | null }).current = executor;

    return () => {
      executor.cancel();
      if (debouncedLayerLoaderRef.current === executor) {
        (debouncedLayerLoaderRef as { current: DebouncedExecutor | null }).current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleZoomChangeRef = useRef(handleZoomChange);
  useEffect(() => {
    handleZoomChangeRef.current = handleZoomChange;
  }, [handleZoomChange]);

  const contextMenuHandlerRef = useRef(handleContextMenu);
  useEffect(() => {
    contextMenuHandlerRef.current = handleContextMenu;
  }, [handleContextMenu]);

  // ── Attach all OL event listeners ──────────────────────────────────
  const attachEventListeners = useCallback(() => {
    const map = mapInstanceRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    const contextTargets = new Set<EventTarget>();
    const viewport = map.getViewport?.();
    if (viewport) contextTargets.add(viewport);
    const overlayStop = map.getOverlayContainerStopEvent?.();
    if (overlayStop) contextTargets.add(overlayStop);
    contextTargets.add(container);

    const pointerMoveWrapper = (event: MapBrowserEvent) => {
      pointerMoveHandlerRef.current?.(event);
    };
    const moveEndWrapper = () => {
      const worldMapId = currentWorldMapIdRef.current;
      if (worldMapId) {
        storeCurrentViewState(worldMapId, {
          userAdjusted: !isProgrammaticViewUpdateRef.current,
          boundsSignature: lastAppliedBoundsSignatureRef.current ?? undefined,
        });
      }
      if (isProgrammaticViewUpdateRef.current) {
        scheduleProgrammaticReset();
      }
      if (debouncedLayerLoaderRef.current) {
        debouncedLayerLoaderRef.current.trigger();
      } else {
        loadWorldLayersHandlerRef.current?.();
      }
    };
    const mapClickWrapper = (event: MapBrowserEvent) => {
      mapClickHandlerRef.current?.(event);
    };
    const contextMenuWrapper = (event: Event) => {
      event.stopPropagation();
      contextMenuHandlerRef.current?.(event as MouseEvent);
    };
    const zoomChangeWrapper = () => {
      handleZoomChangeRef.current?.();
    };

    const mapView = map.getView();
    map.on("pointermove", pointerMoveWrapper);
    map.on("moveend", moveEndWrapper);
    map.on("click", mapClickWrapper);
    mapView.on("change:resolution", zoomChangeWrapper);
    contextTargets.forEach((target) => {
      target.addEventListener("contextmenu", contextMenuWrapper);
    });

    return () => {
      map.un("pointermove", pointerMoveWrapper);
      map.un("moveend", moveEndWrapper);
      map.un("click", mapClickWrapper);
      mapView.un("change:resolution", zoomChangeWrapper);
      contextTargets.forEach((target) => {
        target.removeEventListener("contextmenu", contextMenuWrapper);
      });
    };
    // Stable callback — reads refs, not state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    contextMenu,
    closeContextMenu,
    contextMenuContainerRef,
    hoverInfo,
    selectedFeature,
    setSelectedFeature,
    currentZoom,
    zoomIn,
    zoomOut,
    attachEventListeners,
    loadWorldLayersHandlerRef,
  };
}
