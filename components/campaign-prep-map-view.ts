import { useCallback, useRef } from "react";
import type Map from "ol/Map";

import { updateProjectionExtent } from "./map-projection";
import { toast } from "sonner";
import {
  type BoundsLike,
  type CachedViewState,
  type BaseWorldMap,
  isFiniteCoordinateTuple,
  padExtent,
  createBoundsSignature,
} from "./campaign-prep-map-types";

// ── Hook: useMapView ─────────────────────────────────────────────────
// Viewport management, view state caching, and extent fitting logic.

export interface UseMapViewOptions {
  mapInstanceRef: React.RefObject<Map | null>;
  worldMap: BaseWorldMap;
  onError?: (_message: string) => void;
}

export interface UseMapViewReturn {
  // Refs exposed to other hooks
  viewStateCacheRef: React.RefObject<Record<string, CachedViewState>>;
  isProgrammaticViewUpdateRef: React.RefObject<boolean>;
  lastAppliedBoundsSignatureRef: React.RefObject<string | null>;
  initialFitDoneRef: React.RefObject<boolean>;
  lastFittedExtentRef: React.RefObject<[number, number, number, number] | null>;
  lastFittedSizeRef: React.RefObject<[number, number] | null>;
  // Callbacks
  storeCurrentViewState: (
    worldMapId: string,
    options?: { userAdjusted?: boolean; boundsSignature?: string },
  ) => void;
  updateViewExtent: (
    bounds?: BoundsLike | null,
    options?: { force?: boolean; reason?: string },
  ) => void;
  scheduleProgrammaticReset: () => void;
  handleMapError: (message: string) => void;
}

export function useMapView({
  mapInstanceRef,
  worldMap,
  onError,
}: UseMapViewOptions): UseMapViewReturn {
  const viewStateCacheRef = useRef<Record<string, CachedViewState>>({});
  const isProgrammaticViewUpdateRef = useRef(false);
  const lastAppliedBoundsSignatureRef = useRef<string | null>(null);
  const initialFitDoneRef = useRef(false);
  const lastFittedExtentRef = useRef<[number, number, number, number] | null>(null);
  const lastFittedSizeRef = useRef<[number, number] | null>(null);

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

  const areExtentsEqual = useCallback(
    (a: [number, number, number, number], b: [number, number, number, number]) => {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    },
    [],
  );

  const scheduleProgrammaticReset = useCallback(() => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        isProgrammaticViewUpdateRef.current = false;
      });
      return;
    }
    setTimeout(() => {
      isProgrammaticViewUpdateRef.current = false;
    }, 0);
  }, []);

  const storeCurrentViewState = useCallback(
    (
      worldMapId: string,
      options: { userAdjusted?: boolean; boundsSignature?: string } = {},
    ) => {
      if (!worldMapId) return;

      const map = mapInstanceRef.current;
      const view = map?.getView();
      if (!map || !view) return;

      const cache = viewStateCacheRef.current;

      const size = map.getSize();
      if (!size || size[0] <= 0 || size[1] <= 0) return;

      const centerCandidate = view.getCenter();
      if (!isFiniteCoordinateTuple(centerCandidate as [number, number])) return;
      const center = [
        (centerCandidate as number[])[0],
        (centerCandidate as number[])[1],
      ] as [number, number];

      const zoom = view.getZoom();
      const resolution = view.getResolution();
      const extent = view.calculateExtent(size);
      if (!extent || extent.some((v) => !Number.isFinite(v))) return;

      const existing = cache[worldMapId];
      const boundsSignature =
        options.boundsSignature
        ?? lastAppliedBoundsSignatureRef.current
        ?? existing?.boundsSignature
        ?? "bounds:unknown";

      const userAdjusted =
        typeof options.userAdjusted === "boolean"
          ? options.userAdjusted
          : existing?.userAdjusted ?? false;

      const zoomValue =
        typeof zoom === "number" && Number.isFinite(zoom) ? zoom : null;
      const resolutionValue =
        typeof resolution === "number" && Number.isFinite(resolution) ? resolution : null;

      cache[worldMapId] = {
        center,
        zoom: zoomValue,
        resolution: resolutionValue,
        extent: [extent[0], extent[1], extent[2], extent[3]],
        size: [size[0], size[1]],
        boundsSignature,
        userAdjusted,
      };
    },
    [mapInstanceRef],
  );

  const updateViewExtent = useCallback(
    (bounds?: BoundsLike | null, options?: { force?: boolean; reason?: string }) => {
      const map = mapInstanceRef.current;
      const view = map?.getView();
      if (!map || !view) return;

      const worldMapId = worldMap.id;
      const targetBounds = bounds ?? worldMap.bounds ?? null;
      const extent = updateProjectionExtent(targetBounds ?? null);
      const paddedExtent = padExtent(extent);
      view.setProperties({ extent: paddedExtent });

      const boundsSignature = createBoundsSignature(targetBounds);
      lastAppliedBoundsSignatureRef.current = boundsSignature;

      const size = map.getSize();
      if (!size || size[0] === 0 || size[1] === 0) {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            updateViewExtent(targetBounds, options);
          });
        } else {
          setTimeout(() => {
            updateViewExtent(targetBounds, options);
          }, 0);
        }
        return;
      }

      const cache = viewStateCacheRef.current;
      const cachedState = worldMapId ? cache[worldMapId] : undefined;

      if (
        cachedState
        && cachedState.boundsSignature === boundsSignature
        && !options?.force
        && (cachedState.userAdjusted || initialFitDoneRef.current)
      ) {
        isProgrammaticViewUpdateRef.current = true;
        view.setCenter(cachedState.center);
        if (typeof cachedState.zoom === "number") {
          view.setZoom(cachedState.zoom);
        } else if (typeof cachedState.resolution === "number") {
          view.setResolution(cachedState.resolution);
        }
        lastFittedExtentRef.current = cachedState.extent;
        lastFittedSizeRef.current = cachedState.size;
        initialFitDoneRef.current = true;
        storeCurrentViewState(worldMapId, {
          userAdjusted: cachedState.userAdjusted,
          boundsSignature,
        });
        scheduleProgrammaticReset();
        return;
      }

      const targetCenter: [number, number] = [
        (extent[0] + extent[2]) / 2,
        (extent[1] + extent[3]) / 2,
      ];
      view.setCenter(targetCenter);

      const previousExtent = lastFittedExtentRef.current;
      const previousSize = lastFittedSizeRef.current;
      const extentChanged = !previousExtent || !areExtentsEqual(previousExtent, extent);
      const sizeChanged =
        !previousSize || previousSize[0] !== size[0] || previousSize[1] !== size[1];
      const shouldFit =
        options?.force === true
        || !initialFitDoneRef.current
        || extentChanged
        || sizeChanged;

      if (shouldFit) {
        isProgrammaticViewUpdateRef.current = true;
        view.fit(extent, {
          size,
          nearest: true,
          padding: [0, 0, 0, 0],
          duration: 0,
        });
        lastFittedExtentRef.current = extent;
        lastFittedSizeRef.current = [size[0], size[1]];
        initialFitDoneRef.current = true;
        storeCurrentViewState(worldMapId, {
          userAdjusted: false,
          boundsSignature,
        });
        scheduleProgrammaticReset();
      }
    },
    [
      areExtentsEqual,
      mapInstanceRef,
      scheduleProgrammaticReset,
      storeCurrentViewState,
      worldMap,
    ],
  );

  return {
    viewStateCacheRef,
    isProgrammaticViewUpdateRef,
    lastAppliedBoundsSignatureRef,
    initialFitDoneRef,
    lastFittedExtentRef,
    lastFittedSizeRef,
    storeCurrentViewState,
    updateViewExtent,
    scheduleProgrammaticReset,
    handleMapError,
  };
}
