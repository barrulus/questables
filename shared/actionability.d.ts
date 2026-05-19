export type ActionabilityReason =
  | 'ok'
  | 'no_active_session'
  | 'phase_not_actionable'
  | 'user_not_in_turn_order'
  | 'not_active_player_in_combat'
  | 'no_active_character';

export interface GameStateLike {
  phase: string;
  turnOrder: string[];
  activePlayerId: string | null;
}

export interface ActionabilityResult {
  canAct: boolean;
  reason: ActionabilityReason;
  activeUserId?: string;
  phase?: string;
}

export const ACTIONABILITY_REASONS: {
  OK: 'ok';
  NO_ACTIVE_SESSION: 'no_active_session';
  PHASE_NOT_ACTIONABLE: 'phase_not_actionable';
  USER_NOT_IN_TURN_ORDER: 'user_not_in_turn_order';
  NOT_ACTIVE_PLAYER_IN_COMBAT: 'not_active_player_in_combat';
  NO_ACTIVE_CHARACTER: 'no_active_character';
};

export function computeActionability(args: {
  gameState: GameStateLike | null;
  userId: string;
  hasActiveCharacter: boolean;
}): ActionabilityResult;
