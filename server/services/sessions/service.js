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

