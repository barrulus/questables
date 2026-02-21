export const NARRATIVE_TYPES = Object.freeze({
  DM_NARRATION: 'dm_narration',
  SCENE_DESCRIPTION: 'scene_description',
  NPC_DIALOGUE: 'npc_dialogue',
  ACTION_NARRATIVE: 'action_narrative',
  QUEST: 'quest_generation',
  OBJECTIVE_DESCRIPTION: 'objective_description',
  OBJECTIVE_TREASURE: 'objective_treasure',
  OBJECTIVE_COMBAT: 'objective_combat',
  OBJECTIVE_NPCS: 'objective_npcs',
  OBJECTIVE_RUMOURS: 'objective_rumours',
  PLAYER_ACTION_RESPONSE: 'player_action_response',
  DM_WORLD_TURN: 'dm_world_turn',
  ENEMY_COMBAT_TURN: 'enemy_combat_turn',
  SOCIAL_DIALOGUE: 'social_dialogue',
  SHOP_AUTO_STOCK: 'shop_auto_stock',
});

export const SUPPORTED_TYPES = new Set(Object.values(NARRATIVE_TYPES));

export function assertSupportedType(type) {
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`Unsupported narrative type: ${type}`);
  }
}
