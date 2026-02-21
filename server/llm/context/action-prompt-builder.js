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
  attack: 'Attack a target',
  dash: 'Dash (double movement)',
  dodge: 'Dodge (impose disadvantage on attacks)',
  disengage: 'Disengage (avoid opportunity attacks)',
  help: 'Help an ally (grant advantage)',
  hide: 'Hide (attempt to become unseen)',
  ready: 'Ready an action (trigger on condition)',
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

export const DM_COMBAT_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. You are resolving a combat action.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: a vivid, immersive description of the combat action (2-4 sentences).
- For attack actions: if the action requires an attack roll, populate "requiredRolls" with rollType "attack_roll" and set DC to the target's AC.
- For saving throws: populate "requiredRolls" with rollType "saving_throw", the relevant ability, and appropriate DC.
- If the attack hits or the spell takes effect, populate "mechanicalOutcome" with damage, healing, or condition effects.
- For concentration spells, include mechanicalOutcome type "concentration_start" with the spell name.
- Keep damage values realistic for D&D 5e. A longsword does 1d8+STR, a fireball does 8d6, etc.
- "privateMessage" is for information only the acting player should see.
- Do NOT invent NPCs, locations, or items not present in the combat context.`;

export const DM_ENEMY_TURN_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. You are controlling an enemy combatant during their turn in combat.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: describe the enemy's action vividly (2-3 sentences).
- Choose a tactically reasonable action for the enemy based on their stat block and the combat situation.
- If attacking, populate "mechanicalOutcome" with type "damage" and a reasonable amount based on the enemy's attacks.
- If the enemy uses a special ability, describe it in narration and apply appropriate mechanical effects.
- Target the most tactically logical PC (closest, weakest, most threatening).
- Keep damage values realistic for the enemy's capabilities.
- Do NOT have the enemy do something outside their stat block capabilities.`;

export const DM_SOCIAL_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A player is engaging in social dialogue with an NPC. You must respond IN CHARACTER as the NPC.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: describe the NPC's response, body language, and any environmental details (2-4 sentences). Write the NPC's dialogue within the narration.
- Stay true to the NPC's personality, motivations, and secrets. The NPC should NOT reveal secrets easily.
- Use the NPC's memories and relationship history to inform their disposition toward the player.
- If the player attempts persuasion, deception, intimidation, or insight, populate "requiredRolls" with the appropriate skill check and a reasonable DC.
- Populate "npcSentimentUpdate" with how the NPC's disposition shifted: trustDelta (-3 to +3), sentiment, and a brief memorySummary of what the NPC will remember about this interaction.
- "privateMessage" can reveal the NPC's internal thoughts or hidden reactions to the player.
- Do NOT break character. The NPC should respond naturally based on their personality.
- Keep DCs reasonable: easy=10, medium=15, hard=20, very hard=25.`;

/**
 * Build the prompt for a social dialogue action with NPC context.
 */
export function buildSocialActionPrompt({
  character,
  liveState,
  actionType,
  actionPayload,
  npcContext,
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
Live State: ${formatLiveState(liveState)}`);

  // NPC detail
  if (npcContext?.npc) {
    const npc = npcContext.npc;
    const npcParts = [`Name: ${npc.name}`];
    if (npc.race) npcParts.push(`Race: ${npc.race}`);
    if (npc.occupation) npcParts.push(`Occupation: ${npc.occupation}`);
    if (npc.personality) npcParts.push(`Personality: ${npc.personality}`);
    if (npc.motivations) npcParts.push(`Motivations: ${npc.motivations}`);
    if (npc.secrets) npcParts.push(`Secrets (hidden from player): ${npc.secrets}`);
    if (npc.appearance) npcParts.push(`Appearance: ${npc.appearance}`);
    sections.push(`## NPC\n${npcParts.join('\n')}`);
  }

  // NPC memories
  if (npcContext?.memories?.length > 0) {
    const memList = npcContext.memories
      .map((m) => `- [${m.sentiment}] ${m.memory_summary} (trust: ${m.trust_delta > 0 ? '+' : ''}${m.trust_delta})`)
      .join('\n');
    sections.push(`## NPC Memories of Past Interactions\n${memList}`);
  }

  // NPC relationship with this character
  if (npcContext?.relationship) {
    const rel = npcContext.relationship;
    sections.push(`## Relationship with ${character.name}
Type: ${rel.relationship_type ?? 'unknown'}
Trust Level: ${rel.strength ?? 0}`);
  }

  // Declared action
  const socialAction = actionPayload?.socialAction ?? 'speak';
  const dialogue = actionPayload?.dialogue ?? '';
  sections.push(`## Social Action
Action: ${socialAction}
${dialogue ? `Player says: "${dialogue}"` : `Player attempts to ${socialAction}.`}`);

  // Roll result
  if (rollResult) {
    sections.push(`## Roll Result\n${JSON.stringify(rollResult)}`);
  }

  // Recent narrations
  if (recentNarrations?.length > 0) {
    const narrationText = recentNarrations
      .slice(-5)
      .map((n, i) => `${i + 1}. ${n}`)
      .join('\n');
    sections.push(`## Recent Dialogue\n${narrationText}`);
  }

  return sections.join('\n\n');
}

export const DM_WORLD_TURN_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. A full round of player actions has completed. Narrate the world's response.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: describe environmental changes, NPC reactions, and atmospheric shifts (3-5 sentences).
- If the round's events should trigger a phase transition, populate "phaseTransition".
- "stateChanges" can note NPC disposition shifts or quest flag updates.
- Do NOT invent NPCs, locations, or items not present in the scene context.`;

/**
 * Build the prompt for a combat action resolution.
 */
export function buildCombatActionPrompt({
  character,
  liveState,
  actionType,
  actionPayload,
  allCombatants,
  turnOrder,
  roundNumber,
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
  sections.push(`## Combat Action
Type: ${actionLabel}
Details: ${JSON.stringify(actionPayload)}`);

  // Roll result
  if (rollResult) {
    sections.push(`## Roll Result
${JSON.stringify(rollResult)}`);
  }

  // All combatants
  if (allCombatants?.length > 0) {
    const combatantList = allCombatants
      .map((c) => {
        const hp = typeof c.hit_points === 'object' ? c.hit_points : {};
        return `- ${c.name} (${c.participant_type}): HP ${hp.current ?? '?'}/${hp.max ?? '?'}, AC ${c.armor_class}, Initiative ${c.initiative ?? '?'}${c.conditions?.length ? `, Conditions: ${JSON.stringify(c.conditions)}` : ''}`;
      })
      .join('\n');
    sections.push(`## Combatants\n${combatantList}`);
  }

  // Turn order context
  if (turnOrder?.length > 0) {
    sections.push(`## Initiative Order (Round ${roundNumber ?? 1})
${turnOrder.join(' → ')}`);
  }

  return sections.join('\n\n');
}

/**
 * Build the prompt for an LLM-controlled enemy turn.
 */
export function buildEnemyTurnPrompt({
  enemy,
  allCombatants,
  liveStates,
}) {
  const sections = [];

  // Enemy stat block
  const hp = typeof enemy.hit_points === 'object' ? enemy.hit_points : {};
  sections.push(`## Acting Enemy
Name: ${enemy.name}
Type: ${enemy.participant_type}
HP: ${hp.current ?? '?'}/${hp.max ?? '?'}
AC: ${enemy.armor_class}
Conditions: ${enemy.conditions?.length ? JSON.stringify(enemy.conditions) : 'None'}
${enemy.npc_description ? `Description: ${enemy.npc_description}` : ''}
${enemy.personality ? `Personality: ${enemy.personality}` : ''}`);

  // All combatants
  if (allCombatants?.length > 0) {
    const combatantList = allCombatants
      .map((c) => {
        const cHp = typeof c.hit_points === 'object' ? c.hit_points : {};
        const isEnemy = c.id === enemy.id;
        return `- ${c.name} (${c.participant_type})${isEnemy ? ' [ACTING]' : ''}: HP ${cHp.current ?? '?'}/${cHp.max ?? '?'}, AC ${c.armor_class}${c.conditions?.length ? `, Conditions: ${JSON.stringify(c.conditions)}` : ''}`;
      })
      .join('\n');
    sections.push(`## All Combatants\n${combatantList}`);
  }

  // PC live states for more detail
  if (Array.isArray(liveStates) && liveStates.length > 0) {
    const pcList = liveStates
      .map((s) => `- ${s.character_name ?? s.character_id}: HP ${s.hp_current}/${s.hp_max}, AC unknown, Conditions: ${s.conditions?.length ? s.conditions.join(', ') : 'None'}`)
      .join('\n');
    sections.push(`## Player Character Details\n${pcList}`);
  }

  sections.push(`## Instructions
Choose the most tactically appropriate action for ${enemy.name}. Consider:
- Which PC is the biggest threat or the most vulnerable?
- What attacks/abilities does this enemy have?
- Should the enemy move, attack, use a special ability, or retreat?

Respond with a narration of the enemy's action and any mechanical outcomes (damage dealt, conditions applied, etc.).`);

  return sections.join('\n\n');
}
