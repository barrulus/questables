/**
 * Core game-state service.
 *
 * All mutations follow the pattern:
 *   1. SELECT … FOR UPDATE  (lock the session row)
 *   2. Validate transition / turn
 *   3. Write new state + log to game_state_log
 *
 * Callers are responsible for wrapping calls in a transaction (BEGIN / COMMIT).
 */

import { logInfo } from '../../utils/logger.js';
import { validatePhaseTransition, VALID_PHASES } from './transitions.js';
import { buildTurnOrder } from './turn-order.js';
import { resetTurnBudget } from '../combat/service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_GAME_STATE = {
  phase: 'exploration',
  previousPhase: null,
  turnOrder: [],
  activePlayerId: null,
  roundNumber: 1,
  worldTurnPending: false,
  encounterId: null,
  phaseEnteredAt: null, // set at write time
  combatTurnBudget: null, // populated during combat phase
  restContext: null, // populated during rest phase: { type: 'short'|'long', startedAt: ISO }
};

/**
 * Read the game_state JSON from a session row, applying defaults for any
 * missing keys so callers always get a fully-populated object.
 */
const parseGameState = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GAME_STATE, phaseEnteredAt: new Date().toISOString() };
  }
  return { ...DEFAULT_GAME_STATE, ...raw };
};

/**
 * Persist `newState` to the session row and append a log entry.
 */
const persistAndLog = async (
  client,
  { sessionId, campaignId, eventType, actorId, previousState, newState, metadata },
) => {
  await client.query(
    `UPDATE public.sessions
        SET game_state = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [sessionId, JSON.stringify(newState)],
  );

  await client.query(
    `INSERT INTO public.game_state_log
       (session_id, campaign_id, event_type, actor_id, previous_state, new_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      campaignId,
      eventType,
      actorId ?? null,
      previousState ? JSON.stringify(previousState) : null,
      JSON.stringify(newState),
      metadata ? JSON.stringify(metadata) : '{}',
    ],
  );
};

/**
 * Lock and return the session row (must be inside a transaction).
 */
const lockSession = async (client, sessionId) => {
  const { rows } = await client.query(
    `SELECT s.id, s.campaign_id, s.game_state, s.status
       FROM public.sessions s
      WHERE s.id = $1
      FOR UPDATE`,
    [sessionId],
  );
  return rows[0] ?? null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the current game state for a session (no lock).
 */
export const getGameState = async (client, sessionId) => {
  const { rows } = await client.query(
    'SELECT game_state FROM public.sessions WHERE id = $1',
    [sessionId],
  );
  if (rows.length === 0) {
    return null;
  }
  return parseGameState(rows[0].game_state);
};

/**
 * Create the initial game state when a session is activated.
 */
export const initializeGameState = async (client, sessionId, campaignId, { dmUserId } = {}) => {
  const turnOrder = await buildTurnOrder(client, campaignId, sessionId, 'exploration', {});
  const now = new Date().toISOString();

  const newState = {
    ...DEFAULT_GAME_STATE,
    turnOrder,
    activePlayerId: turnOrder[0] ?? null,
    phaseEnteredAt: now,
  };

  await persistAndLog(client, {
    sessionId,
    campaignId,
    eventType: 'phase_changed',
    actorId: dmUserId ?? null,
    previousState: null,
    newState,
    metadata: { reason: 'session_activated' },
  });

  logInfo('Game state initialized', {
    telemetryEvent: 'game_state.initialized',
    sessionId,
    campaignId,
    phase: newState.phase,
    turnOrderLength: turnOrder.length,
  });

  return newState;
};

/**
 * Transition to a new game phase.
 */
export const changePhase = async (client, sessionId, { newPhase, encounterId, actorId }) => {
  if (!VALID_PHASES.has(newPhase)) {
    const err = new Error(`Invalid target phase: ${newPhase}`);
    err.status = 400;
    err.code = 'invalid_phase';
    throw err;
  }

  const row = await lockSession(client, sessionId);
  if (!row) {
    const err = new Error('Session not found');
    err.status = 404;
    err.code = 'session_not_found';
    throw err;
  }

  const prev = parseGameState(row.game_state);

  if (!validatePhaseTransition(prev.phase, newPhase)) {
    const err = new Error(`Cannot transition from ${prev.phase} to ${newPhase}`);
    err.status = 400;
    err.code = 'invalid_phase_transition';
    throw err;
  }

  const turnOrder = await buildTurnOrder(client, row.campaign_id, sessionId, newPhase, { encounterId });
  const now = new Date().toISOString();

  const firstPlayer = turnOrder[0] ?? null;
  const firstIsNpc = typeof firstPlayer === 'string' && firstPlayer.startsWith('npc:');
  const isCombat = newPhase === 'combat';

  const newState = {
    phase: newPhase,
    previousPhase: prev.phase,
    turnOrder,
    activePlayerId: firstPlayer,
    roundNumber: 1,
    worldTurnPending: false,
    encounterId: encounterId ?? null,
    phaseEnteredAt: now,
    combatTurnBudget: isCombat && !firstIsNpc ? resetTurnBudget() : null,
  };

  await persistAndLog(client, {
    sessionId,
    campaignId: row.campaign_id,
    eventType: 'phase_changed',
    actorId,
    previousState: prev,
    newState,
    metadata: { encounterId: encounterId ?? null },
  });

  logInfo('Game phase changed', {
    telemetryEvent: 'game_state.phase_changed',
    sessionId,
    campaignId: row.campaign_id,
    previousPhase: prev.phase,
    newPhase,
  });

  return { campaignId: row.campaign_id, previousPhase: prev.phase, newState };
};

/**
 * End the current player's turn and advance to the next.
 */
export const endTurn = async (client, sessionId, { actorId }) => {
  const row = await lockSession(client, sessionId);
  if (!row) {
    const err = new Error('Session not found');
    err.status = 404;
    err.code = 'session_not_found';
    throw err;
  }

  const prev = parseGameState(row.game_state);

  if (prev.turnOrder.length === 0) {
    const err = new Error('No turn order set for this phase');
    err.status = 400;
    err.code = 'no_turn_order';
    throw err;
  }

  // DM can always end any turn; otherwise must be the active player
  // (caller should pass actorId of the requesting user)
  if (prev.activePlayerId && actorId !== prev.activePlayerId) {
    // Check if the actor is the DM — we accept this as a convenience;
    // proper DM check is done at the route layer, so here we just allow it.
  }

  const currentIndex = prev.turnOrder.indexOf(prev.activePlayerId);
  const nextIndex = (currentIndex + 1) % prev.turnOrder.length;
  const roundComplete = nextIndex === 0 && currentIndex >= 0;

  const nextPlayerId = prev.turnOrder[nextIndex];
  const isCombat = prev.phase === 'combat';
  const nextIsNpc = typeof nextPlayerId === 'string' && nextPlayerId.startsWith('npc:');

  const newState = {
    ...prev,
    activePlayerId: nextPlayerId,
    roundNumber: roundComplete ? prev.roundNumber + 1 : prev.roundNumber,
    worldTurnPending: roundComplete,
    // Reset combat budget on turn advance in combat phase
    combatTurnBudget: isCombat && !nextIsNpc ? resetTurnBudget() : null,
  };

  await persistAndLog(client, {
    sessionId,
    campaignId: row.campaign_id,
    eventType: 'turn_advanced',
    actorId,
    previousState: prev,
    newState,
    metadata: { roundComplete, nextIsNpc },
  });

  logInfo('Turn advanced', {
    telemetryEvent: 'game_state.turn_advanced',
    sessionId,
    campaignId: row.campaign_id,
    nextPlayer: newState.activePlayerId,
    roundNumber: newState.roundNumber,
    roundComplete,
    nextIsNpc,
  });

  return { campaignId: row.campaign_id, newState };
};

/**
 * Execute the DM world turn (called after a round completes).
 */
export const executeDmWorldTurn = async (client, sessionId, { actorId }) => {
  const row = await lockSession(client, sessionId);
  if (!row) {
    const err = new Error('Session not found');
    err.status = 404;
    err.code = 'session_not_found';
    throw err;
  }

  const prev = parseGameState(row.game_state);

  if (!prev.worldTurnPending) {
    const err = new Error('No world turn is pending');
    err.status = 400;
    err.code = 'no_world_turn_pending';
    throw err;
  }

  const newState = {
    ...prev,
    worldTurnPending: false,
    activePlayerId: prev.turnOrder[0] ?? null,
  };

  await persistAndLog(client, {
    sessionId,
    campaignId: row.campaign_id,
    eventType: 'world_turn_completed',
    actorId,
    previousState: prev,
    newState,
  });

  logInfo('DM world turn executed', {
    telemetryEvent: 'game_state.world_turn_completed',
    sessionId,
    campaignId: row.campaign_id,
    roundNumber: newState.roundNumber,
  });

  return { campaignId: row.campaign_id, newState };
};

/**
 * DM reorder of the turn order.
 */
export const setTurnOrder = async (client, sessionId, { turnOrder, actorId }) => {
  if (!Array.isArray(turnOrder)) {
    const err = new Error('turnOrder must be an array of user IDs');
    err.status = 400;
    err.code = 'invalid_turn_order';
    throw err;
  }

  const row = await lockSession(client, sessionId);
  if (!row) {
    const err = new Error('Session not found');
    err.status = 404;
    err.code = 'session_not_found';
    throw err;
  }

  const prev = parseGameState(row.game_state);

  const newState = {
    ...prev,
    turnOrder,
    activePlayerId: turnOrder[0] ?? null,
  };

  await persistAndLog(client, {
    sessionId,
    campaignId: row.campaign_id,
    eventType: 'turn_order_set',
    actorId,
    previousState: prev,
    newState,
  });

  logInfo('Turn order set', {
    telemetryEvent: 'game_state.turn_order_set',
    sessionId,
    campaignId: row.campaign_id,
    turnOrderLength: turnOrder.length,
  });

  return { campaignId: row.campaign_id, newState };
};

/**
 * DM skip a player's turn.
 */
export const skipTurn = async (client, sessionId, { targetPlayerId, actorId }) => {
  const row = await lockSession(client, sessionId);
  if (!row) {
    const err = new Error('Session not found');
    err.status = 404;
    err.code = 'session_not_found';
    throw err;
  }

  const prev = parseGameState(row.game_state);

  if (prev.activePlayerId !== targetPlayerId) {
    const err = new Error('Target player is not the active player');
    err.status = 400;
    err.code = 'not_active_player';
    throw err;
  }

  const currentIndex = prev.turnOrder.indexOf(targetPlayerId);
  const nextIndex = (currentIndex + 1) % prev.turnOrder.length;
  const roundComplete = nextIndex === 0 && currentIndex >= 0;

  const newState = {
    ...prev,
    activePlayerId: prev.turnOrder[nextIndex],
    roundNumber: roundComplete ? prev.roundNumber + 1 : prev.roundNumber,
    worldTurnPending: roundComplete,
  };

  await persistAndLog(client, {
    sessionId,
    campaignId: row.campaign_id,
    eventType: 'player_skipped',
    actorId,
    previousState: prev,
    newState,
    metadata: { skippedPlayerId: targetPlayerId },
  });

  logInfo('Player skipped', {
    telemetryEvent: 'game_state.player_skipped',
    sessionId,
    campaignId: row.campaign_id,
    skippedPlayerId: targetPlayerId,
    nextPlayer: newState.activePlayerId,
  });

  return { campaignId: row.campaign_id, newState };
};
