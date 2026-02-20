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
      const result = await changePhase(client, sessionId, {
        newPhase,
        encounterId: encounterId ?? null,
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

export const registerGameStateRoutes = (app) => {
  app.use('/api', router);
};
