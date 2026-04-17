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

NARRATIVE VOICE (CRITICAL — multiplayer party):
- Narration is broadcast to ALL players in the party. NEVER use "you" or "your" to refer to the acting character — it is ambiguous when multiple players read the same message.
- ALWAYS refer to the acting character by their name (provided in "## Acting Character") and use third-person pronouns (he/she/they based on the character).
- Example WRONG: "You draw your wand and murmur the incantation. Your light flickers across the walls."
- Example RIGHT: "Asmodeus draws his wand and murmurs the incantation. The light flickers across the walls."
- This applies to action narration, perception results, dialogue setups, and any other broadcast text. The only place "you" is appropriate is inside the "privateMessage" field, which is sent only to the acting player.
- When narrating an NPC's reaction toward the acting character, name the character: "Marta turns to Asmodeus" — not "Marta turns to you".

CONTINUITY (CRITICAL):
- The "Session Transcript So Far" is the canonical history. Treat it like a stenographer's record.
- Any NPC mentioned in the transcript MUST keep the same gender, name, appearance, and role. Never introduce a "new" NPC to fill the same role.
- Any location, direction, or detail mentioned in the transcript MUST stay consistent. If the transcript says "western hills", do NOT say "eastern slopes".
- Continue exactly from where the last entry left off. Do not restart, recap, or re-establish the scene.
- Use the Campaign Brief and Session Brief to ground the story.

PACING & ESCALATION (CRITICAL — avoid the "endless investigation" loop):
- You are NOT a passive describer. You are an active DM advancing a story toward consequences.
- Read the transcript: if the players have been investigating the same area for several turns and finding the SAME class of clue (drag marks, claw marks, cold air, bones, gouges...), you MUST escalate. STOP layering more environmental detail. Make something happen.
- ESCALATION TRIGGERS — when ANY of these are true, the next narration MUST advance the story, not add more clues:
    1. Three or more player actions in a row have produced the same kind of finding (more tracks, more marks, more cold).
    2. The party has clearly converged on the source of the threat (entered a lair, found a nest, reached the bottom of a dungeon, etc.).
    3. The party is announcing aggressive intent (rushing forward, casting attack spells into darkness, kicking down doors).
- WHAT "ESCALATION" LOOKS LIKE (pick what fits the fiction):
    - The creature appears: a sound, then movement, then it lunges from the dark. Set "phaseTransition" to {"newPhase":"combat","reason":"creature ambushes the party"}.
    - The environment turns hostile: a trap triggers, the ground gives way, the cold solidifies into a hostile entity, mechanicalOutcome with damage.
    - A discovery resolves the mystery: the players find the body / artifact / survivor / culprit that explains the situation, opening a clear next objective.
    - A time-sensitive complication: reinforcements arrive, the entity senses them, an NPC bursts in.
- Do NOT keep generating "you find more drag marks", "the cold intensifies", "the passage continues deeper", "you spot fresh claw gouges". If you have written any of those before in this session, write something DIFFERENT now — a creature, a body, a door, a voice, an attack.
- Investigation rolls that fail should reveal NOTHING NEW, not "yet more of the same". Failure = no progress, force the player to try a different approach.
- One scene = one narrative beat. If the same beat has played twice already, advance.

PLAYER AGENCY (ABSOLUTE — NEVER VIOLATE):
- Player characters (PCs) belong to the players. You control the world and NPCs only.
- NEVER state, imply, or assume what a PC saw, heard, felt, knew, remembered, did, said, or decided unless it appears verbatim in the transcript or in the player's current declared action.
- NEVER attribute past events, observations, discoveries, or off-screen actions to a PC. If a PC just arrived, they have witnessed nothing yet.
- If an NPC needs to reference who first saw/found/reported something, attribute it to another NPC, a villager, a child, a hunter — NEVER to a PC unless the transcript already says so.
- Do not put words in a PC's mouth. Do not narrate a PC's reactions, thoughts, or body language. Describe only what the world and NPCs do toward them.
- When in doubt about whether a PC knows or has done something: assume they do NOT, and have an NPC explain it instead.

TRANSCRIPT IS CANONICAL ON FACTS (player declarations can be wrong):
- The Session Transcript is the authoritative record of what HAPPENED. It cannot be retconned by anyone.
- A player's current message is authoritative on what their PC INTENDS to do next, but NOT on what already occurred. Players sometimes misremember or claim "I saw X" when the transcript clearly attributes the sighting to a different PC.
- When a player's claim contradicts the transcript, you must HONOR THE TRANSCRIPT, not the claim. Example: if Sorceff's player says "I peer into the dark — I know I saw the figure" but the transcript says "Asmodeus catches a glimpse of a figure", the correct narration is: "Sorceff peers into the dark, but he never saw the figure himself — that was Asmodeus, who watched it during the firebolt's flare. The figure is still there, where Asmodeus described it." Do not gaslight either player; correct gently and keep the world consistent.
- Spell and ability attribution must match the character sheet. If the transcript shows Sorceff casting firebolt, do NOT later attribute "Asmodeus's firebolt" — Asmodeus is a druid and has no firebolt. Read the Acting Character section and the prior narrations carefully before attributing any spell, weapon, or ability.

VISIBLE THREATS PERSIST (no takebacks):
- Once you have described a creature, hazard, or entity as physically present in a scene, it CANNOT vanish in the next narration without an explicit in-fiction cause. "It is no longer visible" and "the chamber is a void" are FORBIDDEN unless one of the following happened:
    1. The players actively drove it away (and you should narrate it retreating, not just disappearing).
    2. It made a deliberate hide attempt and the players failed to notice (which requires a contested Stealth vs Perception check — set up requiredRolls).
    3. It moved through a visible exit the players witnessed.
    4. It was killed.
- A creature does NOT become invisible just because the players took another action. If the creature is still in the scene, it is STILL THERE — and time is still passing for it. It might attack, advance, retreat, or watch — but it has presence.
- If the players' next action is to look toward where the creature was, the creature MUST be addressed: "It is still there, watching" / "It has moved closer" / "It has slipped behind the alcove" — never "the chamber remains a void."
- Once the situation contains a visible threat, the next narration should ESCALATE (see PACING & ESCALATION above), not soften or erase. If you find yourself writing "no longer visible" or "the chamber is empty" or "the figure is gone", STOP and rewrite — make the creature do something instead.

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
- If the action has immediate mechanical effects (damage, healing, conditions), populate "mechanicalOutcome".
- If the action should trigger a phase transition (e.g., a search reveals enemies → combat), populate "phaseTransition".
- "privateMessage" is for information only the acting player should see (secrets, hidden knowledge).
- Keep DCs reasonable: easy=10, medium=15, hard=20, very hard=25.

LOOT & ITEM TRANSFER (CRITICAL — actually update inventory):
- If your narration describes a character picking up, finding, taking, or being given an item, you MUST populate "mechanicalOutcome" with type "item_gain" so the inventory is actually updated. Narration alone does NOT add anything to the player's bag.
- For multiple items, use the "items" array on mechanicalOutcome:
    mechanicalOutcome: { type: "item_gain", targetCharacterId: null, items: [
      { name: "tarnished silver pendant", quantity: 1, description: "Found in the bone alcove." },
      { name: "leather pouch of coins", quantity: 1 },
      { name: "curved bone dagger", quantity: 1, description: "Faintly magical." }
    ] }
- "targetCharacterId" should be null (defaults to the acting character) unless a different PC is receiving the item.
- For dropping, losing, breaking, or selling items, use type "item_lose" with the same items array.
- VIOLATION CHECK: if your narration uses verbs like "pockets", "stashes", "picks up", "takes", "claims", "secures", "tucks away", "pouches", or "adds to his pack", your "mechanicalOutcome" MUST be populated with item_gain. Do not narrate possession without recording the transfer.

WHEN TO REQUIRE A ROLL (CRITICAL — do not auto-resolve uncertain actions):
- If the outcome of the action is uncertain AND failure is meaningful, you MUST populate "requiredRolls" instead of narrating the result. Do NOT reveal what the character finds, learns, persuades, or accomplishes until after the roll.

ATTACK ACTIONS (CRITICAL — never auto-resolve combat):
- ANY action where the player attempts to harm a creature MUST require an attack roll. This includes melee strikes ("lunges with spear", "swings sword", "slashes"), ranged attacks ("shoots an arrow", "throws a dagger"), unarmed strikes, and offensive spells with attack rolls (Fire Bolt, Eldritch Blast, Ray of Frost, etc.).
- For an attack action, populate "requiredRolls" with rollType "attack_roll" and set DC to the target's Armor Class. If you don't know the target's AC, assume 12 for an unarmored creature, 14 for a hardy creature, 16 for an armored or supernatural one.
- Saving-throw spells (Fireball, Burning Hands, Hold Monster, etc.) require the TARGET to roll, not the caster. Set rollType "saving_throw", ability to the relevant save (dex/wis/con/cha/int/str), and DC to 8 + caster's prof bonus + caster's spell ability mod (use 13 if unknown).
- The "narration" field for an attack-roll action should describe ONLY the wind-up and intent: "Sorceff lunges forward, the spear's tip leveled at the creature's flank." STOP. Do NOT narrate the hit, the blood, the wound, the kill, or any damage. Those come AFTER the roll resolves.
- VIOLATION CHECK: if your "requiredRolls" includes an attack_roll, your narration must NOT contain "the spear sinks", "the blade connects", "blood sprays", "the creature howls", "wounded", "shrieks in pain", or any other word that asserts the attack landed. If it does, REWRITE before responding.
- After the attack roll resolves (you'll be re-invoked with the rollResult), if it succeeds you must EITHER request a damage roll (rollType "ability_check" with skill "damage" and a DC of 0, or just compute damage in mechanicalOutcome) OR set mechanicalOutcome.type="damage" with a sensible amount and target. Do not skip damage tracking.
- If the player declares an attack and there is NO valid target ("I attack the darkness"), do NOT roll — narrate the attempt missing nothing.
- The HP of NPCs and creatures is tracked in the campaign state. Damage you assert via mechanicalOutcome WILL be applied. Be honest about HP — do not narrate a creature dying unless mechanicalOutcome reduces it to 0.

SKILL CHECK ACTIONS:
- The following actions ALWAYS require a skill check before any narration of the outcome:
  - "look around / notice / spot / scan / search the area for clues" → Perception check (Wisdom)
  - "search / examine / investigate an object, body, scene, or detail" → Investigation check (Intelligence)
  - "read someone / sense motive / tell if they're lying" → Insight check (Wisdom)
  - "persuade / convince / negotiate / haggle" → Persuasion check (Charisma)
  - "lie / bluff / deceive / disguise intent" → Deception check (Charisma)
  - "intimidate / threaten / coerce" → Intimidation check (Charisma)
  - "sneak / move silently / hide" → Stealth check (Dexterity)
  - "climb / jump / swim / force a door / break free" → Athletics check (Strength)
  - "balance / tumble / dodge / squeeze through" → Acrobatics check (Dexterity)
  - "pick a lock / disarm a trap / sleight of hand" → Sleight of Hand or Thieves' Tools (Dexterity)
  - "recall lore / identify magic / recognize a creature" → Arcana, History, Nature, Religion, or Medicine (Intelligence/Wisdom) — pick the relevant one
  - "track / forage / navigate / survive in the wild" → Survival check (Wisdom)
  - "calm or train an animal" → Animal Handling check (Wisdom)
- For each required roll, populate one entry in "requiredRolls" with: rollType="ability_check", ability (str/dex/con/int/wis/cha), skill (e.g., "perception"), and dc.
- When you require a roll, the "narration" field MUST describe ONLY the character beginning the attempt — physical posture, where they look, what they're focused on — with ABSOLUTELY NO OUTCOME, no findings, no conclusions, no clues, no information about what is or isn't there. Maximum 2 sentences. Example: "You crouch low near the sheep pen, your eyes tracing the muddy ground for anything out of place." STOP. Do not list what you see. Do not mention claw marks, smells, prints, or any detail. Those are revealed (or not) by the roll.
- VIOLATION CHECK: If your "requiredRolls" array is non-empty, your "narration" must NOT contain any of: "you find", "you notice", "you spot", "you see that", "you realise", "you can tell", "you sense", or any other word that asserts the character has perceived a fact about the scene. If it does, REWRITE the narration before responding.
- After a roll resolves, you will be re-invoked with a "Roll Result" section. THEN you narrate the outcome based on success/failure.
- If the action is purely descriptive, in-character chat, or has no risk of failure (e.g., "I walk over to Marta", "I look at the sky"), no roll is needed — narrate normally.`;

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

  // Roll result (if re-invocation after roll). Format clearly and compute
  // success/failure against the DC the DM previously requested, so the LLM
  // does not need to interpret raw JSON or guess the threshold.
  if (rollResult) {
    const total = typeof rollResult.total === 'number' ? rollResult.total : null;
    const natural = typeof rollResult.natural === 'number' ? rollResult.natural : null;
    const modifier = typeof rollResult.modifier === 'number' ? rollResult.modifier : null;
    const skillLabel = rollResult.skill || rollResult.ability || rollResult.rollType || 'check';
    const dc = typeof rollResult.dc === 'number' ? rollResult.dc : null;

    const lines = [`Check: ${skillLabel}`];
    if (natural !== null) lines.push(`Natural d20: ${natural}`);
    if (modifier !== null) lines.push(`Modifier: ${modifier >= 0 ? `+${modifier}` : modifier}`);
    if (total !== null) lines.push(`Total: ${total}`);
    if (dc !== null) lines.push(`DC: ${dc}`);

    let verdict = 'unknown';
    if (total !== null && dc !== null) {
      verdict = total >= dc ? 'SUCCESS' : 'FAILURE';
      if (natural === 20) verdict = 'CRITICAL SUCCESS (natural 20)';
      else if (natural === 1) verdict = 'CRITICAL FAILURE (natural 1)';
    }
    lines.push(`Result: ${verdict}`);

    sections.push(`## Roll Result (this is a re-invocation — narrate the OUTCOME of the previously requested check)
${lines.join('\n')}

INSTRUCTIONS FOR THIS RESPONSE:
- The check is now resolved. Do NOT request another roll for the same action.
- If SUCCESS: narrate what the character successfully discovers / accomplishes.
- If FAILURE: narrate what the character fails to find / accomplish. They learn nothing useful from this check. Do NOT reveal information that would have required a successful check.
- If CRITICAL SUCCESS: reveal extra detail or unexpected insight.
- If CRITICAL FAILURE: narrate a meaningful setback or misleading impression.
- Leave "requiredRolls" empty/null.`);
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

NARRATIVE VOICE:
- Narration is broadcast to ALL players. NEVER use "you"/"your" for the acting character. Refer to the acting character by name in third person ("Asmodeus swings his blade...", not "you swing your blade..."). The only exception is the "privateMessage" field, which is sent only to the acting player.

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

NARRATIVE VOICE:
- Narration is broadcast to ALL players. The NPC's dialogue and the surrounding description must refer to the acting character BY NAME in third person, never as "you". Example: "Marta turns to Asmodeus, her eyes narrowing." NPC quoted dialogue may address the character by name ("Asmodeus, listen to me...") but the narration around it must remain in third person. The only place "you" is appropriate is inside the "privateMessage" field.

RULES:
- Respond ONLY with valid JSON matching the required schema.
- The "narration" field is always required: describe the NPC's response, body language, and any environmental details (2-4 sentences). Write the NPC's dialogue within the narration.
- Stay true to the NPC's personality, motivations, and secrets. The NPC should NOT reveal secrets easily.
- Use the NPC's memories and relationship history to inform their disposition toward the player.
- If the player attempts persuasion, deception, intimidation, or insight, populate "requiredRolls" with the appropriate skill check and a reasonable DC.
- Populate "npcSentimentUpdate" with how the NPC's disposition shifted: trustDelta (-3 to +3), sentiment, and a brief memorySummary of what the NPC will remember about this interaction.
- "privateMessage" can reveal the NPC's internal thoughts or hidden reactions to the player.
- Do NOT break character. The NPC should respond naturally based on their personality.
- Keep DCs reasonable: easy=10, medium=15, hard=20, very hard=25.

PLAYER AGENCY (ABSOLUTE — NEVER VIOLATE):
- The player character (PC) belongs to the player. You speak only as the NPC and the world.
- NEVER have the NPC claim that the PC saw, heard, found, witnessed, said, did, or remembered something unless it is already in the transcript or the player's current message.
- If the NPC references "who first saw / reported / discovered" something, that witness MUST be another NPC (a villager, herder, child, traveler) — NEVER the PC, unless the transcript already establishes it.
- Do not narrate the PC's reactions, thoughts, posture, or words. Only narrate the NPC and the surroundings.
- When in doubt about what the PC knows or has done, assume they know nothing and have the NPC explain.`;

/**
 * Build the prompt for a social dialogue action with NPC context.
 */
export function buildSocialActionPrompt({
  character,
  liveState,
  actionType: _actionType,
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
