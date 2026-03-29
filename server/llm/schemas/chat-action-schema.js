/**
 * JSON schema for LLM intent parsing of natural language chat messages.
 *
 * When a player types something like "I search the tavern for hidden doors",
 * the LLM classifies it into a structured action that can be processed
 * by the existing DM action resolution pipeline.
 */

export const CHAT_ACTION_PARSE_SCHEMA = {
  type: 'object',
  required: ['actionType', 'narrationHint'],
  properties: {
    actionType: {
      type: 'string',
      enum: [
        'move', 'interact', 'search', 'use_item', 'cast_spell',
        'talk_to_npc', 'pass', 'free_action',
        'attack', 'dash', 'dodge', 'disengage', 'help', 'hide', 'ready',
        'custom',
      ],
      description: 'The game action type that best matches the player intent',
    },
    target: {
      type: 'string',
      description: 'What or who the action targets (NPC name, object, direction, etc.)',
    },
    details: {
      type: 'string',
      description: 'Additional context from the player message relevant to resolution',
    },
    isFreeAction: {
      type: 'boolean',
      description: 'True ONLY for out-of-character questions or pure OOC chat. In-game actions like looking around, checking inventory, searching, or interacting with anything are NEVER free actions.',
    },
    narrationHint: {
      type: 'string',
      description: 'Brief hint for the DM about how to narrate the resolution of this action',
    },
  },
};
