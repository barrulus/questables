/**
 * Proactive Narrator — generates LLM narration automatically at key game moments.
 *
 * Handles:
 * - Session opening narration (when a session starts)
 * - Area entry narration (when players move to a new location)
 * - World turn narration (after all players have acted in a round)
 */

import { query, getClient } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { describeTerrainCell } from '../../llm/context/terrain-naming.js';
import { postNarrationToChat } from '../chat/dm-narrator.js';
import { evaluateEncounterChance, generateEncounter } from '../encounters/proactive-generator.js';
import { generateNpcsForBurg } from '../npcs/auto-generator.js';
import { executeDmWorldTurn } from '../game-state/service.js';

// ── Session Opening ─────────────────────────────────────────────────────────

const SESSION_OPENING_SYSTEM_PROMPT = `You are the Dungeon Master narrating the opening of a D&D 5e session. Write ONLY in-character narration — no meta-commentary, no feedback, no suggestions.

Write 3-6 sentences that:
- Describe where the party finds themselves right now
- Use any named locations, terrain, or weather from the provided context
- Hint at the session objective without stating it outright
- End by addressing the players and inviting their first action
- Set an evocative mood appropriate to the setting

Do NOT: review the world lore, give writing feedback, ask questions, or break character. You are the DM speaking to the players.`;

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
  llmService,
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

    // Load party members for the opening
    const { rows: partyRows } = await query(
      `SELECT c.name, c.class, c.race, c.level
         FROM campaign_players cp
         JOIN characters c ON c.id = cp.character_id
        WHERE cp.campaign_id = $1 AND cp.status = 'active'`,
      [campaignId],
      { label: 'proactive-narrator.party' },
    );

    // Load nearby geographic features for grounding
    const worldMapId = campaignRows[0].world_map_id;
    const sx = spawn.x;
    const sy = spawn.y;

    const { rows: nearbyBurgs } = await query(
      `SELECT name, statefull, population, culture, religion,
              ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 0)) AS distance
         FROM maps_burgs WHERE world_id = $1
         ORDER BY geom <-> ST_SetSRID(ST_MakePoint($2, $3), 0) LIMIT 5`,
      [worldMapId, sx, sy],
      { label: 'proactive-narrator.nearby-burgs' },
    );

    const { rows: nearbyRivers } = await query(
      `SELECT name, type
         FROM maps_rivers WHERE world_id = $1
         ORDER BY geom <-> ST_SetSRID(ST_MakePoint($2, $3), 0) LIMIT 2`,
      [worldMapId, sx, sy],
      { label: 'proactive-narrator.nearby-rivers' },
    );

    const { rows: terrainCell } = await query(
      `SELECT biome, type, height, state, culture, religion
         FROM maps_cells WHERE world_id = $1
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($2, $3), 0)) LIMIT 1`,
      [worldMapId, sx, sy],
      { label: 'proactive-narrator.terrain' },
    );

    // Build a focused prompt with real geographic data
    const promptParts = [];
    promptParts.push(`Campaign: ${campaignRows[0].campaign_name}`);
    if (spawn.name || spawn.note) {
      promptParts.push(`Starting location: ${spawn.name || 'Unknown'}${spawn.note ? ` — ${spawn.note}` : ''}`);
    }
    if (partyRows.length) {
      const partyList = partyRows.map((p) => `${p.name} (Level ${p.level} ${p.race} ${p.class})`).join(', ');
      promptParts.push(`Party: ${partyList}`);
    }
    if (objectives.length) {
      promptParts.push(`Session objective: ${objectives.map((o) => o.title).join('; ')}`);
    }

    // Geographic context — real names only. `maps_cells.type` is FMG's
    // isLand boolean stringified (always "island" for land cells); never
    // emit it as a noun — describeTerrainCell uses the biome integer.
    if (terrainCell.length) {
      const t = terrainCell[0];
      const description = describeTerrainCell(t);
      if (description) {
        promptParts.push(
          `Terrain: ${description}${t.state ? ` (territory of ${t.state})` : ''}${t.culture ? `, ${t.culture} culture` : ''}`,
        );
      }
    }
    if (nearbyBurgs.length) {
      const burgList = nearbyBurgs.map((b) => `${b.name} (${b.statefull}, pop ${b.population})`).join('; ');
      promptParts.push(`Nearby settlements: ${burgList}`);
    }
    if (nearbyRivers.length) {
      promptParts.push(`Nearby rivers: ${nearbyRivers.map((r) => `${r.name} (${r.type})`).join(', ')}`);
    }

    promptParts.push('\nUsing ONLY the real place names above, narrate the opening scene for this session.');

    // Use the LLM service directly — no full game context needed for opening narration
    const result = await llmService.generate({
      type: NARRATIVE_TYPES.SESSION_OPENING,
      prompt: promptParts.join('\n'),
      systemPrompt: SESSION_OPENING_SYSTEM_PROMPT,
    });

    const narration = result.content || null;
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

export const AREA_DESCRIPTION_SYSTEM_PROMPT = `You are the DM. Describe the area the party has just entered. 2-4 sentences, atmospheric, plain prose (no JSON).

GROUND TRUTH (highest priority):
- The "Current settlement" line in the geographic context is the ONLY authoritative location. Recent chat may describe a different settlement — that was THEN, not NOW. The party has moved. Do NOT reuse settlement names, scene details, or atmosphere from prior chat if they conflict with the current geographic context.
- The "Party in current scene" list names every PC physically present. The "Full party roster" is reference only — do NOT narrate party members not in the in-scene list as present.
- The "NPCs in current scene" list names every NPC physically present. The "Campaign NPC roster" is reference only — do NOT narrate roster NPCs as present.
- Do not invent named establishments, shops, taverns, items, or settlements. Refer to commerce, lodging, and goods generically ("a market stall", "an inn", "a clay jug") unless a specific name appears in the geographic or NPC context above.

Use real names from the geographic context. Mention markers, terrain, or campaign regions where relevant. If approaching a settlement, describe the approach (gates, walls, sounds, smells) using that settlement's actual properties.`;

/**
 * Generate area entry narration when a player moves to a notably different location.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {string|null} [opts.actingUserId] - User id of the player whose action triggered this narration; falls back to the session active player.
 * @param {string} [opts.movementContext] - Brief description of what triggered this (e.g. "entered new biome", "approaching settlement")
 * @param {object} opts.contextualService
 * @param {object} opts.wsServer
 */
export async function narrateAreaEntry({
  campaignId,
  sessionId,
  actingUserId = null,
  movementContext = null,
  contextualService,
  wsServer,
}) {
  try {
    // The geographic / scene-presence sections in the prompt now anchor the
    // narration to the party's actual current location. Movement context
    // (when supplied) is the only extra detail the caller adds.
    const extraSections = movementContext
      ? [{ title: 'Movement Context', content: movementContext }]
      : [];

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      actingUserId,
      type: NARRATIVE_TYPES.AREA_DESCRIPTION,
      request: {
        extraSections,
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

export const WORLD_TURN_SYSTEM_PROMPT = `You are the DM narrating the world's response after a full round of player actions. 2-4 sentences, plain prose (no JSON).

GROUND TRUTH (highest priority):
- The "Current settlement" line in the geographic context is the ONLY authoritative location. Recent chat may describe a different settlement — that was THEN, not NOW. Do NOT reuse settlement names, scene details, or NPCs from prior chat if they conflict with the current context.
- The "NPCs in current scene" list is the complete cast physically present. If empty, NO NPC speaks, acts, or reacts — focus on environment and the party. Do NOT include NPCs from the "Campaign NPC roster" who aren't in the in-scene list, even if they were mentioned moments ago in chat.
- The "Party in current scene" list names every PC physically present. The "Full party roster" is reference only — do NOT narrate party members not in this list as present.
- Do not invent named establishments, shops, taverns, items, or settlements. Refer to commerce, lodging, and goods generically ("a market stall", "an inn", "a clay jug") unless a specific name appears in the geographic or NPC context above.

Use the geographic context to ground details — weather, distant sounds, environmental shifts, time passing. If the party is in an isolated location (cave, tunnel, sealed chamber), narrate what THEY perceive there, not what's happening at locations they left.`;

/**
 * Generate and post world turn narration after all players have acted in a round.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {string|null} [opts.actingUserId] - User id of the player whose action triggered this narration; falls back to the session active player.
 * @param {object} opts.contextualService
 * @param {object} opts.wsServer
 */
export async function narrateWorldTurn({
  campaignId,
  sessionId,
  actingUserId = null,
  contextualService,
  wsServer,
}) {
  try {
    // Scene presence is now handled by buildGameContext's npcsInScene /
    // partyInScene fields and rendered in the snapshot; no override needed.
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      actingUserId,
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

/**
 * Fire the full world-turn pipeline (narration → mechanical execution → encounter
 * check) when an auto-advanced turn rolls the round counter. Mirrors the inline
 * logic in game-state.routes.js endTurn handler so chat-action / action-panel /
 * roll-result auto-advance paths get the same world-turn behaviour as the
 * manual End Turn button.
 *
 * Fire-and-forget — does not block the calling request. Errors are logged but
 * never propagate.
 */
export function fireWorldTurnIfPending({
  campaignId,
  sessionId,
  newState,
  actorId,
  contextualService,
  wsServer,
}) {
  if (!newState?.worldTurnPending || !contextualService) return;

  // Run async without blocking the caller. Each step has its own try/catch so
  // a failure in one phase doesn't strand the others.
  (async () => {
    try {
      await narrateWorldTurn({
        campaignId,
        sessionId,
        actingUserId: actorId ?? null,
        contextualService,
        wsServer,
      });
    } catch (err) {
      logError('Auto world turn narration failed', { campaignId, error: err.message });
    }

    let wtClient;
    try {
      wtClient = await getClient({ label: 'auto-world-turn' });
      await wtClient.query('BEGIN');
      const wtResult = await executeDmWorldTurn(wtClient, sessionId, { actorId });
      await wtClient.query('COMMIT');
      if (wsServer && wtResult?.newState) {
        wsServer.emitWorldTurnCompleted?.(campaignId, {
          sessionId,
          gameState: wtResult.newState,
        });
      }
    } catch (wtErr) {
      if (wtClient) await wtClient.query('ROLLBACK').catch(() => {});
      logError('Auto world turn execution failed', { campaignId, error: wtErr.message });
    } finally {
      wtClient?.release();
    }
  })();
}
