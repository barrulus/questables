import { describe, expect, it } from '@jest/globals';
import {
  computeActionability,
  ACTIONABILITY_REASONS,
} from '../../shared/actionability.js';

const userId = 'user-1';
const otherUserId = 'user-2';

const baseGameState = {
  phase: 'exploration',
  turnOrder: [userId, otherUserId],
  activePlayerId: userId,
};

describe('computeActionability', () => {
  it('returns ok when user is in turn order during exploration', () => {
    const result = computeActionability({
      gameState: baseGameState,
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({ canAct: true, reason: ACTIONABILITY_REASONS.OK });
  });

  it('returns ok for any party member during social phase', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, phase: 'social', activePlayerId: otherUserId },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.canAct).toBe(true);
  });

  it('returns no_active_session when gameState is null', () => {
    const result = computeActionability({
      gameState: null,
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.NO_ACTIVE_SESSION,
    });
  });

  it('returns phase_not_actionable with phase field for downtime', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, phase: 'downtime' },
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.PHASE_NOT_ACTIONABLE,
      phase: 'downtime',
    });
  });

  it('returns phase_not_actionable for rest phase', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, phase: 'rest' },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.reason).toBe(ACTIONABILITY_REASONS.PHASE_NOT_ACTIONABLE);
    expect(result.phase).toBe('rest');
  });

  it('returns user_not_in_turn_order when user missing from exploration turnOrder', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, turnOrder: [otherUserId] },
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.USER_NOT_IN_TURN_ORDER,
    });
  });

  it('returns not_active_player_in_combat for non-active combatant', () => {
    const result = computeActionability({
      gameState: {
        phase: 'combat',
        turnOrder: [userId, otherUserId],
        activePlayerId: otherUserId,
      },
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.NOT_ACTIVE_PLAYER_IN_COMBAT,
      activeUserId: otherUserId,
    });
  });

  it('returns ok for the active combatant', () => {
    const result = computeActionability({
      gameState: {
        phase: 'combat',
        turnOrder: [userId, otherUserId],
        activePlayerId: userId,
      },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.canAct).toBe(true);
  });

  it('returns no_active_character when user has none, even if otherwise eligible', () => {
    const result = computeActionability({
      gameState: baseGameState,
      userId,
      hasActiveCharacter: false,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.NO_ACTIVE_CHARACTER,
    });
  });

  it('treats empty turnOrder as no_active_session-equivalent state', () => {
    const result = computeActionability({
      gameState: { phase: 'exploration', turnOrder: [], activePlayerId: null },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.canAct).toBe(false);
    expect(result.reason).toBe(ACTIONABILITY_REASONS.NO_ACTIVE_SESSION);
  });
});
