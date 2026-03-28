/**
 * DM Narrator — single entry point for all LLM-generated narration.
 *
 * All LLM output (action results, world turns, scene descriptions, etc.)
 * flows through this module and is persisted as chat messages in the
 * dm_broadcast channel, then broadcast to all connected clients via WebSocket.
 */
import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';

/**
 * Post a narration from the LLM Dungeon Master into the Adventure (dm_broadcast) channel.
 *
 * Uses the campaign's DM user as the sender so the foreign key on chat_messages is satisfied.
 * The message_type distinguishes LLM output from manual DM messages.
 *
 * @param {object} opts
 * @param {string} opts.campaignId - Campaign UUID
 * @param {string} opts.content - The narration text
 * @param {string} [opts.messageType='narration'] - One of: narration, action_result, roll_request, system_event, world_turn
 * @param {string} [opts.sessionId] - Active session UUID (optional)
 * @param {object} [opts.wsServer] - WebSocket server instance for broadcasting
 * @returns {Promise<object|null>} The created chat message row
 */
export async function postNarrationToChat({
  campaignId,
  content,
  messageType = 'narration',
  sessionId = null,
  wsServer = null,
  locX = null,
  locY = null,
  insideBurgId = null,
}) {
  try {
    // Look up the campaign DM to use as sender
    const { rows: campaignRows } = await query(
      `SELECT dm_user_id FROM campaigns WHERE id = $1`,
      [campaignId],
      { label: 'dm-narrator.lookup-dm' },
    );

    if (!campaignRows.length) {
      logError('DM Narrator: campaign not found', { campaignId });
      return null;
    }

    const dmUserId = campaignRows[0].dm_user_id;

    // Insert the narration as a chat message
    const { rows } = await query(
      `WITH inserted AS (
         INSERT INTO chat_messages (
           campaign_id,
           session_id,
           content,
           message_type,
           sender_id,
           sender_name,
           channel_type,
           loc_x,
           loc_y,
           inside_burg_id
         ) VALUES ($1, $2, $3, $4, $5, 'Dungeon Master', 'dm_broadcast', $6, $7, $8)
         RETURNING *
       )
       SELECT inserted.*, up.username, NULL::text AS character_name
         FROM inserted
         JOIN user_profiles up ON inserted.sender_id = up.id`,
      [
        campaignId,
        sessionId,
        content,
        messageType,
        dmUserId,
        locX,
        locY,
        insideBurgId,
      ],
      { label: 'dm-narrator.post' },
    );

    const message = rows[0] ?? null;

    if (message && wsServer) {
      // Broadcast to all campaign participants via the standard new-message event
      const messageData = {
        id: message.id,
        campaign_id: message.campaign_id,
        session_id: message.session_id,
        content: message.content,
        message_type: message.message_type,
        sender_id: message.sender_id,
        sender_name: message.sender_name,
        username: message.username,
        character_id: null,
        character_name: null,
        dice_roll: message.dice_roll,
        channel_type: 'dm_broadcast',
        channel_target_user_id: null,
        created_at: message.created_at,
      };

      wsServer.io
        .to(`campaign-${campaignId}`)
        .emit('new-message', messageData);
    }

    logInfo('DM narration posted to chat', {
      campaignId,
      messageType,
      messageId: message?.id,
    });

    return message;
  } catch (error) {
    logError('DM Narrator: failed to post narration', {
      campaignId,
      messageType,
      error: error.message,
    });
    return null;
  }
}

/**
 * Post a private narration visible only to a specific player.
 * Uses dm_whisper channel so only the target player sees it.
 */
export async function postPrivateNarration({
  campaignId,
  targetUserId,
  content,
  messageType = 'narration',
  sessionId = null,
  wsServer = null,
}) {
  try {
    const { rows: campaignRows } = await query(
      `SELECT dm_user_id FROM campaigns WHERE id = $1`,
      [campaignId],
      { label: 'dm-narrator.lookup-dm-private' },
    );

    if (!campaignRows.length) return null;
    const dmUserId = campaignRows[0].dm_user_id;

    const { rows } = await query(
      `WITH inserted AS (
         INSERT INTO chat_messages (
           campaign_id,
           session_id,
           content,
           message_type,
           sender_id,
           sender_name,
           channel_type,
           channel_target_user_id
         ) VALUES ($1, $2, $3, $4, $5, 'Dungeon Master', 'dm_whisper', $6)
         RETURNING *
       )
       SELECT inserted.*, up.username, NULL::text AS character_name
         FROM inserted
         JOIN user_profiles up ON inserted.sender_id = up.id`,
      [
        campaignId,
        sessionId,
        content,
        messageType,
        dmUserId,
        targetUserId,
      ],
      { label: 'dm-narrator.post-private' },
    );

    const message = rows[0] ?? null;

    if (message && wsServer) {
      const messageData = {
        id: message.id,
        campaign_id: message.campaign_id,
        session_id: message.session_id,
        content: message.content,
        message_type: message.message_type,
        sender_id: message.sender_id,
        sender_name: message.sender_name,
        username: message.username,
        character_id: null,
        character_name: null,
        dice_roll: message.dice_roll,
        channel_type: 'dm_whisper',
        channel_target_user_id: targetUserId,
        created_at: message.created_at,
      };

      // Only send to the DM and the target player
      wsServer.emitToUser(campaignId, dmUserId, 'new-message', messageData);
      if (targetUserId !== dmUserId) {
        wsServer.emitToUser(campaignId, targetUserId, 'new-message', messageData);
      }
    }

    return message;
  } catch (error) {
    logError('DM Narrator: failed to post private narration', {
      campaignId,
      targetUserId,
      error: error.message,
    });
    return null;
  }
}
