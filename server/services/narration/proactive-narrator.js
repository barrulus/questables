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
      `SELECT biome, type AS terrain_type, state, culture, religion
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

    // Geographic context — real names only
    if (terrainCell.length) {
      const t = terrainCell[0];
      const parts = [t.biome, t.terrain_type].filter(Boolean).join(', ');
      promptParts.push(`Terrain: ${parts}${t.state ? ` (territory of ${t.state})` : ''}${t.culture ? `, ${t.culture} culture` : ''}`);
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

const AREA_DESCRIPTION_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. The party has moved to a new area. Describe what they see.

RULES:
- Write a brief scene description (2-4 sentences) based on the geographic context.
- Name real settlements, routes, rivers, and terrain from the context.
- Mention any points of interest (markers) or campaign regions they've entered.
- If entering a settlement, describe the approach — gates, walls, sounds, smells.
- Keep it atmospheric and evocative but concise.
- If a "CURRENT LOCATION" line is provided, you MUST use THAT name for the
  settlement the party is in. Do NOT reuse names of prior locations from
  the chat history or lore — the party has moved on. If prior lore refers
  to another town (e.g. "Toprak"), ignore it; narrate the current location.
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
  actingUserId = null,
  movementContext = null,
  contextualService,
  wsServer,
}) {
  try {
    const sections = [];

    // Anchor the LLM to the actual current burg so it can't re-use names
    // of prior locations from chat history / lore. If the party isn't inside
    // a burg, we still pin their terrain cell so narration doesn't drift.
    const { rows: currentBurg } = await query(
      `SELECT b.name AS burg_name, b.statefull, b.provincefull, b.culture
         FROM public.campaign_players cp
         JOIN public.maps_burgs b ON b.id = cp.inside_burg_id
        WHERE cp.campaign_id = $1 AND cp.status = 'active' AND cp.inside_burg_id IS NOT NULL
        LIMIT 1`,
      [campaignId],
      { label: 'area-narrate.current-burg' },
    );
    if (currentBurg.length > 0) {
      const b = currentBurg[0];
      const parts = [b.burg_name];
      if (b.provincefull) parts.push(b.provincefull);
      if (b.statefull) parts.push(b.statefull);
      sections.push(`## CURRENT LOCATION\n${parts.join(', ')}${b.culture ? ` (${b.culture} culture)` : ''}`);
    }

    if (movementContext) sections.push(`## Movement Context\n${movementContext}`);

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      actingUserId,
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
- Consider: time passing, weather changes, environmental shifts, distant sounds.
- Use the geographic context to ground details — reference actual nearby locations and terrain.
- If in a dangerous area (encounter region), hint at tension or approaching threats.
- Keep it atmospheric — this is the beat between player actions.
- Respond with plain narrative text, not JSON.

SCENE AWARENESS (CRITICAL — do NOT teleport NPCs):
- The "## Current Scene" section below tells you EXACTLY where the party is right now and which NPCs are physically with them.
- If the Current Scene says "no NPCs present", then NO NPCs are present in this narration. Do NOT have anyone speak, react, watch, or wring their hands.
- If the Current Scene lists specific NPCs, those are the ONLY NPCs who can appear in this narration.
- NPCs mentioned earlier in the transcript who are NOT in the current scene are ELSEWHERE — they were left behind when the party moved. Do not narrate them as present, even if they were just two paragraphs ago.
- Example: if the party climbed down a well into a tunnel, the villagers waiting at the wellhead are NOT in the tunnel with them. They are still up at the well.
- When the current scene is an isolated location (a cave, a tunnel, a sealed chamber), focus on the environment and the party itself — not on absent NPCs.`;

/**
 * Build the "## Current Scene" override section that tells the world-turn
 * LLM exactly where the party is and which NPCs (if any) are physically with
 * them. Reads `current_scene` from active campaign players and `scene_tag`
 * from NPCs — both maintained by `applySceneTransition`.
 */
async function buildCurrentSceneSection(campaignId) {
  try {
    const { rows: players } = await query(
      `SELECT cp.user_id, cp.current_scene, c.name AS character_name
         FROM public.campaign_players cp
         LEFT JOIN public.characters c ON c.id = cp.character_id
        WHERE cp.campaign_id = $1 AND cp.status = 'active'`,
      [campaignId],
      { label: 'world-turn.current-scene-players' },
    );

    if (players.length === 0) {
      return '## Current Scene\nNo active players. No NPCs present.';
    }

    // Collapse to the most-recently-set scene if all players agree, otherwise
    // list each player's scene. In practice the party stays together.
    const scenes = [...new Set(players.map((p) => p.current_scene).filter(Boolean))];
    const partyScene = scenes.length === 1 ? scenes[0] : null;

    let npcLines = 'No NPCs present (the party is alone in this location).';
    if (partyScene) {
      const { rows: sceneNpcs } = await query(
        `SELECT name, gender, age_group, occupation
           FROM public.npcs
          WHERE campaign_id = $1 AND scene_tag = $2`,
        [campaignId, partyScene],
        { label: 'world-turn.scene-npcs' },
      );
      if (sceneNpcs.length > 0) {
        npcLines = sceneNpcs
          .map((n) => {
            const demo = [n.gender, n.age_group].filter(Boolean).join(' ');
            const desc = [demo, n.occupation].filter(Boolean).join(', ');
            return desc ? `- ${n.name} (${desc})` : `- ${n.name}`;
          })
          .join('\n');
      }
    }

    const sceneLine = partyScene
      ? `Sub-scene: ${partyScene}`
      : `Players in different scenes: ${players.map((p) => `${p.character_name ?? 'someone'} → ${p.current_scene ?? 'unspecified'}`).join('; ')}`;

    return `${sceneLine}

NPCs in this exact scene:
${npcLines}

The "NPCs:" list earlier in the Game Context Snapshot is the FULL CAMPAIGN ROSTER, not the in-scene cast. Use ONLY the NPCs listed above. Any NPC mentioned earlier in the transcript who is NOT listed above is ELSEWHERE and must NOT appear in this narration.`;
  } catch (err) {
    logError('Failed to build current scene section', { campaignId, error: err.message });
    return '';
  }
}

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
  actingUserId = null,
  contextualService,
  wsServer,
}) {
  try {
    // Build the current-scene override so the LLM doesn't pull NPCs from the
    // generic campaign list when they aren't physically with the party.
    // extraSections is an array of {title, content} — see prompt-builder.js.
    const sceneContent = await buildCurrentSceneSection(campaignId);
    const extraSections = sceneContent
      ? [{
          title: 'Current Scene (HARD OVERRIDE — only these NPCs are physically present right now)',
          content: sceneContent,
        }]
      : [];

    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      actingUserId,
      type: NARRATIVE_TYPES.WORLD_TURN_NARRATION,
      request: {
        systemPromptOverride: WORLD_TURN_SYSTEM_PROMPT,
        extraSections,
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
