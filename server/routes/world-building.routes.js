/**
 * World-Building Routes — collaborative CD + LLM world creation.
 *
 * These endpoints are used during campaign prep (before gameplay) to generate,
 * review, edit, and manage world lore sections.
 */

import { Router } from 'express';
import { body, param } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { handleValidationErrors } from '../validation/common.js';
import { ensureDmControl, resolveCampaignViewerContext } from '../services/campaigns/service.js';
import { getClient } from '../db/pool.js';
import { logError, logInfo } from '../utils/logger.js';
import {
  generateWorldLore,
  listWorldLore,
  getWorldLoreById,
  upsertWorldLore,
  deleteWorldLore,
} from '../services/world-building/service.js';

const router = Router();

const VALID_SECTIONS = ['geopolitical', 'history', 'cultures', 'religions', 'regions', 'factions', 'custom'];

// ── POST /api/campaigns/:campaignId/world-building/generate ─────────────────
// Generate a world lore section via LLM

router.post(
  '/api/campaigns/:campaignId/world-building/generate',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('section').isString().isIn(VALID_SECTIONS),
    body('subsection').optional({ nullable: true }).isString(),
    body('direction').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const { section, subsection, direction } = req.body;

    const client = await getClient({ label: 'world-build.generate' });
    try {
      const viewer = await resolveCampaignViewerContext(client, campaignId, req.user.id);
      ensureDmControl(viewer, 'Only the campaign director can manage world lore.');

      // Get the campaign's world map
      const { rows } = await client.query(
        'SELECT world_map_id FROM campaigns WHERE id = $1',
        [campaignId],
      );
      if (!rows.length || !rows[0].world_map_id) {
        return res.status(400).json({
          error: 'no_world_map',
          message: 'Campaign must have a world map assigned for world-building',
        });
      }

      const contextualService = req.app?.locals?.contextualLLMService;
      if (!contextualService) {
        return res.status(503).json({ error: 'LLM service not available' });
      }

      const result = await generateWorldLore({
        campaignId,
        worldMapId: rows[0].world_map_id,
        section,
        subsection: subsection ?? null,
        direction: direction ?? null,
        contextualService,
      });

      // Auto-save the generated content
      const saved = await upsertWorldLore({
        campaignId,
        section,
        subsection: subsection ?? null,
        content: result.content,
        cdDirection: direction ?? null,
        generatedBy: 'llm',
      });

      logInfo('World lore generated', {
        campaignId,
        section,
        subsection,
        loreId: saved.id,
      });

      return res.json(saved);
    } catch (error) {
      logError('World lore generation failed', error, { campaignId, section });
      return res.status(error.status || 500).json({
        error: error.code || 'generation_failed',
        message: error.message || 'Failed to generate world lore',
      });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:campaignId/world-building/lore ──────────────────────
// List all world lore for a campaign

router.get(
  '/api/campaigns/:campaignId/world-building/lore',
  requireAuth,
  [param('campaignId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    try {
      const lore = await listWorldLore(campaignId);
      return res.json(lore);
    } catch (error) {
      logError('Failed to list world lore', error, { campaignId });
      return res.status(500).json({ error: 'Failed to list world lore' });
    }
  },
);

// ── PUT /api/campaigns/:campaignId/world-building/lore/:id ──────────────────
// Update a world lore entry (manual edit)

router.put(
  '/api/campaigns/:campaignId/world-building/lore/:loreId',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('loreId').isUUID(),
    body('content').isString().isLength({ min: 1, max: 50000 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, loreId } = req.params;
    const { content } = req.body;

    const client = await getClient({ label: 'world-build.update' });
    try {
      const viewer = await resolveCampaignViewerContext(client, campaignId, req.user.id);
      ensureDmControl(viewer, 'Only the campaign director can manage world lore.');

      const existing = await getWorldLoreById(loreId);
      if (!existing || existing.campaign_id !== campaignId) {
        return res.status(404).json({ error: 'Lore entry not found' });
      }

      const updated = await upsertWorldLore({
        campaignId,
        section: existing.section,
        subsection: existing.subsection,
        content,
        cdDirection: existing.cd_direction,
        generatedBy: 'manual',
      });

      return res.json(updated);
    } catch (error) {
      logError('Failed to update world lore', error, { campaignId, loreId });
      return res.status(error.status || 500).json({
        error: error.code || 'update_failed',
        message: error.message || 'Failed to update world lore',
      });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /api/campaigns/:campaignId/world-building/lore/:id ───────────────
// Delete a world lore entry

router.delete(
  '/api/campaigns/:campaignId/world-building/lore/:loreId',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('loreId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, loreId } = req.params;

    const client = await getClient({ label: 'world-build.delete' });
    try {
      const viewer = await resolveCampaignViewerContext(client, campaignId, req.user.id);
      ensureDmControl(viewer, 'Only the campaign director can manage world lore.');
      const deleted = await deleteWorldLore(loreId);
      if (!deleted) {
        return res.status(404).json({ error: 'Lore entry not found' });
      }
      return res.json({ deleted: true });
    } catch (error) {
      logError('Failed to delete world lore', error, { campaignId, loreId });
      return res.status(error.status || 500).json({ error: 'Failed to delete world lore' });
    } finally {
      client.release();
    }
  },
);

export const registerWorldBuildingRoutes = (app) => {
  app.use(router);
};
