import { Router } from 'express';
import { requireAuth } from '../auth-middleware.js';
import { getUserProfile, updateUserProfile, serializeUserForClient } from '../services/users/service.js';
import { logError, logInfo } from '../utils/logger.js';

const router = Router();

router.get('/profile', requireAuth, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      error: 'authentication_required',
      message: 'User authentication is required',
    });
  }

  try {
    const profile = await getUserProfile(userId);

    if (!profile) {
      return res.status(404).json({
        error: 'user_not_found',
        message: 'User profile could not be located',
      });
    }

    logInfo('User profile fetched', {
      telemetryEvent: 'users.profile.fetched',
      userId,
    });

    return res.json({ user: serializeUserForClient(profile) });
  } catch (error) {
    logError('User profile fetch failed', error, { userId });
    return res.status(500).json({
      error: 'profile_fetch_failed',
      message: 'Failed to load user profile',
    });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      error: 'authentication_required',
      message: 'User authentication is required',
    });
  }

  const updates = req.body ?? {};

  try {
    const profile = await updateUserProfile(userId, updates);

    if (!profile) {
      return res.status(404).json({
        error: 'user_not_found',
        message: 'User profile could not be located',
      });
    }

    logInfo('User profile updated', {
      telemetryEvent: 'users.profile.updated',
      userId,
      fields: Object.keys(updates ?? {}),
    });

    return res.json({ user: serializeUserForClient(profile) });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({
        error: error.code ?? 'profile_update_failed',
        message: error.message ?? 'Failed to update user profile',
      });
    }

    logError('User profile update failed', error, {
      userId,
      fields: Object.keys(updates ?? {}),
    });

    return res.status(500).json({
      error: 'profile_update_failed',
      message: 'Failed to update user profile',
    });
  }
});

export const registerUserRoutes = (app) => {
  app.use('/api/users', router);
};
