/**
 * Levelling Service — XP thresholds and level-up application.
 */

import { patchLiveState } from '../live-state/service.js';
import { computeStats } from '../srd/stats-engine.js';
import { logInfo } from '../../utils/logger.js';

// D&D 5e XP thresholds: index = level, value = total XP required
const XP_THRESHOLDS = [
  0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

// Hit die by class name
const CLASS_HIT_DICE = {
  barbarian: 'd12', fighter: 'd10', paladin: 'd10', ranger: 'd10',
  bard: 'd8', cleric: 'd8', druid: 'd8', monk: 'd8', rogue: 'd8', warlock: 'd8',
  sorcerer: 'd6', wizard: 'd6',
};

// Caster type by class
const CASTER_TYPES = {
  wizard: 'FULL', sorcerer: 'FULL', bard: 'FULL', cleric: 'FULL', druid: 'FULL', warlock: 'FULL',
  paladin: 'HALF', ranger: 'HALF',
  'eldritch knight': 'THIRD', 'arcane trickster': 'THIRD',
  barbarian: 'NONE', fighter: 'NONE', monk: 'NONE', rogue: 'NONE',
};

/**
 * Check which characters have enough XP to level up.
 */
export const checkLevelUps = async (client, { sessionId, campaignId }) => {
  const { rows } = await client.query(
    `SELECT sls.character_id, sls.user_id, sls.xp_gained,
            c.level, c.xp, c.name
       FROM public.session_live_states sls
       JOIN public.characters c ON c.id = sls.character_id
      WHERE sls.session_id = $1 AND sls.campaign_id = $2`,
    [sessionId, campaignId],
  );

  const eligibleLevelUps = [];
  for (const row of rows) {
    const totalXp = (row.xp ?? 0) + (row.xp_gained ?? 0);
    const currentLevel = row.level ?? 1;
    const nextLevel = currentLevel + 1;

    if (nextLevel <= 20 && totalXp >= XP_THRESHOLDS[nextLevel]) {
      eligibleLevelUps.push({
        characterId: row.character_id,
        userId: row.user_id,
        characterName: row.name,
        currentLevel,
        newLevel: nextLevel,
        totalXp,
      });
    }
  }

  return eligibleLevelUps;
};

/**
 * Apply a level-up to a character.
 */
export const applyLevelUp = async (client, { characterId, sessionId, hpChoice }) => {
  // Load character
  const { rows: charRows } = await client.query(
    `SELECT id, name, class, level, abilities, hit_points, spellcasting
       FROM public.characters WHERE id = $1 FOR UPDATE`,
    [characterId],
  );

  if (charRows.length === 0) {
    const err = new Error('Character not found');
    err.status = 404;
    err.code = 'character_not_found';
    throw err;
  }

  const char = charRows[0];
  const currentLevel = char.level ?? 1;
  const newLevel = currentLevel + 1;

  if (newLevel > 20) {
    const err = new Error('Character is already at maximum level');
    err.status = 400;
    err.code = 'max_level';
    throw err;
  }

  // Determine class data
  const classKey = (char.class || '').toLowerCase().replace(/^srd-\d{4}_/, '');
  const hitDie = CLASS_HIT_DICE[classKey] ?? 'd8';
  const dieSize = parseInt(hitDie.replace('d', ''), 10) || 8;

  // CON modifier
  const abilities = typeof char.abilities === 'string'
    ? JSON.parse(char.abilities) : (char.abilities || {});
  const conMod = Math.floor(((abilities.constitution ?? 10) - 10) / 2);

  // HP increase
  let hpIncrease;
  if (hpChoice === 'roll') {
    const roll = Math.floor(Math.random() * dieSize) + 1;
    hpIncrease = Math.max(1, roll + conMod);
  } else {
    // Average: ceil(die/2) + 1 + CON mod
    hpIncrease = Math.max(1, Math.ceil(dieSize / 2) + 1 + conMod);
  }

  // Update character record
  const hp = typeof char.hit_points === 'string'
    ? JSON.parse(char.hit_points) : (char.hit_points || {});
  const newMaxHp = (hp.max ?? 0) + hpIncrease;
  const newCurrentHp = (hp.current ?? 0) + hpIncrease;

  await client.query(
    `UPDATE public.characters
        SET level = $2,
            hit_points = jsonb_build_object(
              'current', $3::int,
              'max', $4::int,
              'temporary', $5::int
            ),
            updated_at = NOW()
      WHERE id = $1`,
    [characterId, newLevel, newCurrentHp, newMaxHp, hp.temporary ?? 0],
  );

  // Compute new spell slots if applicable
  const casterType = CASTER_TYPES[classKey] ?? 'NONE';
  let newSpellSlots = null;
  if (casterType !== 'NONE') {
    const stats = computeStats({
      baseAbilities: abilities,
      level: newLevel,
      hitDice: hitDie,
      casterType,
      classKey: char.class,
    });
    newSpellSlots = stats.spellcasting?.spellSlots ?? null;
  }

  // Update live state if session is active
  if (sessionId) {
    const liveChanges = {
      hp_current: newCurrentHp,
    };

    // Update hp_max directly (patchLiveState clamps hp_current to hp_max)
    await client.query(
      `UPDATE public.session_live_states
          SET hp_max = $3, updated_at = NOW()
        WHERE session_id = $1 AND character_id = $2`,
      [sessionId, characterId, newMaxHp],
    );

    if (newSpellSlots) {
      liveChanges.spell_slots = newSpellSlots;
    }

    // Update hit dice total
    const { rows: lsRows } = await client.query(
      `SELECT hit_dice FROM public.session_live_states
        WHERE session_id = $1 AND character_id = $2`,
      [sessionId, characterId],
    );
    if (lsRows.length > 0) {
      const hd = typeof lsRows[0].hit_dice === 'string'
        ? JSON.parse(lsRows[0].hit_dice) : (lsRows[0].hit_dice || {});
      liveChanges.hit_dice = {
        ...hd,
        total: newLevel,
        remaining: Math.min(newLevel, (hd.remaining ?? 0) + 1),
      };
    }

    await patchLiveState(client, {
      sessionId,
      characterId,
      changes: liveChanges,
      reason: `level up to ${newLevel}`,
      actorId: 'system',
    });
  }

  // ASI/Feat levels
  const asiLevels = [4, 8, 12, 16, 19];
  const isAsiLevel = asiLevels.includes(newLevel);

  logInfo('Character levelled up', {
    telemetryEvent: 'levelling.level_up',
    characterId,
    newLevel,
    hpIncrease,
    hpChoice,
  });

  return {
    characterId,
    characterName: char.name,
    newLevel,
    hpIncrease,
    newMaxHp,
    newSpellSlots,
    isAsiLevel,
    hitDie,
  };
};

export { XP_THRESHOLDS };
