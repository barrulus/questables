/**
 * Death Saves Service — handles character death, unconsciousness, and death saving throws.
 */

import { patchLiveState } from '../live-state/service.js';
import { logInfo } from '../../utils/logger.js';

/**
 * Handle a character reaching 0 HP.
 */
export const handleHpZero = async (client, {
  sessionId,
  characterId,
  damageAmount,
  isCritical,
  wsServer,
  campaignId,
}) => {
  // Load current state
  const { rows } = await client.query(
    `SELECT hp_current, hp_max, conditions, death_saves
       FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );
  if (rows.length === 0) return;

  const state = rows[0];
  const conditions = [...(state.conditions || [])];
  const isAlreadyUnconscious = conditions.includes('unconscious');

  // Check instant death: if damage amount exceeds hp_max
  if (damageAmount >= state.hp_max) {
    await markCharacterDead(client, { sessionId, characterId, wsServer, campaignId });
    return;
  }

  if (isAlreadyUnconscious) {
    // Already unconscious and taking damage = automatic death save failures
    const failures = isCritical ? 2 : 1;
    await applyDeathSaveFailures(client, {
      sessionId,
      characterId,
      failures,
      wsServer,
      campaignId,
    });
    return;
  }

  // Newly at 0 HP: add unconscious condition, reset death saves
  if (!conditions.includes('unconscious')) {
    conditions.push('unconscious');
  }

  await patchLiveState(client, {
    sessionId,
    characterId,
    changes: {
      conditions,
      death_saves: { successes: 0, failures: 0 },
    },
    reason: 'reduced to 0 HP',
    actorId: 'system',
  });

  // Clear concentration
  await client.query(
    `UPDATE public.session_live_states
        SET concentration = NULL
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );

  logInfo('Character fell unconscious', {
    telemetryEvent: 'death_saves.unconscious',
    sessionId,
    characterId,
  });
};

/**
 * Resolve a death saving throw.
 */
export const resolveDeathSave = async (client, {
  sessionId,
  characterId,
  roll,
}) => {
  const { rows } = await client.query(
    `SELECT death_saves, conditions
       FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2
      FOR UPDATE`,
    [sessionId, characterId],
  );
  if (rows.length === 0) {
    const err = new Error('Live state not found');
    err.status = 404;
    throw err;
  }

  const state = rows[0];
  const ds = typeof state.death_saves === 'string'
    ? JSON.parse(state.death_saves)
    : (state.death_saves || { successes: 0, failures: 0 });

  let outcome;

  if (roll === 20) {
    // Natural 20: regain 1 HP, remove unconscious, reset death saves
    const conditions = (state.conditions || []).filter((c) => c !== 'unconscious');
    await patchLiveState(client, {
      sessionId,
      characterId,
      changes: {
        hp_current: 1,
        conditions,
        death_saves: { successes: 0, failures: 0 },
      },
      reason: 'death save nat 20: regained consciousness',
      actorId: 'system',
    });
    outcome = 'conscious';
  } else if (roll === 1) {
    // Natural 1: 2 failures
    const newFailures = ds.failures + 2;
    if (newFailures >= 3) {
      await markCharacterDead(client, { sessionId, characterId });
      outcome = 'dead';
    } else {
      await patchLiveState(client, {
        sessionId,
        characterId,
        changes: {
          death_saves: { ...ds, failures: newFailures },
        },
        reason: 'death save nat 1: two failures',
        actorId: 'system',
      });
      outcome = 'fail';
    }
  } else if (roll >= 10) {
    // Success
    const newSuccesses = ds.successes + 1;
    if (newSuccesses >= 3) {
      // Stabilized
      await patchLiveState(client, {
        sessionId,
        characterId,
        changes: {
          death_saves: { successes: 3, failures: ds.failures },
        },
        reason: 'death save stabilized: three successes',
        actorId: 'system',
      });
      outcome = 'stabilized';
    } else {
      await patchLiveState(client, {
        sessionId,
        characterId,
        changes: {
          death_saves: { ...ds, successes: newSuccesses },
        },
        reason: `death save success (${newSuccesses}/3)`,
        actorId: 'system',
      });
      outcome = 'success';
    }
  } else {
    // Failure (2-9)
    const newFailures = ds.failures + 1;
    if (newFailures >= 3) {
      await markCharacterDead(client, { sessionId, characterId });
      outcome = 'dead';
    } else {
      await patchLiveState(client, {
        sessionId,
        characterId,
        changes: {
          death_saves: { ...ds, failures: newFailures },
        },
        reason: `death save failure (${newFailures}/3)`,
        actorId: 'system',
      });
      outcome = 'fail';
    }
  }

  const updatedDs = outcome === 'dead'
    ? { successes: ds.successes, failures: 3 }
    : outcome === 'conscious'
      ? { successes: 0, failures: 0 }
      : outcome === 'stabilized'
        ? { successes: 3, failures: ds.failures }
        : outcome === 'success'
          ? { successes: ds.successes + 1, failures: ds.failures }
          : { successes: ds.successes, failures: roll === 1 ? ds.failures + 2 : ds.failures + 1 };

  logInfo('Death save resolved', {
    telemetryEvent: 'death_saves.resolved',
    sessionId,
    characterId,
    roll,
    outcome,
  });

  return { roll, outcome, deathSaves: updatedDs };
};

/**
 * Handle healing when a character is at 0 HP.
 */
export const handleHealingAtZero = async (client, {
  sessionId,
  characterId,
  healAmount,
}) => {
  const { rows } = await client.query(
    `SELECT conditions FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );
  if (rows.length === 0) return;

  const conditions = (rows[0].conditions || []).filter(
    (c) => c !== 'unconscious',
  );

  await patchLiveState(client, {
    sessionId,
    characterId,
    changes: {
      conditions,
      death_saves: { successes: 0, failures: 0 },
    },
    reason: `healed at 0 HP: +${healAmount}`,
    actorId: 'system',
  });

  logInfo('Character revived from healing at zero', {
    telemetryEvent: 'death_saves.healed_at_zero',
    sessionId,
    characterId,
    healAmount,
  });
};

/**
 * Mark a character as dead.
 */
export const markCharacterDead = async (client, {
  sessionId,
  characterId,
}) => {
  const { rows } = await client.query(
    `SELECT conditions FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );
  if (rows.length === 0) return;

  let conditions = (rows[0].conditions || []).filter(
    (c) => c !== 'unconscious',
  );
  if (!conditions.includes('dead')) {
    conditions.push('dead');
  }

  await patchLiveState(client, {
    sessionId,
    characterId,
    changes: {
      hp_current: 0,
      conditions,
      death_saves: { successes: 0, failures: 3 },
    },
    reason: 'character died',
    actorId: 'system',
  });

  logInfo('Character died', {
    telemetryEvent: 'death_saves.character_died',
    sessionId,
    characterId,
  });
};

/**
 * Apply automatic death save failures (from taking damage while unconscious).
 */
const applyDeathSaveFailures = async (client, {
  sessionId,
  characterId,
  failures,
}) => {
  const { rows } = await client.query(
    `SELECT death_saves FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );
  if (rows.length === 0) return;

  const ds = typeof rows[0].death_saves === 'string'
    ? JSON.parse(rows[0].death_saves)
    : (rows[0].death_saves || { successes: 0, failures: 0 });

  const newFailures = ds.failures + failures;

  if (newFailures >= 3) {
    await markCharacterDead(client, { sessionId, characterId });
  } else {
    await patchLiveState(client, {
      sessionId,
      characterId,
      changes: {
        death_saves: { ...ds, failures: newFailures },
      },
      reason: `auto death save failure from damage (${newFailures}/3)`,
      actorId: 'system',
    });
  }
};
