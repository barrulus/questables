export interface Campaign {
  id: string;
  name: string;
  description: string;
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
  maxPlayers: number;
  minLevel: number;
  maxLevel: number;
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

export const DEFAULT_LEVEL_RANGE = { min: 1, max: 20 } as const;

const EDIT_FORM_TEMPLATE: CampaignEditFormState = {
  name: '',
  description: '',
  system: 'D&D 5e',
  setting: '',
  status: 'recruiting',
  maxPlayers: 6,
  minLevel: DEFAULT_LEVEL_RANGE.min,
  maxLevel: DEFAULT_LEVEL_RANGE.max,
  worldMapId: '',
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
    description: campaign.description || '',
    system: campaign.system || EDIT_FORM_TEMPLATE.system,
    setting: campaign.setting || '',
    status: (campaign.status as CampaignStatus) ?? EDIT_FORM_TEMPLATE.status,
    maxPlayers: Number.isFinite(numericMaxPlayers) ? numericMaxPlayers : EDIT_FORM_TEMPLATE.maxPlayers,
    minLevel: levelRange.min,
    maxLevel: levelRange.max,
    worldMapId: campaign.world_map_id ?? '',
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
