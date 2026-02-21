/**
 * Rest Service — short/long rest mechanics.
 */

import { patchLiveState, getAllLiveStates } from '../live-state/service.js';
import { logInfo } from '../../utils/logger.js';

/**
 * Spend a hit die during a short rest.
 * Rolls the character's hit die, adds CON modifier, heals HP.
 */
export const spendHitDie = async (client, { sessionId, characterId }) => {
  // Load live state + character abilities for CON mod
  const { rows } = await client.query(
    `SELECT sls.hp_current, sls.hp_max, sls.hit_dice,
            c.abilities
       FROM public.session_live_states sls
       JOIN public.characters c ON c.id = sls.character_id
      WHERE sls.session_id = $1 AND sls.character_id = $2
      FOR UPDATE`,
    [sessionId, characterId],
  );

  if (rows.length === 0) {
    const err = new Error('Live state not found');
    err.status = 404;
    err.code = 'live_state_not_found';
    throw err;
  }

  const state = rows[0];
  const hitDice = typeof state.hit_dice === 'string'
    ? JSON.parse(state.hit_dice)
    : (state.hit_dice || {});

  if (!hitDice.remaining || hitDice.remaining <= 0) {
    const err = new Error('No hit dice remaining');
    err.status = 400;
    err.code = 'no_hit_dice';
    throw err;
  }

  // Parse die size
  const dieSize = parseInt((hitDice.die || 'd8').replace('d', ''), 10) || 8;

  // Roll
  const roll = Math.floor(Math.random() * dieSize) + 1;

  // CON modifier
  const abilities = typeof state.abilities === 'string'
    ? JSON.parse(state.abilities)
    : (state.abilities || {});
  const conScore = abilities.constitution ?? 10;
  const conMod = Math.floor((conScore - 10) / 2);

  const healing = Math.max(1, roll + conMod);
  const newHp = Math.min(state.hp_max, state.hp_current + healing);

  // Update live state
  const newHitDice = {
    ...hitDice,
    remaining: hitDice.remaining - 1,
  };

  await patchLiveState(client, {
    sessionId,
    characterId,
    changes: {
      hp_current: newHp,
      hit_dice: newHitDice,
    },
    reason: `hit die spent: d${dieSize}(${roll}) + ${conMod} = ${healing} healing`,
    actorId: 'system',
  });

  logInfo('Hit die spent', {
    telemetryEvent: 'rest.hit_die_spent',
    sessionId,
    characterId,
    roll,
    conMod,
    healing,
    hitDiceRemaining: newHitDice.remaining,
  });

  return {
    roll,
    dieSize,
    conMod,
    healing,
    newHp,
    hitDiceRemaining: newHitDice.remaining,
  };
};

/**
 * Complete a rest, applying restoration effects.
 */
export const completeRest = async (client, { sessionId, campaignId, restType }) => {
  const liveStates = await getAllLiveStates(client, { sessionId });

  for (const ls of liveStates) {
    const changes = {};

    if (restType === 'long') {
      // Full HP restoration
      changes.hp_current = ls.hp_max;
      changes.hp_temporary = 0;

      // Restore all spell slots (reset used to 0)
      if (ls.spell_slots && typeof ls.spell_slots === 'object') {
        const restoredSlots = {};
        const slots = typeof ls.spell_slots === 'string'
          ? JSON.parse(ls.spell_slots) : ls.spell_slots;
        for (const [level, slot] of Object.entries(slots)) {
          if (slot && typeof slot === 'object') {
            restoredSlots[level] = { ...slot, used: 0 };
          }
        }
        changes.spell_slots = restoredSlots;
      }

      // Regain half hit dice (minimum 1)
      if (ls.hit_dice && typeof ls.hit_dice === 'object') {
        const hd = typeof ls.hit_dice === 'string'
          ? JSON.parse(ls.hit_dice) : ls.hit_dice;
        const total = hd.total ?? 1;
        const regain = Math.max(1, Math.floor(total / 2));
        changes.hit_dice = {
          ...hd,
          remaining: Math.min(total, (hd.remaining ?? 0) + regain),
        };
      }

      // Clear death saves and concentration
      changes.death_saves = { successes: 0, failures: 0 };

      // Clear concentration
      await client.query(
        `UPDATE public.session_live_states
            SET concentration = NULL
          WHERE session_id = $1 AND character_id = $2`,
        [sessionId, ls.character_id],
      );
    }
    // Short rest: no automatic restoration (hit dice spent interactively)

    if (Object.keys(changes).length > 0) {
      await patchLiveState(client, {
        sessionId,
        characterId: ls.character_id,
        changes,
        reason: `${restType} rest completed`,
        actorId: 'system',
      });
    }
  }

  logInfo('Rest completed', {
    telemetryEvent: 'rest.completed',
    sessionId,
    campaignId,
    restType,
    playerCount: liveStates.length,
  });

  return { restType, playersAffected: liveStates.length };
};

/**
 * Roll for a random encounter during rest.
 * 15% chance (roll 1-3 on d20).
 */
export const rollRestEncounter = () => {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { triggered: roll <= 3, roll };
};
