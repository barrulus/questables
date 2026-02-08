// SRD Reference Data Types

export interface SrdSpeciesTrait {
  name: string;
  desc: string;
  type?: string | null;
}

export interface SrdSpecies {
  id: string;
  key: string;
  name: string;
  desc_text: string | null;
  is_subspecies: boolean;
  subspecies_of_key: string | null;
  traits: SrdSpeciesTrait[];
  source_key: string | null;
  subspecies?: SrdSpecies[] | null;
}

export interface SrdClassFeature {
  key: string;
  name: string;
  desc: string;
  feature_type?: string;
  gained_at?: Array<{ level: number; detail?: string }>;
}

export interface SrdClass {
  id: string;
  key: string;
  name: string;
  desc_text: string | null;
  hit_dice: string | null;
  caster_type: 'FULL' | 'HALF' | 'THIRD' | 'NONE' | null;
  subclass_of_key: string | null;
  features: SrdClassFeature[];
  source_key: string | null;
  // Populated by detail endpoint
  saving_throws_list?: Array<{ class_key: string; ability_key: string }> | null;
  primary_abilities_list?: Array<{ class_key: string; ability_key: string }> | null;
  subclasses?: SrdClass[] | null;
}

export interface SrdBackgroundBenefit {
  name: string;
  desc: string;
  type?: string | null;
}

export interface SrdBackground {
  id: string;
  key: string;
  name: string;
  desc_text: string | null;
  benefits: SrdBackgroundBenefit[];
  source_key: string | null;
}

export interface SrdSpell {
  id: string;
  key: string;
  name: string;
  desc_text: string | null;
  level: number;
  school_key: string | null;
  casting_time: string | null;
  range_text: string | null;
  range: number | null;
  duration: string | null;
  concentration: boolean;
  ritual: boolean;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  material_specified: string | null;
  damage_roll: string | null;
  damage_types: string[];
  saving_throw_ability: string | null;
  attack_roll: boolean;
  source_key: string | null;
  class_keys?: string[] | null;
}

export interface SrdItem {
  id: string;
  key: string;
  name: string;
  desc_text: string | null;
  category_key: string | null;
  rarity_key: string | null;
  cost: string | null;
  weight: number | null;
  weight_unit: string | null;
  requires_attunement: boolean;
  source_key: string | null;
}

export interface SrdFeat {
  id: string;
  key: string;
  name: string;
  desc_text: string | null;
  feat_type: string | null;
  prerequisite: string | null;
  benefits: Record<string, unknown> | Array<{ desc: string }>;
  source_key: string | null;
}

export interface SrdCondition {
  id: string;
  key: string;
  name: string;
  descriptions: string | string[];
  source_key: string | null;
}

export type AbilityName = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

export interface ComputeStatsRequest {
  speciesKey?: string;
  classKey?: string;
  backgroundKey?: string;
  level: number;
  baseAbilities: Record<AbilityName, number>;
  abilityScoreMethod?: string;
  chosenSkills?: string[];
  chosenLanguages?: string[];
}

export interface SavingThrowInfo {
  modifier: number;
  proficient: boolean;
}

export interface SkillInfo {
  modifier: number;
  proficient: boolean;
  ability: string;
}

export interface SpellSlotInfo {
  max: number;
  used: number;
}

export interface SpellcastingStats {
  ability: string;
  spellSaveDC: number;
  spellAttackBonus: number;
  cantripsKnown: number;
  spellSlots: Record<number, SpellSlotInfo> | null;
}

export interface ProficienciesInfo {
  armor: string[];
  weapons: string[];
  tools: string[];
  savingThrows: string[];
  skills: string[];
  languages: string[];
}

export interface ComputeStatsResponse {
  abilities: Record<AbilityName, number>;
  abilityModifiers: Record<AbilityName, number>;
  hitPoints: { max: number; current: number; temporary: number };
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  savingThrows: Record<AbilityName, SavingThrowInfo>;
  skills: Record<string, SkillInfo>;
  initiative: number;
  passivePerception: number;
  spellcasting: SpellcastingStats | null;
  proficiencies: ProficienciesInfo;
}
