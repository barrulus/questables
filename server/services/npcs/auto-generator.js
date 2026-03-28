/**
 * NPC Auto-Generator — creates NPCs dynamically when the party arrives at a
 * settlement that has no campaign NPCs yet.
 *
 * Uses burg characteristics (port, capital, temple, citadel, culture, religion)
 * to generate contextually appropriate NPCs.
 */

import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';

const NPC_GEN_SYSTEM_PROMPT = `You are a D&D 5e world builder. Generate NPCs for a settlement the party is visiting.

RULES:
- Respond ONLY with valid JSON: an array of NPC objects.
- Each NPC must have: name, race, occupation, personality, motivations, secrets, appearance.
- NPCs should be appropriate to the settlement type and culture.
- Include a mix of helpful, neutral, and potentially suspicious NPCs.
- Port towns: sailors, merchants, harbor master, smugglers.
- Capital cities: nobles, guards, court officials, diplomats.
- Temple towns: priests, pilgrims, acolytes, healers.
- Citadel settlements: soldiers, blacksmiths, veterans, scouts.
- Market plazas: shopkeepers, entertainers, pickpockets, travelers.
- Give each NPC a distinct personality and at least one secret.
- Use the settlement's culture and religion to influence naming and behaviour.
- Generate 2-3 NPCs.`;

const NPC_GEN_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name', 'race', 'occupation', 'personality'],
    properties: {
      name: { type: 'string' },
      race: { type: 'string' },
      occupation: { type: 'string' },
      personality: { type: 'string' },
      motivations: { type: 'string' },
      secrets: { type: 'string' },
      appearance: { type: 'string' },
      voiceStyle: { type: 'string', description: 'How this NPC speaks (e.g. gruff, formal, nervous)' },
    },
  },
};

/**
 * Check if a burg needs NPCs generated, and if so, generate them.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.burgId - The maps_burgs UUID
 * @param {string} opts.sessionId
 * @param {object} opts.contextualService
 * @returns {Promise<object[]>} Generated NPC records (may be empty)
 */
export async function generateNpcsForBurg({
  campaignId,
  burgId,
  sessionId,
  contextualService,
}) {
  try {
    // Check if this burg already has NPCs
    const { rows: existingNpcs } = await query(
      `SELECT COUNT(*) AS count FROM public.npcs
        WHERE campaign_id = $1 AND linked_burg_id = $2`,
      [campaignId, burgId],
      { label: 'npc-gen.check-existing' },
    );
    if (parseInt(existingNpcs[0]?.count ?? '0', 10) > 0) {
      return []; // Burg already has NPCs
    }

    // Load burg details
    const { rows: burgRows } = await query(
      `SELECT name, statefull, provincefull, culture, religion,
              population, capital, port, citadel, walls, plaza, temple, shanty
         FROM public.maps_burgs WHERE id = $1`,
      [burgId],
      { label: 'npc-gen.burg-detail' },
    );
    if (!burgRows.length) return [];

    const burg = burgRows[0];
    const features = [
      burg.capital && 'capital city',
      burg.port && 'port town',
      burg.citadel && 'military citadel',
      burg.temple && 'temple town',
      burg.plaza && 'market plaza',
      burg.walls && 'walled settlement',
      burg.shanty && 'has shanty districts',
    ].filter(Boolean);

    const burgContext = [
      `## Settlement: ${burg.name}`,
      `Population: ${burg.population?.toLocaleString() ?? 'unknown'}`,
      `Features: ${features.join(', ') || 'none notable'}`,
      burg.statefull ? `State: ${burg.statefull}` : null,
      burg.culture ? `Culture: ${burg.culture}` : null,
      burg.religion ? `Religion: ${burg.religion}` : null,
    ].filter(Boolean).join('\n');

    // Generate NPCs via LLM
    const { result } = await contextualService.generateFromContext({
      campaignId,
      sessionId,
      type: NARRATIVE_TYPES.DM_NARRATION,
      request: {
        extraSections: burgContext,
        systemPromptOverride: NPC_GEN_SYSTEM_PROMPT,
      },
      parameters: {
        schema: NPC_GEN_SCHEMA,
      },
    });

    let npcs = [];
    if (result.parsed && Array.isArray(result.parsed)) {
      npcs = result.parsed;
    } else if (result.content) {
      try {
        const parsed = JSON.parse(result.content);
        npcs = Array.isArray(parsed) ? parsed : [];
      } catch {
        logError('NPC generation returned non-JSON', { campaignId, burgId });
        return [];
      }
    }

    if (npcs.length === 0) return [];

    // Persist generated NPCs
    const created = [];
    for (const npc of npcs) {
      try {
        const { rows } = await query(
          `INSERT INTO public.npcs
             (campaign_id, name, race, occupation, personality, motivations, secrets,
              appearance, voice_config, auto_generated, linked_burg_id, world_position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10,
             (SELECT geom FROM public.maps_burgs WHERE id = $10))
           RETURNING id, name, race, occupation`,
          [
            campaignId,
            npc.name ?? 'Unknown',
            npc.race ?? 'Human',
            npc.occupation ?? 'Commoner',
            npc.personality ?? 'Unremarkable',
            npc.motivations ?? null,
            npc.secrets ?? null,
            npc.appearance ?? null,
            npc.voiceStyle ? JSON.stringify({ speechStyle: npc.voiceStyle }) : '{}',
            burgId,
          ],
          { label: 'npc-gen.insert' },
        );
        if (rows[0]) created.push(rows[0]);
      } catch (insertErr) {
        logError('Failed to insert auto-generated NPC', {
          npcName: npc.name,
          error: insertErr.message,
        });
      }
    }

    logInfo('Auto-generated NPCs for burg', {
      campaignId,
      burgId,
      burgName: burg.name,
      count: created.length,
      names: created.map((n) => n.name),
    });

    return created;
  } catch (error) {
    logError('NPC auto-generation failed', {
      campaignId,
      burgId,
      error: error.message,
    });
    return [];
  }
}
