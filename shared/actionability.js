/**
 * @typedef {Object} GameStateLike
 * @property {string} phase
 * @property {string[]} turnOrder
 * @property {string|null} activePlayerId
 */

/**
 * @typedef {Object} ActionabilityResult
 * @property {boolean} canAct
 * @property {string} reason
 * @property {string} [activeUserId]
 * @property {string} [phase]
 */

export const ACTIONABILITY_REASONS = Object.freeze({
  OK: 'ok',
  NO_ACTIVE_SESSION: 'no_active_session',
  PHASE_NOT_ACTIONABLE: 'phase_not_actionable',
  USER_NOT_IN_TURN_ORDER: 'user_not_in_turn_order',
  NOT_ACTIVE_PLAYER_IN_COMBAT: 'not_active_player_in_combat',
  NO_ACTIVE_CHARACTER: 'no_active_character',
});

const ACTIONABLE_PHASES = new Set(['exploration', 'combat', 'social']);

/**
 * Decide whether a given user could currently take an in-character action
 * that the DM action-interceptor would resolve.
 *
 * Pure function: same inputs → same outputs. Safe to call from both server
 * (chat intercept path) and client (turn-status bar / input gating).
 *
 * @param {{ gameState: GameStateLike|null, userId: string, hasActiveCharacter: boolean }} args
 * @returns {ActionabilityResult}
 */
export function computeActionability({ gameState, userId, hasActiveCharacter }) {
  if (!gameState) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.NO_ACTIVE_SESSION };
  }

  const turnOrder = Array.isArray(gameState.turnOrder) ? gameState.turnOrder : [];
  if (turnOrder.length === 0) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.NO_ACTIVE_SESSION };
  }

  if (!ACTIONABLE_PHASES.has(gameState.phase)) {
    return {
      canAct: false,
      reason: ACTIONABILITY_REASONS.PHASE_NOT_ACTIONABLE,
      phase: gameState.phase,
    };
  }

  if (gameState.phase === 'combat') {
    if (!turnOrder.includes(userId)) {
      return { canAct: false, reason: ACTIONABILITY_REASONS.USER_NOT_IN_TURN_ORDER };
    }
    if (gameState.activePlayerId !== userId) {
      return {
        canAct: false,
        reason: ACTIONABILITY_REASONS.NOT_ACTIVE_PLAYER_IN_COMBAT,
        activeUserId: gameState.activePlayerId ?? undefined,
      };
    }
  } else if (!turnOrder.includes(userId)) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.USER_NOT_IN_TURN_ORDER };
  }

  if (!hasActiveCharacter) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.NO_ACTIVE_CHARACTER };
  }

  return { canAct: true, reason: ACTIONABILITY_REASONS.OK };
}
