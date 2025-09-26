const CAMPAIGN_STATUS_VALUES = new Set(['recruiting', 'active', 'paused', 'completed']);
const EXPERIENCE_TYPE_VALUES = new Set(['milestone', 'experience_points']);
const RESTING_RULE_VALUES = new Set(['standard', 'gritty', 'heroic']);
const DEATH_SAVE_RULE_VALUES = new Set(['standard', 'hardcore', 'forgiving']);
const DEFAULT_LEVEL_RANGE = { min: 1, max: 20 };
const DEFAULT_MAX_PLAYERS = 6;

const clampLevelValue = (value) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new Error('Level values must be integers');
  }
  if (numeric < 1 || numeric > 20) {
    throw new Error('Level values must be between 1 and 20');
  }
  return numeric;
};

export const parseLevelRangeInput = (input, { fallbackToDefault = true } = {}) => {
  if (input === undefined || input === null || input === '') {
    if (fallbackToDefault) {
      return { ...DEFAULT_LEVEL_RANGE };
    }
    throw new Error('Level range is required');
  }

  const candidate = typeof input === 'string'
    ? (() => {
        try {
          return JSON.parse(input);
        } catch (error) {
          throw new Error('Level range string must be valid JSON');
        }
      })()
    : input;

  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Level range must be an object containing min and max values');
  }

  const min = clampLevelValue(candidate.min ?? candidate.minimum);
  const max = clampLevelValue(candidate.max ?? candidate.maximum);

  if (min > max) {
    throw new Error('Level range minimum cannot exceed maximum');
  }

  return { min, max };
};

export const parseMaxPlayersInput = (value, { fallback = DEFAULT_MAX_PLAYERS, required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error('Max players is required');
    }
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 20) {
    throw new Error('Max players must be an integer between 1 and 20');
  }
  return numeric;
};

export const normalizeStatusInput = (status, fallback = 'recruiting') => {
  if (typeof status !== 'string') {
    return fallback;
  }
  const trimmed = status.trim();
  return CAMPAIGN_STATUS_VALUES.has(trimmed) ? trimmed : fallback;
};

export const coerceNullableString = (value, { trim = true } = {}) => {
  if (typeof value !== 'string') {
    return null;
  }
  const result = trim ? value.trim() : value;
  return result.length > 0 ? result : null;
};

export const coerceBooleanInput = (value, defaultValue = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  if (value === undefined || value === null) return defaultValue;
  return Boolean(value);
};

export const coerceExperienceType = (value, fallback = 'milestone') => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return EXPERIENCE_TYPE_VALUES.has(normalized) ? normalized : fallback;
};

export const coerceRestingRules = (value, fallback = 'standard') => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return RESTING_RULE_VALUES.has(normalized) ? normalized : fallback;
};

export const coerceDeathSaveRules = (value, fallback = 'standard') => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return DEATH_SAVE_RULE_VALUES.has(normalized) ? normalized : fallback;
};

export const pickProvided = (...values) => values.find((value) => value !== undefined);

export const DEFAULT_VISIBILITY_RADIUS = Number.parseFloat(process.env.CAMPAIGN_VISIBILITY_RADIUS ?? '') || 500;
export const DEFAULT_MAX_MOVE_DISTANCE = Math.max(0, Number.parseFloat(process.env.CAMPAIGN_MAX_MOVE_DISTANCE ?? '') || 500);
export const DEFAULT_MIN_MOVE_INTERVAL_MS = Math.max(0, Number.parseFloat(process.env.CAMPAIGN_MIN_MOVE_INTERVAL_MS ?? '') || 1000);

export { DEFAULT_MAX_PLAYERS, DEFAULT_LEVEL_RANGE, CAMPAIGN_STATUS_VALUES, EXPERIENCE_TYPE_VALUES, RESTING_RULE_VALUES, DEATH_SAVE_RULE_VALUES };
