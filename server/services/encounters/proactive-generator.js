/**
 * Proactive Encounter Generator — evaluates whether to trigger random encounters
 * based on location, party level, region type, and narrative pacing.
 *
 * Called after world turns or significant movement. If an encounter is triggered,
 * the LLM generates encounter details and the system auto-transitions to combat.
 */

import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { postNarrationToChat } from '../chat/dm-narrator.js';

const ENCOUNTER_GEN_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A random encounter has been triggered. Generate a brief encounter introduction.

RULES:
- Write 2-4 sentences setting the scene for the encounter.
- Describe what the party notices: sounds, movement, an ambush, a creature emerging, etc.
- Ground the encounter in the geographic context — use terrain, weather, time of day.
- This is a narrative intro only — the combat system handles mechanics.
- Build tension and urgency.
- Respond with plain narrative text, not JSON.`;

/**
 * Evaluate whether a random encounter should trigger.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @returns {Promise<boolean>} Whether an encounter should trigger
 */
export async function evaluateEncounterChance({
  campaignId,
  sessionId,
}) {
  try {
    // Check how many rounds since the last combat encounter
    const { rows: recentCombat } = await query(
      `SELECT COUNT(*) AS count
         FROM public.game_state_log
        WHERE session_id = $1 AND event_type = 'phase_changed'
          AND (metadata->>'newPhase' = 'combat')
          AND created_at > NOW() - INTERVAL '2 hours'`,
      [sessionId],
      { label: 'encounter-gen.recent-combat' },
    );
    const recentCombatCount = parseInt(recentCombat[0]?.count ?? '0', 10);

    // Check if player is in an encounter region
    const { rows: playerPos } = await query(
      `SELECT cp.loc_current, cmr.category
         FROM public.campaign_players cp
         LEFT JOIN public.campaign_map_regions cmr
           ON cmr.campaign_id = cp.campaign_id
           AND cp.loc_current IS NOT NULL
           AND ST_Contains(cmr.region, cp.loc_current)
           AND cmr.category = 'encounter'
        WHERE cp.campaign_id = $1 AND cp.status = 'active' AND cp.loc_current IS NOT NULL
        LIMIT 1`,
      [campaignId],
      { label: 'encounter-gen.player-region' },
    );

    const inEncounterRegion = playerPos.some((r) => r.category === 'encounter');

    // Check if inside a settlement (safe — no random encounters)
    const { rows: insideBurg } = await query(
      `SELECT inside_burg_id FROM public.campaign_players
        WHERE campaign_id = $1 AND status = 'active' AND inside_burg_id IS NOT NULL
        LIMIT 1`,
      [campaignId],
      { label: 'encounter-gen.inside-burg' },
    );
    if (insideBurg.length > 0) return false;

    // Calculate encounter probability
    let probability = 0.05; // Base 5% per world turn

    if (inEncounterRegion) probability = 0.25; // 25% in encounter zones
    if (recentCombatCount === 0) probability += 0.05; // +5% if no recent combat (build tension)
    if (recentCombatCount >= 2) probability *= 0.5; // Halve if lots of recent combat (prevent fatigue)

    const roll = Math.random();
    const triggered = roll < probability;

    logInfo('Encounter check', {
      campaignId,
      sessionId,
      probability: Math.round(probability * 100),
      roll: Math.round(roll * 100),
      triggered,
      inEncounterRegion,
      recentCombatCount,
    });

    return triggered;
  } catch (error) {
    logError('Encounter evaluation failed', { error: error.message, campaignId });
    return false;
  }
}

/**
 * Generate and narrate an encounter, then transition to combat phase.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.sessionId
 * @param {object} opts.contextualService
 * @param {object} opts.wsServer
 */
export async function generateEncounter({
  campaignId,
  sessionId,
  contextualService,
  wsServer,
}) {
  try {
    // Generate encounter narration via LLM
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.DM_NARRATION,
      request: {
        systemPromptOverride: ENCOUNTER_GEN_SYSTEM_PROMPT,
        extraSections: '## Instructions\nGenerate a brief encounter introduction. Hostile creatures approach the party.',
      },
    });

    const narration = result.parsed?.narration || result.content || 'Something stirs in the shadows...';

    await postNarrationToChat({
      campaignId,
      content: narration,
      messageType: 'narration',
      sessionId,
      wsServer,
    });

    logInfo('Proactive encounter generated', { campaignId, sessionId });

    // Note: actual combat initiation (phase transition, initiative rolls) would be
    // triggered by the CD or by a future enhancement that auto-creates encounter records
    // and calls initiateCombat(). For now, the narration sets the stage and the CD
    // can use the phase transition controls to start combat.
  } catch (error) {
    logError('Encounter generation failed', { error: error.message, campaignId });
  }
}
