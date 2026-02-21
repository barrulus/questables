import { Router } from 'express';
import { body, param } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import { handleValidationErrors } from '../validation/common.js';
import {
  ensureDmControl,
  getViewerContextOrThrow,
} from '../services/campaigns/service.js';
import {
  getGameState,
  changePhase,
  endTurn,
  executeDmWorldTurn,
  setTurnOrder,
  skipTurn,
} from '../services/game-state/service.js';
import { initiateCombat, resolveCombatEnd } from '../services/combat/service.js';
import { getAllLiveStates } from '../services/live-state/service.js';
import { resolveDeathSave } from '../services/combat/death-saves.js';
import { checkLevelUps } from '../services/levelling/service.js';
import { logError } from '../utils/logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET  /campaigns/:campaignId/game-state
// ---------------------------------------------------------------------------
router.get(
  '/campaigns/:campaignId/game-state',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'game-state.get' });

      // Any campaign member may read game state
      await getViewerContextOrThrow(client, campaignId, req.user);

      // Find the active session for this campaign
      const { rows: sessionRows } = await client.query(
        `SELECT id, game_state
           FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC
          LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        return res.json({ gameState: null, sessionId: null });
      }

      const session = sessionRows[0];
      const gameState = await getGameState(client, session.id);
      return res.json({ gameState, sessionId: session.id });
    } catch (error) {
      logError('Get game state failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'game_state_get_failed',
        message: error.message || 'Failed to get game state',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// PUT  /campaigns/:campaignId/game-state/phase  — DM only
// ---------------------------------------------------------------------------
router.put(
  '/campaigns/:campaignId/game-state/phase',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
    body('phase')
      .isString()
      .isIn(['exploration', 'combat', 'social', 'rest'])
      .withMessage('phase must be exploration, combat, social, or rest'),
    body('encounterId')
      .optional({ nullable: true })
      .isUUID()
      .withMessage('encounterId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { phase: newPhase, encounterId } = req.body;
    let client;

    try {
      client = await getClient({ label: 'game-state.change-phase' });
      await client.query('BEGIN');

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer);

      // Find active session
      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'no_active_session',
          message: 'No active session found for this campaign',
        });
      }

      const sessionId = sessionRows[0].id;

      // Auto-initiate combat when transitioning to combat phase
      let combatEncounterId = encounterId ?? null;
      if (newPhase === 'combat' && !combatEncounterId) {
        const combatResult = await initiateCombat(client, {
          campaignId,
          sessionId,
          enemyNpcIds: req.body.enemyNpcIds ?? [],
          reason: req.body.reason ?? 'Combat initiated by DM',
        });
        combatEncounterId = combatResult.encounter.id;
      }

      const result = await changePhase(client, sessionId, {
        newPhase,
        encounterId: combatEncounterId,
        actorId: req.user.id,
      });

      await client.query('COMMIT');

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitGamePhaseChanged(campaignId, {
          sessionId,
          previousPhase: result.previousPhase,
          newPhase,
          gameState: result.newState,
        });

        // If first turn is an NPC, fire enemy turn processing
        const firstPlayer = result.newState.activePlayerId;
        if (newPhase === 'combat' && typeof firstPlayer === 'string' && firstPlayer.startsWith('npc:')) {
          wsServer.emitEnemyTurnStarted(campaignId, {
            sessionId,
            participantId: firstPlayer,
            gameState: result.newState,
          });
        }
      }

      return res.json({ sessionId, gameState: result.newState });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Change game phase failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'phase_change_failed',
        message: error.message || 'Failed to change game phase',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// POST /campaigns/:campaignId/game-state/end-turn  — Active player or DM
// ---------------------------------------------------------------------------
router.post(
  '/campaigns/:campaignId/game-state/end-turn',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'game-state.end-turn' });
      await client.query('BEGIN');

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      // Find active session
      const { rows: sessionRows } = await client.query(
        `SELECT id, game_state FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'no_active_session',
          message: 'No active session found',
        });
      }

      const sessionId = sessionRows[0].id;
      const currentState = sessionRows[0].game_state;
      const activePlayerId = currentState?.activePlayerId;

      // Must be the active player or the DM
      const isDm = viewer.role === 'dm' || viewer.isAdmin;
      if (!isDm && req.user.id !== activePlayerId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'not_your_turn',
          message: 'It is not your turn',
        });
      }

      const result = await endTurn(client, sessionId, { actorId: req.user.id });
      await client.query('COMMIT');

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitTurnAdvanced(campaignId, {
          sessionId,
          gameState: result.newState,
        });

        // If next turn is an NPC, auto-fire enemy turn processing
        const nextPlayer = result.newState.activePlayerId;
        if (typeof nextPlayer === 'string' && nextPlayer.startsWith('npc:')) {
          wsServer.emitEnemyTurnStarted(campaignId, {
            sessionId,
            participantId: nextPlayer,
            gameState: result.newState,
          });

          // Trigger async enemy turn processing
          const contextualService = req.app?.locals?.contextualLLMService;
          if (contextualService) {
            const encounterId = result.newState.encounterId;
            const participantId = nextPlayer.replace('npc:', '');
            // Fire and forget — executeEnemyTurn handles its own DB client
            import('../services/combat/enemy-turn-service.js').then(({ executeEnemyTurn }) => {
              executeEnemyTurn(contextualService, req.app.locals.pool ?? null, {
                campaignId,
                sessionId,
                encounterId,
                participantId,
                wsServer,
              }).catch((err) => logError('Enemy turn failed', err, { campaignId, participantId }));
            }).catch((err) => logError('Enemy turn import failed', err));
          }
        }
      }

      return res.json({ sessionId, gameState: result.newState });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('End turn failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'end_turn_failed',
        message: error.message || 'Failed to end turn',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// POST /campaigns/:campaignId/game-state/dm-world-turn  — DM only
// ---------------------------------------------------------------------------
router.post(
  '/campaigns/:campaignId/game-state/dm-world-turn',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'game-state.dm-world-turn' });
      await client.query('BEGIN');

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer);

      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'no_active_session',
          message: 'No active session found',
        });
      }

      const sessionId = sessionRows[0].id;
      const result = await executeDmWorldTurn(client, sessionId, { actorId: req.user.id });
      await client.query('COMMIT');

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitWorldTurnCompleted(campaignId, {
          sessionId,
          gameState: result.newState,
        });
      }

      return res.json({ sessionId, gameState: result.newState });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('DM world turn failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'dm_world_turn_failed',
        message: error.message || 'Failed to execute DM world turn',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// PUT  /campaigns/:campaignId/game-state/turn-order  — DM only
// ---------------------------------------------------------------------------
router.put(
  '/campaigns/:campaignId/game-state/turn-order',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
    body('turnOrder')
      .isArray({ min: 0 })
      .withMessage('turnOrder must be an array of user IDs'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { turnOrder: newTurnOrder } = req.body;
    let client;

    try {
      client = await getClient({ label: 'game-state.set-turn-order' });
      await client.query('BEGIN');

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer);

      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'no_active_session',
          message: 'No active session found',
        });
      }

      const sessionId = sessionRows[0].id;
      const result = await setTurnOrder(client, sessionId, {
        turnOrder: newTurnOrder,
        actorId: req.user.id,
      });

      await client.query('COMMIT');

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitTurnOrderChanged(campaignId, {
          sessionId,
          gameState: result.newState,
        });
      }

      return res.json({ sessionId, gameState: result.newState });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Set turn order failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'turn_order_set_failed',
        message: error.message || 'Failed to set turn order',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// POST /campaigns/:campaignId/game-state/skip-turn  — DM only
// ---------------------------------------------------------------------------
router.post(
  '/campaigns/:campaignId/game-state/skip-turn',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
    body('targetPlayerId')
      .isUUID()
      .withMessage('targetPlayerId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { targetPlayerId } = req.body;
    let client;

    try {
      client = await getClient({ label: 'game-state.skip-turn' });
      await client.query('BEGIN');

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer);

      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'no_active_session',
          message: 'No active session found',
        });
      }

      const sessionId = sessionRows[0].id;
      const result = await skipTurn(client, sessionId, {
        targetPlayerId,
        actorId: req.user.id,
      });

      await client.query('COMMIT');

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitTurnAdvanced(campaignId, {
          sessionId,
          gameState: result.newState,
        });
      }

      return res.json({ sessionId, gameState: result.newState });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Skip turn failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'skip_turn_failed',
        message: error.message || 'Failed to skip turn',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// POST /campaigns/:campaignId/combat/end  — DM only
// ---------------------------------------------------------------------------
router.post(
  '/campaigns/:campaignId/combat/end',
  requireAuth,
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid UUID'),
    body('endCondition')
      .isString()
      .isIn(['victory', 'enemies_fled', 'party_fled', 'parley'])
      .withMessage('endCondition must be victory, enemies_fled, party_fled, or parley'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { endCondition } = req.body;
    let client;

    try {
      client = await getClient({ label: 'combat.end' });
      await client.query('BEGIN');

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer);

      // Find active session
      const { rows: sessionRows } = await client.query(
        `SELECT id, game_state FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'no_active_session',
          message: 'No active session found',
        });
      }

      const sessionId = sessionRows[0].id;
      const gameState = sessionRows[0].game_state;

      if (gameState?.phase !== 'combat' || !gameState?.encounterId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'not_in_combat',
          message: 'Not currently in combat phase or no encounter set',
        });
      }

      // Resolve combat (XP, mark encounter complete)
      const combatResult = await resolveCombatEnd(client, {
        campaignId,
        sessionId,
        encounterId: gameState.encounterId,
        endCondition,
      });

      // Transition back to previous phase (or exploration)
      const returnPhase = endCondition === 'parley' ? 'social' : 'exploration';
      const phaseResult = await changePhase(client, sessionId, {
        newPhase: returnPhase,
        encounterId: null,
        actorId: req.user.id,
      });

      await client.query('COMMIT');

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        // Broadcast combat ended with XP info
        wsServer.emitCombatEnded(campaignId, {
          sessionId,
          endCondition,
          xpAwarded: combatResult.xpAwarded,
          gameState: phaseResult.newState,
        });

        // Broadcast updated live states (XP changes)
        const updatedStates = await getAllLiveStates(client, { sessionId });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId,
          liveStates: updatedStates,
          reason: `combat ended: ${endCondition}`,
        });

        // Check for level-ups after combat XP distribution
        try {
          const levelUps = await checkLevelUps(client, { sessionId, campaignId });
          for (const lu of levelUps) {
            wsServer.emitToUser(campaignId, lu.userId, 'level-up-available', {
              characterId: lu.characterId,
              characterName: lu.characterName,
              currentLevel: lu.currentLevel,
              newLevel: lu.newLevel,
            });
          }
        } catch (luErr) {
          logError('Level-up check after combat failed', luErr, { campaignId });
        }
      }

      return res.json({
        sessionId,
        gameState: phaseResult.newState,
        xpAwarded: combatResult.xpAwarded,
        endCondition,
      });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('End combat failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'combat_end_failed',
        message: error.message || 'Failed to end combat',
      });
    } finally {
      client?.release();
    }
  },
);

// ---------------------------------------------------------------------------
// POST /campaigns/:campaignId/death-save
// ---------------------------------------------------------------------------
router.post(
  '/campaigns/:campaignId/death-save',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('characterId').isUUID(),
    body('roll').isInt({ min: 1, max: 20 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { characterId, roll } = req.body;
    const client = await getClient({ label: 'death-save' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      // Players can only roll for their own character
      if (viewer.role !== 'dm' && viewer.role !== 'co-dm' && !viewer.isAdmin) {
        const { rows: playerRows } = await client.query(
          `SELECT character_id FROM public.campaign_players
            WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
          [campaignId, req.user.id],
        );
        if (!playerRows.some((r) => r.character_id === characterId)) {
          const err = new Error('You can only roll death saves for your own character');
          err.status = 403;
          err.code = 'death_save_forbidden';
          throw err;
        }
      }

      // Validate character is unconscious
      const { rows: stateRows } = await client.query(
        `SELECT sls.conditions, sls.session_id
           FROM public.session_live_states sls
           JOIN public.sessions s ON s.id = sls.session_id
          WHERE s.campaign_id = $1 AND sls.character_id = $2 AND s.status = 'active'
          LIMIT 1`,
        [campaignId, characterId],
      );

      if (stateRows.length === 0) {
        const err = new Error('No active live state found');
        err.status = 404;
        err.code = 'live_state_not_found';
        throw err;
      }

      const conditions = stateRows[0].conditions || [];
      if (!conditions.includes('unconscious')) {
        const err = new Error('Character is not unconscious');
        err.status = 400;
        err.code = 'not_unconscious';
        throw err;
      }

      const sessionId = stateRows[0].session_id;

      const result = await resolveDeathSave(client, {
        sessionId,
        characterId,
        roll,
      });

      await client.query('COMMIT');

      // Broadcast
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer) {
        const allStates = await getAllLiveStates(client, { sessionId });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId,
          liveStates: allStates,
          reason: `death save: ${result.outcome}`,
        });

        wsServer.broadcastToCampaign(campaignId, 'death-save-rolled', {
          sessionId,
          characterId,
          ...result,
          emittedAt: new Date().toISOString(),
        });

        if (result.outcome === 'dead') {
          wsServer.broadcastToCampaign(campaignId, 'character-died', {
            sessionId,
            characterId,
            emittedAt: new Date().toISOString(),
          });
        } else if (result.outcome === 'stabilized') {
          wsServer.broadcastToCampaign(campaignId, 'character-stabilized', {
            sessionId,
            characterId,
            emittedAt: new Date().toISOString(),
          });
        }
      }

      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Death save failed', error, { campaignId, characterId });
      res.status(error.status || 500).json({
        error: error.code || 'death_save_failed',
        message: error.message || 'Failed to resolve death save',
      });
    } finally {
      client.release();
    }
  },
);

export const registerGameStateRoutes = (app) => {
  app.use('/api', router);
};
