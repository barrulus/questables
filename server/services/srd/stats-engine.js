/**
 * D&D 5e Derived Stats Computation Engine
 *
 * Stateless computation: client sends choices, server returns full derived stats.
 */

const SKILL_ABILITIES = {
  acrobatics: 'dexterity',
  'animal handling': 'wisdom',
  arcana: 'intelligence',
  athletics: 'strength',
  deception: 'charisma',
  history: 'intelligence',
  insight: 'wisdom',
  intimidation: 'charisma',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  performance: 'charisma',
  persuasion: 'charisma',
  religion: 'intelligence',
  'sleight of hand': 'dexterity',
  stealth: 'dexterity',
  survival: 'wisdom',
};

const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

const HIT_DICE_VALUES = {
  d6: 6, d8: 8, d10: 10, d12: 12,
};

// Casting ability by class key (partial — covers SRD classes)
const CASTER_ABILITY = {
  wizard: 'intelligence',
  'srd-2014_wizard': 'intelligence',
  'srd-2024_wizard': 'intelligence',
  sorcerer: 'charisma',
  'srd-2014_sorcerer': 'charisma',
  'srd-2024_sorcerer': 'charisma',
  warlock: 'charisma',
  'srd-2014_warlock': 'charisma',
  'srd-2024_warlock': 'charisma',
  bard: 'charisma',
  'srd-2014_bard': 'charisma',
  'srd-2024_bard': 'charisma',
  cleric: 'wisdom',
  'srd-2014_cleric': 'wisdom',
  'srd-2024_cleric': 'wisdom',
  druid: 'wisdom',
  'srd-2014_druid': 'wisdom',
  'srd-2024_druid': 'wisdom',
  paladin: 'charisma',
  'srd-2014_paladin': 'charisma',
  'srd-2024_paladin': 'charisma',
  ranger: 'wisdom',
  'srd-2014_ranger': 'wisdom',
  'srd-2024_ranger': 'wisdom',
};

// Spell slot progression for full casters
const FULL_CASTER_SLOTS = {
  1: [2],
  2: [3],
  3: [4, 2],
  4: [4, 3],
  5: [4, 3, 2],
  6: [4, 3, 3],
  7: [4, 3, 3, 1],
  8: [4, 3, 3, 2],
  9: [4, 3, 3, 3, 1],
  10: [4, 3, 3, 3, 2],
  11: [4, 3, 3, 3, 2, 1],
  12: [4, 3, 3, 3, 2, 1],
  13: [4, 3, 3, 3, 2, 1, 1],
  14: [4, 3, 3, 3, 2, 1, 1],
  15: [4, 3, 3, 3, 2, 1, 1, 1],
  16: [4, 3, 3, 3, 2, 1, 1, 1],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

const HALF_CASTER_SLOTS = {
  2: [2],
  3: [3],
  4: [3],
  5: [4, 2],
  6: [4, 2],
  7: [4, 3],
  8: [4, 3],
  9: [4, 3, 2],
  10: [4, 3, 2],
  11: [4, 3, 3],
  12: [4, 3, 3],
  13: [4, 3, 3, 1],
  14: [4, 3, 3, 1],
  15: [4, 3, 3, 2],
  16: [4, 3, 3, 2],
  17: [4, 3, 3, 3, 1],
  18: [4, 3, 3, 3, 1],
  19: [4, 3, 3, 3, 2],
  20: [4, 3, 3, 3, 2],
};

const THIRD_CASTER_SLOTS = {
  3: [2],
  4: [3],
  5: [3],
  6: [3],
  7: [4, 2],
  8: [4, 2],
  9: [4, 2],
  10: [4, 3],
  11: [4, 3],
  12: [4, 3],
  13: [4, 3, 2],
  14: [4, 3, 2],
  15: [4, 3, 2],
  16: [4, 3, 3],
  17: [4, 3, 3],
  18: [4, 3, 3],
  19: [4, 3, 3, 1],
  20: [4, 3, 3, 1],
};

function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level) {
  return Math.ceil(level / 4) + 1;
}

function parseHitDie(hitDice) {
  if (!hitDice) return 8;
  const cleaned = hitDice.toLowerCase().replace(/\s/g, '');
  return HIT_DICE_VALUES[cleaned] || 8;
}

function computeMaxHP(hitDie, conMod, level) {
  // Level 1: max hit die + CON mod
  let hp = hitDie + conMod;
  // Levels 2+: average roll + CON mod per level
  for (let i = 2; i <= level; i++) {
    hp += Math.ceil(hitDie / 2) + 1 + conMod;
  }
  return Math.max(1, hp);
}

function getSpellSlots(casterType, level) {
  if (!casterType || casterType === 'NONE') return null;

  let table;
  switch (casterType) {
    case 'FULL': table = FULL_CASTER_SLOTS; break;
    case 'HALF': table = HALF_CASTER_SLOTS; break;
    case 'THIRD': table = THIRD_CASTER_SLOTS; break;
    default: return null;
  }

  const slots = table[level];
  if (!slots) return null;

  const result = {};
  for (let i = 0; i < slots.length; i++) {
    result[i + 1] = { max: slots[i], used: 0 };
  }
  return result;
}

// Cantrips known by class and level (simplified SRD defaults)
function getCantripsKnown(casterType, level) {
  if (!casterType || casterType === 'NONE') return 0;
  if (casterType === 'HALF' || casterType === 'THIRD') return 0;

  // Full casters
  if (level >= 10) return 5;
  if (level >= 4) return 4;
  return 3;
}

/**
 * Compute full derived stats from character creation choices.
 *
 * @param {object} params
 * @param {object} params.baseAbilities - { strength, dexterity, constitution, intelligence, wisdom, charisma }
 * @param {number} params.level - Character level (1-20)
 * @param {string} params.hitDice - e.g. "d10"
 * @param {string} params.casterType - FULL, HALF, THIRD, NONE
 * @param {string} params.classKey - SRD class key (for casting ability lookup)
 * @param {string[]} params.savingThrowProficiencies - ability names (e.g. ["strength", "constitution"])
 * @param {string[]} params.skillProficiencies - skill names (e.g. ["athletics", "perception"])
 * @param {string[]} params.languages - known languages
 * @param {object} params.racialBonuses - ability score bonuses from species e.g. { dexterity: 2 }
 * @returns {object} Full derived stats
 */
export function computeStats({
  baseAbilities = {},
  level = 1,
  hitDice = 'd8',
  casterType = 'NONE',
  classKey = '',
  savingThrowProficiencies = [],
  skillProficiencies = [],
  languages = ['Common'],
  racialBonuses = {},
  armorProficiencies = [],
  weaponProficiencies = [],
  toolProficiencies = [],
}) {
  // Apply racial bonuses to base abilities
  const abilities = {};
  const abilityModifiers = {};
  for (const ab of ABILITY_NAMES) {
    abilities[ab] = (baseAbilities[ab] || 10) + (racialBonuses[ab] || 0);
    abilityModifiers[ab] = abilityModifier(abilities[ab]);
  }

  const profBonus = proficiencyBonus(level);
  const conMod = abilityModifiers.constitution;
  const dexMod = abilityModifiers.dexterity;
  const hitDie = parseHitDie(hitDice);

  // Hit points
  const maxHP = computeMaxHP(hitDie, conMod, level);

  // Saving throws
  const savingThrows = {};
  const saveProfSet = new Set(savingThrowProficiencies.map(s => s.toLowerCase()));
  for (const ab of ABILITY_NAMES) {
    const proficient = saveProfSet.has(ab);
    savingThrows[ab] = {
      modifier: abilityModifiers[ab] + (proficient ? profBonus : 0),
      proficient,
    };
  }

  // Skills
  const skills = {};
  const skillProfSet = new Set(skillProficiencies.map(s => s.toLowerCase()));
  for (const [skill, ability] of Object.entries(SKILL_ABILITIES)) {
    const proficient = skillProfSet.has(skill);
    skills[skill] = {
      modifier: abilityModifiers[ability] + (proficient ? profBonus : 0),
      proficient,
      ability,
    };
  }

  // Initiative
  const initiative = dexMod;

  // Passive Perception
  const perceptionProficient = skillProfSet.has('perception');
  const passivePerception = 10 + abilityModifiers.wisdom + (perceptionProficient ? profBonus : 0);

  // AC (unarmored)
  const armorClass = 10 + dexMod;

  // Speed (default, species may modify)
  const speed = 30;

  // Spellcasting
  let spellcasting = null;
  if (casterType && casterType !== 'NONE') {
    const castingAbility = CASTER_ABILITY[classKey] || CASTER_ABILITY[classKey.split('_').pop()] || 'intelligence';
    const castingMod = abilityModifiers[castingAbility] || 0;
    const spellSlots = getSpellSlots(casterType, level);
    const cantripsKnown = getCantripsKnown(casterType, level);

    spellcasting = {
      ability: castingAbility,
      spellSaveDC: 8 + profBonus + castingMod,
      spellAttackBonus: profBonus + castingMod,
      cantripsKnown,
      spellSlots,
    };
  }

  return {
    abilities,
    abilityModifiers,
    hitPoints: { max: maxHP, current: maxHP, temporary: 0 },
    armorClass,
    speed,
    proficiencyBonus: profBonus,
    savingThrows,
    skills,
    initiative,
    passivePerception,
    spellcasting,
    proficiencies: {
      armor: armorProficiencies,
      weapons: weaponProficiencies,
      tools: toolProficiencies,
      savingThrows: savingThrowProficiencies,
      skills: skillProficiencies,
      languages,
    },
  };
}
