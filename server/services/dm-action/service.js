/**
 * DM Action Service — orchestrates LLM-driven action resolution.
 *
 * Flow: player declares action → LLM processes → structured response → apply outcomes.
 */

import { logInfo, logError, logWarn } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { DM_RESPONSE_SCHEMA } from '../../llm/schemas/dm-response-schema.js';
import {
  buildActionPrompt,
  buildWorldTurnPrompt,
  DM_ACTION_SYSTEM_PROMPT,
  DM_WORLD_TURN_SYSTEM_PROMPT,
} from '../../llm/context/action-prompt-builder.js';
import { patchLiveState } from '../live-state/service.js';

/**
 * Build action context by loading player-specific data from the DB.
 */
export const buildActionContext = async (client, {
  campaignId,
  sessionId,
  actingUserId,
  characterId,
  actionType,
  actionPayload,
  gameState,
}) => {
  // Load character record
  const { rows: charRows } = await client.query(
    `SELECT id, name, class, level, race, abilities, armor_class, speed, skills, equipment
       FROM public.characters WHERE id = $1`,
    [characterId],
  );
  const character = charRows[0] ?? null;

  // Load live state
  const { rows: liveRows } = await client.query(
    `SELECT * FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );
  const liveState = liveRows[0] ?? null;

  // Scene context: DM context markdown from session
  const { rows: sessionRows } = await client.query(
    `SELECT dm_context_md, dm_focus FROM public.sessions WHERE id = $1`,
    [sessionId],
  );
  const session = sessionRows[0] ?? {};

  // Visible NPCs near the player
  const { rows: nearbyNpcs } = await client.query(
    `SELECT n.id, n.name, n.occupation, n.personality
       FROM public.npcs n
      WHERE n.campaign_id = $1
      LIMIT 10`,
    [campaignId],
  );

  // Last 5 narrations from completed actions this session
  const { rows: recentActions } = await client.query(
    `SELECT dm_response->>'narration' AS narration
       FROM public.session_player_actions
      WHERE session_id = $1 AND status = 'completed' AND dm_response IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5`,
    [sessionId],
  );
  const recentNarrations = recentActions
    .map((r) => r.narration)
    .filter(Boolean)
    .reverse();

  return {
    character,
    liveState,
    actionType,
    actionPayload,
    sceneContext: {
      locationName: session.dm_focus ?? 'Unknown',
      description: session.dm_context_md ?? null,
      visibleNpcs: nearbyNpcs,
      regionTags: [],
    },
    recentNarrations,
    gameState,
  };
};

/**
 * Invoke the LLM to resolve a player action.
 * Returns the parsed DM response or a fallback narration-only response.
 */
export const invokeDmForAction = async (contextualService, {
  campaignId,
  sessionId,
  actionContext,
  rollResult,
}) => {
  const prompt = buildActionPrompt({
    ...actionContext,
    rollResult,
  });

  try {
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.PLAYER_ACTION_RESPONSE,
      metadata: { actionType: actionContext.actionType },
      request: {
        extraSections: prompt,
      },
    });

    // Try to use parsed structured output first
    if (result.parsed) {
      return result.parsed;
    }

    // Fallback: if provider returned content but didn't parse, try manual parse
    if (result.content) {
      try {
        return JSON.parse(result.content);
      } catch {
        // Treat raw content as narration-only
        return { narration: result.content };
      }
    }

    return { narration: 'The DM considers your action...' };
  } catch (error) {
    logError('DM action LLM invocation failed', error, { campaignId, sessionId });
    return {
      narration: 'The DM pauses to consider the outcome of your action.',
      _error: error.message,
    };
  }
};

/**
 * Apply mechanical outcomes from a DM response to live state.
 */
export const applyMechanicalOutcome = async (client, {
  sessionId,
  mechanicalOutcome,
  actingCharacterId,
}) => {
  if (!mechanicalOutcome || !mechanicalOutcome.type) return null;

  const targetId = mechanicalOutcome.targetCharacterId || actingCharacterId;
  const amount = mechanicalOutcome.amount ?? 0;

  switch (mechanicalOutcome.type) {
    case 'damage': {
      // Read current HP, apply damage
      const { rows } = await client.query(
        `SELECT hp_current, hp_temporary FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const current = rows[0];
      let remaining = amount;

      // Absorb with temp HP first
      let newTempHp = current.hp_temporary;
      if (newTempHp > 0) {
        const absorbed = Math.min(newTempHp, remaining);
        newTempHp -= absorbed;
        remaining -= absorbed;
      }

      const newHp = Math.max(0, current.hp_current - remaining);

      return patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { hp_current: newHp, hp_temporary: newTempHp },
        reason: `damage: ${amount}`,
        actorId: 'system',
      });
    }

    case 'healing': {
      const { rows } = await client.query(
        `SELECT hp_current, hp_max FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const newHp = Math.min(rows[0].hp_max, rows[0].hp_current + amount);
      return patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { hp_current: newHp },
        reason: `healing: ${amount}`,
        actorId: 'system',
      });
    }

    case 'condition_add': {
      const { rows } = await client.query(
        `SELECT conditions FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const condition = mechanicalOutcome.condition;
      if (!condition) return null;

      const conditions = [...(rows[0].conditions || [])];
      if (!conditions.includes(condition)) {
        conditions.push(condition);
      }

      return patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { conditions },
        reason: `condition added: ${condition}`,
        actorId: 'system',
      });
    }

    case 'condition_remove': {
      const { rows } = await client.query(
        `SELECT conditions FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const condition = mechanicalOutcome.condition;
      if (!condition) return null;

      const conditions = (rows[0].conditions || []).filter((c) => c !== condition);

      return patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { conditions },
        reason: `condition removed: ${condition}`,
        actorId: 'system',
      });
    }

    case 'spell_slot_use': {
      // Decrement a spell slot level
      const { rows } = await client.query(
        `SELECT spell_slots FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const slotLevel = mechanicalOutcome.resourceName ?? '1';
      const slots = { ...(rows[0].spell_slots || {}) };
      if (slots[slotLevel] && typeof slots[slotLevel] === 'object') {
        const current = slots[slotLevel].current ?? slots[slotLevel].remaining ?? 0;
        if (current > 0) {
          slots[slotLevel] = { ...slots[slotLevel], current: current - 1, remaining: current - 1 };
        }
      }

      return patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { spell_slots: slots },
        reason: `spell slot used: level ${slotLevel}`,
        actorId: 'system',
      });
    }

    case 'concentration_start': {
      // Set concentration on the live state
      const spellName = mechanicalOutcome.condition ?? mechanicalOutcome.itemName ?? 'Unknown Spell';
      await client.query(
        `UPDATE public.session_live_states
            SET concentration = $3, updated_at = NOW()
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId, JSON.stringify({ spellName, startedRound: Date.now() })],
      );

      logInfo('Concentration started', { characterId: targetId, spellName });
      return { concentration: { spellName } };
    }

    case 'concentration_break': {
      // Clear concentration
      await client.query(
        `UPDATE public.session_live_states
            SET concentration = NULL, updated_at = NOW()
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );

      logInfo('Concentration broken', { characterId: targetId });
      return { concentration: null };
    }

    default:
      logWarn('Unhandled mechanical outcome type', { type: mechanicalOutcome.type });
      return null;
  }
};

/**
 * Check if a character has concentration and if damage should trigger a CON save.
 * Returns a roll request object or null.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ sessionId: string, characterId: string, damageAmount: number }} opts
 * @returns {Promise<object|null>} roll request or null
 */
export const checkConcentration = async (client, { sessionId, characterId, damageAmount }) => {
  const { rows } = await client.query(
    `SELECT concentration, user_id FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );

  if (rows.length === 0 || !rows[0].concentration) return null;

  const concentration = typeof rows[0].concentration === 'string'
    ? JSON.parse(rows[0].concentration)
    : rows[0].concentration;

  if (!concentration?.spellName) return null;

  const dc = Math.max(10, Math.floor(damageAmount / 2));

  logInfo('Concentration check required', {
    characterId,
    spellName: concentration.spellName,
    dc,
    damageAmount,
  });

  return {
    userId: rows[0].user_id,
    rollRequest: {
      rollType: 'saving_throw',
      ability: 'constitution',
      dc,
      description: `Concentration save for ${concentration.spellName} (DC ${dc})`,
    },
    concentration,
  };
};

/**
 * Execute a DM world turn with LLM narration.
 */
export const executeDmWorldTurnWithLLM = async (contextualService, pool, {
  campaignId,
  sessionId,
  gameState,
}) => {
  const client = await pool.connect();
  try {
    // Get recent actions for this round
    const { rows: recentActions } = await client.query(
      `SELECT spa.action_type, spa.dm_response->>'narration' AS narration,
              c.name AS character_name
         FROM public.session_player_actions spa
         JOIN public.characters c ON c.id = spa.character_id
        WHERE spa.session_id = $1 AND spa.round_number = $2
        ORDER BY spa.created_at`,
      [sessionId, gameState.roundNumber],
    );

    // Get scene context
    const { rows: sessionRows } = await client.query(
      `SELECT dm_context_md FROM public.sessions WHERE id = $1`,
      [sessionId],
    );

    const prompt = buildWorldTurnPrompt({
      gameState,
      recentActions,
      sceneContext: { description: sessionRows[0]?.dm_context_md ?? null },
    });

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.DM_WORLD_TURN,
      metadata: { roundNumber: gameState.roundNumber },
      request: { extraSections: prompt },
    });

    let parsed = result.parsed;
    if (!parsed && result.content) {
      try {
        parsed = JSON.parse(result.content);
      } catch {
        parsed = { narration: result.content };
      }
    }

    return parsed || { narration: 'The world shifts around you...' };
  } finally {
    client.release();
  }
};
