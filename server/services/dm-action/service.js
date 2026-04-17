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
  buildSocialActionPrompt,
  DM_ACTION_SYSTEM_PROMPT,
  DM_SOCIAL_SYSTEM_PROMPT,
} from '../../llm/context/action-prompt-builder.js';
import { patchLiveState } from '../live-state/service.js';
import { handleHpZero, handleHealingAtZero } from '../combat/death-saves.js';

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

  // Session context: title, summary, DM notes, current focus
  const { rows: sessionRows } = await client.query(
    `SELECT title, summary, dm_notes, dm_focus, dm_context_md FROM public.sessions WHERE id = $1`,
    [sessionId],
  );
  const session = sessionRows[0] ?? {};

  // Campaign brief: name, description, setting
  const { rows: campaignRows } = await client.query(
    `SELECT name, description, setting FROM public.campaigns WHERE id = $1`,
    [campaignId],
  );
  const campaign = campaignRows[0] ?? {};

  // Other player characters in the same campaign (active, with location)
  const { rows: otherPlayers } = await client.query(
    `SELECT ch.name AS character_name, ch.class AS character_class, ch.level AS character_level,
            ch.race AS character_race, up.username,
            ST_X(cp.loc_current) AS loc_x, ST_Y(cp.loc_current) AS loc_y,
            cp.visibility_state
       FROM public.campaign_players cp
       JOIN public.characters ch ON cp.character_id = ch.id
       JOIN public.user_profiles up ON cp.user_id = up.id
      WHERE cp.campaign_id = $1 AND cp.status = 'active' AND cp.character_id != $2`,
    [campaignId, characterId],
  );

  // Resolve the acting player's geographic location AND current scene
  const { rows: playerLocRows } = await client.query(
    `SELECT ST_X(cp.loc_current) AS loc_x, ST_Y(cp.loc_current) AS loc_y,
            cp.inside_burg_id, cp.current_scene, b.name AS burg_name
       FROM public.campaign_players cp
       LEFT JOIN public.maps_burgs b ON cp.inside_burg_id = b.id
      WHERE cp.campaign_id = $1 AND cp.user_id = $2 AND cp.loc_current IS NOT NULL
      LIMIT 1`,
    [campaignId, actingUserId],
  );
  const playerLoc = playerLocRows[0] ?? null;
  const currentScene = playerLoc?.current_scene ?? null;

  // NPCs at the player's current location AND scene.
  // Scene filtering: if the player has a current_scene, only NPCs tagged
  // with that exact scene OR with no scene tag (general village population)
  // are visible. NPCs tagged with a *different* scene are excluded — they're
  // somewhere else in the village.
  let nearbyNpcs = [];
  if (playerLoc?.loc_x != null && playerLoc?.loc_y != null) {
    const NEARBY_RADIUS_PX = 5000;
    const { rows } = await client.query(
      `SELECT n.id, n.name, n.race, n.gender, n.age_group, n.occupation, n.personality, n.appearance, n.scene_tag,
              ST_Distance(n.world_position, ST_SetSRID(ST_MakePoint($2, $3), 0)) AS distance
         FROM public.npcs n
        WHERE n.campaign_id = $1
          AND (
            n.world_position IS NULL
            OR ST_Distance(n.world_position, ST_SetSRID(ST_MakePoint($2, $3), 0)) <= $4
          )
          AND (
            $5::text IS NULL
            OR n.scene_tag IS NULL
            OR n.scene_tag = $5::text
          )
        ORDER BY n.world_position IS NULL, distance ASC NULLS LAST
        LIMIT 10`,
      [campaignId, playerLoc.loc_x, playerLoc.loc_y, NEARBY_RADIUS_PX, currentScene],
    );
    nearbyNpcs = rows;
  } else {
    const { rows } = await client.query(
      `SELECT id, name, race, gender, age_group, occupation, personality, appearance, scene_tag
         FROM public.npcs
        WHERE campaign_id = $1
          AND ($2::text IS NULL OR scene_tag IS NULL OR scene_tag = $2::text)
        ORDER BY created_at DESC
        LIMIT 10`,
      [campaignId, currentScene],
    );
    nearbyNpcs = rows;
  }

  // If not inside a burg, find the nearest one for geographic context
  let nearestBurgName = playerLoc?.burg_name ?? null;
  if (!nearestBurgName && playerLoc?.loc_x != null) {
    const { rows: burgRows } = await client.query(
      `SELECT b.name
         FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
        ORDER BY ST_Distance(b.geom, ST_SetSRID(ST_MakePoint($2, $3), 0))
        LIMIT 1`,
      [campaignId, playerLoc.loc_x, playerLoc.loc_y],
    );
    nearestBurgName = burgRows[0]?.name ?? null;
  }

  // Recent chat history — both player messages and DM narrations, in order.
  // This is what the players have actually seen, regardless of how it got there
  // (action interceptor, seed script, or DM broadcast).
  //
  // Speaker resolution: prefer the character explicitly attached to the message,
  // but fall back to the sender's enrolled campaign character (joined via
  // campaign_players) so that OOC/IC-toggled-off messages from a player still
  // appear in the transcript under their character's name. Otherwise the LLM
  // sees a username it doesn't recognise and invents a new character.
  const { rows: recentChat } = await client.query(
    `SELECT cm.content,
            cm.message_type,
            cm.channel_type,
            cm.sender_name,
            c.name AS character_name,
            cp_char.name AS player_character_name
       FROM public.chat_messages cm
       LEFT JOIN public.characters c ON cm.character_id = c.id
       LEFT JOIN public.campaign_players cp
              ON cp.campaign_id = cm.campaign_id
             AND cp.user_id = cm.sender_id
             AND cp.status = 'active'
       LEFT JOIN public.characters cp_char ON cp_char.id = cp.character_id
      WHERE cm.campaign_id = $1
        AND cm.channel_type IN ('party', 'dm_broadcast')
      ORDER BY cm.created_at DESC
      LIMIT 12`,
    [campaignId],
  );
  const recentNarrations = recentChat
    .reverse()
    .map((row) => {
      if (row.channel_type === 'dm_broadcast' || row.message_type === 'narration' || row.message_type === 'action_result') {
        return `[DM] ${row.content}`;
      }
      const speaker = row.character_name || row.player_character_name || row.sender_name || 'Player';
      return `${speaker}: ${row.content}`;
    });

  // Load NPC context for social dialogue actions
  let npcContext = null;
  if (actionType === 'talk_to_npc' && actionPayload?.npcId) {
    const { rows: npcRows } = await client.query(
      `SELECT id, name, race, occupation, personality, appearance, motivations, secrets, description
         FROM public.npcs WHERE id = $1`,
      [actionPayload.npcId],
    );
    const npc = npcRows[0] ?? null;

    let memories = [];
    let relationship = null;

    if (npc) {
      // Last 10 memories for this NPC in this campaign
      const { rows: memRows } = await client.query(
        `SELECT memory_summary, sentiment, trust_delta, tags, created_at
           FROM public.npc_memories
          WHERE npc_id = $1 AND campaign_id = $2
          ORDER BY created_at DESC LIMIT 10`,
        [actionPayload.npcId, campaignId],
      );
      memories = memRows.reverse();

      // Relationship with the acting character
      const { rows: relRows } = await client.query(
        `SELECT relationship_type, description, strength
           FROM public.npc_relationships
          WHERE npc_id = $1 AND target_id = $2 AND target_type = 'character'`,
        [actionPayload.npcId, characterId],
      );
      relationship = relRows[0] ?? null;
    }

    npcContext = { npc, memories, relationship };
  }

  // Build location name from actual map data, falling back to session dm_focus
  const locationName = playerLoc?.burg_name
    ? `In ${playerLoc.burg_name}`
    : nearestBurgName
      ? `Near ${nearestBurgName}`
      : session.dm_focus ?? 'Unknown';

  return {
    character,
    liveState,
    actionType,
    actionPayload,
    campaignBrief: {
      name: campaign.name ?? null,
      description: campaign.description ?? null,
      setting: campaign.setting ?? null,
    },
    sessionBrief: {
      title: session.title ?? null,
      summary: session.summary ?? null,
      dmNotes: session.dm_notes ?? null,
      dmFocus: session.dm_focus ?? null,
    },
    playerLocation: playerLoc
      ? {
          locX: playerLoc.loc_x != null ? Number(playerLoc.loc_x) : null,
          locY: playerLoc.loc_y != null ? Number(playerLoc.loc_y) : null,
          insideBurgId: playerLoc.inside_burg_id ?? null,
          burgName: playerLoc.burg_name ?? null,
          currentScene,
        }
      : null,
    currentScene,
    sceneContext: {
      locationName,
      description: session.dm_context_md ?? null,
      visibleNpcs: nearbyNpcs,
      otherPlayers,
      regionTags: [],
    },
    recentNarrations,
    gameState,
    npcContext,
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
    const { result } = await contextualService.generateDirect({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.PLAYER_ACTION_RESPONSE,
      systemPrompt: DM_ACTION_SYSTEM_PROMPT,
      prompt,
      metadata: { actionType: actionContext.actionType },
      parameters: { schema: DM_RESPONSE_SCHEMA },
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
 * Invoke the LLM to resolve a social dialogue action with NPC context.
 */
export const invokeDmForSocialAction = async (contextualService, {
  campaignId,
  sessionId,
  actionContext,
  rollResult,
}) => {
  const prompt = buildSocialActionPrompt({
    ...actionContext,
    rollResult,
  });

  try {
    const { result } = await contextualService.generateDirect({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.SOCIAL_DIALOGUE,
      systemPrompt: DM_SOCIAL_SYSTEM_PROMPT,
      prompt,
      metadata: { actionType: actionContext.actionType },
      parameters: { schema: DM_RESPONSE_SCHEMA },
    });

    if (result.parsed) return result.parsed;
    if (result.content) {
      try {
        return JSON.parse(result.content);
      } catch {
        return { narration: result.content };
      }
    }
    return { narration: 'The NPC regards you thoughtfully...' };
  } catch (error) {
    logError('Social action LLM invocation failed', error, { campaignId, sessionId });
    return {
      narration: 'The NPC pauses, considering their response...',
      _error: error.message,
    };
  }
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an LLM-supplied target character reference to a real UUID.
 * The LLM sometimes returns a character name ("Asmodeus") instead of the UUID
 * because the prompt exposes names. Accept either, fall back to the acting
 * character if the reference can't be resolved.
 */
const resolveCharacterRef = async (client, { sessionId, ref, actingCharacterId }) => {
  if (!ref) return actingCharacterId;
  if (UUID_REGEX.test(ref)) return ref;

  // Treat as a name — look up among characters with live state in this session.
  try {
    const { rows } = await client.query(
      `SELECT c.id
         FROM public.characters c
         JOIN public.session_live_states sls ON sls.character_id = c.id
        WHERE sls.session_id = $1 AND LOWER(c.name) = LOWER($2)
        LIMIT 1`,
      [sessionId, ref],
    );
    if (rows.length > 0) return rows[0].id;
  } catch (lookupError) {
    logWarn('Character ref lookup failed', { sessionId, ref, error: lookupError.message });
  }

  logWarn('Could not resolve targetCharacterId, falling back to acting character', {
    sessionId,
    ref,
    actingCharacterId,
  });
  return actingCharacterId;
};

/**
 * Apply mechanical outcomes from a DM response to live state.
 */
export const applyMechanicalOutcome = async (client, {
  sessionId,
  mechanicalOutcome,
  actingCharacterId,
  wsServer = null,
}) => {
  if (!mechanicalOutcome || !mechanicalOutcome.type) return null;

  const targetId = await resolveCharacterRef(client, {
    sessionId,
    ref: mechanicalOutcome.targetCharacterId,
    actingCharacterId,
  });
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

      const result = await patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { hp_current: newHp, hp_temporary: newTempHp },
        reason: `damage: ${amount}`,
        actorId: 'system',
      });

      // Check for death at 0 HP
      if (newHp === 0) {
        await handleHpZero(client, {
          sessionId,
          characterId: targetId,
          damageAmount: amount,
          isCritical: mechanicalOutcome.isCritical ?? false,
        });
      }

      return result;
    }

    case 'healing': {
      const { rows } = await client.query(
        `SELECT hp_current, hp_max, conditions FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const wasAtZero = rows[0].hp_current === 0;
      const newHp = Math.min(rows[0].hp_max, rows[0].hp_current + amount);

      const result = await patchLiveState(client, {
        sessionId,
        characterId: targetId,
        changes: { hp_current: newHp },
        reason: `healing: ${amount}`,
        actorId: 'system',
      });

      // Revive from unconscious if healed above 0
      if (wasAtZero && newHp > 0 && (rows[0].conditions || []).includes('unconscious')) {
        await handleHealingAtZero(client, {
          sessionId,
          characterId: targetId,
          healAmount: amount,
        });
      }

      return result;
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
      // Decrement a spell slot level — uses { max, used } format from stats-engine
      const { rows } = await client.query(
        `SELECT spell_slots FROM public.session_live_states
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, targetId],
      );
      if (rows.length === 0) return null;

      const slotLevel = mechanicalOutcome.resourceName ?? '1';
      const slots = { ...(rows[0].spell_slots || {}) };
      const slot = slots[slotLevel];
      if (slot && typeof slot === 'object') {
        const available = (slot.max ?? 0) - (slot.used ?? 0);
        if (available > 0) {
          slots[slotLevel] = { ...slot, used: (slot.used ?? 0) + 1 };
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

    case 'item_gain': {
      // Append item(s) to the character's inventory column on the characters
      // table. Inventory is a JSONB array of {id, name, type, quantity, weight,
      // description}. Supports both single-item (itemName) and multi-item
      // (items array) shapes.
      const itemsToAdd = Array.isArray(mechanicalOutcome.items) && mechanicalOutcome.items.length > 0
        ? mechanicalOutcome.items
        : (mechanicalOutcome.itemName ? [{ name: mechanicalOutcome.itemName, quantity: mechanicalOutcome.amount ?? 1 }] : []);

      if (itemsToAdd.length === 0) return null;

      const { rows: charRows } = await client.query(
        `SELECT inventory FROM public.characters WHERE id = $1`,
        [targetId],
      );
      if (charRows.length === 0) {
        logWarn('item_gain: character not found', { targetId });
        return null;
      }

      const existing = Array.isArray(charRows[0].inventory) ? charRows[0].inventory : [];
      const updated = [...existing];
      const addedNames = [];

      for (const it of itemsToAdd) {
        if (!it?.name?.trim()) continue;
        const name = it.name.trim();
        const quantity = typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1;
        const description = typeof it.description === 'string' ? it.description : '';

        // Stack with existing identical-name item if present
        const existingIdx = updated.findIndex(
          (e) => typeof e?.name === 'string' && e.name.toLowerCase() === name.toLowerCase(),
        );
        if (existingIdx >= 0) {
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: (updated[existingIdx].quantity ?? 1) + quantity,
          };
        } else {
          updated.push({
            id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            name,
            type: 'other',
            weight: 0,
            quantity,
            description,
          });
        }
        addedNames.push(`${name}${quantity > 1 ? ` x${quantity}` : ''}`);
      }

      await client.query(
        `UPDATE public.characters SET inventory = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updated), targetId],
      );

      logInfo('Items added to inventory', { characterId: targetId, items: addedNames });
      return { inventoryAdded: addedNames };
    }

    case 'item_lose': {
      const itemsToRemove = Array.isArray(mechanicalOutcome.items) && mechanicalOutcome.items.length > 0
        ? mechanicalOutcome.items
        : (mechanicalOutcome.itemName ? [{ name: mechanicalOutcome.itemName, quantity: mechanicalOutcome.amount ?? 1 }] : []);

      if (itemsToRemove.length === 0) return null;

      const { rows: charRows } = await client.query(
        `SELECT inventory FROM public.characters WHERE id = $1`,
        [targetId],
      );
      if (charRows.length === 0) return null;

      const existing = Array.isArray(charRows[0].inventory) ? charRows[0].inventory : [];
      let updated = [...existing];
      const removedNames = [];

      for (const it of itemsToRemove) {
        if (!it?.name?.trim()) continue;
        const name = it.name.trim();
        const quantity = typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1;

        const idx = updated.findIndex(
          (e) => typeof e?.name === 'string' && e.name.toLowerCase() === name.toLowerCase(),
        );
        if (idx < 0) continue;

        const currentQty = updated[idx].quantity ?? 1;
        if (currentQty <= quantity) {
          updated = updated.filter((_, i) => i !== idx);
        } else {
          updated[idx] = { ...updated[idx], quantity: currentQty - quantity };
        }
        removedNames.push(`${name}${quantity > 1 ? ` x${quantity}` : ''}`);
      }

      await client.query(
        `UPDATE public.characters SET inventory = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updated), targetId],
      );

      logInfo('Items removed from inventory', { characterId: targetId, items: removedNames });
      return { inventoryRemoved: removedNames };
    }

    case 'move_player': {
      const destination = mechanicalOutcome.destination;
      if (!destination || !destination.kind || destination.ref == null) {
        logWarn('move_player outcome missing destination', { sessionId });
        return null;
      }

      const { rows: sessionRows } = await client.query(
        `SELECT campaign_id FROM public.sessions WHERE id = $1 LIMIT 1`,
        [sessionId],
      );
      if (sessionRows.length === 0) {
        logWarn('move_player: session not found', { sessionId });
        return null;
      }
      const campaignId = sessionRows[0].campaign_id;

      const { rows: playerRows } = await client.query(
        `SELECT id, user_id
           FROM public.campaign_players
          WHERE campaign_id = $1
            AND character_id = $2
            AND status = 'active'
          LIMIT 1`,
        [campaignId, actingCharacterId],
      );
      if (playerRows.length === 0) {
        logWarn('move_player: no active campaign_player for acting character', {
          campaignId, actingCharacterId,
        });
        return null;
      }
      const playerId = playerRows[0].id;

      const { applyNarrativeMove } = await import('../movement/narrative-movement.js');

      const summary = await applyNarrativeMove(client, {
        campaignId,
        playerId,
        requestorUserId: playerRows[0].user_id,
        destination,
        reason: 'llm narrative move',
        wsServer,
      });

      logInfo('move_player applied', summary);
      return summary;
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
