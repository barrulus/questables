/**
 * Loot table routes — CRUD and rolling.
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
  createLootTable,
  listLootTables,
  getLootTableWithEntries,
  updateLootTable,
  deleteLootTable,
  addLootTableEntry,
  updateLootTableEntry,
  removeLootTableEntry,
  rollOnLootTable,
} from '../services/loot/service.js';
import { logError } from '../utils/logger.js';

const router = Router();

// ── POST /api/campaigns/:id/loot-tables ──────────────────────────────────
router.post(
  '/api/campaigns/:campaignId/loot-tables',
  requireAuth,
  [
    param('campaignId').isUUID(),
    body('name').isString().notEmpty(),
    body('tableType').optional().isString(),
    body('crMin').optional().isInt({ min: 0 }),
    body('crMax').optional().isInt({ min: 0 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'loot.create' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can create loot tables.');
      const table = await createLootTable(client, { campaignId, ...req.body });
      res.status(201).json(table);
    } catch (error) {
      logError('Loot table creation failed', error, { campaignId });
      res.status(error.status || 500).json({ error: error.code || 'loot_create_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:id/loot-tables ───────────────────────────────────
router.get(
  '/api/campaigns/:campaignId/loot-tables',
  requireAuth,
  [param('campaignId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient({ label: 'loot.list' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can view loot tables.');
      const tables = await listLootTables(client, { campaignId });
      res.json({ tables });
    } catch (error) {
      logError('Loot table list failed', error, { campaignId });
      res.status(error.status || 500).json({ error: error.code || 'loot_list_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/campaigns/:id/loot-tables/:tableId ──────────────────────────
router.get(
  '/api/campaigns/:campaignId/loot-tables/:tableId',
  requireAuth,
  [param('campaignId').isUUID(), param('tableId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, tableId } = req.params;
    const client = await getClient({ label: 'loot.get' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can view loot tables.');
      const table = await getLootTableWithEntries(client, { tableId });
      if (!table || table.campaign_id !== campaignId) {
        return res.status(404).json({ error: 'loot_table_not_found' });
      }
      res.json(table);
    } catch (error) {
      logError('Loot table get failed', error, { campaignId, tableId });
      res.status(error.status || 500).json({ error: error.code || 'loot_get_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /api/campaigns/:id/loot-tables/:tableId ──────────────────────────
router.put(
  '/api/campaigns/:campaignId/loot-tables/:tableId',
  requireAuth,
  [param('campaignId').isUUID(), param('tableId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, tableId } = req.params;
    const client = await getClient({ label: 'loot.update' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can update loot tables.');
      const table = await updateLootTable(client, { tableId, updates: req.body });
      res.json(table);
    } catch (error) {
      logError('Loot table update failed', error, { campaignId, tableId });
      res.status(error.status || 500).json({ error: error.code || 'loot_update_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /api/campaigns/:id/loot-tables/:tableId ───────────────────────
router.delete(
  '/api/campaigns/:campaignId/loot-tables/:tableId',
  requireAuth,
  [param('campaignId').isUUID(), param('tableId').isUUID()],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, tableId } = req.params;
    const client = await getClient({ label: 'loot.delete' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can delete loot tables.');
      await deleteLootTable(client, { tableId });
      res.json({ success: true });
    } catch (error) {
      logError('Loot table delete failed', error, { campaignId, tableId });
      res.status(error.status || 500).json({ error: error.code || 'loot_delete_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/loot-tables/:tableId/entries ─────────────────
router.post(
  '/api/campaigns/:campaignId/loot-tables/:tableId/entries',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('tableId').isUUID(),
    body('itemKey').optional().isString(),
    body('weight').optional().isInt({ min: 1 }),
    body('quantityMin').optional().isInt({ min: 1 }),
    body('quantityMax').optional().isInt({ min: 1 }),
    body('currencyAmount').optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, tableId } = req.params;
    const client = await getClient({ label: 'loot.entry.add' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can manage loot tables.');
      const entry = await addLootTableEntry(client, { tableId, ...req.body });
      res.status(201).json(entry);
    } catch (error) {
      logError('Loot table entry add failed', error, { campaignId, tableId });
      res.status(error.status || 500).json({ error: error.code || 'loot_entry_add_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /api/campaigns/:id/loot-tables/:tableId/entries/:entryId ─────────
router.put(
  '/api/campaigns/:campaignId/loot-tables/:tableId/entries/:entryId',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('tableId').isUUID(),
    param('entryId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, entryId } = req.params;
    const client = await getClient({ label: 'loot.entry.update' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can manage loot tables.');
      const entry = await updateLootTableEntry(client, { entryId, ...req.body });
      res.json(entry);
    } catch (error) {
      logError('Loot table entry update failed', error, { campaignId, entryId });
      res.status(error.status || 500).json({ error: error.code || 'loot_entry_update_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /api/campaigns/:id/loot-tables/:tableId/entries/:entryId ──────
router.delete(
  '/api/campaigns/:campaignId/loot-tables/:tableId/entries/:entryId',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('tableId').isUUID(),
    param('entryId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, entryId } = req.params;
    const client = await getClient({ label: 'loot.entry.remove' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can manage loot tables.');
      await removeLootTableEntry(client, { entryId });
      res.json({ success: true });
    } catch (error) {
      logError('Loot table entry remove failed', error, { campaignId, entryId });
      res.status(error.status || 500).json({ error: error.code || 'loot_entry_remove_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

// ── POST /api/campaigns/:id/loot-tables/:tableId/roll ────────────────────
router.post(
  '/api/campaigns/:campaignId/loot-tables/:tableId/roll',
  requireAuth,
  [
    param('campaignId').isUUID(),
    param('tableId').isUUID(),
    body('count').optional().isInt({ min: 1, max: 20 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId, tableId } = req.params;
    const { count } = req.body;
    const client = await getClient({ label: 'loot.roll' });
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the DM can roll on loot tables.');
      const results = await rollOnLootTable(client, { tableId, count });
      res.json({ results });
    } catch (error) {
      logError('Loot table roll failed', error, { campaignId, tableId });
      res.status(error.status || 500).json({ error: error.code || 'loot_roll_failed', message: error.message });
    } finally {
      client.release();
    }
  },
);

export function registerLootRoutes(app) {
  app.use(router);
}

export default registerLootRoutes;
