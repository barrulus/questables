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
  channelType,
  channelTargetUserId,
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
         dice_roll,
         channel_type,
         channel_target_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      channelType ?? 'party',
      channelTargetUserId ?? null,
    ],
    { label: 'chat.messages.create' },
  );

  return rows[0] ?? null;
};

export const listChatMessages = async ({ campaignId, limit, offset, channelType, channelTargetUserId, userId }) => {
  const safeLimit = sanitizeLimit(limit, 50);
  const safeOffset = sanitizeOffset(offset);

  const params = [campaignId, safeLimit, safeOffset];
  let whereClause = 'cm.campaign_id = $1';
  let paramIndex = 4;

  if (channelType) {
    whereClause += ` AND cm.channel_type = $${paramIndex}`;
    params.push(channelType);
    paramIndex += 1;
  }

  // For private/whisper channels, only show messages where user is sender or target
  if (channelType === 'private' || channelType === 'dm_whisper') {
    if (channelTargetUserId) {
      whereClause += ` AND ((cm.sender_id = $${paramIndex} AND cm.channel_target_user_id = $${paramIndex + 1})
                        OR  (cm.sender_id = $${paramIndex + 1} AND cm.channel_target_user_id = $${paramIndex}))`;
      params.push(userId, channelTargetUserId);
      paramIndex += 2;
    } else if (userId) {
      whereClause += ` AND (cm.sender_id = $${paramIndex} OR cm.channel_target_user_id = $${paramIndex})`;
      params.push(userId);
      paramIndex += 1;
    }
  }

  const { rows } = await query(
    `SELECT cm.*, up.username, c.name AS character_name
       FROM chat_messages cm
       JOIN user_profiles up ON cm.sender_id = up.id
       LEFT JOIN characters c ON cm.character_id = c.id
      WHERE ${whereClause}
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3`,
    params,
    { label: 'chat.messages.list' },
  );

  return rows;
};

export const listRecentChatMessages = async ({ campaignId, since, channelType, channelTargetUserId, userId }) => {
  const params = [campaignId];
  let text = `
    SELECT cm.*, up.username, c.name AS character_name
      FROM chat_messages cm
      JOIN user_profiles up ON cm.sender_id = up.id
      LEFT JOIN characters c ON cm.character_id = c.id
     WHERE cm.campaign_id = $1`;

  let paramIndex = 2;

  if (since) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      logWarn('Invalid "since" timestamp for recent chat messages', { campaignId, since });
    } else {
      text += ` AND cm.created_at > $${paramIndex}`;
      params.push(parsed.toISOString());
      paramIndex += 1;
    }
  }

  if (channelType) {
    text += ` AND cm.channel_type = $${paramIndex}`;
    params.push(channelType);
    paramIndex += 1;
  }

  if ((channelType === 'private' || channelType === 'dm_whisper') && userId) {
    if (channelTargetUserId) {
      text += ` AND ((cm.sender_id = $${paramIndex} AND cm.channel_target_user_id = $${paramIndex + 1})
                 OR  (cm.sender_id = $${paramIndex + 1} AND cm.channel_target_user_id = $${paramIndex}))`;
      params.push(userId, channelTargetUserId);
      paramIndex += 2;
    } else {
      text += ` AND (cm.sender_id = $${paramIndex} OR cm.channel_target_user_id = $${paramIndex})`;
      params.push(userId);
      paramIndex += 1;
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

/**
 * Get unread message counts per channel for a user.
 */
export const getUnreadCounts = async ({ campaignId, userId }) => {
  const { rows } = await query(
    `SELECT
       cm.channel_type,
       cm.channel_target_user_id,
       COUNT(*)::int AS unread_count
     FROM chat_messages cm
     LEFT JOIN chat_read_cursors crc
       ON crc.user_id = $2
      AND crc.campaign_id = $1
      AND crc.channel_type = cm.channel_type
      AND COALESCE(crc.channel_target_user_id, '00000000-0000-0000-0000-000000000000')
        = COALESCE(cm.channel_target_user_id, '00000000-0000-0000-0000-000000000000')
     WHERE cm.campaign_id = $1
       AND cm.created_at > COALESCE(crc.last_read_at, '1970-01-01'::timestamptz)
       AND (
         cm.channel_type IN ('party', 'dm_broadcast')
         OR cm.sender_id = $2
         OR cm.channel_target_user_id = $2
       )
     GROUP BY cm.channel_type, cm.channel_target_user_id`,
    [campaignId, userId],
    { label: 'chat.unread_counts' },
  );

  return rows;
};

/**
 * Mark a channel as read for a user.
 */
export const markChannelRead = async ({ campaignId, userId, channelType, channelTargetUserId }) => {
  await query(
    `INSERT INTO chat_read_cursors (user_id, campaign_id, channel_type, channel_target_user_id, last_read_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, campaign_id, channel_type,
       COALESCE(channel_target_user_id, '00000000-0000-0000-0000-000000000000'))
     DO UPDATE SET last_read_at = NOW()`,
    [userId, campaignId, channelType, channelTargetUserId ?? null],
    { label: 'chat.mark_read' },
  );
};
