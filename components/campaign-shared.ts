import type { CampaignLevelRange, UpdateCampaignRequest } from "../utils/api-client";

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  dm_user_id: string;
  dm_username?: string;
  system: string;
  setting: string;
  status: 'recruiting' | 'active' | 'paused' | 'completed';
  max_players: number;
  current_players?: number;
  level_range: { min: number; max: number } | string | null;
  is_public: boolean;
  world_map_id: string | null;
  allow_spectators?: boolean;
  auto_approve_join_requests?: boolean;
  experience_type?: 'milestone' | 'experience_points';
  resting_rules?: 'standard' | 'gritty' | 'heroic';
  death_save_rules?: 'standard' | 'hardcore' | 'forgiving';
  created_at: string;
  updated_at: string;
}

export type CampaignStatus = Campaign['status'];
export type ExperienceType = 'milestone' | 'experience_points';
export type RestingRules = 'standard' | 'gritty' | 'heroic';
export type DeathSaveRules = 'standard' | 'hardcore' | 'forgiving';

export interface CampaignEditFormState {
  name: string;
  description: string;
  system: string;
  setting: string;
  status: CampaignStatus;
  maxPlayers: number | '';
  minLevel: number | '';
  maxLevel: number | '';
  worldMapId: string;
}

export interface CampaignSettingsFormState {
  isPublic: boolean;
  allowSpectators: boolean;
  autoApproveJoinRequests: boolean;
  experienceType: ExperienceType;
  restingRules: RestingRules;
  deathSaveRules: DeathSaveRules;
}

export type NumericInputValue = number | '';

export interface LevelRangeInputState {
  min: NumericInputValue;
  max: NumericInputValue;
}

export interface CreateCampaignFormState {
  name: string;
  description: string;
  system: string;
  setting: string;
  maxPlayers: NumericInputValue;
  levelRange: LevelRangeInputState;
  isPublic: boolean;
  worldMapId: string;
}

export const DEFAULT_LEVEL_RANGE = { min: 1, max: 20 } as const;
export const WORLD_MAP_NONE_SENTINEL = '__none';
export const DEFAULT_MAX_PLAYERS = 6;

export interface SelectOption {
  value: string;
  label: string;
}

const SYSTEM_PRESETS = [
  { value: "D&D 5e", label: "D&D 5e" },
  { value: "Pathfinder 2e", label: "Pathfinder 2e" },
  { value: "Call of Cthulhu", label: "Call of Cthulhu" },
  { value: "Vampire: The Masquerade", label: "Vampire: The Masquerade" },
  { value: "Other", label: "Other" },
] as const satisfies readonly SelectOption[];

export const CAMPAIGN_SYSTEM_OPTIONS: readonly SelectOption[] = SYSTEM_PRESETS;

const EDIT_FORM_TEMPLATE: CampaignEditFormState = {
  name: '',
  description: '',
  system: '',
  setting: '',
  status: 'recruiting',
  maxPlayers: DEFAULT_MAX_PLAYERS,
  minLevel: DEFAULT_LEVEL_RANGE.min,
  maxLevel: DEFAULT_LEVEL_RANGE.max,
  worldMapId: WORLD_MAP_NONE_SENTINEL,
};

const SETTINGS_FORM_TEMPLATE: CampaignSettingsFormState = {
  isPublic: false,
  allowSpectators: false,
  autoApproveJoinRequests: false,
  experienceType: 'milestone',
  restingRules: 'standard',
  deathSaveRules: 'standard',
};

export function createEditFormDefaults(): CampaignEditFormState {
  return { ...EDIT_FORM_TEMPLATE };
}

export function createSettingsFormDefaults(): CampaignSettingsFormState {
  return { ...SETTINGS_FORM_TEMPLATE };
}

export function normalizeWorldMapId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(value);
  }

  return null;
}

export function resetWorldMapSelectValue(): string {
  return WORLD_MAP_NONE_SENTINEL;
}

export function toWorldMapSelectValue(
  worldMapId: string | number | null | undefined,
): string {
  const normalized = normalizeWorldMapId(worldMapId);
  return normalized ?? WORLD_MAP_NONE_SENTINEL;
}

export function fromWorldMapSelectValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === WORLD_MAP_NONE_SENTINEL) {
    return null;
  }

  return trimmed;
}

export function hasCampaignDescription(
  value: string | null | undefined,
): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  return value.trim().length > 0;
}

export interface CampaignEditSnapshot {
  name: string;
  description: string;
  system: string;
  setting: string;
  status: CampaignStatus;
  maxPlayers: number;
  levelRange: CampaignLevelRange;
  worldMapId: string | null;
}

export function clampLevelValue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LEVEL_RANGE.min;
  return Math.min(20, Math.max(1, Math.round(value)));
}

export function coerceLevelRange(value: Campaign['level_range'] | null | undefined): { min: number; max: number } {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return coerceLevelRange(parsed as Campaign['level_range']);
    } catch {
      return { ...DEFAULT_LEVEL_RANGE };
    }
  }

  if (value && typeof value === 'object' && 'min' in value && 'max' in value) {
    const candidate = value as { min: unknown; max: unknown };
    const min = clampLevelValue(Number(candidate.min));
    const max = clampLevelValue(Number(candidate.max));
    return {
      min,
      max: max < min ? min : max,
    };
  }

  return { ...DEFAULT_LEVEL_RANGE };
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return Boolean(value);
}

function toExperienceType(value: unknown): ExperienceType {
  return value === 'experience_points' ? 'experience_points' : 'milestone';
}

function toRestingRules(value: unknown): RestingRules {
  return value === 'gritty' || value === 'heroic' ? (value as RestingRules) : 'standard';
}

function toDeathSaveRules(value: unknown): DeathSaveRules {
  return value === 'hardcore' || value === 'forgiving' ? (value as DeathSaveRules) : 'standard';
}

export function buildEditFormState(campaign: Campaign): CampaignEditFormState {
  const levelRange = coerceLevelRange(campaign.level_range);
  const numericMaxPlayers = Number(campaign.max_players);

  return {
    name: campaign.name || '',
    description: typeof campaign.description === 'string' ? campaign.description : '',
    system: campaign.system || '',
    setting: campaign.setting || '',
    status: (campaign.status as CampaignStatus) ?? EDIT_FORM_TEMPLATE.status,
    maxPlayers: Number.isFinite(numericMaxPlayers) ? numericMaxPlayers : EDIT_FORM_TEMPLATE.maxPlayers,
    minLevel: levelRange.min,
    maxLevel: levelRange.max,
    worldMapId: toWorldMapSelectValue(campaign.world_map_id),
  };
}

export function buildSettingsFormState(campaign: Campaign): CampaignSettingsFormState {
  return {
    isPublic: asBoolean(campaign.is_public),
    allowSpectators: asBoolean(campaign.allow_spectators),
    autoApproveJoinRequests: asBoolean(campaign.auto_approve_join_requests),
    experienceType: toExperienceType(campaign.experience_type),
    restingRules: toRestingRules(campaign.resting_rules),
    deathSaveRules: toDeathSaveRules(campaign.death_save_rules),
  };
}

const normalizeOptionalField = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function buildCampaignUpdatePayload(
  original: Campaign,
  snapshot: CampaignEditSnapshot,
): UpdateCampaignRequest {
  const payload: UpdateCampaignRequest = {};

  const trimmedName = snapshot.name.trim();
  const baselineName = original.name.trim();
  if (trimmedName !== baselineName) {
    payload.name = trimmedName;
  }

  const nextDescription = normalizeOptionalField(snapshot.description);
  const baselineDescription = normalizeOptionalField(original.description);
  if (nextDescription !== baselineDescription) {
    payload.description = nextDescription;
  }

  const nextSystem = normalizeOptionalField(snapshot.system);
  const baselineSystem = normalizeOptionalField(original.system);
  if (nextSystem !== baselineSystem) {
    payload.system = nextSystem;
  }

  const nextSetting = normalizeOptionalField(snapshot.setting);
  const baselineSetting = normalizeOptionalField(original.setting);
  if (nextSetting !== baselineSetting) {
    payload.setting = nextSetting;
  }

  if (snapshot.status !== original.status) {
    payload.status = snapshot.status;
  }

  const baselineMaxPlayers = Number(original.max_players);
  if (snapshot.maxPlayers !== baselineMaxPlayers) {
    payload.maxPlayers = snapshot.maxPlayers;
  }

  const baselineLevelRange = coerceLevelRange(original.level_range);
  if (
    snapshot.levelRange.min !== baselineLevelRange.min ||
    snapshot.levelRange.max !== baselineLevelRange.max
  ) {
    payload.levelRange = snapshot.levelRange;
  }

  const baselineWorldMapId = normalizeWorldMapId(original.world_map_id);
  if (snapshot.worldMapId !== baselineWorldMapId) {
    payload.worldMapId = snapshot.worldMapId;
  }

  return payload;
}

type CreateCampaignTextField = keyof Pick<CreateCampaignFormState, 'name' | 'description' | 'system' | 'setting'>;
type CreateCampaignBooleanField = 'isPublic';

const clampMaxPlayers = (value: number): number => Math.min(20, Math.max(1, Math.round(value)));

export type CreateCampaignFormAction =
  | { type: 'updateText'; field: CreateCampaignTextField; value: string }
  | { type: 'updateBoolean'; field: CreateCampaignBooleanField; value: boolean }
  | { type: 'setWorldMap'; value: string }
  | { type: 'setMaxPlayers'; value: string | number | '' }
  | { type: 'setLevel'; field: 'min' | 'max'; value: string }
  | { type: 'syncWorldMapOptions'; mapIds: readonly string[] }
  | { type: 'reset'; payload: CreateCampaignFormState };

export function createCampaignFormReducer(
  state: CreateCampaignFormState,
  action: CreateCampaignFormAction,
): CreateCampaignFormState {
  switch (action.type) {
    case 'updateText': {
      const nextValue = action.value;
      if (state[action.field] === nextValue) {
        return state;
      }
      return { ...state, [action.field]: nextValue };
    }
    case 'updateBoolean': {
      if (state[action.field] === action.value) {
        return state;
      }
      return { ...state, [action.field]: action.value };
    }
    case 'setWorldMap': {
      if (state.worldMapId === action.value) {
        return state;
      }
      return { ...state, worldMapId: action.value };
    }
    case 'setMaxPlayers': {
      if (action.value === '') {
        if (state.maxPlayers === '') {
          return state;
        }
        return { ...state, maxPlayers: '' };
      }
      const numeric =
        typeof action.value === 'number' ? action.value : Number.parseInt(action.value, 10);
      if (!Number.isFinite(numeric)) {
        return state;
      }
      const clamped = clampMaxPlayers(numeric);
      if (state.maxPlayers === clamped) {
        return state;
      }
      return { ...state, maxPlayers: clamped };
    }
    case 'setLevel': {
      if (action.field === 'min') {
        if (action.value === '') {
          if (state.levelRange.min === '') {
            return state;
          }
          return {
            ...state,
            levelRange: { ...state.levelRange, min: '' },
          };
        }
        const parsed = Number.parseInt(action.value, 10);
        if (Number.isNaN(parsed)) {
          return state;
        }
        const clamped = clampLevelValue(parsed);
        const currentMax = state.levelRange.max;
        const nextMax =
          currentMax === '' ? '' : (currentMax as number) < clamped ? clamped : currentMax;
        if (state.levelRange.min === clamped && state.levelRange.max === nextMax) {
          return state;
        }
        return {
          ...state,
          levelRange: {
            min: clamped,
            max: nextMax,
          },
        };
      }

      if (action.value === '') {
        if (state.levelRange.max === '') {
          return state;
        }
        return {
          ...state,
          levelRange: { ...state.levelRange, max: '' },
        };
      }

      const parsed = Number.parseInt(action.value, 10);
      if (Number.isNaN(parsed)) {
        return state;
      }
      const clamped = clampLevelValue(parsed);
      const currentMin = state.levelRange.min;
      const adjusted =
        currentMin !== '' && clamped < (currentMin as number) ? (currentMin as number) : clamped;
      if (state.levelRange.max === adjusted) {
        return state;
      }
      return {
        ...state,
        levelRange: { ...state.levelRange, max: adjusted },
      };
    }
    case 'syncWorldMapOptions': {
      const mapIds = action.mapIds;
      if (!mapIds || mapIds.length === 0) {
        if (state.worldMapId === WORLD_MAP_NONE_SENTINEL) {
          return state;
        }
        return { ...state, worldMapId: WORLD_MAP_NONE_SENTINEL };
      }

      if (state.worldMapId === WORLD_MAP_NONE_SENTINEL) {
        return state;
      }

      if (mapIds.includes(state.worldMapId)) {
        return state;
      }

      return { ...state, worldMapId: WORLD_MAP_NONE_SENTINEL };
    }
    case 'reset': {
      return action.payload;
    }
    default: {
      return state;
    }
  }
}

export interface ResolveWorldMapIdOptions {
  selectedValue: string;
  baselineValue: unknown;
  touched: boolean;
}

export function resolveWorldMapIdForUpdate({
  selectedValue,
  baselineValue,
  touched,
}: ResolveWorldMapIdOptions): string | null {
  if (!touched) {
    return normalizeWorldMapId(baselineValue);
  }

  const derived = fromWorldMapSelectValue(selectedValue);
  return derived ?? null;
}

type EditCampaignTextField = keyof Pick<CampaignEditFormState, 'name' | 'description' | 'system' | 'setting'>;

export type EditCampaignFormAction =
  | { type: 'hydrate'; payload: CampaignEditFormState }
  | { type: 'updateText'; field: EditCampaignTextField; value: string }
  | { type: 'setStatus'; value: CampaignStatus }
  | { type: 'setWorldMap'; value: string }
  | { type: 'setMaxPlayers'; value: string | number | '' }
  | { type: 'setLevel'; field: 'min' | 'max'; value: string }
  | { type: 'reset'; payload: CampaignEditFormState };

export function editCampaignFormReducer(
  state: CampaignEditFormState,
  action: EditCampaignFormAction,
): CampaignEditFormState {
  switch (action.type) {
    case 'hydrate':
    case 'reset': {
      return { ...action.payload };
    }
    case 'updateText': {
      const nextValue = action.value;
      if (state[action.field] === nextValue) {
        return state;
      }
      return { ...state, [action.field]: nextValue };
    }
    case 'setStatus': {
      if (state.status === action.value) {
        return state;
      }
      return { ...state, status: action.value };
    }
    case 'setWorldMap': {
      if (state.worldMapId === action.value) {
        return state;
      }
      return { ...state, worldMapId: action.value };
    }
    case 'setMaxPlayers': {
      if (action.value === '') {
        if (state.maxPlayers === '') {
          return state;
        }
        return { ...state, maxPlayers: '' };
      }
      const numeric =
        typeof action.value === 'number' ? action.value : Number.parseInt(action.value, 10);
      if (!Number.isFinite(numeric)) {
        return state;
      }
      const clamped = clampMaxPlayers(numeric);
      if (state.maxPlayers === clamped) {
        return state;
      }
      return { ...state, maxPlayers: clamped };
    }
    case 'setLevel': {
      if (action.field === 'min') {
        if (action.value === '') {
          if (state.minLevel === '') {
            return state;
          }
          return { ...state, minLevel: '' };
        }
        const parsed = Number.parseInt(action.value, 10);
        if (Number.isNaN(parsed)) {
          return state;
        }
        const clamped = clampLevelValue(parsed);
        const currentMax = state.maxLevel;
        const nextMax =
          currentMax === '' ? '' : (currentMax as number) < clamped ? clamped : currentMax;
        if (state.minLevel === clamped && state.maxLevel === nextMax) {
          return state;
        }
        return {
          ...state,
          minLevel: clamped,
          maxLevel: nextMax,
        };
      }

      if (action.value === '') {
        if (state.maxLevel === '') {
          return state;
        }
        return { ...state, maxLevel: '' };
      }

      const parsed = Number.parseInt(action.value, 10);
      if (Number.isNaN(parsed)) {
        return state;
      }
      const clamped = clampLevelValue(parsed);
      const currentMin = state.minLevel;
      const adjusted =
        currentMin !== '' && clamped < (currentMin as number) ? (currentMin as number) : clamped;
      if (state.maxLevel === adjusted) {
        return state;
      }
      return { ...state, maxLevel: adjusted };
    }
    default: {
      return state;
    }
  }
}
