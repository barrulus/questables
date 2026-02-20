import { Router } from 'express';
import { body, param } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import { handleValidationErrors } from '../validation/common.js';
import {
  ensureDmControl,
  getViewerContextOrThrow,
  MAX_FOCUS_LENGTH,
  MAX_CONTEXT_LENGTH,
  ENCOUNTER_TYPES,
  SIDEBAR_ENCOUNTER_DIFFICULTIES,
} from '../services/campaigns/service.js';
import { fetchSessionWithCampaign } from '../services/sessions/service.js';
import { normalizeEncounterType, normalizeEncounterDifficulty, DEFAULT_ENCOUNTER_DIFFICULTY } from '../services/encounters/service.js';
import { sanitizeUserInput } from '../utils/sanitization.js';
import { logError, logInfo } from '../utils/logger.js';
import { incrementCounter, recordEvent } from '../utils/telemetry.js';
import { initializeGameState } from '../services/game-state/service.js';

const router = Router();

router.post(
  '/campaigns/:campaignId/sessions',
  requireAuth,
  [
    param('campaignId')
      .isUUID()
      .withMessage('campaignId must be a valid UUID'),
    body('title')
      .isString()
      .withMessage('title must be a string')
      .bail()
      .trim()
      .notEmpty()
      .withMessage('title is required')
      .isLength({ max: 200 })
      .withMessage('title must be 200 characters or fewer'),
    body('summary')
      .optional({ nullable: true })
      .isString()
      .withMessage('summary must be a string'),
    body('dm_notes')
      .optional({ nullable: true })
      .isString()
      .withMessage('dm_notes must be a string'),
    body('scheduled_at')
      .optional({ nullable: true })
      .isISO8601()
      .withMessage('scheduled_at must be an ISO 8601 timestamp'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'sessions.create' });
      await client.query('BEGIN');

      const campaignCheck = await client.query(
        'SELECT id FROM public.campaigns WHERE id = $1',
        [campaignId],
      );
      if (campaignCheck.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'campaign_not_found',
          message: 'Campaign not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer);

      const normalizedTitle = req.body.title.trim();
      const normalizedSummary = typeof req.body.summary === 'string' ? req.body.summary.trim() || null : null;
      const normalizedNotes = typeof req.body.dm_notes === 'string' ? req.body.dm_notes.trim() || null : null;
      const normalizedScheduledAt = req.body.scheduled_at
        ? new Date(req.body.scheduled_at).toISOString()
        : null;

      const sessionCountResult = await client.query(
        'SELECT COALESCE(MAX(session_number), 0) + 1 AS next_number FROM public.sessions WHERE campaign_id = $1',
        [campaignId],
      );
      const sessionNumber = Number(sessionCountResult.rows[0]?.next_number ?? 1);

      const insertResult = await client.query(
        `INSERT INTO public.sessions (
            campaign_id,
            session_number,
            title,
            summary,
            dm_notes,
            scheduled_at,
            status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
         RETURNING *`,
        [
          campaignId,
          sessionNumber,
          normalizedTitle,
          normalizedSummary,
          normalizedNotes,
          normalizedScheduledAt,
        ],
      );

      await client.query('COMMIT');

      const session = insertResult.rows[0];
      logInfo('Session created', {
        telemetryEvent: 'session.created',
        sessionId: session?.id,
        campaignId,
        userId: req.user.id,
      });

      return res.status(201).json(session);
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Session creation failed', error, { campaignId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'session_create_failed',
        message: error.message || 'Failed to create session',
      });
    } finally {
      client?.release();
    }
  },
);

router.get('/campaigns/:campaignId/sessions', requireAuth, async (req, res) => {
  const { campaignId } = req.params;
  let client;

  try {
    client = await getClient({ label: 'sessions.list' });

    await getViewerContextOrThrow(client, campaignId, req.user);

    const { rows } = await client.query(
      `SELECT s.*,
              COUNT(sp.user_id) AS participant_count
         FROM public.sessions s
         LEFT JOIN public.session_participants sp ON s.id = sp.session_id
        WHERE s.campaign_id = $1
        GROUP BY s.id
        ORDER BY s.session_number DESC`,
      [campaignId],
    );

    return res.json(rows);
  } catch (error) {
    logError('Session listing failed', error, { campaignId, userId: req.user?.id });
    return res.status(error.status || 500).json({
      error: error.code || 'session_list_failed',
      message: error.message || 'Failed to load sessions',
    });
  } finally {
    client?.release();
  }
});

router.put(
  '/sessions/:sessionId',
  requireAuth,
  [
    param('sessionId')
      .isUUID()
      .withMessage('sessionId must be a valid UUID'),
    body('status')
      .optional({ nullable: true })
      .isIn(['scheduled', 'active', 'completed', 'cancelled'])
      .withMessage('status must be scheduled, active, completed, or cancelled'),
    body('started_at')
      .optional({ nullable: true })
      .isISO8601()
      .withMessage('started_at must be an ISO 8601 timestamp'),
    body('ended_at')
      .optional({ nullable: true })
      .isISO8601()
      .withMessage('ended_at must be an ISO 8601 timestamp'),
    body('duration')
      .optional({ nullable: true })
      .isInt({ min: 1 })
      .withMessage('duration must be a positive integer representing minutes'),
    body('experience_awarded')
      .optional({ nullable: true })
      .isInt({ min: 0 })
      .withMessage('experience_awarded must be a non-negative integer'),
    body('summary')
      .optional({ nullable: true })
      .isString()
      .withMessage('summary must be a string'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { sessionId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'sessions.update' });
      await client.query('BEGIN');

      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: true });
      if (!sessionRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'session_not_found',
          message: 'Session not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);
      ensureDmControl(viewer);

      const updates = [];
      const values = [];
      let index = 1;

      if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
        const currentStatus = sessionRow.status;
        const nextStatus = req.body.status ?? currentStatus;

        const allowedTransitions = {
          scheduled: new Set(['scheduled', 'active', 'cancelled']),
          active: new Set(['active', 'completed', 'cancelled']),
          completed: new Set(['completed']),
          cancelled: new Set(['cancelled']),
        };

        if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
          const error = new Error('Status transition is not allowed');
          error.status = 400;
          error.code = 'invalid_status_transition';
          throw error;
        }

        updates.push(`status = $${index++}`);
        values.push(nextStatus);
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'started_at')) {
        const value = req.body.started_at ? new Date(req.body.started_at).toISOString() : null;
        updates.push(`started_at = $${index++}`);
        values.push(value);
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'ended_at')) {
        const value = req.body.ended_at ? new Date(req.body.ended_at).toISOString() : null;
        updates.push(`ended_at = $${index++}`);
        values.push(value);
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'duration')) {
        updates.push(`duration = $${index++}`);
        values.push(req.body.duration ?? null);
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'experience_awarded')) {
        updates.push(`experience_awarded = $${index++}`);
        values.push(req.body.experience_awarded ?? 0);
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'summary')) {
        const normalizedSummary = typeof req.body.summary === 'string' ? req.body.summary.trim() || null : null;
        updates.push(`summary = $${index++}`);
        values.push(normalizedSummary);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'no_updates_provided',
          message: 'Provide at least one session field to update',
        });
      }

      updates.push('updated_at = NOW()');
      const query = `UPDATE public.sessions SET ${updates.join(', ')} WHERE id = $${index} RETURNING *`;
      values.push(sessionId);

      const { rows } = await client.query(query, values);

      const session = rows[0];

      // Auto-initialize game state when session transitions to active
      if (
        sessionRow.status === 'scheduled' &&
        session.status === 'active' &&
        !session.game_state
      ) {
        try {
          const gameState = await initializeGameState(
            client,
            sessionId,
            sessionRow.campaign_id,
            { dmUserId: req.user.id },
          );
          session.game_state = gameState;
        } catch (initError) {
          logError('Game state auto-init failed (non-fatal)', initError, { sessionId });
        }
      }

      await client.query('COMMIT');

      logInfo('Session updated', {
        telemetryEvent: 'session.updated',
        sessionId,
        campaignId: sessionRow.campaign_id,
        userId: req.user.id,
      });

      return res.json(session);
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Session update failed', error, { sessionId, userId: req.user?.id });
      return res.status(error.status || 500).json({
        error: error.code || 'session_update_failed',
        message: error.message || 'Failed to update session',
      });
    } finally {
      client?.release();
    }
  },
);

router.post(
  '/sessions/:sessionId/participants',
  requireAuth,
  [
    param('sessionId')
      .isUUID()
      .withMessage('sessionId must be a valid UUID'),
    body('user_id')
      .isUUID()
      .withMessage('user_id must be a valid UUID'),
    body('character_id')
      .isUUID()
      .withMessage('character_id must be a valid UUID'),
    body('character_level_start')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 20 })
      .withMessage('character_level_start must be an integer between 1 and 20'),
    body('attendance_status')
      .optional({ nullable: true })
      .isIn(['present', 'absent', 'late', 'left_early'])
      .withMessage('attendance_status must be present, absent, late, or left_early'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { sessionId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'sessions.participants.upsert' });
      await client.query('BEGIN');

      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: true });
      if (!sessionRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'session_not_found',
          message: 'Session not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);
      ensureDmControl(viewer);

      const { user_id: participantUserId, character_id: characterId } = req.body;

      const membershipResult = await client.query(
        `SELECT cp.id, cp.user_id, cp.character_id
           FROM public.campaign_players cp
          WHERE cp.campaign_id = $1 AND cp.user_id = $2
          LIMIT 1`,
        [sessionRow.campaign_id, participantUserId],
      );

      if (membershipResult.rowCount === 0) {
        const error = new Error('User is not part of this campaign');
        error.status = 404;
        error.code = 'campaign_player_not_found';
        throw error;
      }

      const characterResult = await client.query(
        'SELECT id, user_id FROM public.characters WHERE id = $1',
        [characterId],
      );

      if (characterResult.rowCount === 0) {
        const error = new Error('Character not found');
        error.status = 404;
        error.code = 'character_not_found';
        throw error;
      }

      if (characterResult.rows[0].user_id !== participantUserId) {
        const error = new Error('Character does not belong to the specified user');
        error.status = 400;
        error.code = 'character_mismatch';
        throw error;
      }

      const attendanceStatus = req.body.attendance_status ?? 'present';
      const levelStart = req.body.character_level_start ?? 1;

      await client.query(
        `INSERT INTO public.session_participants (
            session_id,
            user_id,
            character_id,
            character_level_start,
            character_level_end,
            attendance_status
         ) VALUES ($1, $2, $3, $4, $4, $5)
         ON CONFLICT (session_id, user_id) DO UPDATE SET
           character_id = EXCLUDED.character_id,
           character_level_start = EXCLUDED.character_level_start,
           character_level_end = EXCLUDED.character_level_end,
           attendance_status = EXCLUDED.attendance_status`,
        [sessionId, participantUserId, characterId, levelStart, attendanceStatus],
      );

      await client.query('COMMIT');
      logInfo('Session participant upserted', {
        telemetryEvent: 'session.participant_upserted',
        sessionId,
        campaignId: sessionRow.campaign_id,
        participantUserId,
      });

      return res.json({ success: true });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Session participant upsert failed', error, { sessionId });
      return res.status(error.status || 500).json({
        error: error.code || 'session_participant_failed',
        message: error.message || 'Failed to add or update participant',
      });
    } finally {
      client?.release();
    }
  },
);

router.get('/sessions/:sessionId/participants', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  let client;

  try {
    client = await getClient({ label: 'sessions.participants.list' });

    const sessionRow = await fetchSessionWithCampaign(client, sessionId);
    if (!sessionRow) {
      return res.status(404).json({
        error: 'session_not_found',
        message: 'Session not found',
      });
    }

    await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);

    const { rows } = await client.query(
      `SELECT sp.*, up.username, c.name AS character_name
         FROM public.session_participants sp
         JOIN public.user_profiles up ON sp.user_id = up.id
         LEFT JOIN public.characters c ON sp.character_id = c.id
        WHERE sp.session_id = $1
        ORDER BY up.username`,
      [sessionId],
    );

    return res.json(rows);
  } catch (error) {
    logError('Session participant listing failed', error, { sessionId });
    return res.status(error.status || 500).json({
      error: error.code || 'session_participants_failed',
      message: error.message || 'Failed to fetch session participants',
    });
  } finally {
    client?.release();
  }
});

router.delete(
  '/sessions/:sessionId/participants/:userId',
  requireAuth,
  [
    param('sessionId')
      .isUUID()
      .withMessage('sessionId must be a valid UUID'),
    param('userId')
      .isUUID()
      .withMessage('userId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { sessionId, userId } = req.params;
    let client;

    try {
      client = await getClient({ label: 'sessions.participants.remove' });
      await client.query('BEGIN');

      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: true });
      if (!sessionRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'session_not_found',
          message: 'Session not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);
      ensureDmControl(viewer);

      const deleteResult = await client.query(
        'DELETE FROM public.session_participants WHERE session_id = $1 AND user_id = $2 RETURNING id',
        [sessionId, userId],
      );

      if (deleteResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'participant_not_found',
          message: 'Participant not found for this session',
        });
      }

      await client.query('COMMIT');
      logInfo('Session participant removed', {
        telemetryEvent: 'session.participant_removed',
        sessionId,
        campaignId: sessionRow.campaign_id,
        removedUserId: userId,
      });

      return res.json({ success: true });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Session participant removal failed', error, { sessionId, userId });
      return res.status(error.status || 500).json({
        error: error.code || 'session_participant_remove_failed',
        message: error.message || 'Failed to remove participant',
      });
    } finally {
      client?.release();
    }
  },
);

router.put(
  '/sessions/:sessionId/focus',
  requireAuth,
  [
    param('sessionId')
      .isUUID()
      .withMessage('sessionId must be a valid UUID'),
    body('focus')
      .optional({ nullable: true })
      .custom((value) => value === null || typeof value === 'string')
      .withMessage('focus must be a string or null')
      .custom((value) => {
        if (typeof value === 'string' && value.length > MAX_FOCUS_LENGTH) {
          throw new Error(`focus must be ${MAX_FOCUS_LENGTH} characters or fewer`);
        }
        return true;
      }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { sessionId } = req.params;
    const requested = req.body ?? {};
    let client;

    try {
      client = await getClient({ label: 'sessions.focus.update' });
      await client.query('BEGIN');

      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: true });
      if (!sessionRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'session_not_found',
          message: 'Session not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);
      ensureDmControl(viewer);

      let normalizedFocus = null;
      if (Object.prototype.hasOwnProperty.call(requested, 'focus')) {
        if (typeof requested.focus === 'string') {
          normalizedFocus = sanitizeUserInput(requested.focus, MAX_FOCUS_LENGTH) || null;
        } else if (requested.focus === null) {
          normalizedFocus = null;
        }
      }

      const { rows } = await client.query(
        `UPDATE public.sessions
            SET dm_focus = $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING campaign_id, updated_at`,
        [sessionId, normalizedFocus],
      );

      await client.query('COMMIT');

      const updatedRow = rows[0] ?? null;
      const campaignId = sessionRow.campaign_id;
      const updatedAtIso = updatedRow?.updated_at
        ? new Date(updatedRow.updated_at).toISOString()
        : new Date().toISOString();

      incrementCounter('sessions.focus_updated');
      recordEvent('session.focus_updated', {
        sessionId,
        campaignId,
        userId: req.user.id,
        hasFocus: Boolean(normalizedFocus),
      });
      logInfo('Session focus updated', {
        telemetryEvent: 'session.focus_updated',
        sessionId,
        campaignId,
        userId: req.user.id,
      });

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitSessionFocusUpdated(campaignId, {
          sessionId,
          dmFocus: normalizedFocus,
          actorId: req.user.id,
          updatedAt: updatedAtIso,
        });
      }

      return res.json({ sessionId, dmFocus: normalizedFocus });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Session focus update failed', error, { sessionId });
      return res.status(error.status || 500).json({
        error: error.code || 'session_focus_update_failed',
        message: error.message || 'Failed to update session focus',
      });
    } finally {
      client?.release();
    }
  },
);

router.put(
  '/sessions/:sessionId/context',
  requireAuth,
  [
    param('sessionId')
      .isUUID()
      .withMessage('sessionId must be a valid UUID'),
    body('context_md')
      .optional({ nullable: true })
      .custom((value) => value === null || typeof value === 'string')
      .withMessage('context_md must be a string or null')
      .custom((value) => {
        if (typeof value === 'string' && value.length > MAX_CONTEXT_LENGTH) {
          throw new Error(`context_md must be ${MAX_CONTEXT_LENGTH} characters or fewer`);
        }
        return true;
      }),
    body('mode')
      .optional({ checkFalsy: true })
      .isString()
      .withMessage('mode must be a string when provided')
      .custom((value) => ['append', 'replace'].includes(value.trim().toLowerCase()))
      .withMessage('mode must be one of append or replace'),
    body('append')
      .optional()
      .isBoolean()
      .withMessage('append must be a boolean when provided'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { sessionId } = req.params;
    const bodyPayload = req.body ?? {};
    let client;

    try {
      client = await getClient({ label: 'sessions.context.update' });
      await client.query('BEGIN');

      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: true });
      if (!sessionRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'session_not_found',
          message: 'Session not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);
      ensureDmControl(viewer);

      const requestedMode = typeof bodyPayload.mode === 'string'
        ? bodyPayload.mode.trim().toLowerCase()
        : bodyPayload.append === true
          ? 'append'
          : 'replace';
      const mode = requestedMode === 'append' ? 'append' : 'replace';

      const contextSource = Object.prototype.hasOwnProperty.call(bodyPayload, 'context_md')
        ? bodyPayload.context_md
        : Object.prototype.hasOwnProperty.call(bodyPayload, 'contextMd')
          ? bodyPayload.contextMd
          : bodyPayload.context;

      const normalizeMarkdown = (value) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value);
      const incomingContext = normalizeMarkdown(contextSource);

      let nextContext = null;

      if (mode === 'append') {
        if (typeof incomingContext !== 'string' || incomingContext.trim().length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'context_append_invalid',
            message: 'context_md must be a non-empty string when appending.',
          });
        }
        const existing = normalizeMarkdown(sessionRow.dm_context_md ?? '') || '';
        const combined = existing.trim().length > 0
          ? `${existing.replace(/[\s]+$/, '')}\n\n${incomingContext}`
          : incomingContext;
        if (combined.length > MAX_CONTEXT_LENGTH) {
          await client.query('ROLLBACK');
          return res.status(422).json({
            error: 'context_too_long',
            message: `Resulting context exceeds ${MAX_CONTEXT_LENGTH} characters. Reduce the appended content.`,
          });
        }
        nextContext = combined;
      } else {
        if (typeof incomingContext === 'string') {
          nextContext = incomingContext;
        } else if (
          incomingContext === null
          || Object.prototype.hasOwnProperty.call(bodyPayload, 'context_md')
          || Object.prototype.hasOwnProperty.call(bodyPayload, 'contextMd')
          || Object.prototype.hasOwnProperty.call(bodyPayload, 'context')
        ) {
          nextContext = null;
        } else {
          nextContext = sessionRow.dm_context_md;
        }
      }

      const { rows } = await client.query(
        `UPDATE public.sessions
            SET dm_context_md = $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING campaign_id, updated_at`,
        [sessionId, nextContext],
      );

      await client.query('COMMIT');

      const updatedRow = rows[0] ?? null;
      const campaignId = sessionRow.campaign_id;
      const updatedAtIso = updatedRow?.updated_at
        ? new Date(updatedRow.updated_at).toISOString()
        : new Date().toISOString();
      const contextLength = typeof nextContext === 'string' ? nextContext.length : 0;

      incrementCounter('sessions.context_updated');
      recordEvent('session.context_updated', {
        sessionId,
        campaignId,
        userId: req.user.id,
        mode,
        hasContext: Boolean(nextContext),
        contextLength,
      });
      logInfo('Session context updated', {
        telemetryEvent: 'session.context_updated',
        sessionId,
        campaignId,
        userId: req.user.id,
        mode,
        contextLength,
      });

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitSessionContextUpdated(campaignId, {
          sessionId,
          mode,
          hasContext: Boolean(nextContext && nextContext.length > 0),
          contextLength,
          actorId: req.user.id,
          updatedAt: updatedAtIso,
        });
      }

      return res.json({ sessionId, mode, dmContextMd: nextContext });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Session context update failed', error, { sessionId });
      return res.status(error.status || 500).json({
        error: error.code || 'session_context_update_failed',
        message: error.message || 'Failed to update session context',
      });
    } finally {
      client?.release();
    }
  },
);

router.post(
  '/sessions/:sessionId/unplanned-encounter',
  requireAuth,
  [
    param('sessionId')
      .isUUID()
      .withMessage('sessionId must be a valid UUID'),
    body('type')
      .isString()
      .withMessage('type is required')
      .custom((value) => Boolean(normalizeEncounterType(value)))
      .withMessage(`type must be one of: ${Array.from(ENCOUNTER_TYPES).join(', ')}`),
    body('seed')
      .isString()
      .withMessage('seed is required')
      .isLength({ min: 1, max: 4000 })
      .withMessage('seed must be between 1 and 4000 characters'),
    body('difficulty')
      .optional({ checkFalsy: true })
      .isString()
      .withMessage('difficulty must be a string when provided')
      .custom((value) => Boolean(normalizeEncounterDifficulty(value)))
      .withMessage(`difficulty must be one of: ${Array.from(SIDEBAR_ENCOUNTER_DIFFICULTIES).join(', ')}`),
    body('locationId')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('locationId must be a valid UUID when provided'),
    body('location_id')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('location_id must be a valid UUID when provided'),
    body('llm')
      .optional()
      .isBoolean()
      .withMessage('llm must be a boolean when provided'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { sessionId } = req.params;
    const payload = req.body ?? {};
    let client;

    try {
      client = await getClient({ label: 'sessions.encounters.unplanned' });
      await client.query('BEGIN');

      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: false });
      if (!sessionRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'session_not_found',
          message: 'Session not found',
        });
      }

      const viewer = await getViewerContextOrThrow(client, sessionRow.campaign_id, req.user);
      ensureDmControl(viewer);

      if (payload.llm === true) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'llm_generation_unavailable',
          message: 'LLM-assisted synthesis is not available for unplanned encounters. Provide manual details instead.',
        });
      }

      const type = normalizeEncounterType(payload.type);
      const difficulty = normalizeEncounterDifficulty(payload.difficulty) || DEFAULT_ENCOUNTER_DIFFICULTY;
      const locationId = payload.locationId || payload.location_id || null;

      if (locationId) {
        const { rowCount } = await client.query(
          'SELECT 1 FROM public.locations WHERE id = $1 AND campaign_id = $2',
          [locationId, sessionRow.campaign_id],
        );
        if (rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'location_not_found',
            message: 'The specified location does not belong to this campaign.',
          });
        }
      }

      const seed = typeof payload.seed === 'string' ? payload.seed.trim() : '';
      if (seed.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'seed_required',
          message: 'seed is required to describe the unplanned encounter.',
        });
      }

      const encounterName = sanitizeUserInput(seed, 120) || 'Unplanned Encounter';

      const { rows } = await client.query(
        `INSERT INTO public.encounters (
            campaign_id,
            session_id,
            location_id,
            name,
            description,
            type,
            difficulty,
            status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         RETURNING id, campaign_id, session_id, location_id, name, description, type, difficulty, status, created_at, updated_at`,
        [
          sessionRow.campaign_id,
          sessionId,
          locationId,
          encounterName,
          seed,
          type,
          difficulty,
        ],
      );

      await client.query('COMMIT');

      const encounter = rows[0];
      logInfo('Unplanned encounter created', {
        telemetryEvent: 'encounter.unplanned_created',
        encounterId: encounter.id,
        sessionId,
        campaignId: sessionRow.campaign_id,
        userId: req.user.id,
        type,
        difficulty,
      });

      incrementCounter('encounters.unplanned_created');
      recordEvent('encounter.unplanned_created', {
        encounterId: encounter.id,
        sessionId,
        campaignId: sessionRow.campaign_id,
        userId: req.user.id,
        type,
        difficulty,
      });

      const wsServer = req.app.locals?.wsServer;
      if (wsServer) {
        wsServer.emitUnplannedEncounterCreated(sessionRow.campaign_id, encounter, {
          actorId: req.user.id,
        });
      }

      return res.status(201).json({ encounter });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      logError('Unplanned encounter creation failed', error, { sessionId });
      return res.status(error.status || 500).json({
        error: error.code || 'unplanned_encounter_failed',
        message: error.message || 'Failed to create unplanned encounter',
      });
    } finally {
      client?.release();
    }
  },
);

export const registerSessionRoutes = (app) => {
  app.use('/api', router);
};

