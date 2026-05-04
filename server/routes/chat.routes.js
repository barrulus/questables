import { Router } from 'express';
import {
  requireAuth,
  requireCampaignParticipation,
} from '../auth-middleware.js';
import { handleValidationErrors, validateUUID } from '../validation/common.js';
import { validateChatMessage } from '../validation/chat.js';
import { logInfo, logError } from '../utils/logger.js';
import { incrementCounter } from '../utils/telemetry.js';
import { sanitizeChatMessage, sanitizeUserInput } from '../utils/sanitization.js';
import {
  createChatMessage,
  listChatMessages,
  deleteChatMessage,
  getUnreadCounts,
  markChannelRead,
} from '../services/chat/service.js';
import { shouldInterceptAsAction, interceptChatAction } from '../services/chat/action-interceptor.js';
import { getClient, query } from '../db/pool.js';

const router = Router();

/**
 * Validate channel fields: ensure dm_broadcast is DM-only, whisper/private has a target, etc.
 */
const validateChannelAuth = async (req, res, next) => {
  const channelType = req.body.channel_type ?? 'party';
  const channelTargetUserId = req.body.channel_target_user_id ?? null;
  const { campaignId } = req.params;
  const userId = req.user.id;

  if (channelType === 'dm_broadcast') {
    // Only DM may send broadcasts
    const client = await getClient({ label: 'chat-channel-auth' });
    try {
      const { rows } = await client.query(
        'SELECT dm_user_id FROM campaigns WHERE id = $1',
        [campaignId],
      );
      if (rows.length === 0 || rows[0].dm_user_id !== userId) {
        return res.status(403).json({ error: 'Only the DM may send broadcast messages' });
      }
    } finally {
      client.release();
    }
  }

  if (channelType === 'private') {
    if (!channelTargetUserId) {
      return res.status(400).json({ error: 'Private messages require a channel_target_user_id' });
    }
    if (channelTargetUserId === userId) {
      return res.status(400).json({ error: 'Cannot send a private message to yourself' });
    }
  }

  if (channelType === 'director_whisper') {
    // Only the Campaign Director (DM) may send director whispers — these are
    // private instructions to the LLM that players never see.
    const client = await getClient({ label: 'chat-director-auth' });
    try {
      const { rows } = await client.query(
        'SELECT dm_user_id FROM campaigns WHERE id = $1',
        [campaignId],
      );
      if (rows.length === 0 || rows[0].dm_user_id !== userId) {
        return res.status(403).json({ error: 'Only the Campaign Director may send director whispers' });
      }
    } finally {
      client.release();
    }
  }

  if (channelType === 'dm_whisper') {
    // If user is the DM, they must specify a target. If user is a player, target is auto-set to DM.
    const client = await getClient({ label: 'chat-whisper-auth' });
    try {
      const { rows } = await client.query(
        'SELECT dm_user_id FROM campaigns WHERE id = $1',
        [campaignId],
      );
      const dmUserId = rows[0]?.dm_user_id ?? null;
      if (userId === dmUserId) {
        if (!channelTargetUserId) {
          return res.status(400).json({ error: 'DM whispers require a channel_target_user_id' });
        }
      } else {
        // Player → auto-target DM
        req.body.channel_target_user_id = dmUserId;
      }
    } finally {
      client.release();
    }
  }

  next();
};

router.post('/api/campaigns/:campaignId/messages', requireAuth, requireCampaignParticipation, validateUUID('campaignId'), validateChatMessage, handleValidationErrors, validateChannelAuth, async (req, res) => {
  const { campaignId } = req.params;
  const { content, type, character_id, dice_roll, channel_type, channel_target_user_id } = req.body;

  // Derive sender identity from authenticated user — never trust the client
  const senderId = req.user.id;
  const senderName = req.user.username;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  // If a character_id is provided, verify the authenticated user owns it
  if (character_id) {
    const client = await getClient({ label: 'chat-character-ownership' });
    try {
      const { rows } = await client.query('SELECT user_id FROM characters WHERE id = $1', [character_id]);
      if (rows.length === 0 || rows[0].user_id !== senderId) {
        return res.status(403).json({ error: 'You do not own this character' });
      }
    } finally {
      client.release();
    }
  }

  try {
    // Sanitize user inputs to prevent XSS
    const sanitizedContent = sanitizeChatMessage(content);
    const sanitizedSenderName = sanitizeUserInput(senderName, 50);

    if (!sanitizedContent.trim()) {
      return res.status(400).json({ error: 'Message content cannot be empty after sanitization' });
    }

    // Look up sender's current position for location tagging
    let locX = null, locY = null, insideBurgId = null;
    try {
      const { rows: posRows } = await query(
        `SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y, inside_burg_id
           FROM campaign_players
          WHERE campaign_id = $1 AND user_id = $2 AND loc_current IS NOT NULL
          LIMIT 1`,
        [campaignId, senderId],
      );
      if (posRows.length) {
        locX = posRows[0].x;
        locY = posRows[0].y;
        insideBurgId = posRows[0].inside_burg_id;
      }
    } catch { /* non-critical — message still created without location */ }

    const message = await createChatMessage({
      campaignId,
      content: sanitizedContent,
      type,
      senderId,
      senderName: sanitizedSenderName,
      characterId: character_id,
      diceRoll: dice_roll,
      channelType: channel_type ?? 'party',
      channelTargetUserId: channel_target_user_id ?? null,
      locX,
      locY,
      insideBurgId,
    });

    incrementCounter('chat.messages.sent');
    logInfo('Chat message created', {
      telemetryEvent: 'chat.message_created',
      campaignId,
      messageId: message?.id,
      senderId,
      channelType: channel_type ?? 'party',
    });

    // Broadcast over WebSocket so other connected clients see it without a
    // refresh. Previously the chat panel did this via a parallel
    // socket.emit('chat-message') after the POST returned, which meant any
    // other caller (the narrative console "Post to chat" button, server-side
    // tools, integration scripts) would silently fail to deliver. Doing it
    // here makes the REST endpoint authoritative for both persistence AND
    // delivery.
    const wsServerForBroadcast = req.app?.locals?.wsServer;
    if (wsServerForBroadcast && message) {
      const effectiveChannel = channel_type ?? 'party';
      const messageData = {
        id: message.id,
        campaign_id: message.campaign_id ?? campaignId,
        session_id: message.session_id ?? null,
        content: message.content,
        message_type: message.message_type,
        sender_id: message.sender_id ?? senderId,
        sender_name: message.sender_name ?? sanitizedSenderName,
        username: message.username ?? sanitizedSenderName,
        character_id: message.character_id ?? character_id ?? null,
        character_name: message.character_name ?? null,
        dice_roll: message.dice_roll ?? null,
        channel_type: effectiveChannel,
        channel_target_user_id: message.channel_target_user_id ?? channel_target_user_id ?? null,
        created_at: message.created_at,
      };
      try {
        if (effectiveChannel === 'private' || effectiveChannel === 'dm_whisper') {
          // Private channels: only sender + target receive
          wsServerForBroadcast.emitToUser(campaignId, senderId, 'new-message', messageData);
          if (channel_target_user_id && channel_target_user_id !== senderId) {
            wsServerForBroadcast.emitToUser(campaignId, channel_target_user_id, 'new-message', messageData);
          }
        } else {
          // party / dm_broadcast / director_whisper → whole campaign room
          wsServerForBroadcast.io.to(`campaign-${campaignId}`).emit('new-message', messageData);
        }
      } catch (broadcastErr) {
        logError('Chat REST broadcast failed (non-fatal)', {
          campaignId,
          messageId: message.id,
          error: broadcastErr.message,
        });
      }
    }

    res.json({ message });

    // ── Async action interception ──────────────────────────────────────
    // If this is a party-channel text message, check if it should be
    // processed as a game action (active session, player's turn, etc.)
    const effectiveChannelType = channel_type ?? 'party';
    if (effectiveChannelType === 'party' && (!type || type === 'text')) {
      const contextualService = req.app?.locals?.contextualLLMService;
      const wsServer = req.app?.locals?.wsServer;
      const llmService = req.app?.locals?.llmService ?? null;

      if (contextualService) {
        // Fire-and-forget — don't block the chat response
        shouldInterceptAsAction({ campaignId, userId: senderId })
          .then(({ shouldIntercept, session, gameState, characterId: charId }) => {
            if (shouldIntercept) {
              return interceptChatAction({
                campaignId,
                sessionId: session.id,
                userId: senderId,
                characterId: charId,
                chatMessage: sanitizedContent,
                gameState,
                contextualService,
                wsServer,
                llmService,
              });
            }
          })
          .catch((err) => {
            logError('Action interception failed', { error: err.message, campaignId });
          });
      }
    }
  } catch (error) {
    logError('[Chat] Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.get('/api/campaigns/:campaignId/messages', requireAuth, requireCampaignParticipation, async (req, res) => {
  const { campaignId } = req.params;
  const { limit = 50, offset = 0, channel_type, channel_target_user_id } = req.query;

  try {
    const rows = await listChatMessages({
      campaignId,
      limit,
      offset,
      channelType: channel_type,
      channelTargetUserId: channel_target_user_id,
      userId: req.user.id,
    });
    res.json(rows.reverse());
  } catch (error) {
    logError('[Chat] Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Delete a chat message (only by sender or DM)
router.delete('/api/campaigns/:campaignId/messages/:messageId', requireAuth, requireCampaignParticipation, async (req, res) => {
  const { campaignId, messageId } = req.params;
  const userId = req.user.id;

  try {
    const result = await deleteChatMessage({ campaignId, messageId, userId });
    if (result.notFound) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'You can only delete your own messages or messages in campaigns you DM' });
    }

    incrementCounter('chat.messages.deleted');
    logInfo('Chat message deleted', {
      telemetryEvent: 'chat.message_deleted',
      campaignId,
      messageId,
      actorId: userId,
    });

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    logError('[Chat] Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Get unread counts per channel
router.get('/api/campaigns/:campaignId/channels/unread', requireAuth, requireCampaignParticipation, async (req, res) => {
  const { campaignId } = req.params;

  try {
    const counts = await getUnreadCounts({ campaignId, userId: req.user.id });
    res.json({ counts });
  } catch (error) {
    logError('[Chat] Get unread counts error:', error);
    res.status(500).json({ error: 'Failed to fetch unread counts' });
  }
});

// Mark a channel as read
router.post('/api/campaigns/:campaignId/channels/read', requireAuth, requireCampaignParticipation, async (req, res) => {
  const { campaignId } = req.params;
  const { channel_type, channel_target_user_id } = req.body;

  if (!channel_type) {
    return res.status(400).json({ error: 'channel_type is required' });
  }

  try {
    await markChannelRead({
      campaignId,
      userId: req.user.id,
      channelType: channel_type,
      channelTargetUserId: channel_target_user_id ?? null,
    });
    res.json({ success: true });
  } catch (error) {
    logError('[Chat] Mark channel read error:', error);
    res.status(500).json({ error: 'Failed to mark channel as read' });
  }
});


export const registerChatRoutes = (app) => {
  app.use(router);
};
