import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { logError, logInfo } from '../utils/logger.js';
import {
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  listAvailableModels,
} from '../services/admin/llm-providers.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.post('/providers', async (req, res) => {
  try {
    const provider = await createProvider(req.body ?? {});
    logInfo('LLM provider created', { name: provider.name, userId: req.user.id });
    res.status(201).json(provider);
  } catch (error) {
    logError('Failed to create LLM provider', error, { userId: req.user?.id });
    res.status(error.statusCode || 500).json({
      error: error.code || 'provider_create_failed',
      message: error.message || 'Failed to create LLM provider',
    });
  }
});

router.patch('/providers/:name', async (req, res) => {
  try {
    const provider = await updateProvider(req.params.name, req.body ?? {});
    logInfo('LLM provider updated', { name: req.params.name, userId: req.user.id });
    res.json(provider);
  } catch (error) {
    logError('Failed to update LLM provider', error, { name: req.params.name, userId: req.user?.id });
    res.status(error.statusCode || 500).json({
      error: error.code || 'provider_update_failed',
      message: error.message || 'Failed to update LLM provider',
    });
  }
});

router.delete('/providers/:name', async (req, res) => {
  try {
    const deleted = await deleteProvider(req.params.name);
    logInfo('LLM provider deleted', { name: req.params.name, userId: req.user.id });
    res.json({ deleted: true, name: deleted.name });
  } catch (error) {
    logError('Failed to delete LLM provider', error, { name: req.params.name, userId: req.user?.id });
    res.status(error.statusCode || 500).json({
      error: error.code || 'provider_delete_failed',
      message: error.message || 'Failed to delete LLM provider',
    });
  }
});

router.post('/providers/:name/default', async (req, res) => {
  try {
    const provider = await setDefaultProvider(req.params.name);
    logInfo('LLM default provider set', { name: req.params.name, userId: req.user.id });
    res.json(provider);
  } catch (error) {
    logError('Failed to set default LLM provider', error, { name: req.params.name, userId: req.user?.id });
    res.status(error.statusCode || 500).json({
      error: error.code || 'provider_default_failed',
      message: error.message || 'Failed to set default LLM provider',
    });
  }
});

router.get('/providers/:name/models', async (req, res) => {
  try {
    const registry = req.app?.locals?.llmRegistry;
    const models = await listAvailableModels(req.params.name, registry);
    res.json({ models });
  } catch (error) {
    logError('Failed to list available models', error, { name: req.params.name, userId: req.user?.id });
    res.status(error.statusCode || 500).json({
      error: error.code || 'models_list_failed',
      message: error.message || 'Failed to list available models',
    });
  }
});

router.post('/reload', async (req, res) => {
  try {
    const bootstrapFn = req.app?.locals?.bootstrapLLMServices;
    if (typeof bootstrapFn !== 'function') {
      return res.status(503).json({
        error: 'llm_reload_unavailable',
        message: 'LLM bootstrap function is not available',
      });
    }
    await bootstrapFn();
    logInfo('LLM services reloaded by admin', { userId: req.user.id });
    res.json({ reloaded: true });
  } catch (error) {
    logError('Failed to reload LLM services', error, { userId: req.user?.id });
    res.status(500).json({
      error: 'llm_reload_failed',
      message: error.message || 'Failed to reload LLM services',
    });
  }
});

export const registerAdminLLMRoutes = (app) => {
  app.use('/api/admin/llm', router);
};
