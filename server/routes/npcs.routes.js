import { Router } from 'express';
import { body, param } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { handleValidationErrors } from '../validation/common.js';
import { logError, logInfo } from '../utils/logger.js';
import { sanitizeUserInput } from '../utils/sanitization.js';
import { clamp, VALID_SENTIMENTS } from '../llm/npc-interaction-utils.js';
import { MAX_SENTIMENT_SUMMARY_LENGTH } from '../services/campaigns/service.js';
import {
  createNpc,
  listNpcs,
  updateNpc,
  deleteNpc,
  createNpcSentimentMemory,
  upsertNpcRelationship,
  listNpcRelationships,
} from '../services/npcs/service.js';
import { incrementCounter, recordEvent } from '../utils/telemetry.js';

const router = Router();

router.post(
  '/npcs/:npcId/sentiment',
  requireAuth,
  [
    param('npcId')
      .isUUID()
      .withMessage('npcId must be a valid UUID'),
    body('delta')
      .exists()
      .withMessage('delta is required')
      .isInt({ min: -10, max: 10 })
      .withMessage('delta must be an integer between -10 and 10'),
    body('summary')
      .isString()
      .withMessage('summary is required')
      .isLength({ min: 1, max: MAX_SENTIMENT_SUMMARY_LENGTH })
      .withMessage(`summary must be between 1 and ${MAX_SENTIMENT_SUMMARY_LENGTH} characters`),
    body('sentiment')
      .optional({ checkFalsy: true })
      .isString()
      .withMessage('sentiment must be a string when provided')
      .custom((value) => VALID_SENTIMENTS.has(value.trim().toLowerCase()))
      .withMessage(`sentiment must be one of: ${Array.from(VALID_SENTIMENTS).join(', ')}`),
    body('sessionId')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('sessionId must be a valid UUID when provided'),
    body('session_id')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('session_id must be a valid UUID when provided'),
    body('tags')
      .optional({ checkFalsy: true })
      .isArray()
      .withMessage('tags must be an array when provided'),
    body('tags.*')
      .optional({ checkFalsy: true })
      .isString()
      .withMessage('tags must be strings'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { npcId } = req.params;
    const payload = req.body ?? {};

    try {
      const trustDelta = clamp(Number(payload.delta) || 0, -10, 10);
      const sentimentOverride = typeof payload.sentiment === 'string'
        ? payload.sentiment.trim().toLowerCase()
        : null;
      const sentiment = sentimentOverride
        || (trustDelta > 0 ? 'positive' : trustDelta < 0 ? 'negative' : 'neutral');

      const summary = sanitizeUserInput(payload.summary, MAX_SENTIMENT_SUMMARY_LENGTH);
      if (!summary) {
        return res.status(400).json({
          error: 'summary_required',
          message: 'summary must contain descriptive text for the sentiment adjustment.',
        });
      }

      const tags = Array.isArray(payload.tags)
        ? payload.tags
            .filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
            .map((tag) => sanitizeUserInput(tag, 50))
        : null;

      const memory = await createNpcSentimentMemory({
        npcId,
        user: req.user,
        sessionId: payload.sessionId || payload.session_id || null,
        summary,
        sentiment,
        trustDelta,
        tags,
      });

      incrementCounter('npc.sentiment_adjusted');
      recordEvent('npc.sentiment_adjusted', {
        npcId: memory.npc_id,
        campaignId: memory.campaign_id,
        sessionId: memory.session_id ?? null,
        userId: req.user.id,
        sentiment,
        trustDelta,
        hasTags: Array.isArray(memory.tags) && memory.tags.length > 0,
      });
      logInfo('NPC sentiment adjusted', {
        telemetryEvent: 'npc.sentiment_adjusted',
        npcId: memory.npc_id,
        campaignId: memory.campaign_id,
        userId: req.user.id,
        sentiment,
        trustDelta,
      });

      res.status(201).json({ memory });
    } catch (error) {
      logError('[Sidebar] NPC sentiment update error:', error);
      res.status(error.status || 500).json({
        error: error.code || 'npc_sentiment_failed',
        message: error.message || 'Failed to adjust NPC sentiment',
      });
    }
  },
);

router.post('/campaigns/:campaignId/npcs', async (req, res) => {
  const { campaignId } = req.params;
  const {
    name,
    description,
    race,
    occupation,
    personality,
    appearance,
    motivations,
    secrets,
    current_location_id: currentLocationId,
    stats,
    voice_config: voiceConfig,
  } = req.body ?? {};

  try {
    const npc = await createNpc({
      campaignId,
      name,
      description,
      race,
      occupation,
      personality,
      appearance,
      motivations,
      secrets,
      currentLocationId,
      stats,
      voiceConfig,
    });

    logInfo('NPC created', {
      telemetryEvent: 'npc.created',
      npcId: npc?.id,
      campaignId,
    });

    return res.status(201).json(npc);
  } catch (error) {
    logError('NPC creation failed', error, { campaignId, name });
    return res.status(500).json({ error: error.message });
  }
});

router.get('/campaigns/:campaignId/npcs', async (req, res) => {
  const { campaignId } = req.params;

  try {
    const npcs = await listNpcs(campaignId);
    return res.json(npcs);
  } catch (error) {
    logError('NPC listing failed', error, { campaignId });
    return res.status(500).json({ error: error.message });
  }
});

router.put('/npcs/:npcId', async (req, res) => {
  const { npcId } = req.params;
  const updates = req.body ?? {};

  try {
    const npc = await updateNpc(npcId, updates);
    if (!npc) {
      return res.status(404).json({ error: 'NPC not found' });
    }

    logInfo('NPC updated', { telemetryEvent: 'npc.updated', npcId });
    return res.json(npc);
  } catch (error) {
    logError('NPC update failed', error, { npcId });
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'npc_update_failed', message: error.message });
  }
});

router.delete('/npcs/:npcId', async (req, res) => {
  const { npcId } = req.params;

  try {
    const deleted = await deleteNpc(npcId);
    if (!deleted) {
      return res.status(404).json({ error: 'NPC not found' });
    }

    logInfo('NPC deleted', { telemetryEvent: 'npc.deleted', npcId });
    return res.json({ success: true, name: deleted.name });
  } catch (error) {
    logError('NPC delete failed', error, { npcId });
    return res.status(500).json({ error: error.message });
  }
});

router.post('/npcs/:npcId/relationships', async (req, res) => {
  const { npcId } = req.params;
  const {
    target_id: targetId,
    target_type: targetType,
    relationship_type: relationshipType,
    description,
    strength,
  } = req.body ?? {};

  try {
    const relationship = await upsertNpcRelationship({
      npcId,
      targetId,
      targetType,
      relationshipType,
      description,
      strength,
    });

    return res.json(relationship);
  } catch (error) {
    logError('NPC relationship upsert failed', error, { npcId, targetId, targetType });
    return res.status(500).json({ error: error.message });
  }
});

router.get(
  '/campaigns/:campaignId/npcs/:npcId/memories',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('npcId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, npcId } = req.params;
    const { getClient } = await import('../db/pool.js');
    const { getViewerContextOrThrow } = await import('../services/campaigns/service.js');
    const client = await getClient({ label: 'npcs.memories.list' });

    try {
      await getViewerContextOrThrow(client, campaignId, req.user);

      const { rows: memories } = await client.query(
        `SELECT nm.id, nm.memory_summary, nm.sentiment, nm.trust_delta, nm.tags, nm.created_at
           FROM public.npc_memories nm
          WHERE nm.npc_id = $1 AND nm.campaign_id = $2
          ORDER BY nm.created_at DESC
          LIMIT 20`,
        [npcId, campaignId],
      );

      // Also get relationships for this NPC
      const { rows: relationships } = await client.query(
        `SELECT nr.target_id, nr.target_type, nr.relationship_type, nr.strength,
                CASE
                  WHEN nr.target_type = 'character' THEN c.name
                  ELSE NULL
                END AS target_name
           FROM public.npc_relationships nr
           LEFT JOIN public.characters c ON nr.target_type = 'character' AND nr.target_id = c.id
          WHERE nr.npc_id = $1
          ORDER BY nr.strength DESC NULLS LAST`,
        [npcId],
      );

      res.json({ memories, relationships });
    } catch (error) {
      logError('NPC memories list failed', error, { campaignId, npcId });
      res.status(error.status || 500).json({
        error: error.code || 'npc_memories_failed',
        message: error.message || 'Failed to list NPC memories',
      });
    } finally {
      client.release();
    }
  },
);

router.get('/npcs/:npcId/relationships', async (req, res) => {
  const { npcId } = req.params;

  try {
    const relationships = await listNpcRelationships(npcId);
    return res.json(relationships);
  } catch (error) {
    logError('NPC relationship listing failed', error, { npcId });
    return res.status(500).json({ error: error.message });
  }
});

export const registerNpcRoutes = (app) => {
  app.use('/api', router);
};

