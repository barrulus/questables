import { useEffect, useRef } from "react";
import type Map from "ol/Map";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import 'ol/ol.css';
import { ZoomIn, ZoomOut } from "lucide-react";

import { mapDataLoader } from "./map-data-loader";
import type { TileSetConfig as QuestablesTileSetConfig } from "./maps/questables-tile-source";
import type { GeometryFeature } from "./layers";
import { cn } from "./ui/utils";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { LoadingSpinner } from "./ui/loading-spinner";
import { useLayerVisibility, type LayerVisibilityState } from "./campaign-prep-layer-visibility";
import {
  type CampaignPrepMapProps,
  isFiniteNumber,
  isTileSetRecord,
  createBoundsSignature,
} from "./campaign-prep-map-types";
import { useMapView } from "./campaign-prep-map-view";
import { useMapInit } from "./campaign-prep-map-init";
import { useMapEvents } from "./campaign-prep-map-events";

export type { MapContextDetails, MapContextAction, MapFeatureDetails, CampaignPrepMapProps } from "./campaign-prep-map-types";

const INITIAL_LAYER_VISIBILITY: LayerVisibilityState = {
  burgs: true,
  routes: true,
  rivers: false,
  markers: true,
  cells: false,
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
  // Shared refs owned by the orchestrator
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<Map | null>(null);

  const { visibility: layerVisibility, toggle: toggleLayer } =
    useLayerVisibility(INITIAL_LAYER_VISIBILITY);

  // ── Hooks ──────────────────────────────────────────────────────────
  const viewHook = useMapView({
    mapInstanceRef,
    worldMap,
    onError,
  });

  const initHook = useMapInit({
    mapContainerRef,
    mapInstanceRef,
    worldMap,
    layerVisibility,
    onRegionDrawComplete,
    view: viewHook,
  });

  const eventsHook = useMapEvents({
    mapInstanceRef,
    mapContainerRef,
    editingSpawn,
    canEditSpawn,
    onSelectSpawn,
    onRequestLinkObjective,
    onRegionDrawComplete,
    contextActionBuilder,
    onFeatureSelected,
    view: viewHook,
    isDrawingRegion: initHook.isDrawingRegion,
    startRegionDraw: initHook.startRegionDraw,
    loadWorldLayers: initHook.loadWorldLayers,
    debouncedLayerLoaderRef: initHook.debouncedLayerLoaderRef,
    currentWorldMapIdRef: initHook.currentWorldMapIdRef,
    burgLayerRef: initHook.burgLayerRef,
    routesLayerRef: initHook.routesLayerRef,
    markersLayerRef: initHook.markersLayerRef,
    layerVisibility,
    toggleLayer,
  });

  // ── Lifecycle effects ──────────────────────────────────────────────

  // 1. Fetch tile sets on mount
  useEffect(() => {
    let cancelled = false;
    initHook.setLoadingTiles(true);

    (async () => {
      try {
        const tileSetRecords = await mapDataLoader.loadTileSets();
        if (cancelled) return;

        const normalized: QuestablesTileSetConfig[] = (
          Array.isArray(tileSetRecords) ? tileSetRecords : []
        )
          .filter(isTileSetRecord)
          .map((entry) => {
            const id = String(entry.id);
            const name =
              typeof entry.name === "string" && entry.name.trim() ? entry.name : id;
            return {
              id,
              name,
              base_url: entry.base_url as string,
              attribution:
                typeof entry.attribution === "string" ? entry.attribution : undefined,
              min_zoom: isFiniteNumber(entry.min_zoom) ? entry.min_zoom : undefined,
              max_zoom: isFiniteNumber(entry.max_zoom) ? entry.max_zoom : undefined,
              tile_size: isFiniteNumber(entry.tile_size) ? entry.tile_size : undefined,
              wrapX: Boolean(entry.wrapX),
            };
          });

        initHook.setTileSets(normalized);
        initHook.setMapError((prev) =>
          prev && prev.startsWith("Failed to load available tile sets.") ? null : prev,
        );
        initHook.setSelectedTileSetId((prev) =>
          normalized.length > 0 && prev && normalized.some((ts) => ts.id === prev)
            ? prev
            : normalized[0]?.id ?? "",
        );
      } catch (error) {
        const derivedMessage =
          error instanceof Error && error.message
            ? error.message
            : "Failed to load available tile sets.";
        initHook.setMapError(derivedMessage);
        viewHook.handleMapError(derivedMessage);
      } finally {
        if (!cancelled) initHook.setLoadingTiles(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewHook.handleMapError]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Sync selectedTileSetId when tileSets list changes
  useEffect(() => {
    if (initHook.tileSets.length === 0) {
      if (initHook.selectedTileSetId !== "") initHook.setSelectedTileSetId("");
      return;
    }
    if (
      !initHook.selectedTileSetId
      || !initHook.tileSets.some((ts) => ts.id === initHook.selectedTileSetId)
    ) {
      initHook.setSelectedTileSetId(initHook.tileSets[0].id);
    }
  }, [initHook.selectedTileSetId, initHook.tileSets]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. World map change / initialize
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (
      initHook.currentWorldMapIdRef.current === worldMap.id
      && mapInstanceRef.current
    ) {
      const boundsSignature = createBoundsSignature(worldMap.bounds);
      const cache = viewHook.viewStateCacheRef.current;
      const cachedState = cache[worldMap.id];
      const shouldForceFit =
        !cachedState || cachedState.boundsSignature !== boundsSignature;
      viewHook.updateViewExtent(worldMap.bounds, {
        force: shouldForceFit,
        reason: shouldForceFit ? "bounds-change" : "world-map-sync",
      });
      if (!initHook.mapReadyRef.current) {
        initHook.setMapReady(true);
      }
      return;
    }
    initHook.initializeMap();
  }, [initHook.initializeMap, initHook.setMapReady, viewHook.updateViewExtent, worldMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Cleanup on unmount
  useEffect(
    () => () => {
      if (initHook.pendingFrameRef.current !== null) {
        cancelAnimationFrame(initHook.pendingFrameRef.current);
        initHook.pendingFrameRef.current = null;
      }
      if (initHook.resizeObserverRef.current) {
        initHook.resizeObserverRef.current.disconnect();
        initHook.resizeObserverRef.current = null;
      }
      initHook.debouncedLayerLoaderRef.current?.cancel();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current.dispose();
        mapInstanceRef.current = null;
      }
      initHook.setMapReady(false);
    },
    [initHook.setMapReady], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 5. Apply layer visibility
  useEffect(() => {
    if (!initHook.mapReady) return;
    initHook.applyLayerVisibility();
  }, [initHook.applyLayerVisibility, initHook.mapReady, layerVisibility]);

  // 6. Attach event listeners
  useEffect(() => {
    if (!initHook.mapReady) return;
    const detach = eventsHook.attachEventListeners();
    return () => {
      detach?.();
    };
  }, [eventsHook.attachEventListeners, initHook.mapReady]);

  // 7. Tile source refresh
  useEffect(() => {
    if (!initHook.mapReady) return;

    if (initHook.tileSets.length > 0) {
      const nextId =
        initHook.selectedTileSetId
        && initHook.tileSets.some((ts) => ts.id === initHook.selectedTileSetId)
          ? initHook.selectedTileSetId
          : initHook.tileSets[0].id;
      if (nextId !== initHook.selectedTileSetId) {
        initHook.setSelectedTileSetId(nextId);
        return;
      }
    }

    if (!initHook.selectedTileSetId) {
      initHook.baseLayerRef.current?.setSource(null);
      return;
    }

    const tileSet =
      initHook.tileSets.find((ts) => ts.id === initHook.selectedTileSetId) ?? null;
    initHook.refreshMapTileSource(tileSet);
  }, [
    initHook.mapReady,
    initHook.refreshMapTileSource,
    initHook.selectedTileSetId,
    initHook.tileSets,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // 8. Trigger data load
  useEffect(() => {
    if (!initHook.mapReady) return;
    eventsHook.loadWorldLayersHandlerRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initHook.mapReady, initHook.selectedTileSetId, layerVisibility]);

  // 9. Sync spawn feature
  useEffect(() => {
    initHook.updateSpawnFeature(spawn);
  }, [spawn, initHook.updateSpawnFeature]);

  // 10. Render regions
  useEffect(() => {
    if (!initHook.mapReady) return;
    const layer = initHook.regionsLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    (regions ?? []).forEach((region) => {
      try {
        const featureOrArray = initHook.geoJsonReader.readFeature(region.geometry);
        const feature = Array.isArray(featureOrArray) ? featureOrArray[0] : featureOrArray;
        if (!feature) return;
        feature.setId(region.id);
        feature.set("data", region);
        feature.set("type", "region");
        feature.set("name", region.name);
        feature.setStyle(initHook.getRegionStyle(region));
        source.addFeature(feature as GeometryFeature);
      } catch (error) {
        console.warn("[CampaignPrepMap] Failed to render region", region.id, error);
      }
    });
  }, [initHook.geoJsonReader, initHook.getRegionStyle, initHook.mapReady, regions]);

  // 11. Render highlight point
  useEffect(() => {
    const layer = initHook.highlightLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    if (!highlightPoint) return;

    const feature = new Feature<Point>({
      geometry: new Point(highlightPoint.coordinate),
      id: "highlight-location",
    });
    feature.setStyle(initHook.highlightStyle);
    source.addFeature(feature);

    if (mapInstanceRef.current) {
      mapInstanceRef.current.getView().animate({
        center: highlightPoint.coordinate,
        duration: 250,
      });
    }
  }, [highlightPoint, initHook.highlightStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  // 12. Forward selected feature to parent
  useEffect(() => {
    if (onFeatureSelected) {
      onFeatureSelected(eventsHook.selectedFeature);
    }
  }, [onFeatureSelected, eventsHook.selectedFeature]);

  // 13. Cursor styling for spawn editing
  useEffect(() => {
    const target = mapInstanceRef.current?.getTargetElement();
    if (!target) return;
    target.style.cursor = editingSpawn && canEditSpawn ? "crosshair" : "";
    return () => {
      target.style.cursor = "";
    };
  }, [canEditSpawn, editingSpawn]);

  // 14. Dismiss context menu on click outside
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !eventsHook.contextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!eventsHook.contextMenuContainerRef.current) return;
      if (!eventsHook.contextMenuContainerRef.current.contains(event.target as Node)) {
        eventsHook.closeContextMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [eventsHook.closeContextMenu, eventsHook.contextMenu]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col rounded-md border bg-background",
        className,
      )}
    >
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
            {initHook.loadingTiles ? (
              <Skeleton className="h-8 w-40 rounded-sm" />
            ) : (
              <Select
                value={initHook.tileSets.length === 0 ? "__none__" : initHook.selectedTileSetId}
                onValueChange={(value) => {
                  if (value === "__none__") {
                    initHook.setSelectedTileSetId("");
                    return;
                  }
                  initHook.setSelectedTileSetId(value);
                }}
                disabled={initHook.tileSets.length === 0}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Select tile set" />
                </SelectTrigger>
                <SelectContent>
                  {initHook.tileSetOptions.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      disabled={option.id === "__none__"}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                  {initHook.tileSets.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No tile sets configured
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(
              ["burgs", "routes", "markers", "rivers", "cells"] as Array<
                keyof LayerVisibilityState
              >
            ).map((layerKey) => (
              <label
                key={layerKey}
                className="flex items-center gap-1 rounded border px-2 py-1"
              >
                <Checkbox
                  checked={layerVisibility[layerKey]}
                  onCheckedChange={(checked) => toggleLayer(layerKey, Boolean(checked))}
                />
                <span className="capitalize">{layerKey}</span>
              </label>
            ))}
            <div className="flex items-center gap-1 border-l pl-2">
              <Button
                variant="outline"
                size="sm"
                onClick={eventsHook.zoomOut}
                className="h-7 px-2"
              >
                <ZoomOut className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center text-xs font-medium">
                {eventsHook.currentZoom}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={eventsHook.zoomIn}
                className="h-7 px-2"
              >
                <ZoomIn className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex-1">
        <div
          ref={mapContainerRef}
          className="relative z-0 h-full min-h-[520px] w-full overflow-hidden rounded-b-md bg-muted"
        />

        {initHook.isDrawingRegion && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-transparent text-sm font-semibold text-foreground">
            Drawing region… double-click to finish
          </div>
        )}

        {initHook.mapError ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-transparent">
            <div className="max-w-sm rounded border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {initHook.mapError}
            </div>
          </div>
        ) : null}

        {!initHook.mapReady ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-transparent">
            <LoadingSpinner className="mr-2 h-4 w-4" />
            <span className="text-sm font-medium text-muted-foreground">
              Preparing campaign map…
            </span>
          </div>
        ) : null}

        {eventsHook.contextMenu ? (
          <div
            ref={eventsHook.contextMenuContainerRef}
            className="fixed z-50 min-w-[180px] rounded-md border bg-background p-1 shadow-lg"
            style={{
              left: eventsHook.contextMenu.position.x,
              top: eventsHook.contextMenu.position.y,
            }}
          >
            {eventsHook.contextMenu.actions.map((action) => (
              <Button
                key={action.id}
                variant="ghost"
                className="w-full justify-start px-2 py-1 text-sm"
                onClick={() => {
                  action.onSelect(eventsHook.contextMenu!.context);
                  eventsHook.closeContextMenu();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        {eventsHook.hoverInfo ? (
          <div
            className="pointer-events-none absolute z-40 rounded-md bg-slate-900/90 px-3 py-1 text-xs text-white shadow"
            style={{
              left: eventsHook.hoverInfo.screenX + 16,
              top: eventsHook.hoverInfo.screenY + 16,
            }}
          >
            <div className="font-medium">{eventsHook.hoverInfo.title}</div>
            {eventsHook.hoverInfo.subtitle ? (
              <div className="text-[10px] uppercase text-slate-300">
                {eventsHook.hoverInfo.subtitle}
              </div>
            ) : null}
            {eventsHook.hoverInfo.details
              ? eventsHook.hoverInfo.details.map((line, i) => (
                  <div key={i} className="text-[10px] text-slate-300">
                    {line}
                  </div>
                ))
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
