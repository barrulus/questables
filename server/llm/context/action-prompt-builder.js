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

const DM_SYSTEM_PROMPT = `You are the Dungeon Master for a D&D 5e campaign. Act like a tabletop DM running a live game with friends — not a novelist.

RESPONSE LENGTH (STRICT):
- Maximum 3 sentences in "narration". Hard limit.
- No scene-setting, no weather, no atmosphere, no character descriptions, no internal monologue.
- Describe ONLY what happens as a direct result of the player's action.
- If a player asks a question, answer it as the world/an NPC would. Do not narrate around it.

CONTINUITY (CRITICAL):
- The "Session Transcript So Far" is the canonical history. Treat it like a stenographer's record.
- Any NPC mentioned in the transcript MUST keep the same gender, name, appearance, and role. Never introduce a "new" NPC to fill the same role.
- Any location, direction, or detail mentioned in the transcript MUST stay consistent. If the transcript says "western hills", do NOT say "eastern slopes".
- Continue exactly from where the last entry left off. Do not restart, recap, or re-establish the scene.
- Use the Campaign Brief and Session Brief to ground the story.

SCENES AND SCENE TRANSITIONS (CRITICAL):
- A "scene" is a specific sub-location: a room, a building, a corner of a square, an open shrine. The "Current sub-scene" line in the Scene Context tells you exactly where the player is right now.
- The "NPCs at this location" list is already filtered to only NPCs in the player's current scene. Use them — and ONLY them — when narrating who is present.
- When the player's action moves them to a NEW scene (entering a building, walking to a different group of people, going outside, leaving a room), you MUST populate the "sceneTransition" field in your response:
    sceneTransition: { newScene: "inside Kael's cottage", npcsInScene: ["young Kael"] }
  - "newScene" is a short descriptor of where the player now is.
  - "npcsInScene" lists the NPCs (by name) who are physically present in the new scene. ONLY include NPCs that should be there.
- Once you set a sceneTransition, the listed NPCs become anchored to that scene. Other NPCs from the previous scene are NOT present.
- If no scene change occurs, leave sceneTransition null.
- If the player addresses a SPECIFIC NPC by name, that NPC alone is the speaker. Do not have other NPCs present unless the player explicitly addresses them too.

GROUNDING:
- ONLY reference locations, NPCs, and landmarks that appear in the provided context (Campaign Brief, Session Brief, Scene Context, nearby burgs/routes/markers).
- NEVER invent place names, NPCs, or lore. If you don't have information, say the character doesn't know or have an NPC say so.
- If the player asks for directions, use the real nearby burgs/routes from the geographic context.

MECHANICS:
- Respond ONLY with valid JSON matching the required schema.
- If the action requires a dice roll, populate "requiredRolls" with roll details and set DC appropriately.
- If the action has immediate mechanical effects (damage, healing, conditions), populate "mechanicalOutcome".
- If the action should trigger a phase transition (e.g., a search reveals enemies → combat), populate "phaseTransition".
- "privateMessage" is for information only the acting player should see (secrets, hidden knowledge).
- Keep DCs reasonable: easy=10, medium=15, hard=20, very hard=25.`;

/**
 * Build the user prompt for a player action resolution.
 */
export function buildActionPrompt({
  character,
  liveState,
  actionType,
  actionPayload,
  campaignBrief,
  sessionBrief,
  sceneContext,
  currentScene,
  recentNarrations,
  rollResult,
}) {
  const sections = [];

  // Campaign brief — what is this campaign about?
  if (campaignBrief) {
    const briefParts = [];
    if (campaignBrief.name) briefParts.push(`Name: ${campaignBrief.name}`);
    if (campaignBrief.description) briefParts.push(`Premise: ${campaignBrief.description}`);
    if (campaignBrief.setting) briefParts.push(`Setting: ${campaignBrief.setting}`);
    if (briefParts.length > 0) {
      sections.push(`## Campaign Brief\n${briefParts.join('\n')}`);
    }
  }

  // Session brief — what is happening in this session?
  if (sessionBrief) {
    const sessionParts = [];
    if (sessionBrief.title) sessionParts.push(`Title: ${sessionBrief.title}`);
    if (sessionBrief.summary) sessionParts.push(`Summary: ${sessionBrief.summary}`);
    if (sessionBrief.dmFocus) sessionParts.push(`Current focus: ${sessionBrief.dmFocus}`);
    if (sessionBrief.dmNotes) sessionParts.push(`DM notes: ${sessionBrief.dmNotes}`);
    if (sessionParts.length > 0) {
      sections.push(`## Session Brief\n${sessionParts.join('\n')}`);
    }
  }

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
  const playerMessage = actionPayload?.originalChatMessage;
  sections.push(`## Declared Action
Type: ${actionLabel}
${playerMessage ? `Player says: "${playerMessage}"` : `Details: ${JSON.stringify(actionPayload)}`}`);

  // Roll result (if re-invocation after roll)
  if (rollResult) {
    sections.push(`## Roll Result
${JSON.stringify(rollResult)}`);
  }

  // Scene context
  if (sceneContext) {
    const sceneParts = [];
    if (sceneContext.locationName) sceneParts.push(`Geographic location: ${sceneContext.locationName}`);
    if (currentScene) sceneParts.push(`Current sub-scene: ${currentScene} (only NPCs in this sub-scene are present)`);
    if (sceneContext.visibleNpcs?.length > 0) {
      const npcLines = sceneContext.visibleNpcs.map((n) => {
        const demo = [n.gender, n.age_group, n.race].filter(Boolean).join(' ');
        const parts = [`- ${n.name}`];
        if (demo) parts.push(`(${demo}${n.occupation ? `, ${n.occupation}` : ''})`);
        if (n.personality) parts.push(`— ${n.personality}`);
        return parts.join(' ');
      }).join('\n');
      sceneParts.push(`NPCs at this location (use these EXACT NPCs — do not invent new ones for the same role):\n${npcLines}`);
    }
    if (sceneContext.otherPlayers?.length > 0) {
      const playerList = sceneContext.otherPlayers
        .map((p) => `${p.character_name} (${p.character_race} ${p.character_class}, Level ${p.character_level}, played by ${p.username})`)
        .join(', ');
      sceneParts.push(`Other party members: ${playerList}`);
    }
    if (sceneContext.regionTags?.length > 0) {
      sceneParts.push(`Region Tags: ${sceneContext.regionTags.join(', ')}`);
    }
    if (sceneContext.description) sceneParts.push(`Scene: ${sceneContext.description}`);
    if (sceneParts.length > 0) {
      sections.push(`## Scene Context\n${sceneParts.join('\n')}`);
    }
  }

  // Recent transcript — what the players have actually seen so far this session.
  // Includes both [DM] narrations and player chat messages, in chronological order.
  // This is the canonical history. NPCs, locations, and details mentioned here MUST
  // remain consistent in the new narration.
  if (recentNarrations?.length > 0) {
    const transcript = recentNarrations.join('\n\n');
    sections.push(`## Session Transcript So Far (canonical — DO NOT contradict)\n${transcript}`);
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

    // Inject NPC voice style if configured
    const vc = npc.voice_config || npc.voiceConfig;
    if (vc && (vc.speechStyle || vc.tone || vc.customInstructions)) {
      const voiceParts = [];
      if (vc.speechStyle) voiceParts.push(`Speech style: ${vc.speechStyle}`);
      if (vc.tone) voiceParts.push(`Tone: ${vc.tone}`);
      if (vc.customInstructions) voiceParts.push(`Instructions: ${vc.customInstructions}`);
      sections.push(`## NPC Voice Style\n${voiceParts.join('\n')}`);
    }
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

// ── Chat Action Intent Parsing ──────────────────────────────────────────────

export const CHAT_ACTION_PARSE_SYSTEM_PROMPT = `You are a D&D 5e game action classifier. A player has typed a natural language message during their turn. Your job is to classify it into a structured game action.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- Determine the most appropriate actionType from the available options.
- If the message is clearly out-of-character chat, a question about rules, or checking inventory/stats, set isFreeAction to true.
- If the message describes a game action (moving, attacking, searching, talking, casting), set isFreeAction to false.
- The "target" field should name the object, NPC, or location the action is directed at.
- The "narrationHint" field should be a brief suggestion for the DM about how to resolve this.
- If unclear, default to "custom" actionType and let the DM resolve creatively.`;

/**
 * Build the user prompt for classifying a natural language chat message into an action.
 */
export function buildChatActionParsePrompt({
  characterName,
  characterClass,
  characterLevel,
  phase,
  chatMessage,
  visibleNpcs,
  recentNarrations,
}) {
  const sections = [
    `## Player Character\n${characterName} (Level ${characterLevel} ${characterClass})`,
    `## Current Phase\n${phase}`,
    `## Player's Message\n"${chatMessage}"`,
  ];

  if (visibleNpcs?.length > 0) {
    const npcList = visibleNpcs.map((n) => `- ${n.name} (${n.occupation ?? 'unknown role'})`).join('\n');
    sections.push(`## Nearby NPCs\n${npcList}`);
  }

  if (recentNarrations?.length > 0) {
    sections.push(`## Recent Events\n${recentNarrations.slice(-3).join('\n')}`);
  }

  sections.push(`## Instructions
Classify the player's message into a game action. Consider the current phase and context.
Valid action types: move, interact, search, use_item, cast_spell, talk_to_npc, pass, free_action, attack, dash, dodge, disengage, help, hide, ready, custom.
If this is just chat/OOC/a question, set isFreeAction=true and actionType="free_action".`);

  return sections.join('\n\n');
}
