/**
 * JSON schema for Ollama's `format` parameter.
 * Used when processing player actions to get structured DM responses.
 */

export const DM_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['narration'],
  properties: {
    narration: { type: 'string' },
    privateMessage: { type: ['string', 'null'] },
    mechanicalOutcome: {
      type: ['object', 'null'],
      properties: {
        type: {
          type: 'string',
          enum: [
            'damage', 'healing', 'condition_add', 'condition_remove',
            'item_gain', 'item_lose', 'resource_use',
            'spell_slot_use', 'concentration_start', 'concentration_break',
          ],
        },
        targetCharacterId: { type: ['string', 'null'] },
        amount: { type: ['number', 'null'] },
        isCritical: { type: ['boolean', 'null'] },
        condition: { type: ['string', 'null'] },
        itemName: { type: ['string', 'null'] },
        resourceName: { type: ['string', 'null'] },
      },
    },
    requiredRolls: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['rollType', 'dc'],
        properties: {
          rollType: {
            type: 'string',
            enum: ['ability_check', 'saving_throw', 'attack_roll', 'skill_check'],
          },
          ability: { type: ['string', 'null'] },
          skill: { type: ['string', 'null'] },
          dc: { type: 'number' },
          description: { type: 'string' },
        },
      },
    },
    npcSentimentUpdate: {
      type: ['object', 'null'],
      properties: {
        npcId: { type: 'string' },
        trustDelta: { type: 'number' },
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral', 'hostile', 'friendly'] },
        memorySummary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    stateChanges: { type: ['object', 'null'] },
    phaseTransition: {
      type: ['object', 'null'],
      properties: {
        newPhase: {
          type: 'string',
          enum: ['combat', 'social', 'rest', 'exploration'],
        },
        reason: { type: 'string' },
      },
    },
  },
};

export default DM_RESPONSE_SCHEMA;
