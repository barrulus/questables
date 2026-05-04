/**
 * Action routes — player action submission, roll results, and live state management.
 */

import { Router } from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import { handleValidationErrors } from '../validation/common.js';
import {
  getViewerContextOrThrow,
} from '../services/campaigns/service.js';
import { getActiveSession, getCampaignPlayerCharacterId, userOwnsCharacterInCampaign } from '../services/sessions/service.js';
import {
  buildActionContext,
  invokeDmForAction,
  invokeDmForSocialAction,
  applyMechanicalOutcome,
} from '../services/dm-action/service.js';
import {
  getAllLiveStates,
  patchLiveState,
} from '../services/live-state/service.js';
import { writeNpcMemoryInternal } from '../services/npcs/service.js';
import { consumeAction } from '../services/combat/service.js';
import { logError, logInfo } from '../utils/logger.js';
import { postNarrationToChat, postPrivateNarration } from '../services/chat/dm-narrator.js';
import { endTurn, getGameState } from '../services/game-state/service.js';
import { fireWorldTurnIfPending } from '../services/narration/proactive-narrator.js';

const router = Router();

const VALID_ACTION_TYPES = new Set([
  'move', 'interact', 'search', 'use_item', 'cast_spell',
  'talk_to_npc', 'pass', 'free_action',
  'attack', 'dash', 'dodge', 'disengage', 'help', 'hide', 'ready',
]);

// ── POST /api/campaigns/:id/actions ─────────────────────────────────────
// Submit an action for DM resolution

router.post(
  '/api/campaigns/:campaignId/actions',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('actionType').isString().custom((val) => VALID_ACTION_TYPES.has(val)),
    body('actionPayload').optional().isObject(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { actionType, actionPayload = {} } = req.body;
    const client = await getClient({ label: 'actions.submit' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      // Get active session
      const session = await getActiveSession(client, campaignId);
      if (!session) {
        const err = new Error('No active session');
        err.status = 400;
        err.code = 'no_active_session';
        throw err;
      }
      const gameState = session.game_state;

      // Validate turn ownership (DM can bypass)
      // Social phase allows any player to act for dialogue actions
      const socialBypass = gameState?.phase === 'social' &&
        ['talk_to_npc', 'pass', 'free_action'].includes(actionType);
      if (
        !socialBypass &&
        viewer.role !== 'dm' && viewer.role !== 'co-dm' && !viewer.isAdmin &&
        gameState?.activePlayerId && gameState.activePlayerId !== req.user.id
      ) {
        const err = new Error('It is not your turn');
        err.status = 403;
        err.code = 'not_your_turn';
        throw err;
      }

      // Validate phase allows actions (rest phase does not)
      if (gameState?.phase === 'rest') {
        const err = new Error('Actions are not allowed during rest phase');
        err.status = 400;
        err.code = 'rest_phase_no_actions';
        throw err;
      }

      // In combat phase, validate action against turn budget
      let updatedBudget = null;
      if (gameState?.phase === 'combat' && gameState.combatTurnBudget) {
        updatedBudget = consumeAction(gameState.combatTurnBudget, actionType);
      }

      // Get the player's character
      const characterId = await getCampaignPlayerCharacterId(client, campaignId, req.user.id);
      if (!characterId) {
        const err = new Error('No active character in this campaign');
        err.status = 400;
        err.code = 'no_active_character';
        throw err;
      }

      // Look up campaign_players.id for the player_id FK on session_player_actions.
      // The table has both user_id and player_id NOT NULL — the latter references
      // campaign_players(id), not user_profiles(id).
      const { rows: cpRows } = await client.query(
        `SELECT id FROM public.campaign_players
          WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'
          LIMIT 1`,
        [campaignId, req.user.id],
      );
      const campaignPlayerId = cpRows[0]?.id ?? null;
      if (!campaignPlayerId) {
        const err = new Error('Player is not enrolled in this campaign');
        err.status = 400;
        err.code = 'not_enrolled';
        throw err;
      }

      // Insert the action
      const { rows: actionRows } = await client.query(
        `INSERT INTO public.session_player_actions
          (session_id, campaign_id, player_id, user_id, character_id, round_number, action_type, action_payload, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing')
         RETURNING id, status, created_at`,
        [
          session.id,
          campaignId,
          campaignPlayerId,
          req.user.id,
          characterId,
          gameState?.roundNumber ?? 1,
          actionType,
          JSON.stringify(actionPayload),
        ],
      );

      const action = actionRows[0];

      // Update combat budget in game state if applicable
      if (updatedBudget && gameState?.phase === 'combat') {
        await client.query(
          `UPDATE public.sessions
              SET game_state = jsonb_set(game_state, '{combatTurnBudget}', $2::jsonb)
            WHERE id = $1`,
          [session.id, JSON.stringify(updatedBudget)],
        );
      }

      await client.query('COMMIT');

      // Emit budget change via WebSocket
      if (updatedBudget) {
        const wsServer = req.app?.locals?.wsServer;
        if (wsServer) {
          wsServer.emitCombatBudgetChanged(campaignId, req.user.id, {
            sessionId: session.id,
            combatTurnBudget: updatedBudget,
          });
        }
      }

      // Return immediately — LLM processing happens async
      res.status(202).json({
        actionId: action.id,
        status: 'processing',
        createdAt: action.created_at,
      });

      // ── Async LLM processing ──────────────────────────────────────────
      const wsServer = req.app?.locals?.wsServer;
      const contextualService = req.app?.locals?.contextualLLMService;

      if (!contextualService) {
        logError('Contextual LLM service not available for action processing', null, {
          actionId: action.id,
        });
        return;
      }

      try {
        const asyncClient = await getClient({ label: 'actions.async-resolve' });
        try {
          await asyncClient.query('BEGIN');

          const actionContext = await buildActionContext(asyncClient, {
            campaignId,
            sessionId: session.id,
            actingUserId: req.user.id,
            characterId,
            actionType,
            actionPayload,
            gameState,
          });

          // Use social prompt for social phase dialogue actions
          const isSocialDialogue = gameState?.phase === 'social' &&
            actionType === 'talk_to_npc' && actionContext.npcContext;

          const dmResponse = isSocialDialogue
            ? await invokeDmForSocialAction(contextualService, {
                campaignId,
                sessionId: session.id,
                actionContext,
              })
            : await invokeDmForAction(contextualService, {
                campaignId,
                sessionId: session.id,
                actionContext,
              });

          // Check if rolls are required
          const needsRoll = Array.isArray(dmResponse.requiredRolls) && dmResponse.requiredRolls.length > 0;
          const finalStatus = needsRoll ? 'awaiting_roll' : 'resolved';

          // Apply mechanical outcomes if no roll needed
          let movementOccurred = false;
          if (!needsRoll && dmResponse.mechanicalOutcome) {
            await applyMechanicalOutcome(asyncClient, {
              sessionId: session.id,
              mechanicalOutcome: dmResponse.mechanicalOutcome,
              actingCharacterId: characterId,
              wsServer: req.app?.locals?.wsServer ?? null,
            });
            if (dmResponse.mechanicalOutcome.type === 'move_player') {
              movementOccurred = true;
            }
          }

          // Auto-write NPC memory after social dialogue
          if (isSocialDialogue && dmResponse.npcSentimentUpdate && finalStatus === 'resolved') {
            try {
              await writeNpcMemoryInternal(asyncClient, {
                npcId: actionPayload.npcId,
                campaignId,
                sessionId: session.id,
                summary: dmResponse.npcSentimentUpdate.memorySummary ?? 'Conversation occurred.',
                sentiment: dmResponse.npcSentimentUpdate.sentiment ?? 'neutral',
                trustDelta: dmResponse.npcSentimentUpdate.trustDelta ?? 0,
                tags: dmResponse.npcSentimentUpdate.tags ?? [],
                characterId,
              });
            } catch (memError) {
              logError('Failed to write NPC memory after social dialogue', memError, {
                actionId: action.id, npcId: actionPayload.npcId,
              });
            }
          }

          // Update the action record
          await asyncClient.query(
            `UPDATE public.session_player_actions
                SET dm_response = $2, status = $3, resolved_at = CASE WHEN $3 = 'resolved' THEN NOW() ELSE NULL END
              WHERE id = $1`,
            [action.id, JSON.stringify(dmResponse), finalStatus],
          );

          await asyncClient.query('COMMIT');

          // Bust LLM narration cache if a movement landed during this action.
          if (movementOccurred) {
            try {
              req.app?.locals?.llmService?.clearCacheForCampaign?.(campaignId);
            } catch (cacheErr) {
              logError('Failed to clear LLM cache after action movement (non-fatal)', cacheErr);
            }
          }

          // Persist narration to Adventure chat channel + broadcast via WebSocket
          if (dmResponse.narration) {
            postNarrationToChat({
              campaignId,
              content: dmResponse.narration,
              messageType: 'action_result',
              sessionId: session.id,
              wsServer,
            }).catch((err) => logError('Failed to post narration to chat', { error: err.message }));
          }
          if (dmResponse.privateMessage) {
            postPrivateNarration({
              campaignId,
              targetUserId: req.user.id,
              content: dmResponse.privateMessage,
              messageType: 'narration',
              sessionId: session.id,
              wsServer,
            }).catch((err) => logError('Failed to post private narration', { error: err.message }));
          }

          // Broadcast results via WebSocket (legacy action events — keep for action panel)
          if (wsServer) {

            // Roll request to the acting player
            if (needsRoll) {
              wsServer.emitRollRequested(campaignId, req.user.id, {
                actionId: action.id,
                requiredRolls: dmResponse.requiredRolls,
              });
            }

            // Action completed broadcast
            if (finalStatus === 'resolved') {
              wsServer.emitActionCompleted(campaignId, {
                actionId: action.id,
                characterId,
                actionType,
                outcome: dmResponse,
              });

              // Broadcast live state changes if any
              if (dmResponse.mechanicalOutcome) {
                const updatedStates = await getAllLiveStates(asyncClient, { sessionId: session.id });
                wsServer.emitLiveStateChanged(campaignId, {
                  sessionId: session.id,
                  liveStates: updatedStates,
                  reason: `action: ${actionType}`,
                });
              }
            }
          }

          // Auto-advance the turn after a fully-resolved action panel
          // submission in exploration / social phases. Combat keeps manual
          // End-Turn so players can use action + bonus action + movement.
          // Mirrors the chat-interceptor and roll-result paths.
          if (finalStatus === 'resolved'
              && (gameState?.phase === 'exploration' || gameState?.phase === 'social')) {
            try {
              const advanceResult = await endTurn(asyncClient, session.id, { actorId: req.user.id });
              if (wsServer && advanceResult?.newState) {
                wsServer.emitTurnAdvanced(campaignId, {
                  sessionId: session.id,
                  gameState: advanceResult.newState,
                });
              }
              fireWorldTurnIfPending({
                campaignId,
                sessionId: session.id,
                newState: advanceResult?.newState,
                actorId: req.user.id,
                contextualService,
                wsServer,
              });
            } catch (advanceError) {
              logError('Auto-advance after action panel submission failed (non-fatal)', {
                actionId: action.id,
                error: advanceError.message,
              });
            }
          }

          logInfo('Action resolved', {
            telemetryEvent: 'action.resolved',
            actionId: action.id,
            campaignId,
            status: finalStatus,
          });
        } catch (asyncError) {
          await asyncClient.query('ROLLBACK').catch(() => {});

          // Mark the action as failed
          await asyncClient.query(
            `UPDATE public.session_player_actions SET status = 'failed' WHERE id = $1`,
            [action.id],
          ).catch(() => {});

          logError('Async action resolution failed', asyncError, {
            actionId: action.id,
            campaignId,
          });
        } finally {
          asyncClient.release();
        }
      } catch (poolError) {
        logError('Failed to acquire client for async action resolution', poolError, {
          actionId: action.id,
        });
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Action submission failed', error, { campaignId, userId: req.user?.id });
      res.status(error.status || 500).json({
        error: error.code || 'action_submit_failed',
        message: error.message || 'Failed to submit action',
      });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/actions/:actionId/roll-result ───────────────
// Submit a roll result for an awaiting_roll action

router.post(
  '/api/campaigns/:campaignId/actions/:actionId/roll-result',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('actionId').isUUID(),
    body('rollResult').isObject(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, actionId } = req.params;
    const { rollResult } = req.body;
    const client = await getClient({ label: 'actions.roll-result' });

    try {
      await client.query('BEGIN');

      // Validate the action exists and is awaiting_roll
      const { rows: actionRows } = await client.query(
        `SELECT * FROM public.session_player_actions
          WHERE id = $1 AND campaign_id = $2 AND status = 'awaiting_roll'
          FOR UPDATE`,
        [actionId, campaignId],
      );

      if (actionRows.length === 0) {
        const err = new Error('Action not found or not awaiting a roll');
        err.status = 404;
        err.code = 'action_not_found';
        throw err;
      }

      const action = actionRows[0];

      // Validate the requesting user owns this action
      if (action.user_id !== req.user.id) {
        const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
        if (viewer.role !== 'dm' && viewer.role !== 'co-dm' && !viewer.isAdmin) {
          const err = new Error('Only the action owner or DM can submit roll results');
          err.status = 403;
          err.code = 'roll_forbidden';
          throw err;
        }
      }

      // Store the roll result and mark the action resolved. The valid status
      // values for session_player_actions are pending|awaiting_roll|resolved|cancelled
      // (see database/migrations/001_llm_dm_pivot.sql) — there is no intermediate
      // 'processing' state. The async LLM resolution below appends dm_response
      // without further status changes.
      await client.query(
        `UPDATE public.session_player_actions
            SET roll_result = $2, status = 'resolved', resolved_at = NOW()
          WHERE id = $1`,
        [actionId, JSON.stringify(rollResult)],
      );

      await client.query('COMMIT');

      res.json({ actionId, status: 'resolved' });

      // ── Async: re-invoke LLM with roll result ──────────────────────────
      const wsServer = req.app?.locals?.wsServer;
      const contextualService = req.app?.locals?.contextualLLMService;

      if (!contextualService) return;

      try {
        const asyncClient = await getClient({ label: 'actions.roll-resolve' });
        try {
          await asyncClient.query('BEGIN');

          const actionContext = await buildActionContext(asyncClient, {
            campaignId,
            sessionId: action.session_id,
            actingUserId: action.user_id,
            characterId: action.character_id,
            actionType: action.action_type,
            actionPayload: action.action_payload,
            gameState: null,
          });

          // Enrich rollResult with the DC from the previous DM response so the
          // post-roll prompt can compute success/failure. The frontend submits
          // only total/natural/modifier/skill — the DC was set by the DM in the
          // first invocation and lives in action.dm_response.requiredRolls.
          let dcFromPrevious = null;
          let skillFromPrevious = null;
          let abilityFromPrevious = null;
          try {
            const prev = typeof action.dm_response === 'string'
              ? JSON.parse(action.dm_response)
              : action.dm_response;
            const reqRolls = Array.isArray(prev?.requiredRolls) ? prev.requiredRolls : [];
            // Match by skill/ability if present, otherwise take the first roll.
            const match = reqRolls.find((r) =>
              (rollResult.skill && r.skill && r.skill === rollResult.skill) ||
              (rollResult.ability && r.ability && r.ability === rollResult.ability),
            ) ?? reqRolls[0] ?? null;
            if (match) {
              dcFromPrevious = typeof match.dc === 'number' ? match.dc : null;
              skillFromPrevious = match.skill ?? null;
              abilityFromPrevious = match.ability ?? null;
            }
          } catch { /* leave dc null */ }

          const enrichedRollResult = {
            ...rollResult,
            dc: rollResult.dc ?? dcFromPrevious,
            skill: rollResult.skill ?? skillFromPrevious,
            ability: rollResult.ability ?? abilityFromPrevious,
          };

          const dmResponse = await invokeDmForAction(contextualService, {
            campaignId,
            sessionId: action.session_id,
            actionContext,
            rollResult: enrichedRollResult,
          });

          // Apply outcomes
          let movementOccurred = false;
          if (dmResponse.mechanicalOutcome) {
            await applyMechanicalOutcome(asyncClient, {
              sessionId: action.session_id,
              mechanicalOutcome: dmResponse.mechanicalOutcome,
              actingCharacterId: action.character_id,
              wsServer: req.app?.locals?.wsServer ?? null,
            });
            if (dmResponse.mechanicalOutcome.type === 'move_player') {
              movementOccurred = true;
            }
          }

          // Append the DM response. Status was already set to 'resolved' in the
          // synchronous handler above; we only need to attach dm_response here.
          await asyncClient.query(
            `UPDATE public.session_player_actions
                SET dm_response = $2
              WHERE id = $1`,
            [actionId, JSON.stringify(dmResponse)],
          );

          await asyncClient.query('COMMIT');

          // Bust LLM narration cache if a movement landed during this roll resolution.
          if (movementOccurred) {
            try {
              req.app?.locals?.llmService?.clearCacheForCampaign?.(campaignId);
            } catch (cacheErr) {
              logError('Failed to clear LLM cache after roll-result movement (non-fatal)', cacheErr);
            }
          }

          // Persist narration to Adventure chat channel
          if (dmResponse.narration) {
            postNarrationToChat({
              campaignId,
              content: dmResponse.narration,
              messageType: 'action_result',
              sessionId: action.session_id,
              wsServer,
            }).catch((err) => logError('Failed to post roll-result narration to chat', { error: err.message }));
          }

          // Broadcast legacy action events
          if (wsServer) {
            wsServer.emitActionCompleted(campaignId, {
              actionId,
              characterId: action.character_id,
              actionType: action.action_type,
              outcome: dmResponse,
            });

            if (dmResponse.mechanicalOutcome) {
              const updatedStates = await getAllLiveStates(asyncClient, { sessionId: action.session_id });
              wsServer.emitLiveStateChanged(campaignId, {
                sessionId: action.session_id,
                liveStates: updatedStates,
                reason: `roll resolved: ${action.action_type}`,
              });
            }
          }

          // Auto-advance the turn after a roll-resolved action in
          // exploration/social phases. Combat keeps manual End-Turn so the
          // player can use their full action budget.
          try {
            const gs = await getGameState(asyncClient, action.session_id);
            if (gs && (gs.phase === 'exploration' || gs.phase === 'social')) {
              const advanceResult = await endTurn(asyncClient, action.session_id, { actorId: action.user_id });
              if (wsServer && advanceResult?.newState) {
                wsServer.emitTurnAdvanced(campaignId, {
                  sessionId: action.session_id,
                  gameState: advanceResult.newState,
                });
              }
              fireWorldTurnIfPending({
                campaignId,
                sessionId: action.session_id,
                newState: advanceResult?.newState,
                actorId: action.user_id,
                contextualService,
                wsServer,
              });
            }
          } catch (advanceError) {
            logError('Auto-advance after roll resolution failed (non-fatal)', {
              actionId,
              error: advanceError.message,
            });
          }
        } catch (asyncError) {
          await asyncClient.query('ROLLBACK').catch(() => {});
          await asyncClient.query(
            `UPDATE public.session_player_actions SET status = 'failed' WHERE id = $1`,
            [actionId],
          ).catch(() => {});
          logError('Roll result resolution failed', asyncError, { actionId });
        } finally {
          asyncClient.release();
        }
      } catch (poolError) {
        logError('Failed to acquire client for roll resolution', poolError, { actionId });
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Roll result submission failed', error, { actionId });
      res.status(error.status || 500).json({
        error: error.code || 'roll_submit_failed',
        message: error.message || 'Failed to submit roll result',
      });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:id/actions ──────────────────────────────────────
// List actions for a session/round

router.get(
  '/api/campaigns/:campaignId/actions',
  requireAuth,
  [
    param('campaignId').isUUID(),
    queryValidator('sessionId').optional().isUUID(),
    queryValidator('roundNumber').optional().isInt({ min: 1 }),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'actions.list' });

    try {
      await getViewerContextOrThrow(client, campaignId, req.user);

      const conditions = ['spa.campaign_id = $1'];
      const values = [campaignId];
      let idx = 2;

      if (req.query.sessionId) {
        conditions.push(`spa.session_id = $${idx++}`);
        values.push(req.query.sessionId);
      }

      if (req.query.roundNumber) {
        conditions.push(`spa.round_number = $${idx++}`);
        values.push(parseInt(req.query.roundNumber, 10));
      }

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
      values.push(limit);

      const { rows } = await client.query(
        `SELECT spa.*, c.name AS character_name, up.username
           FROM public.session_player_actions spa
           JOIN public.characters c ON c.id = spa.character_id
           JOIN public.user_profiles up ON up.id = spa.user_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY spa.created_at DESC
          LIMIT $${idx}`,
        values,
      );

      res.json(rows);
    } catch (error) {
      logError('Action list failed', error, { campaignId });
      res.status(error.status || 500).json({
        error: error.code || 'actions_list_failed',
        message: error.message || 'Failed to list actions',
      });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:id/live-states ──────────────────────────────────
// Get all live states for the active session

router.get(
  '/api/campaigns/:campaignId/live-states',
  requireAuth,
  [param('campaignId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'live-states.list' });

    try {
      await getViewerContextOrThrow(client, campaignId, req.user);

      // Get active session
      const { rows: sessionRows } = await client.query(
        `SELECT id FROM public.sessions
          WHERE campaign_id = $1 AND status = 'active'
          ORDER BY session_number DESC LIMIT 1`,
        [campaignId],
      );

      if (sessionRows.length === 0) {
        return res.json([]);
      }

      const states = await getAllLiveStates(client, { sessionId: sessionRows[0].id });
      res.json(states);
    } catch (error) {
      logError('Live states list failed', error, { campaignId });
      res.status(error.status || 500).json({
        error: error.code || 'live_states_failed',
        message: error.message || 'Failed to list live states',
      });
    } finally {
      client.release();
    }
  },
);

// ── PATCH /api/campaigns/:id/live-state ─────────────────────────────────
// Patch a character's live state (DM can patch any, player can patch own)

router.patch(
  '/api/campaigns/:campaignId/live-state',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('characterId').isUUID(),
    body('changes').isObject(),
    body('reason').optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { characterId, changes, reason } = req.body;
    const client = await getClient({ label: 'live-state.patch' });

    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      // DM/co-dm/admin can patch anyone; players can only patch their own character
      if (viewer.role !== 'dm' && viewer.role !== 'co-dm' && !viewer.isAdmin) {
        const owns = await userOwnsCharacterInCampaign(client, campaignId, req.user.id, characterId);
        if (!owns) {
          const err = new Error('You can only modify your own character live state');
          err.status = 403;
          err.code = 'live_state_forbidden';
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

      if (sessionRows.length === 0) {
        const err = new Error('No active session');
        err.status = 400;
        err.code = 'no_active_session';
        throw err;
      }

      const updated = await patchLiveState(client, {
        sessionId: sessionRows[0].id,
        characterId,
        changes,
        reason: reason ?? 'manual patch',
        actorId: req.user.id,
      });

      await client.query('COMMIT');

      // Broadcast the change
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer) {
        const allStates = await getAllLiveStates(client, { sessionId: sessionRows[0].id });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId: sessionRows[0].id,
          liveStates: allStates,
          reason: reason ?? 'manual patch',
        });
      }

      res.json(updated);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Live state patch failed', error, { campaignId, characterId });
      res.status(error.status || 500).json({
        error: error.code || 'live_state_patch_failed',
        message: error.message || 'Failed to patch live state',
      });
    } finally {
      client.release();
    }
  },
);

// ── Export ───────────────────────────────────────────────────────────────

export function registerActionRoutes(app) {
  app.use(router);
}

export default registerActionRoutes;
