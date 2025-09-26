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
} from '../services/chat/service.js';

const router = Router();

router.post('/api/campaigns/:campaignId/messages', requireAuth, requireCampaignParticipation, validateUUID('campaignId'), validateChatMessage, handleValidationErrors, async (req, res) => {
  const { campaignId } = req.params;
  const { content, type, sender_id, sender_name, character_id, dice_roll } = req.body;

  if (!content || !sender_id || !sender_name) {
    return res.status(400).json({ error: 'Content, sender ID, and sender name are required' });
  }

  try {
    // Sanitize user inputs to prevent XSS
    const sanitizedContent = sanitizeChatMessage(content);
    const sanitizedSenderName = sanitizeUserInput(sender_name, 50);
    
    if (!sanitizedContent.trim()) {
      return res.status(400).json({ error: 'Message content cannot be empty after sanitization' });
    }

    const message = await createChatMessage({
      campaignId,
      content: sanitizedContent,
      type,
      senderId: sender_id,
      senderName: sanitizedSenderName,
      characterId: character_id,
      diceRoll: dice_roll,
    });

    incrementCounter('chat.messages.sent');
    logInfo('Chat message created', {
      telemetryEvent: 'chat.message_created',
      campaignId,
      messageId: message?.id,
      senderId: sender_id,
    });

    res.json({ message });
  } catch (error) {
    logError('[Chat] Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.get('/api/campaigns/:campaignId/messages', async (req, res) => {
  const { campaignId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const rows = await listChatMessages({ campaignId, limit, offset });
    res.json(rows.reverse());
  } catch (error) {
    logError('[Chat] Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get recent messages for a campaign (for polling)
router.get('/api/campaigns/:campaignId/messages/recent', async (req, res) => {
  const { campaignId } = req.params;
  const { since } = req.query; // ISO timestamp

  try {
    const rows = await listRecentChatMessages({ campaignId, since });
    res.json(rows);
  } catch (error) {
    logError('[Chat] Get recent messages error:', error);
    res.status(500).json({ error: 'Failed to fetch recent messages' });
  }
});

// Delete a chat message (only by sender or DM)
router.delete('/api/campaigns/:campaignId/messages/:messageId', async (req, res) => {
  const { campaignId, messageId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

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


export const registerChatRoutes = (app) => {
  app.use(router);
};
