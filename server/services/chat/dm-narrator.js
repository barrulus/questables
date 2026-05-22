/**
 * DM Narrator — single entry point for all LLM-generated narration.
 *
 * All LLM output (action results, world turns, scene descriptions, etc.)
 * flows through this module and is persisted as chat messages in the
 * dm_broadcast channel, then broadcast to all connected clients via WebSocket.
 */
import { query } from '../../db/pool.js';
import { logInfo, logError } from '../../utils/logger.js';
import { decryptUserFields } from '../../utils/user-pii.js';
import { extractAndPersistLore } from '../world-building/lore-extractor.js';
import { extractAndPersistNpcs } from '../world-building/npc-extractor.js';

// Module-level LLM service ref — set once at startup via setLLMService()
let _llmService = null;

/** Call once at startup to enable automatic lore extraction after narration. */
export function setLLMService(service) {
  _llmService = service;
}

// Prompt section labels the LLM occasionally echoes back as a leading markdown
// heading. Mirrors typeLabel + section titles in llm/context/prompt-builder.js.
const PROMPT_HEADER_LABELS = [
  'Narrative Response',
  'DM Narration',
  'Scene Description',
  'NPC Dialogue',
  'Action Narrative',
  'Quest Generation',
  'Objective Description',
  'Objective Treasure Hooks',
  'Objective Combat Planning',
  'Objective NPC Brief',
  'Objective Rumours',
  'Shop Auto-Stock',
  'Narrative Type',
  'Narrative Focus',
  'Game Context Snapshot',
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PROMPT_HEADER_REGEX = new RegExp(
  `^\\s*#{1,6}\\s+(?:${PROMPT_HEADER_LABELS.map(escapeRegex).join('|')})\\b[ \\t]*\\n?`,
  'i',
);

export function stripPromptHeaders(content) {
  if (typeof content !== 'string') return content;
  let out = content;
  let prev;
  do {
    prev = out;
    out = out.replace(PROMPT_HEADER_REGEX, '');
  } while (out !== prev && out.length > 0);
  return out.trimStart();
}

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
  llmService = null,
  actingCharacterId = null,
  currentScene = null,
}) {
  try {
    const cleanContent = stripPromptHeaders(content);

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
        cleanContent,
        messageType,
        dmUserId,
        locX,
        locY,
        insideBurgId,
      ],
      { label: 'dm-narrator.post' },
    );

    const message = decryptUserFields(rows[0] ?? null, ['username']);

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

    // Fire-and-forget: extract lore facts and NPCs from the narration
    const svc = llmService || _llmService;
    if (svc && cleanContent && messageType !== 'system_event' && messageType !== 'roll_request') {
      extractAndPersistLore({
        campaignId,
        narrationContent: cleanContent,
        llmService: svc,
        locX,
        locY,
        insideBurgId,
        sourceMessageId: message?.id ?? null,
      }).catch((err) => {
        logError('Lore extraction failed (non-blocking)', { campaignId, error: err.message });
      });

      extractAndPersistNpcs({
        campaignId,
        narrationContent: cleanContent,
        llmService: svc,
        sessionId,
        actingCharacterId,
        locX,
        locY,
        insideBurgId,
        currentScene,
      }).catch((err) => {
        logError('NPC extraction failed (non-blocking)', { campaignId, error: err.message });
      });
    }

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
    const cleanContent = stripPromptHeaders(content);

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
        cleanContent,
        messageType,
        dmUserId,
        targetUserId,
      ],
      { label: 'dm-narrator.post-private' },
    );

    const message = decryptUserFields(rows[0] ?? null, ['username']);

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
