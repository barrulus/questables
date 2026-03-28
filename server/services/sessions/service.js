/**
 * Get the active session for a campaign.
 * The most repeated query across route files — centralised here.
 */
export const getActiveSession = async (client, campaignId) => {
  const { rows } = await client.query(
    `SELECT id, campaign_id, game_state, status, dm_focus, dm_context_md,
            started_at, session_number, free_movement
       FROM public.sessions
      WHERE campaign_id = $1 AND status = 'active'
      ORDER BY session_number DESC
      LIMIT 1`,
    [campaignId],
  );
  return rows[0] ?? null;
};

/**
 * Get the active session for a campaign, with a FOR UPDATE lock.
 */
export const getActiveSessionForUpdate = async (client, campaignId) => {
  const { rows } = await client.query(
    `SELECT id, campaign_id, game_state, status, dm_focus, dm_context_md,
            started_at, session_number, free_movement
       FROM public.sessions
      WHERE campaign_id = $1 AND status = 'active'
      ORDER BY session_number DESC
      LIMIT 1
      FOR UPDATE`,
    [campaignId],
  );
  return rows[0] ?? null;
};

/**
 * Get the character_id for a campaign player.
 * One of the most repeated lookups across route files.
 */
export const getCampaignPlayerCharacterId = async (client, campaignId, userId) => {
  const { rows } = await client.query(
    `SELECT character_id FROM public.campaign_players
      WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
    [campaignId, userId],
  );
  return rows[0]?.character_id ?? null;
};

export const fetchSessionWithCampaign = async (client, sessionId, { forUpdate = false } = {}) => {
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  const { rows } = await client.query(
    `SELECT id,
            campaign_id,
            dm_focus,
            dm_context_md,
            status,
            started_at,
            ended_at,
            duration,
            experience_awarded
       FROM public.sessions
      WHERE id = $1
      ${lockClause}`,
    [sessionId],
  );
  return rows[0] ?? null;
};

