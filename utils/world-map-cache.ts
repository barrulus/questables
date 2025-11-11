import { listWorldMaps } from "./api/maps";

/**
 * Provides a per-session cache for world map summaries so UI surfaces can share
 * the same response without repeatedly hitting the backend.
 */

export interface WorldMapSummary {
  id: string;
  name: string;
  description: string | null;
}

interface CacheState {
  data: WorldMapSummary[] | null;
  inflight: Promise<WorldMapSummary[]> | null;
  error: Error | null;
}

const cache: CacheState = {
  data: null,
  inflight: null,
  error: null,
};

type ListWorldMapsFn = typeof listWorldMaps;
let listWorldMapsFetcher: ListWorldMapsFn = listWorldMaps;

const toWorldMapSummary = (record: unknown): WorldMapSummary | null => {
  if (!record || typeof record !== "object") {
    return null;
  }

  const value = record as Record<string, unknown>;
  const rawId = value.id;
  const rawName = value.name;

  if (typeof rawId !== "string" || !rawId.trim()) {
    return null;
  }

  if (typeof rawName !== "string" || !rawName.trim()) {
    return null;
  }

  const descriptionValue = value.description;
  const description =
    typeof descriptionValue === "string" && descriptionValue.trim()
      ? descriptionValue
      : null;

  return {
    id: rawId,
    name: rawName.trim(),
    description,
  };
};

const sanitizeWorldMaps = (payload: unknown): WorldMapSummary[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map(toWorldMapSummary)
    .filter((item): item is WorldMapSummary => item !== null);
};

export const peekWorldMapSummaries = (): WorldMapSummary[] | null => cache.data;

export async function loadWorldMapSummaries({
  signal,
  force = false,
}: {
  signal?: AbortSignal;
  force?: boolean;
} = {}): Promise<WorldMapSummary[]> {
  if (force) {
    cache.data = null;
  }

  if (cache.data !== null && !force) {
    return cache.data;
  }

  if (cache.inflight) {
    return cache.inflight;
  }

  const request = listWorldMapsFetcher({ signal })
    .then((records) => {
      const summaries = sanitizeWorldMaps(records);
      cache.data = summaries;
      cache.error = null;
      return summaries;
    })
    .catch((err) => {
      cache.error = err instanceof Error ? err : new Error(String(err));
      throw cache.error;
    })
    .finally(() => {
      cache.inflight = null;
    });

  cache.inflight = request;
  return request;
}

export function invalidateWorldMapSummaries(): void {
  cache.data = null;
  cache.error = null;
}

export function getCachedWorldMapError(): Error | null {
  return cache.error;
}

export function __resetWorldMapCacheForTests(): void {
  cache.data = null;
  cache.inflight = null;
  cache.error = null;
  listWorldMapsFetcher = listWorldMaps;
}

export function setWorldMapListFetcher(fetcher: ListWorldMapsFn): void {
  listWorldMapsFetcher = fetcher;
}
