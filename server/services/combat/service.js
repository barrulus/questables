/**
 * Combat service — orchestrates encounter creation, turn budget, and resolution.
 */

import { logInfo } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Initiative helpers
// ---------------------------------------------------------------------------

/**
 * Roll initiative: d20 + DEX modifier.
 * @param {number} [dexModifier=0]
 * @returns {number}
 */
const rollInitiative = (dexModifier = 0) => {
  const d20 = Math.floor(Math.random() * 20) + 1;
  return d20 + dexModifier;
};

/**
 * Extract DEX modifier from a character's abilities JSONB.
 * Abilities may be stored as { dexterity: 14 } or { DEX: 14 } etc.
 */
const getDexModifier = (abilities) => {
  if (!abilities || typeof abilities !== 'object') return 0;
  const dex =
    abilities.dexterity ?? abilities.Dexterity ?? abilities.DEX ?? abilities.dex ?? 10;
  return Math.floor((dex - 10) / 2);
};

// ---------------------------------------------------------------------------
// Combat Initiation
// ---------------------------------------------------------------------------

/**
 * Create an encounter and populate it with all active campaign players and
 * specified enemy NPCs. Rolls initiative for everyone.
 *
 * @param {import('pg').PoolClient} client  — must be inside a transaction
 * @param {{ campaignId: string, sessionId: string, encounterId?: string|null, enemyNpcIds?: string[], reason?: string }} opts
 * @returns {{ encounter: object, participants: object[], initiativeOrder: string[] }}
 */
export const initiateCombat = async (client, { campaignId, sessionId, encounterId, enemyNpcIds = [], reason }) => {
  let encounter;

  if (encounterId) {
    // Use provided encounter
    const { rows } = await client.query(
      `SELECT * FROM public.encounters WHERE id = $1 AND campaign_id = $2`,
      [encounterId, campaignId],
    );
    encounter = rows[0];
    if (!encounter) {
      const err = new Error('Encounter not found');
      err.status = 404;
      err.code = 'encounter_not_found';
      throw err;
    }
    // Mark active
    await client.query(
      `UPDATE public.encounters SET status = 'active' WHERE id = $1`,
      [encounterId],
    );
  } else {
    // Auto-create encounter
    const { rows } = await client.query(
      `INSERT INTO public.encounters
         (campaign_id, session_id, name, description, type, difficulty, status)
       VALUES ($1, $2, $3, $4, 'combat', 'medium', 'active')
       RETURNING *`,
      [campaignId, sessionId, reason ?? 'Combat', reason ?? 'Auto-initiated combat encounter'],
    );
    encounter = rows[0];
  }

  const participants = [];

  // ── Add all active campaign players ──────────────────────────────────
  const { rows: playerRows } = await client.query(
    `SELECT cp.user_id, cp.character_id,
            c.name, c.abilities, c.armor_class
       FROM public.campaign_players cp
       JOIN public.characters c ON c.id = cp.character_id
      WHERE cp.campaign_id = $1 AND cp.status = 'active'`,
    [campaignId],
  );

  for (const p of playerRows) {
    const dexMod = getDexModifier(p.abilities);
    const initiative = rollInitiative(dexMod);

    // Check live state for HP
    const { rows: liveRows } = await client.query(
      `SELECT hp_current, hp_max, hp_temporary FROM public.session_live_states
        WHERE session_id = $1 AND character_id = $2`,
      [sessionId, p.character_id],
    );
    const live = liveRows[0];

    const { rows: insertedRows } = await client.query(
      `INSERT INTO public.encounter_participants
         (encounter_id, participant_id, participant_type, name, initiative,
          hit_points, armor_class, user_id)
       VALUES ($1, $2, 'character', $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        encounter.id,
        p.character_id,
        p.name,
        initiative,
        JSON.stringify({
          max: live?.hp_max ?? 10,
          current: live?.hp_current ?? 10,
          temporary: live?.hp_temporary ?? 0,
        }),
        p.armor_class ?? 10,
        p.user_id,
      ],
    );
    participants.push(insertedRows[0]);
  }

  // ── Add enemy NPCs ─────────────────────────────────────────────────
  for (const npcId of enemyNpcIds) {
    const { rows: npcRows } = await client.query(
      `SELECT id, name, hit_points, armor_class FROM public.npcs WHERE id = $1`,
      [npcId],
    );
    const npc = npcRows[0];
    if (!npc) continue;

    const initiative = rollInitiative(0);

    const hp = typeof npc.hit_points === 'object' && npc.hit_points !== null
      ? npc.hit_points
      : { max: npc.hit_points ?? 10, current: npc.hit_points ?? 10, temporary: 0 };

    const { rows: insertedRows } = await client.query(
      `INSERT INTO public.encounter_participants
         (encounter_id, participant_id, participant_type, name, initiative,
          hit_points, armor_class, user_id)
       VALUES ($1, $2, 'npc', $3, $4, $5, $6, NULL)
       RETURNING *`,
      [encounter.id, npc.id, npc.name, initiative, JSON.stringify(hp), npc.armor_class ?? 10],
    );
    participants.push(insertedRows[0]);
  }

  // Build initiative order
  const sorted = [...participants].sort((a, b) => {
    if ((b.initiative ?? 0) !== (a.initiative ?? 0)) return (b.initiative ?? 0) - (a.initiative ?? 0);
    return a.name.localeCompare(b.name);
  });

  const initiativeOrder = sorted.map((p) =>
    p.participant_type === 'character' && p.user_id ? p.user_id : `npc:${p.id}`,
  );

  logInfo('Combat initiated', {
    telemetryEvent: 'combat.initiated',
    encounterId: encounter.id,
    campaignId,
    sessionId,
    participantCount: participants.length,
  });

  return { encounter, participants, initiativeOrder };
};

// ---------------------------------------------------------------------------
// Combat Turn Order (replaces broken turn-order.js combat branch)
// ---------------------------------------------------------------------------

/**
 * Build a mixed PC/NPC turn order from encounter participants.
 * Returns user_id for PCs and 'npc:{participant_row_id}' for NPCs.
 */
export const buildCombatTurnOrder = async (client, encounterId) => {
  const { rows } = await client.query(
    `SELECT ep.id AS participant_id,
            ep.participant_type,
            ep.user_id,
            ep.initiative,
            ep.name
       FROM public.encounter_participants ep
      WHERE ep.encounter_id = $1
      ORDER BY ep.initiative DESC NULLS LAST, ep.name ASC`,
    [encounterId],
  );

  return rows.map((r) =>
    r.participant_type === 'character' && r.user_id
      ? r.user_id
      : `npc:${r.participant_id}`,
  );
};

// ---------------------------------------------------------------------------
// Turn Budget
// ---------------------------------------------------------------------------

/**
 * Return a fresh combat turn budget for a combatant.
 */
export const resetTurnBudget = () => ({
  actionUsed: false,
  bonusActionUsed: false,
  movementRemaining: 30,
  reactionUsed: false,
});

/**
 * Validate and consume an action from the budget.
 * Returns updated budget or throws if the slot is already used.
 *
 * @param {object} budget
 * @param {string} actionType
 * @returns {object} updated budget
 */
export const consumeAction = (budget, actionType) => {
  const updated = { ...budget };

  switch (actionType) {
    case 'attack':
    case 'cast_spell':
    case 'dodge':
    case 'disengage':
    case 'help':
    case 'hide':
    case 'ready':
    case 'use_item':
    case 'search':
    case 'interact':
    case 'pass': {
      if (updated.actionUsed) {
        const err = new Error('Action already used this turn');
        err.status = 400;
        err.code = 'action_already_used';
        throw err;
      }
      updated.actionUsed = true;
      break;
    }

    case 'dash': {
      if (updated.actionUsed) {
        const err = new Error('Action already used this turn');
        err.status = 400;
        err.code = 'action_already_used';
        throw err;
      }
      updated.actionUsed = true;
      // Dash doubles remaining movement
      updated.movementRemaining = updated.movementRemaining * 2;
      break;
    }

    case 'move': {
      // Movement doesn't use the action slot — it's part of movement budget
      // The actual distance consumed would be tracked via payload, but
      // for now we just note movement was used
      break;
    }

    case 'free_action': {
      // Free actions don't consume budget
      break;
    }

    default: {
      // Unknown action type — just mark action used to be safe
      if (updated.actionUsed) {
        const err = new Error('Action already used this turn');
        err.status = 400;
        err.code = 'action_already_used';
        throw err;
      }
      updated.actionUsed = true;
    }
  }

  return updated;
};

// ---------------------------------------------------------------------------
// Combat Resolution
// ---------------------------------------------------------------------------

/**
 * End combat: mark encounter completed, award XP, return to previous phase.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ campaignId: string, sessionId: string, encounterId: string, endCondition: string }} opts
 * @returns {{ xpAwarded: number, endCondition: string }}
 */
export const resolveCombatEnd = async (client, { campaignId, sessionId, encounterId, endCondition }) => {
  // Mark encounter completed
  await client.query(
    `UPDATE public.encounters SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [encounterId],
  );

  // Calculate XP from encounter reward
  const { rows: encounterRows } = await client.query(
    `SELECT experience_reward FROM public.encounters WHERE id = $1`,
    [encounterId],
  );
  let totalXp = encounterRows[0]?.experience_reward ?? 0;

  // If no preset XP, sum from defeated NPC participants (HP current <= 0)
  if (totalXp === 0) {
    const { rows: defeatedRows } = await client.query(
      `SELECT ep.participant_id
         FROM public.encounter_participants ep
        WHERE ep.encounter_id = $1
          AND ep.participant_type = 'npc'
          AND (ep.hit_points->>'current')::int <= 0`,
      [encounterId],
    );

    if (defeatedRows.length > 0) {
      const npcIds = defeatedRows.map((r) => r.participant_id);
      const { rows: npcRows } = await client.query(
        `SELECT COALESCE(SUM(n.experience_reward), 0) AS total
           FROM public.npcs n
          WHERE n.id = ANY($1)`,
        [npcIds],
      );
      totalXp = npcRows[0]?.total ?? 0;
    }
  }

  // Distribute XP equally among surviving PCs
  if (totalXp > 0) {
    const { rows: survivors } = await client.query(
      `SELECT sls.character_id
         FROM public.session_live_states sls
        WHERE sls.session_id = $1
          AND sls.hp_current > 0`,
      [sessionId],
    );

    if (survivors.length > 0) {
      const xpPerPlayer = Math.floor(totalXp / survivors.length);
      const charIds = survivors.map((s) => s.character_id);

      await client.query(
        `UPDATE public.session_live_states
            SET xp_gained = xp_gained + $2,
                updated_at = NOW()
          WHERE session_id = $1
            AND character_id = ANY($3)`,
        [sessionId, xpPerPlayer, charIds],
      );
    }
  }

  logInfo('Combat resolved', {
    telemetryEvent: 'combat.resolved',
    encounterId,
    campaignId,
    endCondition,
    xpAwarded: totalXp,
  });

  return { xpAwarded: totalXp, endCondition };
};
