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
  concentration?: boolean;
  school?: string;
  q?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedSpells {
  spells: SrdSpell[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchSpells(
  filters: SpellFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdSpell[]> {
  const data = await fetchSpellsPaginated(filters, options);
  return data.spells;
}

export async function fetchSpellsPaginated(
  filters: SpellFilters = {},
  options: ApiRequestOptions = {},
): Promise<PaginatedSpells> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.class) params.set('class', filters.class);
  if (filters.level !== undefined) params.set('level', String(filters.level));
  if (filters.ritual !== undefined) params.set('ritual', String(filters.ritual));
  if (filters.concentration !== undefined) params.set('concentration', String(filters.concentration));
  if (filters.school) params.set('school', filters.school);
  if (filters.q) params.set('q', filters.q);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  const qs = params.toString();
  const data = await fetchJson<PaginatedSpells>(
    `/api/srd/spells${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch spells',
  );
  return data ?? { spells: [], total: 0, limit: 200, offset: 0 };
}

export async function fetchSpellByKey(
  key: string,
  options: ApiRequestOptions & { source?: string } = {},
): Promise<SrdSpell | null> {
  const params = new URLSearchParams();
  if (options.source) params.set('source', options.source);

  const qs = params.toString();
  const data = await fetchJson<{ spell: SrdSpell }>(
    `/api/srd/spells/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch spell',
  );
  return data?.spell ?? null;
}

// Items
export interface ItemFilters {
  category?: string;
  rarity?: string;
  q?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedItems {
  items: SrdItem[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchItems(
  filters: ItemFilters = {},
  options: ApiRequestOptions = {},
): Promise<SrdItem[]> {
  const data = await fetchItemsPaginated(filters, options);
  return data.items;
}

export async function fetchItemsPaginated(
  filters: ItemFilters = {},
  options: ApiRequestOptions = {},
): Promise<PaginatedItems> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.category) params.set('category', filters.category);
  if (filters.rarity) params.set('rarity', filters.rarity);
  if (filters.q) params.set('q', filters.q);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  const qs = params.toString();
  const data = await fetchJson<PaginatedItems>(
    `/api/srd/items${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal: options.signal },
    'Failed to fetch items',
  );
  return data ?? { items: [], total: 0, limit: 200, offset: 0 };
}

// Compendium unified search
export interface CompendiumSearchResult {
  type: 'spell' | 'item';
  key: string;
  name: string;
  summary: string;
  cost_gp: number | null;
  level: number | null;
}

export async function searchCompendium(
  q: string,
  options: ApiRequestOptions & { type?: 'spell' | 'item' | 'any'; limit?: number } = {},
): Promise<CompendiumSearchResult[]> {
  const params = new URLSearchParams({ q });
  if (options.type) params.set('type', options.type);
  if (options.limit) params.set('limit', String(options.limit));

  const qs = params.toString();
  const data = await fetchJson<{ results: CompendiumSearchResult[] }>(
    `/api/srd/compendium/search?${qs}`,
    { method: 'GET', signal: options.signal },
    'Failed to search compendium',
  );
  return data?.results ?? [];
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
