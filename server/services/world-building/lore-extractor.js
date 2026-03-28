/**
 * Lore Extractor — runs after LLM narration to extract and persist key facts.
 *
 * After every LLM interaction (narration, action result, world turn), this
 * service makes a lightweight LLM call to extract any new world facts introduced
 * in the narration. Extracted facts are persisted as targeted campaign_world_lore
 * records keyed to the relevant location/state/religion.
 *
 * This is how the world builds itself organically during gameplay.
 */

import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';

const LORE_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Category: npc, location, event, custom, political, cultural, religious' },
          subsection: { type: 'string', description: 'Specific entity name (NPC name, burg name, state name, etc.)' },
          content: { type: 'string', description: 'The fact or detail to remember, written as a concise statement' },
        },
        required: ['section', 'subsection', 'content'],
      },
    },
  },
  required: ['facts'],
};

const EXTRACT_SYSTEM_PROMPT = `You are a lore extraction tool. Given a narration from a D&D game session, extract any NEW world facts that were introduced. Only extract facts that would be useful to remember for future sessions.

Extract facts about:
- NPCs mentioned (name, role, disposition, location)
- Locations described (features, atmosphere, notable details)
- Events that occurred (what happened, who was involved)
- Political or cultural details revealed
- Religious or magical phenomena

Rules:
- Only extract facts explicitly stated in the narration — do NOT invent or infer
- Each fact should be a single, concise statement (1-2 sentences)
- Use the entity name as the subsection (e.g., "Grumbar the Blacksmith", "Millhaven", "Cheth Empire")
- If no new facts worth remembering, return an empty facts array
- Do NOT extract player actions or dice rolls — only world-building details`;

const VALID_SECTIONS = new Set(['npc', 'location', 'event', 'custom', 'political', 'cultural', 'religious']);

/**
 * Extract lore facts from a narration and persist them.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.narrationContent - The LLM narration text to extract from
 * @param {object} opts.llmService - Enhanced LLM service
 * @param {number} [opts.locX] - X coordinate where narration occurred
 * @param {number} [opts.locY] - Y coordinate where narration occurred
 * @param {string} [opts.insideBurgId] - Burg ID if inside a settlement
 */
export async function extractAndPersistLore({
  campaignId,
  narrationContent,
  llmService,
  locX = null,
  locY = null,
  insideBurgId = null,
}) {
  if (!narrationContent || narrationContent.length < 50) {
    return []; // Too short to contain meaningful lore
  }

  try {
    const result = await llmService.generate({
      type: NARRATIVE_TYPES.LORE_EXTRACTION,
      prompt: `Extract world-building facts from this narration:\n\n${narrationContent}`,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      schema: LORE_EXTRACT_SCHEMA,
    });

    let facts = [];
    const raw = result.content || '';
    try {
      const parsed = result.parsed ?? JSON.parse(raw);
      facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    } catch {
      logInfo('Lore extractor: no parseable facts from LLM response', { campaignId });
      return [];
    }

    // Filter to valid sections and non-empty content
    const validFacts = facts.filter(
      (f) => VALID_SECTIONS.has(f.section) && f.subsection?.trim() && f.content?.trim()
    );

    if (validFacts.length === 0) {
      logInfo('Lore extractor: no new facts found', { campaignId });
      return [];
    }

    // Persist each fact as a campaign_world_lore record
    const persisted = [];
    for (const fact of validFacts) {
      try {
        const { rows } = await query(
          `INSERT INTO campaign_world_lore (campaign_id, section, subsection, content, generated_by)
           VALUES ($1, $2, $3, $4, 'llm')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [campaignId, fact.section, fact.subsection.trim(), fact.content.trim()],
          { label: 'lore-extractor.persist' },
        );
        if (rows.length) {
          persisted.push({ id: rows[0].id, section: fact.section, subsection: fact.subsection });
        }
      } catch (err) {
        logError('Lore extractor: failed to persist fact', { campaignId, fact, error: err.message });
      }
    }

    logInfo('Lore extractor: facts persisted', {
      campaignId,
      extracted: validFacts.length,
      persisted: persisted.length,
      sections: persisted.map((p) => `${p.section}:${p.subsection}`),
    });

    return persisted;
  } catch (err) {
    logError('Lore extractor: extraction failed', { campaignId, error: err.message });
    return [];
  }
}
