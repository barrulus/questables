import {
  fetchJson,
  type ApiRequestOptions,
} from '../api-client';

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const encodeBounds = (bounds: MapBounds): string =>
  encodeURIComponent(JSON.stringify(bounds));

export async function listWorldMaps(options: ApiRequestOptions = {}): Promise<Record<string, unknown>[]> {
  const data = await fetchJson<Record<string, unknown>[]>(
    '/api/maps/world',
    { method: 'GET', signal: options.signal },
    'Failed to load world maps',
  );

  return data ?? [];
}

export async function getWorldMapById(
  worldMapId: string,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown> | null> {
  const data = await fetchJson<Record<string, unknown>>(
    `/api/maps/world/${worldMapId}`,
    { method: 'GET', signal: options.signal },
    'Failed to load world map',
  );

  return data ?? null;
}

export async function listWorldBurgs(
  worldMapId: string,
  bounds?: MapBounds,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>[]> {
  const suffix = bounds ? `?bounds=${encodeBounds(bounds)}` : '';
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/maps/${worldMapId}/burgs${suffix}`,
    { method: 'GET', signal: options.signal },
    'Failed to load burgs',
  );

  return data ?? [];
}

export async function listWorldRoutes(
  worldMapId: string,
  bounds?: MapBounds,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>[]> {
  const suffix = bounds ? `?bounds=${encodeBounds(bounds)}` : '';
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/maps/${worldMapId}/routes${suffix}`,
    { method: 'GET', signal: options.signal },
    'Failed to load routes',
  );

  return data ?? [];
}

export async function listWorldRivers(
  worldMapId: string,
  bounds?: MapBounds,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>[]> {
  const suffix = bounds ? `?bounds=${encodeBounds(bounds)}` : '';
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/maps/${worldMapId}/rivers${suffix}`,
    { method: 'GET', signal: options.signal },
    'Failed to load rivers',
  );

  return data ?? [];
}

export async function listWorldMarkers(
  worldMapId: string,
  bounds?: MapBounds,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>[]> {
  const suffix = bounds ? `?bounds=${encodeBounds(bounds)}` : '';
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/maps/${worldMapId}/markers${suffix}`,
    { method: 'GET', signal: options.signal },
    'Failed to load markers',
  );

  return data ?? [];
}

export async function listWorldCells(
  worldMapId: string,
  bounds: MapBounds,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>[]> {
  const suffix = `?bounds=${encodeBounds(bounds)}`;
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/maps/${worldMapId}/cells${suffix}`,
    { method: 'GET', signal: options.signal },
    'Failed to load cells',
  );

  return data ?? [];
}

export async function listTileSets(options: ApiRequestOptions = {}): Promise<Record<string, unknown>[]> {
  const data = await fetchJson<Record<string, unknown>[]>(
    '/api/maps/tilesets',
    { method: 'GET', signal: options.signal },
    'Failed to load tile sets',
  );

  return data ?? [];
}
