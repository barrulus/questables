/**
 * NPC Shop routes — shop CRUD, inventory management, purchases.
 */

import { Router } from 'express';
import { body, param } from 'express-validator';
import { requireAuth } from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import { handleValidationErrors } from '../validation/common.js';
import {
  ensureDmControl,
  getViewerContextOrThrow,
} from '../services/campaigns/service.js';
import {
  createShop,
  listShops,
  getShopWithInventory,
  updateShop,
  deleteShop,
  addShopItem,
  updateShopItem,
  removeShopItem,
  purchaseItem,
} from '../services/shop/service.js';
import { logError } from '../utils/logger.js';

const router = Router();

// ── POST /api/campaigns/:id/shops ──────────────────────────────────────
router.post(
  '/api/campaigns/:campaignId/shops',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('name').isString().notEmpty(),
    body('shopType').optional().isString(),
    body('priceModifier').optional().isFloat({ min: 0.01, max: 99.99 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'shop.create' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can create shops.');
      const shop = await createShop(client, { campaignId, ...req.body });
      res.status(201).json(shop);
    } catch (error) {
      logError('Shop creation failed', error, { campaignId });
      res.status(error.status || 500).json({ error: error.code || 'shop_create_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:id/shops ───────────────────────────────────────
router.get(
  '/api/campaigns/:campaignId/shops',
  requireAuth,
  [param('campaignId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'shop.list' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      const isDm = viewer.role === 'dm' || viewer.role === 'co-dm' || viewer.isAdmin;
      const shops = await listShops(client, { campaignId, playerView: !isDm });
      res.json({ shops });
    } catch (error) {
      logError('Shop list failed', error, { campaignId });
      res.status(error.status || 500).json({ error: error.code || 'shop_list_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:id/shops/:shopId ───────────────────────────────
router.get(
  '/api/campaigns/:campaignId/shops/:shopId',
  requireAuth,
  [param('campaignId').isUUID(), param('shopId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, shopId } = req.params;
    const client = await getClient({ label: 'shop.get' });
    try {
      await getViewerContextOrThrow(client, campaignId, req.user);
      const shop = await getShopWithInventory(client, { shopId });
      if (!shop || shop.campaign_id !== campaignId) {
        return res.status(404).json({ error: 'shop_not_found' });
      }
      res.json(shop);
    } catch (error) {
      logError('Shop get failed', error, { campaignId, shopId });
      res.status(error.status || 500).json({ error: error.code || 'shop_get_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /api/campaigns/:id/shops/:shopId ───────────────────────────────
router.put(
  '/api/campaigns/:campaignId/shops/:shopId',
  requireAuth,
  [param('campaignId').isUUID(), param('shopId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, shopId } = req.params;
    const client = await getClient({ label: 'shop.update' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can update shops.');
      const shop = await updateShop(client, { shopId, updates: req.body });
      res.json(shop);
    } catch (error) {
      logError('Shop update failed', error, { campaignId, shopId });
      res.status(error.status || 500).json({ error: error.code || 'shop_update_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /api/campaigns/:id/shops/:shopId ────────────────────────────
router.delete(
  '/api/campaigns/:campaignId/shops/:shopId',
  requireAuth,
  [param('campaignId').isUUID(), param('shopId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, shopId } = req.params;
    const client = await getClient({ label: 'shop.delete' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can delete shops.');
      await deleteShop(client, { shopId });
      res.json({ success: true });
    } catch (error) {
      logError('Shop delete failed', error, { campaignId, shopId });
      res.status(error.status || 500).json({ error: error.code || 'shop_delete_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/shops/:shopId/inventory ────────────────────
router.post(
  '/api/campaigns/:campaignId/shops/:shopId/inventory',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('shopId').isUUID(),
    body('itemKey').isString().notEmpty(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, shopId } = req.params;
    const client = await getClient({ label: 'shop.inventory.add' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can manage shop inventory.');
      const entry = await addShopItem(client, { shopId, ...req.body });
      res.status(201).json(entry);
    } catch (error) {
      logError('Shop inventory add failed', error, { campaignId, shopId });
      res.status(error.status || 500).json({ error: error.code || 'shop_inv_add_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /api/campaigns/:id/shops/:shopId/inventory/:entryId ────────────
router.put(
  '/api/campaigns/:campaignId/shops/:shopId/inventory/:entryId',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('shopId').isUUID(),
    param('entryId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, entryId } = req.params;
    const client = await getClient({ label: 'shop.inventory.update' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can manage shop inventory.');
      const entry = await updateShopItem(client, { entryId, ...req.body });
      res.json(entry);
    } catch (error) {
      logError('Shop inventory update failed', error, { campaignId, entryId });
      res.status(error.status || 500).json({ error: error.code || 'shop_inv_update_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /api/campaigns/:id/shops/:shopId/inventory/:entryId ─────────
router.delete(
  '/api/campaigns/:campaignId/shops/:shopId/inventory/:entryId',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('shopId').isUUID(),
    param('entryId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, entryId } = req.params;
    const client = await getClient({ label: 'shop.inventory.remove' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can manage shop inventory.');
      await removeShopItem(client, { entryId });
      res.json({ success: true });
    } catch (error) {
      logError('Shop inventory remove failed', error, { campaignId, entryId });
      res.status(error.status || 500).json({ error: error.code || 'shop_inv_remove_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/shops/:shopId/purchase ─────────────────────
router.post(
  '/api/campaigns/:campaignId/shops/:shopId/purchase',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('shopId').isUUID(),
    body('characterId').isUUID(),
    body('itemKey').isString().notEmpty(),
    body('quantity').optional().isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, shopId } = req.params;
    const { characterId, itemKey, quantity } = req.body;
    const client = await getClient({ label: 'shop.purchase' });
    try {
      await client.query('BEGIN');
      await getViewerContextOrThrow(client, campaignId, req.user);
      const result = await purchaseItem(client, { shopId, characterId, itemKey, quantity });
      await client.query('COMMIT');

      // Broadcast purchase event
      const wsServer = req.app?.locals?.wsServer;
      if (wsServer) {
        wsServer.broadcastToCampaign(campaignId, 'shop-purchase', {
          shopId,
          characterId,
          ...result,
          emittedAt: new Date().toISOString(),
        });
      }

      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('Shop purchase failed', error, { campaignId, shopId, characterId });
      res.status(error.status || 500).json({ error: error.code || 'purchase_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/shops/:shopId/auto-stock ────────────────────
router.post(
  '/api/campaigns/:campaignId/shops/:shopId/auto-stock',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('shopId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, shopId } = req.params;
    const client = await getClient({ label: 'shop.auto-stock' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can auto-stock shops.');

      // Get shop details for context
      const shop = await getShopWithInventory(client, { shopId });
      if (!shop || shop.campaign_id !== campaignId) {
        return res.status(404).json({ error: 'shop_not_found' });
      }

      const contextualService = req.app?.locals?.contextualLLMService;
      if (!contextualService) {
        return res.status(503).json({ error: 'llm_not_available', message: 'LLM service is not available' });
      }

      const { result } = await contextualService.generateFromContext({
        campaignId,
        sessionId: null,
        type: 'shop_auto_stock',
        metadata: { shopId, shopType: shop.shop_type },
        request: {
          extraSections: [
            { title: 'Shop Details', content: `Shop name: ${shop.name}\nShop type: ${shop.shop_type}\nLocation: ${shop.location_text || 'unknown'}\nPrice modifier: ${shop.price_modifier}` },
          ],
        },
      });

      // Parse the LLM response to get item suggestions
      let suggestions = [];
      try {
        const content = result.parsed || result.content;
        suggestions = typeof content === 'string' ? JSON.parse(content) : content;
        if (!Array.isArray(suggestions)) suggestions = [];
      } catch {
        return res.status(500).json({ error: 'llm_parse_failed', message: 'Failed to parse LLM suggestions' });
      }

      // Look up which items actually exist in SRD
      const added = [];
      for (const suggestion of suggestions) {
        if (!suggestion.itemKey) continue;
        const { rows } = await client.query(
          'SELECT key FROM public.srd_items WHERE key = $1 LIMIT 1',
          [suggestion.itemKey],
        );
        if (rows.length > 0) {
          const entry = await addShopItem(client, {
            shopId,
            itemKey: suggestion.itemKey,
            stockQuantity: suggestion.quantity ?? null,
          });
          added.push({ ...entry, reason: suggestion.reason });
        }
      }

      res.json({ added, suggestedCount: suggestions.length, addedCount: added.length });
    } catch (error) {
      logError('Shop auto-stock failed', error, { campaignId, shopId });
      res.status(error.status || 500).json({ error: error.code || 'auto_stock_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

export function registerShopRoutes(app) {
  app.use(router);
}

export default registerShopRoutes;
