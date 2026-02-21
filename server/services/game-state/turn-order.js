/**
 * Turn-order computation helpers for different game phases.
 */

import { buildCombatTurnOrder } from '../combat/service.js';

/**
 * Build the turn order array for a given phase.
 *
 * - exploration / social → round-robin from campaign_players ordered by joined_at
 * - combat → mixed PC/NPC initiative order from encounter_participants
 * - rest → empty (no individual turns)
 *
 * @param {import('pg').PoolClient} client
 * @param {string} campaignId
 * @param {string} _sessionId - reserved for future use
 * @param {string} phase
 * @param {{ encounterId?: string | null }} options
 * @returns {Promise<string[]>} ordered user IDs (or 'npc:{id}' for NPCs in combat)
 */
export const buildTurnOrder = async (client, campaignId, _sessionId, phase, { encounterId } = {}) => {
  if (phase === 'rest') {
    return [];
  }

  if (phase === 'combat' && encounterId) {
    const order = await buildCombatTurnOrder(client, encounterId);
    if (order.length > 0) {
      return order;
    }
    // Fall through to campaign_players if no participants registered yet
  }

  // Default: round-robin from active campaign players
  const { rows } = await client.query(
    `SELECT cp.user_id
       FROM public.campaign_players cp
      WHERE cp.campaign_id = $1
        AND cp.status = 'active'
      ORDER BY cp.joined_at ASC`,
    [campaignId],
  );

  return rows.map((r) => r.user_id);
};
