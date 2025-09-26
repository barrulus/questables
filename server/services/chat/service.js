import { query, withClient } from '../../db/pool.js';
import { logWarn } from '../../utils/logger.js';

const sanitizeLimit = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 200);
};

const sanitizeOffset = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

export const createChatMessage = async ({
  campaignId,
  content,
  type,
  senderId,
  senderName,
  characterId,
  diceRoll,
}) => {
  const { rows } = await query(
    `WITH inserted AS (
       INSERT INTO chat_messages (
         campaign_id,
         content,
         message_type,
         sender_id,
         sender_name,
         character_id,
         dice_roll
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *
     )
     SELECT inserted.*, up.username, c.name AS character_name
       FROM inserted
       JOIN user_profiles up ON inserted.sender_id = up.id
       LEFT JOIN characters c ON inserted.character_id = c.id`,
    [
      campaignId,
      content,
      type ?? 'text',
      senderId,
      senderName,
      characterId ?? null,
      diceRoll ? JSON.stringify(diceRoll) : null,
    ],
    { label: 'chat.messages.create' },
  );

  return rows[0] ?? null;
};

export const listChatMessages = async ({ campaignId, limit, offset }) => {
  const safeLimit = sanitizeLimit(limit, 50);
  const safeOffset = sanitizeOffset(offset);

  const { rows } = await query(
    `SELECT cm.*, up.username, c.name AS character_name
       FROM chat_messages cm
       JOIN user_profiles up ON cm.sender_id = up.id
       LEFT JOIN characters c ON cm.character_id = c.id
      WHERE cm.campaign_id = $1
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3`,
    [campaignId, safeLimit, safeOffset],
    { label: 'chat.messages.list' },
  );

  return rows;
};

export const listRecentChatMessages = async ({ campaignId, since }) => {
  const params = [campaignId];
  let text = `
    SELECT cm.*, up.username, c.name AS character_name
      FROM chat_messages cm
      JOIN user_profiles up ON cm.sender_id = up.id
      LEFT JOIN characters c ON cm.character_id = c.id
     WHERE cm.campaign_id = $1`;

  if (since) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      logWarn('Invalid "since" timestamp for recent chat messages', { campaignId, since });
    } else {
      text += ' AND cm.created_at > $2';
      params.push(parsed.toISOString());
    }
  }

  text += ' ORDER BY cm.created_at ASC';

  const { rows } = await query(text, params, { label: 'chat.messages.recent' });
  return rows;
};

export const deleteChatMessage = async ({ campaignId, messageId, userId }) => {
  return withClient(async (client) => {
    const messageResult = await client.query(
      'SELECT sender_id FROM chat_messages WHERE id = $1 AND campaign_id = $2',
      [messageId, campaignId],
    );

    if (messageResult.rowCount === 0) {
      return { notFound: true };
    }

    const campaignResult = await client.query(
      'SELECT dm_user_id FROM campaigns WHERE id = $1',
      [campaignId],
    );

    const senderId = messageResult.rows[0].sender_id;
    const dmUserId = campaignResult.rows[0]?.dm_user_id ?? null;
    const isSender = senderId === userId;
    const isCampaignDm = dmUserId === userId;

    if (!isSender && !isCampaignDm) {
      return { forbidden: true };
    }

    await client.query('DELETE FROM chat_messages WHERE id = $1', [messageId]);
    return { success: true };
  }, { label: 'chat.messages.delete' });
};

