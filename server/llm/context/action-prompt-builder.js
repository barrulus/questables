/**
 * Builds action-specific prompts for the DM action resolution LLM calls.
 * Extends base context from LLMContextManager with player-specific data.
 */

const ACTION_TYPE_LABELS = {
  move: 'Move to a new location',
  interact: 'Interact with an object or environment',
  search: 'Search the area',
  use_item: 'Use an item',
  cast_spell: 'Cast a spell',
  talk_to_npc: 'Talk to an NPC',
  pass: 'Pass (do nothing)',
  free_action: 'Free action',
};

const formatAbilities = (abilities) => {
  if (!abilities || typeof abilities !== 'object') return 'Unknown';
  return Object.entries(abilities)
    .map(([key, val]) => `${key}: ${val}`)
    .join(', ');
};

const formatLiveState = (liveState) => {
  if (!liveState) return 'No live state available.';
  const parts = [
    `HP: ${liveState.hp_current}/${liveState.hp_max}`,
  ];
  if (liveState.hp_temporary > 0) parts.push(`Temp HP: ${liveState.hp_temporary}`);
  if (liveState.conditions?.length > 0) parts.push(`Conditions: ${liveState.conditions.join(', ')}`);
  if (liveState.inspiration) parts.push('Has Inspiration');
  return parts.join(' | ');
};

const DM_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. You are processing a player's declared action during the exploration phase.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: a vivid, immersive description of what happens (2-4 sentences).
- If the action requires a dice roll (ability check, saving throw, attack roll, or skill check), populate "requiredRolls" with the roll details and set DC appropriately.
- If the action has immediate mechanical effects (damage, healing, conditions), populate "mechanicalOutcome".
- If the action should trigger a phase transition (e.g., a search reveals enemies → combat), populate "phaseTransition".
- "privateMessage" is for information only the acting player should see (secrets, hidden knowledge).
- Do NOT invent NPCs, locations, or items not present in the scene context.
- Keep DCs reasonable: easy=10, medium=15, hard=20, very hard=25.`;

/**
 * Build the user prompt for a player action resolution.
 */
export function buildActionPrompt({
  character,
  liveState,
  actionType,
  actionPayload,
  sceneContext,
  recentNarrations,
  rollResult,
}) {
  const sections = [];

  // Character stat block
  sections.push(`## Acting Character
Name: ${character.name}
Class: ${character.class} (Level ${character.level})
Race: ${character.race}
Abilities: ${formatAbilities(character.abilities)}
AC: ${character.armor_class}, Speed: ${character.speed}
Live State: ${formatLiveState(liveState)}`);

  // Declared action
  const actionLabel = ACTION_TYPE_LABELS[actionType] || actionType;
  sections.push(`## Declared Action
Type: ${actionLabel}
Details: ${JSON.stringify(actionPayload)}`);

  // Roll result (if re-invocation after roll)
  if (rollResult) {
    sections.push(`## Roll Result
${JSON.stringify(rollResult)}`);
  }

  // Scene context
  if (sceneContext) {
    const sceneParts = [];
    if (sceneContext.locationName) sceneParts.push(`Location: ${sceneContext.locationName}`);
    if (sceneContext.visibleNpcs?.length > 0) {
      sceneParts.push(`Visible NPCs: ${sceneContext.visibleNpcs.map((n) => n.name).join(', ')}`);
    }
    if (sceneContext.regionTags?.length > 0) {
      sceneParts.push(`Region Tags: ${sceneContext.regionTags.join(', ')}`);
    }
    if (sceneContext.description) sceneParts.push(`Scene: ${sceneContext.description}`);
    if (sceneParts.length > 0) {
      sections.push(`## Scene Context\n${sceneParts.join('\n')}`);
    }
  }

  // Recent narrations
  if (recentNarrations?.length > 0) {
    const narrationText = recentNarrations
      .slice(-5)
      .map((n, i) => `${i + 1}. ${n}`)
      .join('\n');
    sections.push(`## Recent Narrations\n${narrationText}`);
  }

  return sections.join('\n\n');
}

/**
 * Build the prompt for a DM world turn narration.
 */
export function buildWorldTurnPrompt({
  gameState,
  recentActions,
  sceneContext,
}) {
  const sections = [];

  sections.push(`## World Turn
Round ${gameState.roundNumber} has completed. All players have acted. Describe what happens in the world as a result of the round's events.`);

  if (recentActions?.length > 0) {
    const actionSummary = recentActions
      .map((a) => `- ${a.characterName}: ${a.actionType} → ${a.narration || 'pending'}`)
      .join('\n');
    sections.push(`## Actions This Round\n${actionSummary}`);
  }

  if (sceneContext?.description) {
    sections.push(`## Current Scene\n${sceneContext.description}`);
  }

  return sections.join('\n\n');
}

export const DM_ACTION_SYSTEM_PROMPT = DM_SYSTEM_PROMPT;

export const DM_WORLD_TURN_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A full round of player actions has completed. Narrate the world's response.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: describe environmental changes, NPC reactions, and atmospheric shifts (3-5 sentences).
- If the round's events should trigger a phase transition, populate "phaseTransition".
- "stateChanges" can note NPC disposition shifts or quest flag updates.
- Do NOT invent NPCs, locations, or items not present in the scene context.`;
