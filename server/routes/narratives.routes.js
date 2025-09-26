import { Router } from 'express';
import {
  requireAuth,
  requireCampaignParticipation,
} from '../auth-middleware.js';
import {
  narrativeBaseValidators,
  npcNarrativeValidators,
  actionNarrativeValidators,
  questNarrativeValidators,
} from '../validation/narratives.js';
import { handleValidationErrors } from '../validation/common.js';
import { logError } from '../utils/logger.js';
import { NARRATIVE_TYPES } from '../llm/index.js';
import { respondWithNarrativeError } from '../llm/narrative-errors.js';
import { generateNarrative } from '../services/narratives/service.js';

const router = Router();

router.post(
  '/api/campaigns/:campaignId/narratives/dm',
  requireAuth,
  requireCampaignParticipation,
  narrativeBaseValidators,
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { sessionId, focus, metadata = {}, provider, parameters } = req.body;

    try {
      const { narrative } = await generateNarrative({
        req,
        campaignId,
        sessionId,
        type: NARRATIVE_TYPES.DM_NARRATION,
        provider,
        parameters,
        focus,
        metadata,
        requestExtras: { focus: focus ?? null },
        requireLead: true,
      });

      res.status(201).json(narrative);
    } catch (error) {
      logError('DM narration request failed', error, {
        campaignId,
        sessionId,
        userId: req.user?.id,
      });
      respondWithNarrativeError(res, error);
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/narratives/scene',
  requireAuth,
  requireCampaignParticipation,
  narrativeBaseValidators,
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { sessionId, focus, metadata = {}, provider, parameters } = req.body;

    try {
      const { narrative } = await generateNarrative({
        req,
        campaignId,
        sessionId,
        type: NARRATIVE_TYPES.SCENE_DESCRIPTION,
        provider,
        parameters,
        focus,
        metadata,
        requestExtras: { focus: focus ?? null },
        requireLead: true,
      });

      res.status(201).json(narrative);
    } catch (error) {
      logError('Scene description request failed', error, {
        campaignId,
        sessionId,
        userId: req.user?.id,
      });
      respondWithNarrativeError(res, error);
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/narratives/npc',
  requireAuth,
  requireCampaignParticipation,
  [...narrativeBaseValidators, ...npcNarrativeValidators],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { sessionId, focus, metadata = {}, provider, parameters, npcId, interaction } = req.body;

    try {
      const { narrative } = await generateNarrative({
        req,
        campaignId,
        sessionId,
        npcId,
        type: NARRATIVE_TYPES.NPC_DIALOGUE,
        provider,
        parameters,
        focus,
        metadata: {
          ...metadata,
          npcId,
          interaction: interaction ?? null,
        },
        requestExtras: {
          npcId,
          interaction,
        },
        requireLead: true,
      });

      res.status(201).json(narrative);
    } catch (error) {
      logError('NPC dialogue request failed', error, {
        campaignId,
        sessionId,
        npcId,
        userId: req.user?.id,
      });
      respondWithNarrativeError(res, error);
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/narratives/action',
  requireAuth,
  requireCampaignParticipation,
  [...narrativeBaseValidators, ...actionNarrativeValidators],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { sessionId, focus, metadata = {}, provider, parameters, action } = req.body;

    try {
      const { narrative } = await generateNarrative({
        req,
        campaignId,
        sessionId,
        type: NARRATIVE_TYPES.ACTION_NARRATIVE,
        provider,
        parameters,
        focus,
        metadata: {
          ...metadata,
          action,
        },
        requestExtras: {
          action,
        },
        requireLead: false,
      });

      res.status(201).json(narrative);
    } catch (error) {
      logError('Action narrative request failed', error, {
        campaignId,
        sessionId,
        userId: req.user?.id,
      });
      respondWithNarrativeError(res, error);
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/narratives/quest',
  requireAuth,
  requireCampaignParticipation,
  [...narrativeBaseValidators, ...questNarrativeValidators],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { sessionId, focus, metadata = {}, provider, parameters, questSeeds } = req.body;

    try {
      const { narrative } = await generateNarrative({
        req,
        campaignId,
        sessionId,
        type: NARRATIVE_TYPES.QUEST,
        provider,
        parameters,
        focus,
        metadata: {
          ...metadata,
          questSeeds: questSeeds ?? null,
        },
        requestExtras: {
          questSeeds,
        },
        requireLead: true,
      });

      res.status(201).json(narrative);
    } catch (error) {
      logError('Quest generation request failed', error, {
        campaignId,
        sessionId,
        userId: req.user?.id,
      });
      respondWithNarrativeError(res, error);
    }
  }
);

export const registerNarrativeRoutes = (app) => {
  app.use(router);
};
