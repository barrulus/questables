import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { logError, logInfo } from '../utils/logger.js';
import {
  listUsers,
  getUserDetail,
  updateUserStatus,
  updateUserRoles,
} from '../services/admin/users.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/users', async (req, res) => {
  try {
    const { search, status, limit, offset } = req.query;
    const result = await listUsers({
      search,
      status,
      limit: limit ? Math.min(parseInt(limit, 10) || 25, 100) : 25,
      offset: offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    });
    res.json(result);
  } catch (error) {
    logError('Failed to list users', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const user = await getUserDetail(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    logError('Failed to get user detail', error);
    res.status(500).json({ error: 'Failed to get user detail' });
  }
});

router.patch('/users/:userId/status', async (req, res) => {
  try {
    const { status } = req.body ?? {};
    const user = await updateUserStatus(req.params.userId, status, req.user.id);
    logInfo('Admin updated user status', {
      telemetryEvent: 'admin.user.status_change',
      adminId: req.user.id,
      targetUserId: req.params.userId,
      newStatus: status,
    });
    res.json(user);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logError('Failed to update user status', error);
    res.status(statusCode).json({ error: error.message || 'Failed to update user status' });
  }
});

router.patch('/users/:userId/roles', async (req, res) => {
  try {
    const { roles } = req.body ?? {};
    const user = await updateUserRoles(req.params.userId, roles, req.user.id);
    logInfo('Admin updated user roles', {
      telemetryEvent: 'admin.user.role_change',
      adminId: req.user.id,
      targetUserId: req.params.userId,
      newRoles: roles,
    });
    res.json(user);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logError('Failed to update user roles', error);
    res.status(statusCode).json({ error: error.message || 'Failed to update user roles' });
  }
});

export const registerAdminRoutes = (app) => {
  app.use('/api/admin', router);
};
