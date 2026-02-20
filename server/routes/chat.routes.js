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
  listRecentChatMessages,
  deleteChatMessage,
  getUnreadCounts,
  markChannelRead,
} from '../services/chat/service.js';
import { getClient } from '../db/pool.js';

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
    });

    incrementCounter('chat.messages.sent');
    logInfo('Chat message created', {
      telemetryEvent: 'chat.message_created',
      campaignId,
      messageId: message?.id,
      senderId,
      channelType: channel_type ?? 'party',
    });

    res.json({ message });
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

// Get recent messages for a campaign (for polling)
router.get('/api/campaigns/:campaignId/messages/recent', requireAuth, requireCampaignParticipation, async (req, res) => {
  const { campaignId } = req.params;
  const { since, channel_type, channel_target_user_id } = req.query; // ISO timestamp

  try {
    const rows = await listRecentChatMessages({
      campaignId,
      since,
      channelType: channel_type,
      channelTargetUserId: channel_target_user_id,
      userId: req.user.id,
    });
    res.json(rows);
  } catch (error) {
    logError('[Chat] Get recent messages error:', error);
    res.status(500).json({ error: 'Failed to fetch recent messages' });
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
