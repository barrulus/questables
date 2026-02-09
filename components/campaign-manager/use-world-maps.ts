import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  loadWorldMapSummaries,
  peekWorldMapSummaries,
  type WorldMapSummary,
} from "../../utils/world-map-cache";

export interface UseWorldMapsReturn {
  worldMaps: WorldMapSummary[];
  worldMapsLoading: boolean;
}

export function useWorldMaps(): UseWorldMapsReturn {
  const [worldMaps, setWorldMaps] = useState<WorldMapSummary[]>([]);
  const [worldMapsLoading, setWorldMapsLoading] = useState(false);

  const loadWorldMaps = useCallback(
    async ({
      signal,
      force = false,
    }: { signal?: AbortSignal; force?: boolean } = {}) => {
      if (!force) {
        const cached = peekWorldMapSummaries();
        if (cached !== null) {
          setWorldMaps(cached);
          return;
        }
      }

      try {
        setWorldMapsLoading(true);
        const maps = await loadWorldMapSummaries({ signal, force });
        setWorldMaps(maps);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Failed to load world maps";
        toast.error(message);
      } finally {
        setWorldMapsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadWorldMaps({ signal: controller.signal });
    return () => controller.abort();
  }, [loadWorldMaps]);

  return { worldMaps, worldMapsLoading };
}
