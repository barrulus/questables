/**
 * Levelling routes — XP-based and milestone level-up management.
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
import { applyLevelUp } from '../services/levelling/service.js';
import { getAllLiveStates } from '../services/live-state/service.js';
import { logError } from '../utils/logger.js';

const router = Router();

// ── POST /api/campaigns/:id/characters/:characterId/level-up ────────────
// Player (own char) or DM. Apply a level-up.

router.post(
  '/api/campaigns/:campaignId/characters/:characterId/level-up',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('characterId').isUUID(),
    body('hpChoice').isIn(['roll', 'average']),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, characterId } = req.params;
    const { hpChoice } = req.body;
    const client = await getClient({ label: 'levelling.level-up' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      // Players can only level up their own character
      if (viewer.role !== 'dm' && viewer.role !== 'co-dm' && !viewer.isAdmin) {
        const { rows: playerRows } = await client.query(
          `SELECT character_id FROM public.campaign_players
            WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
          [campaignId, req.user.id],
        );
        if (!playerRows.some((r) => r.character_id === characterId)) {
          const err = new Error('You can only level up your own character');
          err.status = 403;
          err.code = 'level_up_forbidden';
          throw err;
        }
      }

      // Get active session
      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      const sessionId = sessionRows[0]?.id ?? null;

      const result = await applyLevelUp(client, {
        characterId,
        sessionId,
        hpChoice,
      });

      await client.query('COMMIT');

      // Broadcast live state changes
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer && sessionId) {
        const allStates = await getAllLiveStates(client, { sessionId });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId,
          liveStates: allStates,
          reason: `level up: ${result.newLevel}`,
        });
      }

      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Level-up failed', error, { campaignId, characterId });
      res.status(error.status || 500).json({
        error: error.code || 'level_up_failed',
        message: error.message || 'Failed to level up',
      });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/characters/:characterId/milestone-level-up ──
// DM only. Bypasses XP check.

router.post(
  '/api/campaigns/:campaignId/characters/:characterId/milestone-level-up',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('characterId').isUUID(),
    body('hpChoice').isIn(['roll', 'average']),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, characterId } = req.params;
    const { hpChoice } = req.body;
    const client = await getClient({ label: 'levelling.milestone' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can grant milestone level-ups.');

      // Get active session
      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      const sessionId = sessionRows[0]?.id ?? null;

      const result = await applyLevelUp(client, {
        characterId,
        sessionId,
        hpChoice,
      });

      await client.query('COMMIT');

      // Broadcast
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer && sessionId) {
        const allStates = await getAllLiveStates(client, { sessionId });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId,
          liveStates: allStates,
          reason: `milestone level up: ${result.newLevel}`,
        });
      }

      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Milestone level-up failed', error, { campaignId, characterId });
      res.status(error.status || 500).json({
        error: error.code || 'milestone_level_up_failed',
        message: error.message || 'Failed to apply milestone level-up',
      });
    } finally {
      client.release();
    }
  },
);

export function registerLevellingRoutes(app) {
  app.use(router);
}

export default registerLevellingRoutes;
