/**
 * Turn-order computation helpers for different game phases.
 */

/**
 * Build the turn order array (user IDs) for a given phase.
 *
 * - exploration / social → round-robin from campaign_players ordered by joined_at
 * - combat → initiative order from encounter_participants (if encounterId provided)
 * - rest → empty (no individual turns)
 *
 * @param {import('pg').PoolClient} client
 * @param {string} campaignId
 * @param {string} _sessionId - reserved for future use
 * @param {string} phase
 * @param {{ encounterId?: string | null }} options
 * @returns {Promise<string[]>} ordered user IDs
 */
export const buildTurnOrder = async (client, campaignId, _sessionId, phase, { encounterId } = {}) => {
  if (phase === 'rest') {
    return [];
  }

  if (phase === 'combat' && encounterId) {
    const { rows } = await client.query(
      `SELECT ep.user_id
         FROM public.encounter_participants ep
        WHERE ep.encounter_id = $1
          AND ep.user_id IS NOT NULL
        ORDER BY ep.initiative DESC NULLS LAST, ep.created_at ASC`,
      [encounterId],
    );
    if (rows.length > 0) {
      return rows.map((r) => r.user_id);
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
