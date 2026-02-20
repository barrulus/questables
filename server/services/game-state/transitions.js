/**
 * Phase transition rules for the game state engine.
 *
 * Each key is a current phase; its value is the set of phases it can
 * transition to.  The DM is the only actor allowed to trigger phase
 * changes (enforced at the route/service layer).
 */

export const VALID_PHASES = new Set([
  'exploration',
  'combat',
  'social',
  'rest',
]);

export const PHASE_TRANSITIONS = {
  exploration: new Set(['combat', 'social', 'rest']),
  combat:      new Set(['exploration', 'social']),
  social:      new Set(['exploration', 'combat', 'rest']),
  rest:        new Set(['exploration']),
};

/**
 * Returns `true` when `current → target` is an allowed phase change.
 */
export const validatePhaseTransition = (current, target) => {
  if (!VALID_PHASES.has(current) || !VALID_PHASES.has(target)) {
    return false;
  }
  if (current === target) {
    return false;
  }
  return PHASE_TRANSITIONS[current]?.has(target) ?? false;
};
