/**
 * Rest routes — short/long rest management.
 */

import { Router } from 'express';
import { body, param } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import { handleValidationErrors } from '../validation/common.js';
import {
  ensureDmControl,
  getViewerContextOrThrow,
} from '../services/campaigns/service.js';
import { changePhase } from '../services/game-state/service.js';
import { spendHitDie, completeRest, rollRestEncounter } from '../services/rest/service.js';
import { getAllLiveStates } from '../services/live-state/service.js';
import { checkLevelUps } from '../services/levelling/service.js';
import { logError } from '../utils/logger.js';

const router = Router();

// ── POST /api/campaigns/:id/rest/start ──────────────────────────────────
// DM only. Transition to rest phase.

router.post(
  '/api/campaigns/:campaignId/rest/start',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('restType').isIn(['short', 'long']),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { restType } = req.body;
    const client = await getClient({ label: 'rest.start' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can start a rest.');

      // Get active session
      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );
      if (sessionRows.length === 0) {
        const err = new Error('No active session');
        err.status = 400;
        err.code = 'no_active_session';
        throw err;
      }

      const sessionId = sessionRows[0].id;

      // Transition to rest phase
      const { newState } = await changePhase(client, sessionId, {
        newPhase: 'rest',
        actorId: req.user.id,
      });

      // Store rest context in game_state
      const restContext = { type: restType, startedAt: new Date().toISOString() };
      await client.query(
        `UPDATE public.sessions
            SET game_state = jsonb_set(game_state, '{restContext}', $2::jsonb)
          WHERE id = $1`,
        [sessionId, JSON.stringify(restContext)],
      );

      // For long rest, roll for random encounter
      let encounter = null;
      if (restType === 'long') {
        encounter = rollRestEncounter();
      }

      await client.query('COMMIT');

      // Broadcast
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer) {
        wsServer.emitGamePhaseChanged(campaignId, {
          sessionId,
          previousPhase: newState.previousPhase,
          newPhase: 'rest',
          gameState: { ...newState, restContext },
        });

        wsServer.broadcastToCampaign(campaignId, 'rest-started', {
          sessionId,
          restType,
          encounter,
          emittedAt: new Date().toISOString(),
        });
      }

      res.json({ restType, encounter, gameState: { ...newState, restContext } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Rest start failed', error, { campaignId });
      res.status(error.status || 500).json({
        error: error.code || 'rest_start_failed',
        message: error.message || 'Failed to start rest',
      });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/rest/spend-hit-die ─────────────────────────
// Player (own char) or DM. Spend a hit die during short rest.

router.post(
  '/api/campaigns/:campaignId/rest/spend-hit-die',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('characterId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { characterId } = req.body;
    const client = await getClient({ label: 'rest.spend-hit-die' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      // Players can only spend their own hit dice
      if (viewer.role !== 'dm' && viewer.role !== 'co-dm' && !viewer.isAdmin) {
        const { rows: playerRows } = await client.query(
          `SELECT character_id FROM public.campaign_players
            WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
          [campaignId, req.user.id],
        );
        if (!playerRows.some((r) => r.character_id === characterId)) {
          const err = new Error('You can only spend your own hit dice');
          err.status = 403;
          err.code = 'hit_die_forbidden';
          throw err;
        }
      }

      // Get active session and validate phase
      const { rows: sessionRows } = await client.query(
        `SELECT id, game_state FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );
      if (sessionRows.length === 0) {
        const err = new Error('No active session');
        err.status = 400;
        err.code = 'no_active_session';
        throw err;
      }

      const session = sessionRows[0];
      const gameState = session.game_state;

      if (gameState?.phase !== 'rest') {
        const err = new Error('Can only spend hit dice during rest phase');
        err.status = 400;
        err.code = 'not_rest_phase';
        throw err;
      }

      if (gameState?.restContext?.type !== 'short') {
        const err = new Error('Hit dice can only be spent during a short rest');
        err.status = 400;
        err.code = 'not_short_rest';
        throw err;
      }

      const result = await spendHitDie(client, {
        sessionId: session.id,
        characterId,
      });

      await client.query('COMMIT');

      // Broadcast
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer) {
        const allStates = await getAllLiveStates(client, { sessionId: session.id });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId: session.id,
          liveStates: allStates,
          reason: 'hit die spent',
        });

        wsServer.broadcastToCampaign(campaignId, 'hit-dice-spent', {
          sessionId: session.id,
          characterId,
          ...result,
          emittedAt: new Date().toISOString(),
        });
      }

      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Hit die spend failed', error, { campaignId, characterId });
      res.status(error.status || 500).json({
        error: error.code || 'hit_die_spend_failed',
        message: error.message || 'Failed to spend hit die',
      });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/rest/complete ──────────────────────────────
// DM only. Complete the rest and transition back to exploration.

router.post(
  '/api/campaigns/:campaignId/rest/complete',
  requireAuth,
  [param('campaignId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'rest.complete' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can complete a rest.');

      // Get active session
      const { rows: sessionRows } = await client.query(
        `SELECT id, game_state FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );
      if (sessionRows.length === 0) {
        const err = new Error('No active session');
        err.status = 400;
        err.code = 'no_active_session';
        throw err;
      }

      const session = sessionRows[0];
      const gameState = session.game_state;

      if (gameState?.phase !== 'rest') {
        const err = new Error('Not in rest phase');
        err.status = 400;
        err.code = 'not_rest_phase';
        throw err;
      }

      const restType = gameState.restContext?.type ?? 'short';

      // Apply rest effects
      await completeRest(client, {
        sessionId: session.id,
        campaignId,
        restType,
      });

      // Transition back to exploration
      const { newState } = await changePhase(client, session.id, {
        newPhase: 'exploration',
        actorId: req.user.id,
      });

      // Clear rest context
      await client.query(
        `UPDATE public.sessions
            SET game_state = jsonb_set(game_state, '{restContext}', 'null'::jsonb)
          WHERE id = $1`,
        [session.id],
      );

      await client.query('COMMIT');

      // Broadcast
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer) {
        const allStates = await getAllLiveStates(client, { sessionId: session.id });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId: session.id,
          liveStates: allStates,
          reason: `${restType} rest completed`,
        });

        wsServer.emitGamePhaseChanged(campaignId, {
          sessionId: session.id,
          previousPhase: 'rest',
          newPhase: 'exploration',
          gameState: newState,
        });

        // Check for level-ups after rest
        try {
          const levelUps = await checkLevelUps(client, { sessionId: session.id, campaignId });
          for (const lu of levelUps) {
            wsServer.emitToUser(campaignId, lu.userId, 'level-up-available', {
              characterId: lu.characterId,
              characterName: lu.characterName,
              currentLevel: lu.currentLevel,
              newLevel: lu.newLevel,
            });
          }
        } catch (luErr) {
          logError('Level-up check after rest failed', luErr, { campaignId });
        }

        wsServer.broadcastToCampaign(campaignId, 'rest-completed', {
          sessionId: session.id,
          restType,
          emittedAt: new Date().toISOString(),
        });
      }

      res.json({ restType, gameState: newState });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Rest complete failed', error, { campaignId });
      res.status(error.status || 500).json({
        error: error.code || 'rest_complete_failed',
        message: error.message || 'Failed to complete rest',
      });
    } finally {
      client.release();
    }
  },
);

export function registerRestRoutes(app) {
  app.use(router);
}

export default registerRestRoutes;
