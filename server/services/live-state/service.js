/**
 * Live state service — server-authoritative mutable character state during a session.
 *
 * Live states are initialised from permanent character records when a session activates
 * and can be synced back when the session ends.
 */

import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';

/**
 * Get a single live state for a character in a session.
 * Falls back to the permanent character record if no live state exists.
 */
export const getLiveState = async (client, { sessionId, characterId }) => {
  const { rows } = await client.query(
    `SELECT * FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );

  if (rows.length > 0) return rows[0];

  // Fallback: build a synthetic live state from the character record
  const { rows: charRows } = await client.query(
    `SELECT id, hit_points, spellcasting FROM public.characters WHERE id = $1`,
    [characterId],
  );
  if (charRows.length === 0) return null;

  const char = charRows[0];
  const hp = char.hit_points || {};
  return {
    character_id: characterId,
    session_id: sessionId,
    hp_current: hp.current ?? 0,
    hp_max: hp.max ?? 0,
    hp_temporary: hp.temporary ?? 0,
    conditions: [],
    spell_slots: char.spellcasting?.spellSlots ?? {},
    hit_dice: {},
    class_resources: {},
    inspiration: false,
    death_saves: { successes: 0, failures: 0 },
    xp_gained: 0,
    change_log: [],
    _fallback: true,
  };
};

/**
 * Get all live states for a session.
 */
export const getAllLiveStates = async (client, { sessionId }) => {
  const { rows } = await client.query(
    `SELECT sls.*, c.name AS character_name, up.username
       FROM public.session_live_states sls
       JOIN public.characters c ON c.id = sls.character_id
       JOIN public.user_profiles up ON up.id = sls.user_id
      WHERE sls.session_id = $1`,
    [sessionId],
  );
  return rows;
};

/**
 * Patch a live state with validation and changelog.
 * Uses SELECT FOR UPDATE to prevent concurrent writes.
 */
export const patchLiveState = async (client, { sessionId, characterId, changes, reason, actorId }) => {
  // Lock the row
  const { rows: lockRows } = await client.query(
    `SELECT * FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2
      FOR UPDATE`,
    [sessionId, characterId],
  );

  if (lockRows.length === 0) {
    const err = new Error('Live state not found for this character in this session');
    err.status = 404;
    err.code = 'live_state_not_found';
    throw err;
  }

  const current = lockRows[0];
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (typeof changes.hp_current === 'number') {
    const clamped = Math.max(0, Math.min(changes.hp_current, current.hp_max));
    setClauses.push(`hp_current = $${idx++}`);
    values.push(clamped);
  }

  if (typeof changes.hp_temporary === 'number') {
    setClauses.push(`hp_temporary = $${idx++}`);
    values.push(Math.max(0, changes.hp_temporary));
  }

  if (Array.isArray(changes.conditions)) {
    setClauses.push(`conditions = $${idx++}`);
    values.push(changes.conditions);
  }

  if (typeof changes.inspiration === 'boolean') {
    setClauses.push(`inspiration = $${idx++}`);
    values.push(changes.inspiration);
  }

  if (changes.spell_slots && typeof changes.spell_slots === 'object') {
    setClauses.push(`spell_slots = $${idx++}`);
    values.push(JSON.stringify(changes.spell_slots));
  }

  if (changes.hit_dice && typeof changes.hit_dice === 'object') {
    setClauses.push(`hit_dice = $${idx++}`);
    values.push(JSON.stringify(changes.hit_dice));
  }

  if (changes.class_resources && typeof changes.class_resources === 'object') {
    setClauses.push(`class_resources = $${idx++}`);
    values.push(JSON.stringify(changes.class_resources));
  }

  if (changes.death_saves && typeof changes.death_saves === 'object') {
    setClauses.push(`death_saves = $${idx++}`);
    values.push(JSON.stringify(changes.death_saves));
  }

  if (typeof changes.xp_gained === 'number') {
    setClauses.push(`xp_gained = $${idx++}`);
    values.push(changes.xp_gained);
  }

  if (setClauses.length === 0) {
    return current;
  }

  // Append to change_log
  const logEntry = {
    at: new Date().toISOString(),
    by: actorId,
    reason: reason ?? null,
    changes,
  };
  setClauses.push(`change_log = change_log || $${idx++}::jsonb`);
  values.push(JSON.stringify([logEntry]));

  values.push(sessionId, characterId);
  const sql = `UPDATE public.session_live_states
    SET ${setClauses.join(', ')}, updated_at = NOW()
    WHERE session_id = $${idx++} AND character_id = $${idx++}
    RETURNING *`;

  const { rows } = await client.query(sql, values);
  return rows[0];
};

/**
 * Initialize live states for all active players in a session.
 * Copies from permanent character records.
 */
export const initializeLiveStates = async (client, { sessionId, campaignId }) => {
  // Get all active players in the campaign, joining class data for hit dice
  const { rows: players } = await client.query(
    `SELECT cp.user_id, cp.character_id, c.hit_points, c.spellcasting, c.level, c.class
       FROM public.campaign_players cp
       JOIN public.characters c ON c.id = cp.character_id
      WHERE cp.campaign_id = $1 AND cp.status = 'active'`,
    [campaignId],
  );

  if (players.length === 0) return [];

  // Hit die lookup by class name (lowercase key)
  const CLASS_HIT_DICE = {
    barbarian: 'd12', fighter: 'd10', paladin: 'd10', ranger: 'd10',
    bard: 'd8', cleric: 'd8', druid: 'd8', monk: 'd8', rogue: 'd8', warlock: 'd8',
    sorcerer: 'd6', wizard: 'd6',
  };

  const inserted = [];
  for (const player of players) {
    const hp = player.hit_points || {};
    const spellSlots = player.spellcasting?.spellSlots ?? {};
    const level = player.level ?? 1;

    // Determine hit die from class name
    const classKey = (player.class || '').toLowerCase().replace(/^srd-\d{4}_/, '');
    const hitDie = CLASS_HIT_DICE[classKey] ?? 'd8';
    const hitDiceState = { die: hitDie, total: level, remaining: level };

    const { rows } = await client.query(
      `INSERT INTO public.session_live_states
        (session_id, campaign_id, user_id, character_id, hp_current, hp_max, hp_temporary, spell_slots, hit_dice)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (session_id, character_id) DO NOTHING
       RETURNING *`,
      [
        sessionId,
        campaignId,
        player.user_id,
        player.character_id,
        hp.current ?? hp.max ?? 0,
        hp.max ?? 0,
        hp.temporary ?? 0,
        JSON.stringify(spellSlots),
        JSON.stringify(hitDiceState),
      ],
    );
    if (rows[0]) inserted.push(rows[0]);
  }

  logInfo('Live states initialized', {
    telemetryEvent: 'live_state.initialized',
    sessionId,
    campaignId,
    count: inserted.length,
  });

  return inserted;
};

/**
 * Sync a live state back to the permanent character record.
 */
export const syncToCharacterRecord = async (client, { sessionId, characterId }) => {
  const { rows } = await client.query(
    `SELECT hp_current, hp_max, hp_temporary, spell_slots, xp_gained
       FROM public.session_live_states
      WHERE session_id = $1 AND character_id = $2`,
    [sessionId, characterId],
  );

  if (rows.length === 0) return null;

  const ls = rows[0];
  const xpGained = ls.xp_gained ?? 0;

  const { rows: updated } = await client.query(
    `UPDATE public.characters
        SET hit_points = jsonb_build_object(
              'current', $2::int,
              'max', $3::int,
              'temporary', $4::int
            ),
            xp = COALESCE(xp, 0) + $5
      WHERE id = $1
      RETURNING id, name, hit_points, xp`,
    [characterId, ls.hp_current, ls.hp_max, ls.hp_temporary, xpGained],
  );

  return updated[0] ?? null;
};
