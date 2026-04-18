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
            'move_player',
          ],
          description: 'The mechanical effect type. Use move_player when narration moves the party to a new location (travelling to a town, entering a building, leaving a scene).',
        },
        targetCharacterId: {
          type: ['string', 'null'],
          description: 'UUID of the target character. Leave null to default to the acting character. NEVER put a character name here — only UUIDs from the provided context.',
        },
        amount: { type: ['number', 'null'] },
        isCritical: { type: ['boolean', 'null'] },
        condition: { type: ['string', 'null'] },
        itemName: { type: ['string', 'null'] },
        resourceName: { type: ['string', 'null'] },
        items: {
          type: ['array', 'null'],
          description: 'For item_gain or item_lose outcomes covering multiple items at once. Each entry is one item the character picks up or drops.',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Display name of the item.' },
              quantity: { type: ['number', 'null'], description: 'How many. Defaults to 1.' },
              description: { type: ['string', 'null'], description: 'Brief flavour description.' },
            },
          },
        },
        destination: {
          type: ['object', 'null'],
          description: 'Required when type === "move_player". Where the party ends up.',
          properties: {
            kind: {
              type: 'string',
              enum: ['burg', 'poi', 'coordinate'],
              description: 'burg = a named settlement in maps_burgs. poi = a named point-of-interest in maps_markers. coordinate = raw world pixel coords.',
            },
            ref: {
              description: 'For kind=burg: the burg name (string) or id (uuid). For kind=poi: the marker note/name. For kind=coordinate: object {x,y}.',
            },
          },
          required: ['kind', 'ref'],
        },
        via: {
          type: ['string', 'null'],
          description: 'Optional. For type="move_player": "roads" (default, snap to routes), "direct" (cross-country straight line), or a specific route UUID.',
        },
        mode: {
          type: ['string', 'null'],
          enum: ['walk', 'ride', 'boat', 'fly', 'teleport', null],
          description: 'Optional travel mode for type="move_player". Defaults to "walk". Use "ride" when the party is mounted, "boat" on water, "fly" when airborne, "teleport" for magical instant travel.',
        },
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
    sceneTransition: {
      type: ['object', 'null'],
      description: 'Set when the player moves to a new sub-location (e.g. enters a building, leaves a room). Used to anchor NPCs and future narration.',
      properties: {
        newScene: {
          type: 'string',
          description: 'Short descriptor of the new scene, e.g. "inside Kael\'s cottage", "at the village shrine", "outside Dure village square"',
        },
        npcsInScene: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of NPCs that are physically present in the new scene. These will be tagged so future narration knows where they are.',
        },
      },
    },
  },
};

export default DM_RESPONSE_SCHEMA;
