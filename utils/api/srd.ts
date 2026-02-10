import { fetchJson, buildJsonRequestInit, type ApiRequestOptions } from '../api-client';
import type {
  SrdSpecies, SrdClass, SrdBackground, SrdSpell,
  SrdItem, SrdFeat, SrdCondition,
  ComputeStatsRequest, ComputeStatsResponse,
} from '../srd/types';

// Species
export interface SpeciesFilters {
  source?: string;
}

export async function fetchSpecies(
  filters: SpeciesFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdSpecies[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);

  const qs = params.toString();
  const data = await fetchJson<{ species: SrdSpecies[] }>(
    `/api/srd/species${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch species',
  );
  return data?.species ?? [];
}

export async function fetchSpeciesByKey(
  key: string,
  options: ApiRequestOptions & { source?: string } = {},
): Promise<SrdSpecies | null> {
  const params = new URLSearchParams();
  if (options.source) params.set('source', options.source);

  const qs = params.toString();
  const data = await fetchJson<{ species: SrdSpecies }>(
    `/api/srd/species/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch species',
  );
  return data?.species ?? null;
}

// Classes
export interface ClassFilters {
  source?: string;
}

export async function fetchClasses(
  filters: ClassFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdClass[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);

  const qs = params.toString();
  const data = await fetchJson<{ classes: SrdClass[] }>(
    `/api/srd/classes${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch classes',
  );
  return data?.classes ?? [];
}

export async function fetchClassByKey(
  key: string,
  options: ApiRequestOptions & { source?: string } = {},
): Promise<SrdClass | null> {
  const params = new URLSearchParams();
  if (options.source) params.set('source', options.source);

  const qs = params.toString();
  const data = await fetchJson<{ class: SrdClass }>(
    `/api/srd/classes/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch class',
  );
  return data?.class ?? null;
}

// Backgrounds
export interface BackgroundFilters {
  source?: string;
}

export async function fetchBackgrounds(
  filters: BackgroundFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdBackground[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);

  const qs = params.toString();
  const data = await fetchJson<{ backgrounds: SrdBackground[] }>(
    `/api/srd/backgrounds${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch backgrounds',
  );
  return data?.backgrounds ?? [];
}

export async function fetchBackgroundByKey(
  key: string,
  options: ApiRequestOptions & { source?: string } = {},
): Promise<SrdBackground | null> {
  const params = new URLSearchParams();
  if (options.source) params.set('source', options.source);

  const qs = params.toString();
  const data = await fetchJson<{ background: SrdBackground }>(
    `/api/srd/backgrounds/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch background',
  );
  return data?.background ?? null;
}

// Spells
export interface SpellFilters {
  class?: string;
  level?: number;
  ritual?: boolean;
  source?: string;
}

export async function fetchSpells(
  filters: SpellFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdSpell[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.class) params.set('class', filters.class);
  if (filters.level !== undefined) params.set('level', String(filters.level));
  if (filters.ritual !== undefined) params.set('ritual', String(filters.ritual));

  const qs = params.toString();
  const data = await fetchJson<{ spells: SrdSpell[] }>(
    `/api/srd/spells${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch spells',
  );
  return data?.spells ?? [];
}

// Items
export interface ItemFilters {
  category?: string;
  source?: string;
}

export async function fetchItems(
  filters: ItemFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdItem[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.category) params.set('category', filters.category);

  const qs = params.toString();
  const data = await fetchJson<{ items: SrdItem[] }>(
    `/api/srd/items${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch items',
  );
  return data?.items ?? [];
}

// Feats
export interface FeatFilters {
  type?: string;
  source?: string;
}

export async function fetchFeats(
  filters: FeatFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdFeat[]> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.type) params.set('type', filters.type);

  const qs = params.toString();
  const data = await fetchJson<{ feats: SrdFeat[] }>(
    `/api/srd/feats${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch feats',
  );
  return data?.feats ?? [];
}

// Conditions
export async function fetchConditions(
  options: ApiRequestOptions = {},
): Promise<SrdCondition[]> {
  const data = await fetchJson<{ conditions: SrdCondition[] }>(
    '/api/srd/conditions',
    { method: 'GET', signal: options.signal },
    'Failed to fetch conditions',
  );
  return data?.conditions ?? [];
}

// Compute stats
export async function computeStats(
  request: ComputeStatsRequest,
  options: ApiRequestOptions = {},
): Promise<ComputeStatsResponse> {
  const data = await fetchJson<ComputeStatsResponse>(
    '/api/srd/compute-stats',
    buildJsonRequestInit('POST', request, options),
    'Failed to compute stats',
  );
  if (!data) {
    throw new Error('Compute stats returned empty response');
  }
  return data;
}
