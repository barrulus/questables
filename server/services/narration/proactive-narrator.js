/**
 * Proactive Narrator — generates LLM narration automatically at key game moments.
 *
 * Handles:
 * - Session opening narration (when a session starts)
 * - Area entry narration (when players move to a new location)
 * - World turn narration (after all players have acted in a round)
 */

import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { postNarrationToChat } from '../chat/dm-narrator.js';
import { evaluateEncounterChance, generateEncounter } from '../encounters/proactive-generator.js';
import { generateNpcsForBurg } from '../npcs/auto-generator.js';

// ── Session Opening ─────────────────────────────────────────────────────────

const SESSION_OPENING_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A new game session is beginning. Your role is to set the scene and draw the players into the world.

RULES:
- Write an immersive opening narration (3-6 sentences) describing where the party finds themselves.
- Use the geographic context to ground the description in the actual world map — name real settlements, routes, terrain.
- Reference the campaign objectives to hint at what lies ahead without being heavy-handed.
- Set the mood based on the world tone and narrative voice settings.
- End with a clear invitation for the first player to act.
- Do NOT invent locations or NPCs not present in the context.
- Respond with plain narrative text, not JSON.`;

/**
 * Generate and post opening narration when a session is activated.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {object} opts.contextualService - The contextual LLM service
 * @param {object} opts.wsServer - WebSocket server for broadcasting
 */
export async function narrateSessionOpening({
  campaignId,
  sessionId,
  contextualService,
  wsServer,
}) {
  try {
    // Load campaign world map and spawn point
    const { rows: campaignRows } = await query(
      `SELECT c.world_map_id, c.name AS campaign_name
         FROM public.campaigns c WHERE c.id = $1`,
      [campaignId],
      { label: 'proactive-narrator.campaign' },
    );
    if (!campaignRows.length || !campaignRows[0].world_map_id) return;

    // Get spawn position
    const { rows: spawnRows } = await query(
      `SELECT ST_X(world_position) AS x, ST_Y(world_position) AS y, name, note
         FROM public.campaign_spawns
        WHERE campaign_id = $1
        ORDER BY is_default DESC, updated_at DESC
        LIMIT 1`,
      [campaignId],
      { label: 'proactive-narrator.spawn' },
    );
    if (!spawnRows.length) return;

    const spawn = spawnRows[0];

    // Load campaign objectives for narrative hooks
    const { rows: objectives } = await query(
      `SELECT title, description_md, is_major
         FROM public.campaign_objectives
        WHERE campaign_id = $1 AND is_major = true
        ORDER BY order_index
        LIMIT 3`,
      [campaignId],
      { label: 'proactive-narrator.objectives' },
    );

    // Build the opening prompt
    const sections = [];
    if (spawn.note) sections.push(`## Spawn Note\n${spawn.note}`);
    if (objectives.length) {
      const objList = objectives.map((o) => `- ${o.title}`).join('\n');
      sections.push(`## Major Campaign Objectives\n${objList}`);
    }

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.SESSION_OPENING,
      request: {
        extraSections: sections.join('\n\n'),
        systemPromptOverride: SESSION_OPENING_SYSTEM_PROMPT,
      },
    });

    const narration = result.parsed?.narration || result.content || null;
    if (narration) {
      await postNarrationToChat({
        campaignId,
        content: narration,
        messageType: 'narration',
        sessionId,
        wsServer,
      });

      logInfo('Session opening narration posted', { campaignId, sessionId });
    }
  } catch (error) {
    logError('Session opening narration failed', {
      campaignId,
      sessionId,
      error: error.message,
    });
  }
}

// ── Area Entry Narration ────────────────────────────────────────────────────

const AREA_DESCRIPTION_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. The party has moved to a new area. Describe what they see.

RULES:
- Write a brief scene description (2-4 sentences) based on the geographic context.
- Name real settlements, routes, rivers, and terrain from the context.
- Mention any points of interest (markers) or campaign regions they've entered.
- If entering a settlement, describe the approach — gates, walls, sounds, smells.
- Keep it atmospheric and evocative but concise.
- Respond with plain narrative text, not JSON.`;

/**
 * Generate area entry narration when a player moves to a notably different location.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {string} [opts.movementContext] - Brief description of what triggered this (e.g. "entered new biome", "approaching settlement")
 * @param {object} opts.contextualService
 * @param {object} opts.wsServer
 */
export async function narrateAreaEntry({
  campaignId,
  sessionId,
  movementContext = null,
  contextualService,
  wsServer,
}) {
  try {
    const sections = [];
    if (movementContext) sections.push(`## Movement Context\n${movementContext}`);

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.AREA_DESCRIPTION,
      request: {
        extraSections: sections.join('\n\n'),
        systemPromptOverride: AREA_DESCRIPTION_SYSTEM_PROMPT,
      },
    });

    const narration = result.parsed?.narration || result.content || null;
    if (narration) {
      await postNarrationToChat({
        campaignId,
        content: narration,
        messageType: 'narration',
        sessionId,
        wsServer,
      });
    }

    // Check if any player is inside a burg — trigger NPC generation if needed
    const { rows: burgPlayers } = await query(
      `SELECT inside_burg_id FROM public.campaign_players
        WHERE campaign_id = $1 AND status = 'active' AND inside_burg_id IS NOT NULL
        LIMIT 1`,
      [campaignId],
      { label: 'area-narrate.burg-check' },
    );
    if (burgPlayers.length > 0 && contextualService) {
      generateNpcsForBurg({
        campaignId,
        burgId: burgPlayers[0].inside_burg_id,
        sessionId,
        contextualService,
      }).catch((err) => logError('NPC auto-generation failed (non-fatal)', { error: err.message }));
    }
  } catch (error) {
    logError('Area entry narration failed', {
      campaignId,
      error: error.message,
    });
  }
}

// ── World Turn Narration ────────────────────────────────────────────────────

const WORLD_TURN_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A full round of player actions has just completed. Narrate the world's response.

RULES:
- Write a brief world turn narration (2-4 sentences) describing what happens in the world.
- Consider: time passing, weather changes, NPC reactions, distant sounds, environmental shifts.
- Use the geographic context to ground details — reference actual nearby locations and terrain.
- If in a dangerous area (encounter region), hint at tension or approaching threats.
- Keep it atmospheric — this is the beat between player actions.
- Respond with plain narrative text, not JSON.`;

/**
 * Generate and post world turn narration after all players have acted in a round.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {object} opts.contextualService
 * @param {object} opts.wsServer
 */
export async function narrateWorldTurn({
  campaignId,
  sessionId,
  contextualService,
  wsServer,
}) {
  try {
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.WORLD_TURN_NARRATION,
      request: {
        systemPromptOverride: WORLD_TURN_SYSTEM_PROMPT,
      },
    });

    const narration = result.parsed?.narration || result.content || null;
    if (narration) {
      await postNarrationToChat({
        campaignId,
        content: narration,
        messageType: 'world_turn',
        sessionId,
        wsServer,
      });

      logInfo('World turn narration posted', { campaignId, sessionId });
    }

    // Check for proactive encounter after world turn
    const shouldEncounter = await evaluateEncounterChance({ campaignId, sessionId });
    if (shouldEncounter) {
      await generateEncounter({ campaignId, sessionId, contextualService, wsServer });
    }
  } catch (error) {
    logError('World turn narration failed', {
      campaignId,
      sessionId,
      error: error.message,
    });
  }
}
