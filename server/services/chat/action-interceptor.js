/**
 * Action Interceptor — detects and processes game actions from natural language chat messages.
 *
 * When a player types in the Party channel during their turn, this module:
 * 1. Calls the LLM to parse intent (lightweight classification)
 * 2. If it's a game action, delegates to the existing DM action resolution pipeline
 * 3. Posts the narration result to the Adventure (dm_broadcast) channel
 */

import { getClient } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { CHAT_ACTION_PARSE_SCHEMA } from '../../llm/schemas/chat-action-schema.js';
import {
  buildChatActionParsePrompt,
  CHAT_ACTION_PARSE_SYSTEM_PROMPT,
} from '../../llm/context/action-prompt-builder.js';
import {
  buildActionContext,
  invokeDmForAction,
  invokeDmForSocialAction,
  applyMechanicalOutcome,
} from '../dm-action/service.js';
import { getAllLiveStates } from '../live-state/service.js';
import { postNarrationToChat, postPrivateNarration } from './dm-narrator.js';

/**
 * Determine if a chat message should be intercepted as a game action.
 *
 * @returns {{ shouldIntercept: boolean, session?: object, gameState?: object, characterId?: string }}
 */
export async function shouldInterceptAsAction({
  campaignId,
  userId,
}) {
  const client = await getClient({ label: 'action-interceptor.check' });
  try {
    // Find active session
    const { rows: sessionRows } = await client.query(
      `SELECT s.id, s.game_state
         FROM public.sessions s
        WHERE s.campaign_id = $1 AND s.status = 'active'
        LIMIT 1`,
      [campaignId],
    );
    if (!sessionRows.length) return { shouldIntercept: false };

    const session = sessionRows[0];
    const gameState = typeof session.game_state === 'string'
      ? JSON.parse(session.game_state)
      : session.game_state;

    if (!gameState) return { shouldIntercept: false };

    // Check if this user is the active player
    if (gameState.activePlayerId !== userId) {
      return { shouldIntercept: false };
    }

    // Check phase allows actions (exploration, combat, social)
    const actionPhases = new Set(['exploration', 'combat', 'social']);
    if (!actionPhases.has(gameState.phase)) {
      return { shouldIntercept: false };
    }

    // Find the player's character in this campaign
    const { rows: charRows } = await client.query(
      `SELECT character_id FROM public.campaign_players
        WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
      [campaignId, userId],
    );
    const characterId = charRows[0]?.character_id ?? null;
    if (!characterId) return { shouldIntercept: false };

    return {
      shouldIntercept: true,
      session,
      gameState,
      characterId,
    };
  } finally {
    client.release();
  }
}

/**
 * Parse a natural language chat message into a structured action via LLM.
 */
async function parseActionIntent(contextualService, {
  campaignId,
  sessionId,
  characterName,
  characterClass,
  characterLevel,
  phase,
  chatMessage,
  visibleNpcs,
  recentNarrations,
}) {
  const prompt = buildChatActionParsePrompt({
    characterName,
    characterClass,
    characterLevel,
    phase,
    chatMessage,
    visibleNpcs,
    recentNarrations,
  });

  try {
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.CHAT_ACTION_PARSE,
      request: {
        extraSections: prompt,
        systemPromptOverride: CHAT_ACTION_PARSE_SYSTEM_PROMPT,
      },
      parameters: {
        schema: CHAT_ACTION_PARSE_SCHEMA,
      },
    });

    if (result.parsed) return result.parsed;

    if (result.content) {
      try {
        return JSON.parse(result.content);
      } catch {
        // If we can't parse, treat as a custom action
        return {
          actionType: 'custom',
          details: chatMessage,
          isFreeAction: false,
          narrationHint: 'Player typed something the parser could not classify',
        };
      }
    }

    return {
      actionType: 'custom',
      details: chatMessage,
      isFreeAction: false,
      narrationHint: 'Intent parsing returned no result',
    };
  } catch (error) {
    logError('Action intent parsing failed', { error: error.message, campaignId });
    // Fallback: treat as custom action and let the DM resolve it
    return {
      actionType: 'custom',
      details: chatMessage,
      isFreeAction: false,
      narrationHint: 'Intent parsing failed — resolve creatively',
    };
  }
}

/**
 * Main entry point: intercept a chat message and process it as a game action.
 *
 * This runs asynchronously after the chat message has been created —
 * the chat response is not blocked by this processing.
 */
export async function interceptChatAction({
  campaignId,
  sessionId,
  userId,
  characterId,
  chatMessage,
  gameState,
  contextualService,
  wsServer,
}) {
  const client = await getClient({ label: 'action-interceptor.process' });

  try {
    // Load character info for the intent parser
    const { rows: charRows } = await client.query(
      `SELECT id, name, class, level FROM public.characters WHERE id = $1`,
      [characterId],
    );
    const character = charRows[0];
    if (!character) {
      logError('Action interceptor: character not found', { characterId });
      return;
    }

    // Load nearby NPCs for context
    const { rows: nearbyNpcs } = await client.query(
      `SELECT id, name, occupation FROM public.npcs
        WHERE campaign_id = $1 LIMIT 10`,
      [campaignId],
    );

    // Load recent narrations
    const { rows: recentActions } = await client.query(
      `SELECT dm_response->>'narration' AS narration
         FROM public.session_player_actions
        WHERE session_id = $1 AND status = 'completed' AND dm_response IS NOT NULL
        ORDER BY created_at DESC LIMIT 5`,
      [sessionId],
    );
    const recentNarrations = recentActions.map((r) => r.narration).filter(Boolean).reverse();

    // Step 1: Parse intent
    const intent = await parseActionIntent(contextualService, {
      campaignId,
      sessionId,
      characterName: character.name,
      characterClass: character.class,
      characterLevel: character.level,
      phase: gameState.phase,
      chatMessage,
      visibleNpcs: nearbyNpcs,
      recentNarrations,
    });

    logInfo('Chat action intent parsed', {
      campaignId,
      characterName: character.name,
      actionType: intent.actionType,
      isFreeAction: intent.isFreeAction,
    });

    // Free actions don't consume the turn — skip DM resolution
    if (intent.isFreeAction) {
      return;
    }

    // Step 2: Record the action in session_player_actions
    // Look up campaign_player_id for the player_id FK
    const { rows: cpRows } = await client.query(
      `SELECT id FROM campaign_players WHERE campaign_id = $1 AND user_id = $2 LIMIT 1`,
      [campaignId, userId],
    );
    const campaignPlayerId = cpRows[0]?.id ?? null;

    const { rows: actionRows } = await client.query(
      `INSERT INTO public.session_player_actions
         (session_id, campaign_id, player_id, user_id, character_id, action_type, action_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
       RETURNING id`,
      [
        sessionId,
        campaignId,
        campaignPlayerId,
        userId,
        characterId,
        intent.actionType,
        JSON.stringify({
          ...intent,
          originalChatMessage: chatMessage,
        }),
      ],
    );
    const actionId = actionRows[0].id;

    // Step 3: Build action context and invoke DM
    const actionContext = await buildActionContext(client, {
      campaignId,
      sessionId,
      actingUserId: userId,
      characterId,
      actionType: intent.actionType,
      actionPayload: {
        ...intent,
        originalChatMessage: chatMessage,
      },
      gameState,
    });

    const invoker = intent.actionType === 'talk_to_npc'
      ? invokeDmForSocialAction
      : invokeDmForAction;

    const dmResponse = await invoker(contextualService, {
      campaignId,
      sessionId,
      actionContext,
    });

    // Step 4: Apply mechanical outcomes
    if (dmResponse.mechanicalOutcome) {
      await applyMechanicalOutcome(client, {
        sessionId,
        campaignId,
        mechanicalOutcome: dmResponse.mechanicalOutcome,
        actingCharacterId: characterId,
      });
    }

    // Step 5: Update action record
    const finalStatus = dmResponse.requiredRolls?.length ? 'awaiting_roll' : 'completed';
    await client.query(
      `UPDATE public.session_player_actions
          SET dm_response = $2, status = $3, resolved_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END
        WHERE id = $1`,
      [actionId, JSON.stringify(dmResponse), finalStatus],
    );

    // Step 6: Post narration to Adventure channel
    if (dmResponse.narration) {
      await postNarrationToChat({
        campaignId,
        content: dmResponse.narration,
        messageType: 'action_result',
        sessionId,
        wsServer,
      });
    }

    if (dmResponse.privateMessage) {
      await postPrivateNarration({
        campaignId,
        targetUserId: userId,
        content: dmResponse.privateMessage,
        messageType: 'narration',
        sessionId,
        wsServer,
      });
    }

    // Step 7: Broadcast state changes
    if (wsServer) {
      if (dmResponse.requiredRolls?.length) {
        wsServer.emitRollRequested(campaignId, userId, {
          actionId,
          requiredRolls: dmResponse.requiredRolls,
        });
      }

      if (finalStatus === 'completed') {
        wsServer.emitActionCompleted(campaignId, {
          actionId,
          characterId,
          actionType: intent.actionType,
          outcome: dmResponse,
        });
      }

      if (dmResponse.mechanicalOutcome) {
        const updatedStates = await getAllLiveStates(client, { sessionId });
        wsServer.emitLiveStateChanged(campaignId, {
          sessionId,
          liveStates: updatedStates,
          reason: `chat action: ${intent.actionType}`,
        });
      }
    }

    logInfo('Chat action resolved', {
      campaignId,
      actionId,
      actionType: intent.actionType,
      status: finalStatus,
    });
  } catch (error) {
    logError('Action interceptor failed', {
      campaignId,
      userId,
      error: error.message,
    });

    // Post a fallback narration so the player isn't left hanging
    await postNarrationToChat({
      campaignId,
      content: 'The Dungeon Master pauses, considering the situation...',
      messageType: 'system_event',
      sessionId,
      wsServer,
    }).catch(() => {});
  } finally {
    client.release();
  }
}
