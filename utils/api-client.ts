const ENV_VAR_NAME = "VITE_DATABASE_SERVER_URL";
export const AUTH_LOGOUT_EVENT = "questables:auth:logout";

function normalizeBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  return trimmed.replace(/\/+$/, "");
}

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function broadcastAuthLogout(detail: { message: string }) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT, { detail }));
}

const resolveBaseUrlEnv = (): string | undefined => {
  const metaEnv = typeof import.meta !== "undefined"
    ? ((import.meta as { env?: Record<string, unknown> }).env?.VITE_DATABASE_SERVER_URL as string | undefined)
    : undefined;

  if (typeof metaEnv === "string" && metaEnv.trim()) {
    return metaEnv;
  }

  const processEnv = typeof process !== "undefined"
    ? process.env?.VITE_DATABASE_SERVER_URL
    : undefined;

  return typeof processEnv === "string" && processEnv.trim() ? processEnv : undefined;
};

export function getApiBaseUrl(): string {
  const envValue = resolveBaseUrlEnv();

  if (!envValue || !envValue.trim()) {
    throw new Error(
      `${ENV_VAR_NAME} is not configured. Set it to the fully qualified URL of the database server (e.g., https://localhost:3001).`
    );
  }

  const normalized = normalizeBaseUrl(envValue);
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`${ENV_VAR_NAME} must include the http(s) protocol (received "${envValue}").`);
  }

  return normalized;
}

export function buildApiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`API paths must start with '/'. Received: ${path}`);
  }

  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${path}`;
}

function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem("dnd-auth-token");
  } catch (error) {
    console.warn("[api-client] Unable to read auth token from storage", error);
    return null;
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = buildApiUrl(path);
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const token = headers.has("Authorization") ? null : getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });

  return response;
}

export async function readJsonBody<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    const message = text.trim() || `Unexpected response format (status ${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const clone = response.clone();
    const contentType = clone.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await clone.json();
      if (payload && typeof payload === "object") {
        const candidate = (payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message;
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate;
        }
      }
    } else {
      const text = await clone.text();
      if (text.trim()) {
        return text.trim();
      }
    }
  } catch (error) {
    console.error("[api-client] Failed to parse error response", error);
  }

  return `${fallback} (status ${response.status})`;
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  errorMessage?: string,
): Promise<T | undefined> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      errorMessage ?? "Request failed",
    );
    if (response.status === 401) {
      broadcastAuthLogout({ message });
    }
    throw new HttpError(message, response.status);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined;
  }

  return readJsonBody<T>(response);
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

export const buildJsonRequestInit = (
  method: string,
  body: unknown | undefined,
  options: ApiRequestOptions = {},
  headers: Record<string, string> = {},
): RequestInit => {
  const finalHeaders: Record<string, string> = { ...headers };
  const init: RequestInit = {
    method,
    signal: options.signal,
    headers: finalHeaders,
  };

  if (body !== undefined) {
    if (!finalHeaders['Content-Type']) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    init.body = JSON.stringify(body);
  }

  return init;
};

export const ensurePayload = <T>(data: T | undefined, errorMessage: string): T => {
  if (data === undefined || data === null) {
    throw new Error(errorMessage);
  }
  return data;
};

export interface BurgSearchResult {
  id: string;
  world_id: string;
  burg_id: number;
  name: string;
  state?: string | null;
  culture?: string | null;
  religion?: string | null;
  population?: number | null;
  populationraw?: number | null;
  geometry: { type: string; coordinates: [number, number] };
}

export const searchWorldBurgs = async (
  worldMapId: string,
  query: string,
  options: ApiRequestOptions = {},
  limit = 10,
): Promise<BurgSearchResult[]> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const params = new URLSearchParams();
  params.set("q", trimmed);
  params.set("limit", String(limit));

  const data = await fetchJson<{ results: BurgSearchResult[] }>(
    `/api/maps/${worldMapId}/burgs/search?${params.toString()}`,
    { method: "GET", signal: options.signal },
    "Failed to search burgs",
  );

  return data?.results ?? [];
};

export type CampaignRegionCategory = "encounter" | "rumour" | "narrative" | "travel" | "custom";

export interface CampaignRegion {
  id: string;
  campaignId: string;
  worldMapId: string | null;
  name: string;
  description: string | null;
  category: CampaignRegionCategory;
  color: string | null;
  metadata: Record<string, unknown>;
  geometry: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRegionCreatePayload {
  name: string;
  description?: string | null;
  category?: CampaignRegionCategory;
  color?: string | null;
  worldMapId?: string | null;
  metadata?: Record<string, unknown> | string | null;
  geometry: Record<string, unknown> | string;
}

export interface CampaignRegionUpdatePayload extends Omit<CampaignRegionCreatePayload, "geometry"> {
  geometry?: Record<string, unknown> | string | null;
}

export const listCampaignRegions = async (
  campaignId: string,
  options: ApiRequestOptions = {},
): Promise<CampaignRegion[]> => {
  const data = await fetchJson<{ regions: CampaignRegion[] }>(
    `/api/campaigns/${campaignId}/map-regions`,
    { method: "GET", signal: options.signal },
    "Failed to load campaign map regions",
  );
  return data?.regions ?? [];
};

export const createCampaignRegion = async (
  campaignId: string,
  payload: CampaignRegionCreatePayload,
): Promise<CampaignRegion> => {
  const response = await apiFetch(
    `/api/campaigns/${campaignId}/map-regions`,
    buildJsonRequestInit("POST", payload),
  );

  if (!response.ok) {
    throw new HttpError(await readErrorMessage(response, "Failed to create map region"), response.status);
  }

  const data = await readJsonBody<{ region: CampaignRegion }>(response);
  return ensurePayload(data.region, "Server returned an empty region payload.");
};

export const updateCampaignRegion = async (
  campaignId: string,
  regionId: string,
  payload: CampaignRegionUpdatePayload,
): Promise<CampaignRegion> => {
  const response = await apiFetch(
    `/api/campaigns/${campaignId}/map-regions/${regionId}`,
    buildJsonRequestInit("PUT", payload),
  );

  if (!response.ok) {
    throw new HttpError(await readErrorMessage(response, "Failed to update map region"), response.status);
  }

  const data = await readJsonBody<{ region: CampaignRegion }>(response);
  return ensurePayload(data.region, "Server returned an empty region payload.");
};

export const deleteCampaignRegion = async (
  campaignId: string,
  regionId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/campaigns/${campaignId}/map-regions/${regionId}`,
    buildJsonRequestInit("DELETE", undefined),
  );

  if (!response.ok) {
    throw new HttpError(await readErrorMessage(response, "Failed to delete map region"), response.status);
  }
};

export type ObjectiveLocationPayload =
  | { clear: true }
  | {
      locationType: "pin";
      pin: { x: number; y: number };
    }
  | {
      locationType: "burg";
      locationBurgId: string;
    }
  | {
      locationType: "marker";
      locationMarkerId: string;
    }
  | {
      locationType: "region";
      locationRegionId: string;
    };

export const updateObjectiveLocation = async (
  objectiveId: string,
  payload: ObjectiveLocationPayload,
): Promise<ObjectiveRecord> => {
  const response = await apiFetch(
    `/api/objectives/${objectiveId}/location`,
    buildJsonRequestInit("PUT", payload),
  );

  if (!response.ok) {
    throw new HttpError(await readErrorMessage(response, "Failed to update objective location"), response.status);
  }

  const data = await readJsonBody<{ objective: ObjectiveRecord }>(response);
  return ensurePayload(data.objective, "Server returned an empty objective payload.");
};

export type CampaignStatus = 'recruiting' | 'active' | 'paused' | 'completed';

export interface CampaignLevelRange {
  min: number;
  max: number;
}

export interface CampaignRecord {
  id: string;
  name: string;
  description: string | null;
  dm_user_id: string;
  dm_username?: string | null;
  system: string | null;
  setting: string | null;
  status: CampaignStatus;
  max_players: number | null;
  level_range: CampaignLevelRange | null;
  is_public: boolean | null;
  world_map_id: string | null;
  allow_spectators?: boolean | null;
  auto_approve_join_requests?: boolean | null;
  experience_type?: string | null;
  resting_rules?: string | null;
  death_save_rules?: string | null;
  visibility_radius?: number | null;
  current_players?: number | null;
  last_activity?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface CampaignResponse {
  campaign: CampaignRecord;
}

export interface CreateCampaignRequest {
  name: string;
  description?: string | null;
  system?: string | null;
  setting?: string | null;
  maxPlayers?: number;
  levelRange?: CampaignLevelRange;
  status?: CampaignStatus;
  isPublic?: boolean;
  worldMapId?: string | null;
}

export interface UpdateCampaignRequest {
  name?: string;
  description?: string | null;
  system?: string | null;
  setting?: string | null;
  maxPlayers?: number;
  levelRange?: CampaignLevelRange;
  status?: CampaignStatus;
  isPublic?: boolean;
  worldMapId?: string | null;
  allowSpectators?: boolean;
  autoApproveJoinRequests?: boolean;
  experienceType?: string;
  restingRules?: string;
  deathSaveRules?: string;
}

const mapCampaignPayload = (payload: CreateCampaignRequest | UpdateCampaignRequest): Record<string, unknown> => {
  const body: Record<string, unknown> = {};

  if ('name' in payload && payload.name !== undefined) {
    body.name = payload.name;
  }

  if ('description' in payload) {
    body.description = payload.description ?? null;
  }

  if ('system' in payload) {
    body.system = payload.system ?? null;
  }

  if ('setting' in payload) {
    body.setting = payload.setting ?? null;
  }

  if ('maxPlayers' in payload && payload.maxPlayers !== undefined) {
    body.maxPlayers = payload.maxPlayers;
  }

  if ('levelRange' in payload && payload.levelRange !== undefined) {
    body.levelRange = payload.levelRange;
  }

  if ('status' in payload && payload.status !== undefined) {
    body.status = payload.status;
  }

  if ('isPublic' in payload && payload.isPublic !== undefined) {
    body.isPublic = payload.isPublic;
  }

  if ('worldMapId' in payload) {
    body.worldMapId = payload.worldMapId ?? null;
  }

  if ('allowSpectators' in payload && payload.allowSpectators !== undefined) {
    body.allowSpectators = payload.allowSpectators;
  }

  if ('autoApproveJoinRequests' in payload && payload.autoApproveJoinRequests !== undefined) {
    body.autoApproveJoinRequests = payload.autoApproveJoinRequests;
  }

  if ('experienceType' in payload && payload.experienceType !== undefined) {
    body.experienceType = payload.experienceType;
  }

  if ('restingRules' in payload && payload.restingRules !== undefined) {
    body.restingRules = payload.restingRules;
  }

  if ('deathSaveRules' in payload && payload.deathSaveRules !== undefined) {
    body.deathSaveRules = payload.deathSaveRules;
  }

  return body;
};

export async function getCampaign(campaignId: string, options: ApiRequestOptions = {}): Promise<CampaignRecord> {
  const data = await fetchJson<CampaignResponse>(
    `/api/campaigns/${campaignId}`,
    { method: 'GET', signal: options.signal },
    'Failed to load campaign',
  );

  const payload = ensurePayload(data, 'Campaign response missing payload');
  if (!payload.campaign) {
    throw new Error('Campaign response did not include campaign details');
  }
  return payload.campaign;
}

export async function createCampaign(
  payload: CreateCampaignRequest,
  options: ApiRequestOptions = {},
): Promise<CampaignRecord> {
  const body = mapCampaignPayload(payload);
  const data = await fetchJson<CampaignResponse>(
    '/api/campaigns',
    buildJsonRequestInit('POST', body, options),
    'Failed to create campaign',
  );

  const payloadResponse = ensurePayload(data, 'Campaign creation response missing payload');
  if (!payloadResponse.campaign) {
    throw new Error('Campaign creation response did not include campaign details');
  }
  return payloadResponse.campaign;
}

export async function updateCampaign(
  campaignId: string,
  payload: UpdateCampaignRequest,
  options: ApiRequestOptions = {},
): Promise<CampaignRecord> {
  const body = mapCampaignPayload(payload);
  const data = await fetchJson<CampaignResponse>(
    `/api/campaigns/${campaignId}`,
    buildJsonRequestInit('PUT', body, options),
    'Failed to update campaign',
  );

  const payloadResponse = ensurePayload(data, 'Campaign update response missing payload');
  if (!payloadResponse.campaign) {
    throw new Error('Campaign update response did not include campaign details');
  }
  return payloadResponse.campaign;
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: number[];
}

export interface SpawnPoint {
  id: string;
  campaignId: string;
  name: string;
  note: string | null;
  isDefault: boolean;
  geometry: GeoJsonPoint | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SpawnListResponse {
  spawns: SpawnPoint[];
}

export interface UpsertCampaignSpawnRequest {
  name?: string;
  note?: string | null;
  position: { x: number; y: number };
}

export async function listCampaignSpawns(
  campaignId: string,
  options: ApiRequestOptions = {},
): Promise<SpawnPoint[]> {
  const data = await fetchJson<SpawnListResponse>(
    `/api/campaigns/${campaignId}/spawns`,
    { method: 'GET', signal: options.signal },
    'Failed to load campaign spawns',
  );

  return data?.spawns ?? [];
}

interface SpawnResponse {
  spawn: SpawnPoint;
}

export async function upsertCampaignSpawn(
  campaignId: string,
  payload: UpsertCampaignSpawnRequest,
  options: ApiRequestOptions = {},
): Promise<SpawnPoint> {
  const body: Record<string, unknown> = {};

  if (payload.name !== undefined) {
    body.name = payload.name;
  }

  if (payload.note !== undefined) {
    body.note = payload.note;
  }

  body.worldPosition = {
    x: payload.position.x,
    y: payload.position.y,
  };

  const data = await fetchJson<SpawnResponse>(
    `/api/campaigns/${campaignId}/spawn`,
    buildJsonRequestInit('PUT', body, options),
    'Failed to update campaign spawn',
  );

  const payloadResponse = ensurePayload(data, 'Spawn response missing payload');
  if (!payloadResponse.spawn) {
    throw new Error('Spawn response did not include spawn details');
  }
  return payloadResponse.spawn;
}

export interface ObjectiveLocationPinInput {
  type: 'pin';
  x: number;
  y: number;
}

export interface ObjectiveLocationBurgInput {
  type: 'burg';
  burgId: string;
}

export interface ObjectiveLocationMarkerInput {
  type: 'marker';
  markerId: string;
}

export interface ObjectiveLocationRegionInput {
  type: 'region';
  regionId: string;
}

export type ObjectiveLocationInput =
  | ObjectiveLocationPinInput
  | ObjectiveLocationBurgInput
  | ObjectiveLocationMarkerInput
  | ObjectiveLocationRegionInput;

export interface ObjectiveLocation {
  type: 'pin' | 'burg' | 'marker' | 'region';
  pin: GeoJsonPoint | null;
  burgId: string | null;
  markerId: string | null;
  regionId: string | null;
}

export interface ObjectiveRecord {
  id: string;
  campaignId: string;
  parentId: string | null;
  title: string;
  descriptionMd: string | null;
  treasureMd: string | null;
  combatMd: string | null;
  npcsMd: string | null;
  rumoursMd: string | null;
  location: ObjectiveLocation | null;
  orderIndex: number;
  isMajor: boolean;
  slug: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

interface ObjectiveListResponse {
  objectives: ObjectiveRecord[];
}

interface ObjectiveResponse {
  objective: ObjectiveRecord;
}

interface ObjectiveDeleteResponse {
  deletedObjectiveIds: string[];
}

interface ObjectiveBasePayload {
  parentId?: string | null;
  orderIndex?: number;
  isMajor?: boolean;
  slug?: string | null;
  descriptionMd?: string | null;
  treasureMd?: string | null;
  combatMd?: string | null;
  npcsMd?: string | null;
  rumoursMd?: string | null;
  location?: ObjectiveLocationInput | null;
}

export interface ObjectiveCreatePayload extends ObjectiveBasePayload {
  title: string;
}

export interface ObjectiveUpdatePayload extends ObjectiveBasePayload {
  title?: string;
}

const mapObjectiveLocation = (
  location: ObjectiveLocationInput | null | undefined,
  body: Record<string, unknown>,
) => {
  if (!location) {
    return;
  }

  body.locationType = location.type;

  if (location.type === 'pin') {
    body.locationPin = { x: location.x, y: location.y };
    return;
  }

  if (location.type === 'burg') {
    body.locationBurgId = location.burgId;
    return;
  }

  if (location.type === 'marker') {
    body.locationMarkerId = location.markerId;
    return;
  }

  if (location.type === 'region') {
    body.locationRegionId = location.regionId;
  }
};

const mapObjectivePayload = (
  payload: ObjectiveCreatePayload | ObjectiveUpdatePayload,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {};

  if ('title' in payload && payload.title !== undefined) {
    body.title = payload.title;
  }

  if (payload.parentId !== undefined) {
    body.parentId = payload.parentId;
  }

  if (payload.orderIndex !== undefined) {
    body.orderIndex = payload.orderIndex;
  }

  if (payload.isMajor !== undefined) {
    body.isMajor = payload.isMajor;
  }

  if (payload.slug !== undefined) {
    body.slug = payload.slug;
  }

  if (payload.descriptionMd !== undefined) {
    body.descriptionMd = payload.descriptionMd;
  }

  if (payload.treasureMd !== undefined) {
    body.treasureMd = payload.treasureMd;
  }

  if (payload.combatMd !== undefined) {
    body.combatMd = payload.combatMd;
  }

  if (payload.npcsMd !== undefined) {
    body.npcsMd = payload.npcsMd;
  }

  if (payload.rumoursMd !== undefined) {
    body.rumoursMd = payload.rumoursMd;
  }

  mapObjectiveLocation(payload.location, body);

  return body;
};

export async function listCampaignObjectives(
  campaignId: string,
  options: ApiRequestOptions = {},
): Promise<ObjectiveRecord[]> {
  const data = await fetchJson<ObjectiveListResponse>(
    `/api/campaigns/${campaignId}/objectives`,
    { method: 'GET', signal: options.signal },
    'Failed to load campaign objectives',
  );

  return data?.objectives ?? [];
}

export async function createObjective(
  campaignId: string,
  payload: ObjectiveCreatePayload,
  options: ApiRequestOptions = {},
): Promise<ObjectiveRecord> {
  const body = mapObjectivePayload(payload);
  const data = await fetchJson<ObjectiveResponse>(
    `/api/campaigns/${campaignId}/objectives`,
    buildJsonRequestInit('POST', body, options),
    'Failed to create objective',
  );

  const payloadResponse = ensurePayload(data, 'Objective creation response missing payload');
  if (!payloadResponse.objective) {
    throw new Error('Objective creation response did not include objective details');
  }
  return payloadResponse.objective;
}

export async function updateObjective(
  objectiveId: string,
  payload: ObjectiveUpdatePayload,
  options: ApiRequestOptions = {},
): Promise<ObjectiveRecord> {
  const body = mapObjectivePayload(payload);
  const data = await fetchJson<ObjectiveResponse>(
    `/api/objectives/${objectiveId}`,
    buildJsonRequestInit('PUT', body, options),
    'Failed to update objective',
  );

  const payloadResponse = ensurePayload(data, 'Objective update response missing payload');
  if (!payloadResponse.objective) {
    throw new Error('Objective update response did not include objective details');
  }
  return payloadResponse.objective;
}

export async function deleteObjective(
  objectiveId: string,
  options: ApiRequestOptions = {},
): Promise<string[]> {
  const data = await fetchJson<ObjectiveDeleteResponse>(
    `/api/objectives/${objectiveId}`,
    { method: 'DELETE', signal: options.signal },
    'Failed to delete objective',
  );

  return data?.deletedObjectiveIds ?? [];
}

export type ObjectiveAssistField = 'description' | 'treasure' | 'combat' | 'npcs' | 'rumours';

export interface ObjectiveAssistRequest {
  focus?: string;
  provider?: {
    name?: string;
    model?: string;
    options?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  parameters?: Record<string, unknown>;
}

export interface LlmProviderMetadata {
  name?: string;
  model?: string;
  [key: string]: unknown;
}

export interface LlmMetricsMetadata {
  [key: string]: unknown;
}

export interface LlmCacheMetadata {
  key?: string;
  hit?: boolean;
  [key: string]: unknown;
}

export interface ObjectiveAssistResponse {
  objective: ObjectiveRecord;
  assist: {
    field: string;
    content: string;
    provider: LlmProviderMetadata | null;
    metrics: LlmMetricsMetadata | null;
    cache: LlmCacheMetadata | null;
  };
}

export async function requestObjectiveAssist(
  objectiveId: string,
  field: ObjectiveAssistField,
  payload: ObjectiveAssistRequest = {},
  options: ApiRequestOptions = {},
): Promise<ObjectiveAssistResponse> {
  const data = await fetchJson<ObjectiveAssistResponse>(
    `/api/objectives/${objectiveId}/assist/${field}`,
    buildJsonRequestInit('POST', payload, options),
    'Failed to generate objective assist',
  );

  return ensurePayload(data, 'Objective assist response missing payload');
}

export interface SessionFocusResponse {
  sessionId: string;
  dmFocus: string | null;
}

export interface UpdateSessionFocusRequest {
  focus: string | null;
}

export async function updateSessionFocus(
  sessionId: string,
  payload: UpdateSessionFocusRequest,
  options: ApiRequestOptions = {},
): Promise<SessionFocusResponse> {
  const data = await fetchJson<SessionFocusResponse>(
    `/api/sessions/${sessionId}/focus`,
    buildJsonRequestInit('PUT', payload, options),
    'Failed to update session focus',
  );

  return ensurePayload(data, 'Session focus response missing payload');
}

export interface SessionContextResponse {
  sessionId: string;
  mode: 'append' | 'replace';
  dmContextMd: string | null;
}

export interface UpdateSessionContextRequest {
  contextMd?: string | null;
  mode?: 'append' | 'replace';
  append?: boolean;
}

export async function updateSessionContext(
  sessionId: string,
  payload: UpdateSessionContextRequest,
  options: ApiRequestOptions = {},
): Promise<SessionContextResponse> {
  const body: Record<string, unknown> = {};

  if ('contextMd' in payload) {
    body.contextMd = payload.contextMd ?? null;
  }

  if ('mode' in payload && payload.mode !== undefined) {
    body.mode = payload.mode;
  }

  if ('append' in payload && payload.append !== undefined) {
    body.append = payload.append;
  }

  const data = await fetchJson<SessionContextResponse>(
    `/api/sessions/${sessionId}/context`,
    buildJsonRequestInit('PUT', body, options),
    'Failed to update session context',
  );

  return ensurePayload(data, 'Session context response missing payload');
}

export type UnplannedEncounterType = 'combat' | 'social' | 'exploration' | 'puzzle' | 'rumour';
export type EncounterDifficulty = 'easy' | 'medium' | 'hard' | 'deadly';

export interface CreateUnplannedEncounterRequest {
  type: UnplannedEncounterType;
  seed: string;
  difficulty?: EncounterDifficulty;
  locationId?: string;
}

export interface EncounterRecord {
  id: string;
  campaign_id: string;
  session_id: string;
  location_id: string | null;
  name: string;
  description: string | null;
  type: string;
  difficulty: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface UnplannedEncounterResponse {
  encounter: EncounterRecord;
}

export async function createUnplannedEncounter(
  sessionId: string,
  payload: CreateUnplannedEncounterRequest,
  options: ApiRequestOptions = {},
): Promise<EncounterRecord> {
  const data = await fetchJson<UnplannedEncounterResponse>(
    `/api/sessions/${sessionId}/unplanned-encounter`,
    buildJsonRequestInit('POST', payload, options),
    'Failed to create unplanned encounter',
  );

  const payloadResponse = ensurePayload(data, 'Unplanned encounter response missing payload');
  if (!payloadResponse.encounter) {
    throw new Error('Unplanned encounter response did not include encounter details');
  }
  return payloadResponse.encounter;
}

export type NpcSentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

export interface AdjustNpcSentimentRequest {
  delta: number;
  summary: string;
  sentiment?: NpcSentiment;
  sessionId?: string;
  tags?: string[];
}

export interface NpcMemoryRecord {
  id: string;
  npc_id: string;
  campaign_id: string;
  session_id: string | null;
  memory_summary: string;
  sentiment: string;
  trust_delta: number;
  tags: string[] | null;
  created_at: string;
}

interface NpcSentimentResponse {
  memory: NpcMemoryRecord;
}

export async function adjustNpcSentiment(
  npcId: string,
  payload: AdjustNpcSentimentRequest,
  options: ApiRequestOptions = {},
): Promise<NpcMemoryRecord> {
  const body: Record<string, unknown> = {
    delta: payload.delta,
    summary: payload.summary,
  };

  if (payload.sentiment !== undefined) {
    body.sentiment = payload.sentiment;
  }

  if (payload.sessionId !== undefined) {
    body.sessionId = payload.sessionId;
  }

  if (payload.tags !== undefined) {
    body.tags = payload.tags;
  }

  const data = await fetchJson<NpcSentimentResponse>(
    `/api/npcs/${npcId}/sentiment`,
    buildJsonRequestInit('POST', body, options),
    'Failed to adjust NPC sentiment',
  );

  const payloadResponse = ensurePayload(data, 'NPC sentiment response missing payload');
  if (!payloadResponse.memory) {
    throw new Error('NPC sentiment response did not include memory details');
  }
  return payloadResponse.memory;
}

export interface TeleportPlayerRequest {
  playerId: string;
  spawnId?: string;
  target?: { x: number; y: number };
  reason?: string;
}

export interface TeleportPlayerResponse {
  playerId: string;
  geometry: GeoJsonPoint | null;
  visibilityState: string | null;
  lastLocatedAt: string | null;
  mode: string;
  distance?: number | null;
  reason?: string | null;
  spawn?: SpawnPoint | null;
}

export async function teleportPlayer(
  campaignId: string,
  payload: TeleportPlayerRequest,
  options: ApiRequestOptions = {},
): Promise<TeleportPlayerResponse> {
  const body: Record<string, unknown> = {
    playerId: payload.playerId,
  };

  if (payload.spawnId) {
    body.spawnId = payload.spawnId;
  }

  if (payload.target) {
    body.target = payload.target;
  }

  if (payload.reason !== undefined) {
    body.reason = payload.reason;
  }

  const data = await fetchJson<TeleportPlayerResponse>(
    `/api/campaigns/${campaignId}/teleport/player`,
    buildJsonRequestInit('POST', body, options),
    'Failed to teleport player',
  );

  return ensurePayload(data, 'Player teleport response missing payload');
}

export interface TeleportNpcRequest {
  npcId: string;
  locationId?: string;
  target?: { x: number; y: number };
  reason?: string;
}

export interface TeleportNpcResponse {
  npcId: string;
  campaignId: string;
  currentLocationId: string | null;
  worldPosition: GeoJsonPoint | null;
}

export async function teleportNpc(
  campaignId: string,
  payload: TeleportNpcRequest,
  options: ApiRequestOptions = {},
): Promise<TeleportNpcResponse> {
  const body: Record<string, unknown> = {
    npcId: payload.npcId,
  };

  if (payload.locationId) {
    body.locationId = payload.locationId;
  }

  if (payload.target) {
    body.target = payload.target;
  }

  if (payload.reason !== undefined) {
    body.reason = payload.reason;
  }

  const data = await fetchJson<TeleportNpcResponse>(
    `/api/campaigns/${campaignId}/teleport/npc`,
    buildJsonRequestInit('POST', body, options),
    'Failed to teleport NPC',
  );

  return ensurePayload(data, 'NPC teleport response missing payload');
}
