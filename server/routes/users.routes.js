import { Router } from 'express';
import { requireAuth } from '../auth-middleware.js';
import { getUserProfile, updateUserProfile, serializeUserForClient } from '../services/users/service.js';
import { listUserPasskeys, deleteUserPasskey } from '../services/auth/webauthn.js';
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

router.get('/me/passkeys', requireAuth, async (req, res) => {
  try {
    const passkeys = await listUserPasskeys(req.user.id);
    res.json({ passkeys });
  } catch (error) {
    logError('Failed to list passkeys', error, { userId: req.user.id });
    res.status(500).json({ error: 'passkeys_failed', message: 'Failed to load passkeys.' });
  }
});

router.delete('/me/passkeys/:id', requireAuth, async (req, res) => {
  try {
    const remaining = await listUserPasskeys(req.user.id);
    if (remaining.length <= 1) {
      return res.status(400).json({
        error: 'last_passkey',
        message: 'Cannot remove your only passkey. Add another first, or ask an admin for a fresh enrolment link.',
      });
    }
    await deleteUserPasskey(req.user.id, req.params.id);
    logInfo('Passkey removed', {
      telemetryEvent: 'auth.passkey.removed',
      userId: req.user.id,
      credentialId: req.params.id,
    });
    res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      logError('Failed to delete passkey', error, { userId: req.user.id });
    }
    res.status(status).json({ error: 'passkey_delete_failed', message: error.message || 'Failed to remove passkey.' });
  }
});

export const registerUserRoutes = (app) => {
  app.use('/api/users', router);
};
