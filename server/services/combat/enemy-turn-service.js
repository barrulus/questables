/**
 * Enemy turn service — LLM-controlled NPC/enemy actions during combat.
 *
 * When the turn advances to an NPC participant, this service:
 * 1. Loads the enemy stat block and combat context
 * 2. Calls the LLM to decide the enemy's action
 * 3. Applies mechanical outcomes (damage, conditions, etc.)
 * 4. Broadcasts narration and auto-advances the turn
 */

import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { buildEnemyTurnPrompt } from '../../llm/context/action-prompt-builder.js';
import { applyMechanicalOutcome } from '../dm-action/service.js';
import { endTurn } from '../game-state/service.js';
import { getAllLiveStates } from '../live-state/service.js';
import { getClient } from '../../db/pool.js';

/**
 * Execute an enemy's combat turn via LLM.
 *
 * @param {object} contextualService — the contextual LLM service
 * @param {import('pg').Pool|null} pool — DB pool (unused; we use getClient)
 * @param {{ campaignId: string, sessionId: string, encounterId: string, participantId: string, wsServer: object }} opts
 */
export const executeEnemyTurn = async (contextualService, _pool, {
  campaignId,
  sessionId,
  encounterId,
  participantId,
  wsServer,
}) => {
  const client = await getClient({ label: 'enemy-turn' });

  try {
    await client.query('BEGIN');

    // Load enemy participant
    const { rows: participantRows } = await client.query(
      `SELECT ep.*, n.personality, n.occupation, n.description AS npc_description
         FROM public.encounter_participants ep
         LEFT JOIN public.npcs n ON n.id = ep.participant_id
        WHERE ep.id = $1 AND ep.encounter_id = $2`,
      [participantId, encounterId],
    );

    const enemy = participantRows[0];
    if (!enemy) {
      logError('Enemy participant not found', null, { participantId, encounterId });
      await client.query('ROLLBACK');
      return;
    }

    // Load all combatants for context
    const { rows: allCombatants } = await client.query(
      `SELECT ep.id, ep.name, ep.participant_type, ep.user_id,
              ep.hit_points, ep.armor_class, ep.conditions, ep.initiative
         FROM public.encounter_participants ep
        WHERE ep.encounter_id = $1
        ORDER BY ep.initiative DESC NULLS LAST`,
      [encounterId],
    );

    // Load PC live states for more detail
    const liveStates = await getAllLiveStates(client, { sessionId });

    // Build prompt
    const prompt = buildEnemyTurnPrompt({
      enemy,
      allCombatants,
      liveStates,
    });

    // Call LLM
    let dmResponse;
    try {
      const { result } = await contextualService.generateFromContext({
        campaignId,
        sessionId,
        type: NARRATIVE_TYPES.ENEMY_COMBAT_TURN,
        metadata: { enemyName: enemy.name, participantId },
        request: { extraSections: prompt },
      });

      dmResponse = result.parsed;
      if (!dmResponse && result.content) {
        try {
          dmResponse = JSON.parse(result.content);
        } catch {
          dmResponse = { narration: result.content };
        }
      }
    } catch (llmError) {
      logError('Enemy turn LLM failed', llmError, { participantId });
      dmResponse = {
        narration: `${enemy.name} hesitates, uncertain of their next move.`,
      };
    }

    if (!dmResponse) {
      dmResponse = { narration: `${enemy.name} takes a defensive stance.` };
    }

    // Apply mechanical outcomes
    if (dmResponse.mechanicalOutcome) {
      await applyMechanicalOutcome(client, {
        sessionId,
        mechanicalOutcome: dmResponse.mechanicalOutcome,
        actingCharacterId: enemy.participant_id,
      });
    }

    await client.query('COMMIT');

    // Broadcast narration
    if (wsServer) {
      if (dmResponse.narration) {
        wsServer.emitDmNarration(campaignId, {
          actionId: null,
          narration: dmResponse.narration,
          characterId: enemy.participant_id,
          actionType: 'enemy_action',
        });
      }

      wsServer.emitEnemyTurnCompleted(campaignId, {
        sessionId,
        participantId,
        enemyName: enemy.name,
        outcome: dmResponse,
      });

      // Broadcast live state changes
      if (dmResponse.mechanicalOutcome) {
        const updatedStates = await getAllLiveStates(client, { sessionId });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId,
          liveStates: updatedStates,
          reason: `enemy action: ${enemy.name}`,
        });
      }
    }

    logInfo('Enemy turn completed', {
      telemetryEvent: 'combat.enemy_turn',
      campaignId,
      sessionId,
      enemyName: enemy.name,
      participantId,
    });

    // Auto-advance the turn
    const advanceClient = await getClient({ label: 'enemy-turn-advance' });
    try {
      await advanceClient.query('BEGIN');
      const advanceResult = await endTurn(advanceClient, sessionId, { actorId: 'system' });
      await advanceClient.query('COMMIT');

      if (wsServer) {
        wsServer.emitTurnAdvanced(campaignId, {
          sessionId,
          gameState: advanceResult.newState,
        });

        // If next turn is also an NPC, chain the enemy turn
        const nextPlayer = advanceResult.newState.activePlayerId;
        if (typeof nextPlayer === 'string' && nextPlayer.startsWith('npc:')) {
          const nextParticipantId = nextPlayer.replace('npc:', '');
          wsServer.emitEnemyTurnStarted(campaignId, {
            sessionId,
            participantId: nextPlayer,
            gameState: advanceResult.newState,
          });

          // Recursively process next enemy turn
          setImmediate(() => {
            executeEnemyTurn(contextualService, null, {
              campaignId,
              sessionId,
              encounterId,
              participantId: nextParticipantId,
              wsServer,
            }).catch((err) => logError('Chained enemy turn failed', err, { participantId: nextParticipantId }));
          });
        }
      }
    } catch (advanceError) {
      await advanceClient.query('ROLLBACK').catch(() => {});
      logError('Enemy turn advance failed', advanceError, { campaignId, participantId });
    } finally {
      advanceClient.release();
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logError('Enemy turn execution failed', error, { campaignId, participantId });
  } finally {
    client.release();
  }
};
