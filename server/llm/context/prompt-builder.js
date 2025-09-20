import { NARRATIVE_TYPES } from '../narrative-types.js';
import { LLMServiceError } from '../errors.js';

const typeInstruction = {
  [NARRATIVE_TYPES.DM_NARRATION]: 'Explain the immediate outcome of the party\'s recent actions and set up the next decision point. Keep the narration immersive, grounded in the supplied context, and avoid inventing NPCs or quests that do not exist.',
  [NARRATIVE_TYPES.SCENE_DESCRIPTION]: 'Describe the scene using sensory detail and mood while respecting the given environment and active characters. Only reference locations, NPCs, and events present in the context.',
  [NARRATIVE_TYPES.NPC_DIALOGUE]: 'Write dialogue for the requested NPC that reflects their personality, recent history with the party, and relationship status. Include stage direction or tone only when helpful.',
  [NARRATIVE_TYPES.ACTION_NARRATIVE]: 'Narrate the action outcome with dramatic flair appropriate to the success level. Mention mechanical consequences, status changes, and follow-up hooks the DM can offer.',
  [NARRATIVE_TYPES.QUEST]: 'Outline a quest using the provided campaign state. Include objective, key obstacles, and rewards drawn from existing factions or locations. Do not fabricate unrelated plotlines.',
};

const typeLabel = {
  [NARRATIVE_TYPES.DM_NARRATION]: 'DM Narration',
  [NARRATIVE_TYPES.SCENE_DESCRIPTION]: 'Scene Description',
  [NARRATIVE_TYPES.NPC_DIALOGUE]: 'NPC Dialogue',
  [NARRATIVE_TYPES.ACTION_NARRATIVE]: 'Action Narrative',
  [NARRATIVE_TYPES.QUEST]: 'Quest Generation',
};

const sanitize = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim();
  }
  return value;
};

const summarizeArray = (items, mapper) => {
  if (!Array.isArray(items) || items.length === 0) {
    return 'None';
  }
  return items
    .map(mapper)
    .filter(Boolean)
    .join('\n');
};

const summarizeParty = (party) => summarizeArray(party, (member) => {
  const isActive = member.isInCurrentSession ? ' (present)' : '';
  return `- ${member.character.name} (Level ${member.character.level} ${member.character.race} ${member.character.class})${isActive}`;
});

const summarizeNPCs = (npcs) => summarizeArray(npcs, (npc) => {
  const relationshipSummary = Array.isArray(npc.relationships) && npc.relationships.length > 0
    ? `Relationships: ${npc.relationships
        .map((rel) => `${rel.relationshipType}(${rel.targetName || rel.targetId})`) 
        .join(', ')}`
    : 'Relationships: none logged';
  return `- ${npc.name} (${npc.race}${npc.occupation ? `, ${npc.occupation}` : ''}) — ${sanitize(npc.personality)}. ${relationshipSummary}`;
});

const summarizeLocations = (locations) => summarizeArray(locations, (location) => {
  const discovery = location.isDiscovered ? 'discovered' : 'undiscovered';
  return `- ${location.name} (${location.type}, ${discovery})`;
});

const summarizeEncounters = (encounters) => summarizeArray(encounters, (encounter) => {
  const participants = Array.isArray(encounter.participants)
    ? encounter.participants.map((participant) => `${participant.name} (${participant.participantType})`).join(', ')
    : 'unknown';
  return `- ${encounter.name} [${encounter.status}] — ${encounter.type}/${encounter.difficulty}. Participants: ${participants}`;
});

const summarizeChat = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'No recent chat history.';
  }
  const latest = [...messages]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((msg) => {
      const sender = msg.sender?.characterName || msg.sender?.username || msg.sender?.name || 'Unknown';
      return `- [${msg.messageType}] ${sender}: ${sanitize(msg.content).slice(0, 160)}`;
    });
  return latest.join('\n');
};

const buildContextSummary = (context) => {
  const summarySections = [];

  summarySections.push(
    `Campaign: ${context.campaign.name} (status: ${context.campaign.status}, system: ${context.campaign.system})` +
      `\nDM: ${context.campaign.dm.username} (${context.campaign.dm.email})`
  );

  if (context.session) {
    summarySections.push(
      `Session: ${context.session.title} (#${context.session.number}, status: ${context.session.status})` +
        `\nSummary: ${sanitize(context.session.summary) || 'No summary available.'}`
    );
  } else {
    summarySections.push('Session: none selected (using latest campaign state).');
  }

  summarySections.push(`Party:\n${summarizeParty(context.party)}`);
  summarySections.push(`NPCs:\n${summarizeNPCs(context.npcs)}`);
  summarySections.push(`Locations:\n${summarizeLocations(context.locations)}`);
  summarySections.push(`Encounters:\n${summarizeEncounters(context.encounters)}`);
  summarySections.push(`Recent chat messages:\n${summarizeChat(context.chat?.recentMessages)}`);

  return summarySections.join('\n\n');
};

const assertContext = (context) => {
  if (!context || typeof context !== 'object') {
    throw new LLMServiceError('Context payload is required to build prompts', {
      type: 'context_missing',
    });
  }
  if (!context.campaign) {
    throw new LLMServiceError('Campaign context is missing', {
      type: 'context_missing_campaign',
    });
  }
  if (!Array.isArray(context.party)) {
    throw new LLMServiceError('Party context must be an array', {
      type: 'context_missing_party',
    });
  }
};

const buildSystemPrompt = ({ type, providerConfig }) => {
  const label = typeLabel[type] ?? 'Narrative Response';
  const providerLine = providerConfig?.model
    ? `Responses must be optimized for provider ${providerConfig.name || 'unknown'} using model ${providerConfig.model}.`
    : `Responses will be generated through provider ${providerConfig?.name || 'unknown provider'}.`;

  return [
    'You are the Questables Narrative Engine.',
    `You are producing ${label.toLowerCase()} for a live tabletop campaign.`,
    providerLine,
    'Follow the context exactly—do not invent characters, locations, or events that are not supplied.',
    'Keep responses concise but evocative and respect the Zero-Dummy policy (no placeholders, no promises about unavailable services).',
  ].join('\n');
};

export function buildStructuredPrompt({ type, context, providerConfig, request = {} }) {
  if (!Object.values(NARRATIVE_TYPES).includes(type)) {
    throw new LLMServiceError(`Unsupported narrative type: ${type}`, {
      type: 'unsupported_narrative_type',
      narrativeType: type,
    });
  }

  assertContext(context);

  const instruction = typeInstruction[type];
  const contextSummary = buildContextSummary(context);
  const focus = request.focus ? sanitize(request.focus) : null;

  const promptSections = [];
  promptSections.push(`### Narrative Type\n${typeLabel[type]}`);
  if (focus) {
    promptSections.push(`### Narrative Focus\n${focus}`);
  }
  promptSections.push('### Game Context Snapshot');
  promptSections.push(contextSummary);
  promptSections.push('### Directives');
  promptSections.push(instruction);

  const prompt = promptSections.join('\n\n');
  const systemPrompt = buildSystemPrompt({ type, providerConfig });

  return {
    systemPrompt,
    prompt,
    contextSummary,
    provider: providerConfig ? {
      name: providerConfig.name || null,
      model: providerConfig.model || null,
      parameters: providerConfig.options || null,
    } : null,
  };
}

export default buildStructuredPrompt;
