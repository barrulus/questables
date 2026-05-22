/**
 * NPC Extractor — runs after LLM narration to detect newly-introduced NPCs
 * and persist them as rows in `public.npcs`, with population caps and
 * demographic-aware quotas.
 *
 * Without this, NPCs introduced via narration ("an old woman in a faded
 * indigo headwrap") exist only as text in the chat transcript. Subsequent
 * narrations drift because there is no canonical entity to anchor to.
 *
 * Process:
 * 1. Look up the burg the player is in (or nearest), with its population.
 * 2. Compute the named-NPC cap for that burg.
 * 3. Load existing NPCs at that burg (with gender + age_group) so we can
 *    show the LLM the current demographic distribution.
 * 4. If at cap, skip extraction entirely — the village is already full.
 * 5. Otherwise pass the cap, distribution, and existing NPC list to the LLM
 *    so it can extract only NPCs that fit the remaining slots.
 * 6. Insert each new NPC with `auto_generated = true` and the player's
 *    coordinates / linked burg, plus a `first_meeting` row in `npc_memories`.
 */

import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { NARRATIVE_TYPES } from '../../llm/narrative-types.js';
import { buildEntityIndex } from './entity-resolver.js';

const AGE_GROUPS = ['child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elder'];

const NPC_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    npcs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A specific name OR a clearly identifying descriptor like "old woman in indigo headwrap" if no name was given.',
          },
          race: {
            type: 'string',
            description: 'Best-guess race (human, elf, dwarf, halfling, etc). Use "human" if unspecified.',
          },
          gender: {
            type: 'string',
            description: 'male, female, or unspecified',
          },
          age_group: {
            type: 'string',
            enum: AGE_GROUPS,
            description: 'Age category. Required.',
          },
          occupation: {
            type: 'string',
            description: 'Their role (herder, blacksmith, village elder, merchant, etc). Optional.',
          },
          appearance: {
            type: 'string',
            description: 'Brief physical description from the narration. Optional.',
          },
          personality: {
            type: 'string',
            description: 'Brief personality/disposition cue (worried, hostile, friendly, etc).',
          },
        },
        required: ['name', 'race', 'age_group', 'personality'],
      },
    },
  },
  required: ['npcs'],
};

const EXTRACT_SYSTEM_PROMPT = `You are an NPC extraction tool for a D&D campaign. Given a DM narration, extract any NPCs that were newly introduced.

RULES:
- Only extract NPCs explicitly mentioned in THIS narration. Do not invent.
- An NPC counts if they speak, act, or are clearly described as a present individual.
- Crowds, groups, or generic references ("the villagers", "some sailors") are NOT NPCs — skip those.
- If the narration mentions an NPC by name (e.g. "Karam the shepherd"), use that name.
- If the narration describes an NPC without naming them ("an old woman in a faded indigo headwrap"), use the descriptor as the name.
- A list of "Existing NPCs" is provided. SKIP any NPC that matches an entry in that list — they are already persisted.
- A "Population Cap" tells you the MAXIMUM number of new NPCs you may extract for this location. If the narration introduces more than the cap, extract only the most prominent ones up to the cap.
- A "Current Demographics" breakdown is provided. Avoid extracting NPCs that would make the demographics unrealistic (e.g. don't add a 5th elder to a hamlet of 10 that already has 4 elders).
- A "## Known entities" list of real settlements, NPCs, and shops is provided. If the narration anchors an NPC to a place not in Known settlements (e.g. names a village, tavern, or shop that is not listed), do NOT extract that NPC — they are tied to a fabricated location.
- If no NEW NPCs were introduced, return {"npcs": []}.`;

/**
 * Compute the maximum number of named NPCs a settlement should support
 * based on its population. Tiny hamlets get 3-5 named individuals; large
 * cities scale up but cap out at a reasonable game-relevant number.
 */
const computeNpcCap = (population) => {
  if (population == null || population <= 0) return 5; // wilderness / unknown
  if (population < 20) return Math.max(3, Math.floor(population * 0.4));
  if (population < 100) return Math.max(5, Math.floor(population * 0.2));
  if (population < 500) return Math.max(10, Math.floor(population * 0.1));
  if (population < 5000) return Math.max(20, Math.floor(population * 0.04));
  return 40; // big city — capped, players will only meet a fraction
};

/**
 * Compute a max-per-age-group quota so a 10-person hamlet can't end up
 * with 9 elders. These are soft proportions for a typical settlement.
 */
const computeAgeGroupCaps = (totalCap) => ({
  child: Math.max(1, Math.floor(totalCap * 0.15)),
  teen: Math.max(1, Math.floor(totalCap * 0.10)),
  young_adult: Math.max(1, Math.floor(totalCap * 0.20)),
  adult: Math.max(2, Math.floor(totalCap * 0.30)),
  middle_aged: Math.max(1, Math.floor(totalCap * 0.15)),
  elder: Math.max(1, Math.floor(totalCap * 0.10)),
});

const normaliseName = (name) => name.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();

const isDuplicateNpc = (extractedName, existingNpcs) => {
  const extracted = normaliseName(extractedName);
  if (!extracted) return true;
  for (const existing of existingNpcs) {
    const existingNorm = normaliseName(existing.name);
    if (existingNorm === extracted) return true;
    const extractedTokens = new Set(extracted.split(/\s+/).filter(Boolean));
    const existingTokens = new Set(existingNorm.split(/\s+/).filter(Boolean));
    if (extractedTokens.size > 0 && [...extractedTokens].every((t) => existingTokens.has(t))) return true;
    if (existingTokens.size > 0 && [...existingTokens].every((t) => extractedTokens.has(t))) return true;
  }
  return false;
};

/**
 * Resolve the burg the NPC extraction should be scoped to.
 * Prefers `insideBurgId`, falls back to nearest burg by player coordinates.
 */
async function resolveScopeBurg(campaignId, locX, locY, insideBurgId) {
  if (insideBurgId) {
    const { rows } = await query(
      `SELECT id, name, population FROM public.maps_burgs WHERE id = $1`,
      [insideBurgId],
    );
    if (rows[0]) return rows[0];
  }

  if (typeof locX === 'number' && typeof locY === 'number') {
    const { rows } = await query(
      `SELECT b.id, b.name, b.population
         FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
        ORDER BY ST_Distance(b.geom, ST_SetSRID(ST_MakePoint($2, $3), 0))
        LIMIT 1`,
      [campaignId, locX, locY],
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

/**
 * Extract NPCs from a narration and persist any new ones to the npcs table.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.narrationContent
 * @param {object} opts.llmService - Enhanced LLM service
 * @param {string} [opts.sessionId]
 * @param {string} [opts.actingCharacterId]
 * @param {number} [opts.locX]
 * @param {number} [opts.locY]
 * @param {string} [opts.insideBurgId]
 * @param {string} [opts.sourceMessageId] - chat_messages.id this narration came from; FK ON DELETE CASCADE so deleting the narration removes the NPCs it spawned.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function extractAndPersistNpcs({
  campaignId,
  narrationContent,
  llmService,
  sessionId = null,
  actingCharacterId = null,
  locX = null,
  locY = null,
  insideBurgId = null,
  currentScene = null,
  sourceMessageId = null,
}) {
  if (!narrationContent || narrationContent.length < 30) {
    return [];
  }

  try {
    // 1. Resolve the burg this extraction is scoped to
    const burg = await resolveScopeBurg(campaignId, locX, locY, insideBurgId);
    const population = burg?.population ?? null;
    const totalCap = computeNpcCap(population);
    const ageCaps = computeAgeGroupCaps(totalCap);
    const burgLabel = burg?.name ? `${burg.name} (population ~${population ?? 'unknown'})` : 'wilderness';

    // 1b. Load active player character names so we never extract a PC as an NPC.
    // The LLM will mention character names constantly in narration ("Asmodeus
    // crouches near the well") and the extractor should NEVER persist them as
    // NPCs — that turns the player's own character into an NPC the DM can
    // narrate at, which is a player-agency violation and a bookkeeping mess.
    const { rows: playerCharRows } = await query(
      `SELECT c.name
         FROM public.characters c
         JOIN public.campaign_players cp ON cp.character_id = c.id
        WHERE cp.campaign_id = $1 AND cp.status = 'active' AND c.name IS NOT NULL`,
      [campaignId],
    );
    const playerCharNames = new Set(playerCharRows.map((r) => normaliseName(r.name)).filter(Boolean));

    // 1c. Build the Known entities index for prompt injection.
    const entityIndex = await buildEntityIndex({
      campaignId,
      scope: { insideBurgId, locX, locY },
    });
    const formatList = (label, items) =>
      items.length === 0 ? null : `${label}: ${items.map((i) => i.name).join(', ')}`;
    const knownLines = [
      formatList('Settlements', entityIndex.burgs),
      formatList('NPCs', entityIndex.npcs),
      formatList('Locations', entityIndex.locations),
      formatList('Shops', entityIndex.shops),
    ].filter(Boolean);
    const knownBlock = knownLines.length > 0 ? knownLines.join('\n') : '(none)';

    // 2. Load existing NPCs scoped to this burg (or nearby if no burg)
    let existingNpcs;
    if (burg?.id) {
      ({ rows: existingNpcs } = await query(
        `SELECT id, name, gender, age_group, occupation
           FROM public.npcs
          WHERE campaign_id = $1 AND linked_burg_id = $2`,
        [campaignId, burg.id],
      ));
    } else if (typeof locX === 'number' && typeof locY === 'number') {
      ({ rows: existingNpcs } = await query(
        `SELECT id, name, gender, age_group, occupation
           FROM public.npcs
          WHERE campaign_id = $1
            AND world_position IS NOT NULL
            AND ST_Distance(world_position, ST_SetSRID(ST_MakePoint($2, $3), 0)) <= 5000`,
        [campaignId, locX, locY],
      ));
    } else {
      ({ rows: existingNpcs } = await query(
        `SELECT id, name, gender, age_group, occupation FROM public.npcs WHERE campaign_id = $1`,
        [campaignId],
      ));
    }

    // 3. Hard cap check
    const remainingSlots = Math.max(0, totalCap - existingNpcs.length);
    if (remainingSlots === 0) {
      logInfo('NPC extractor: location at population cap, skipping', {
        campaignId,
        burg: burg?.name,
        existing: existingNpcs.length,
        cap: totalCap,
      });
      return [];
    }

    // 4. Compute current age distribution and remaining per age group
    const currentDist = AGE_GROUPS.reduce((acc, g) => ({ ...acc, [g]: 0 }), {});
    for (const n of existingNpcs) {
      if (n.age_group && currentDist[n.age_group] != null) currentDist[n.age_group] += 1;
    }
    const remainingByAge = {};
    for (const g of AGE_GROUPS) {
      remainingByAge[g] = Math.max(0, ageCaps[g] - currentDist[g]);
    }

    // 5. Build the user prompt with all the constraints
    const existingList = existingNpcs.length > 0
      ? existingNpcs
          .map((r) => `- ${r.name}${r.gender ? ` (${r.gender}` : ''}${r.age_group ? `${r.gender ? ', ' : ' ('}${r.age_group}` : ''}${r.gender || r.age_group ? ')' : ''}${r.occupation ? ` — ${r.occupation}` : ''}`)
          .join('\n')
      : '(none)';

    const distSummary = AGE_GROUPS
      .map((g) => `${g}: ${currentDist[g]}/${ageCaps[g]} (${remainingByAge[g]} slots free)`)
      .join('\n');

    const userPrompt = `## Known entities (do NOT anchor NPCs to places not in this list)
${knownBlock}

## Location
${burgLabel}

## Population Cap
This location can support at most ${totalCap} named NPCs total.
You may extract at most ${remainingSlots} new NPC(s) from this narration.

## Current Demographics
${distSummary}

## Existing NPCs at This Location (DO NOT re-extract these)
${existingList}

## New Narration to Analyse
${narrationContent}`;

    const result = await llmService.generate({
      type: NARRATIVE_TYPES.LORE_EXTRACTION,
      prompt: userPrompt,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      schema: NPC_EXTRACT_SCHEMA,
    });

    let extracted = [];
    try {
      const parsed = result.parsed ?? JSON.parse(result.content || '{}');
      extracted = Array.isArray(parsed.npcs) ? parsed.npcs : [];
    } catch {
      logInfo('NPC extractor: no parseable NPCs from LLM response', { campaignId });
      return [];
    }

    if (extracted.length === 0) {
      return [];
    }

    // 6. Validate, dedupe, enforce cap and demographic quotas
    const newNpcs = [];
    const ageRunningCount = { ...currentDist };
    for (const n of extracted) {
      if (newNpcs.length >= remainingSlots) break;
      if (!n?.name?.trim() || !n?.race?.trim() || !n?.personality?.trim() || !n?.age_group) continue;
      if (!AGE_GROUPS.includes(n.age_group)) continue;
      // Reject extracted NPCs whose name matches an active player character.
      if (playerCharNames.has(normaliseName(n.name))) {
        logInfo('NPC extractor: rejected — name matches a player character', {
          campaignId,
          name: n.name,
        });
        continue;
      }
      if (isDuplicateNpc(n.name, existingNpcs)) continue;
      // Demographic cap: would adding this NPC exceed the age group quota?
      if (ageRunningCount[n.age_group] >= ageCaps[n.age_group]) {
        logInfo('NPC extractor: rejected NPC, age group full', {
          campaignId,
          name: n.name,
          age_group: n.age_group,
          cap: ageCaps[n.age_group],
        });
        continue;
      }
      ageRunningCount[n.age_group] += 1;
      newNpcs.push(n);
    }

    if (newNpcs.length === 0) {
      logInfo('NPC extractor: no NPCs survived validation', { campaignId });
      return [];
    }

    // 7. Persist new NPCs
    const persisted = [];
    for (const npc of newNpcs) {
      try {
        const occupation = npc.occupation?.trim() || null;
        const appearance = npc.appearance?.trim() || null;
        const gender = npc.gender?.trim() || null;
        const description = burg?.name ? `First seen at ${burg.name}` : null;

        const hasLoc = typeof locX === 'number' && typeof locY === 'number';
        const insertSql = hasLoc
          ? `INSERT INTO public.npcs (campaign_id, name, race, occupation, appearance, personality, description, world_position, linked_burg_id, gender, age_group, scene_tag, source_message_id, auto_generated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 0), $10, $11, $12, $13, $14, true)
             RETURNING id, name`
          : `INSERT INTO public.npcs (campaign_id, name, race, occupation, appearance, personality, description, linked_burg_id, gender, age_group, scene_tag, source_message_id, auto_generated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
             RETURNING id, name`;

        const insertParams = hasLoc
          ? [campaignId, npc.name.trim(), npc.race.trim(), occupation, appearance, npc.personality.trim(), description, locX, locY, burg?.id ?? insideBurgId, gender, npc.age_group, currentScene, sourceMessageId]
          : [campaignId, npc.name.trim(), npc.race.trim(), occupation, appearance, npc.personality.trim(), description, burg?.id ?? insideBurgId, gender, npc.age_group, currentScene, sourceMessageId];

        const { rows } = await query(insertSql, insertParams);
        if (rows.length === 0) continue;

        const npcRow = rows[0];
        persisted.push(npcRow);

        // First meeting memory
        if (actingCharacterId && sessionId) {
          await query(
            `INSERT INTO public.npc_memories (npc_id, campaign_id, session_id, memory_summary, sentiment, trust_delta, tags)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              npcRow.id,
              campaignId,
              sessionId,
              `First meeting with the party. ${npc.appearance ? `Appearance: ${npc.appearance}.` : ''} ${npc.personality}`.trim(),
              'neutral',
              0,
              ['first_meeting', 'auto_generated'],
            ],
          );
        }
      } catch (err) {
        logError('NPC extractor: failed to persist NPC', { campaignId, npc, error: err.message });
      }
    }

    if (persisted.length > 0) {
      logInfo('NPC extractor: NPCs persisted', {
        campaignId,
        burg: burg?.name,
        cap: totalCap,
        existing: existingNpcs.length,
        added: persisted.length,
        names: persisted.map((p) => p.name),
      });
    }

    return persisted;
  } catch (err) {
    logError('NPC extractor: extraction failed', { campaignId, error: err.message });
    return [];
  }
}
