import { ENCOUNTER_TYPES, SIDEBAR_ENCOUNTER_DIFFICULTIES } from '../campaigns/service.js';

export const DEFAULT_ENCOUNTER_DIFFICULTY = 'medium';

export const normalizeEncounterType = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return ENCOUNTER_TYPES.has(normalized) ? normalized : null;
};

export const normalizeEncounterDifficulty = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SIDEBAR_ENCOUNTER_DIFFICULTIES.has(normalized) ? normalized : null;
};

