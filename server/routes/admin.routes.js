import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { logError, logInfo } from '../utils/logger.js';
import {
  listUsers,
  getUserDetail,
  updateUserStatus,
  updateUserRoles,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
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

router.post('/users', async (req, res) => {
  try {
    const { username, email, password, roles } = req.body ?? {};
    const user = await createUser({ username, email, password, roles });
    logInfo('Admin created user', {
      telemetryEvent: 'admin.user.create',
      adminId: req.user.id,
      newUserId: user.id,
    });
    res.status(201).json(user);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logError('Failed to create user', error);
    res.status(statusCode).json({ error: error.message || 'Failed to create user' });
  }
});

router.put('/users/:userId', async (req, res) => {
  try {
    const { username, email, roles } = req.body ?? {};
    const user = await updateUser(req.params.userId, { username, email, roles }, req.user.id);
    logInfo('Admin updated user', {
      telemetryEvent: 'admin.user.update',
      adminId: req.user.id,
      targetUserId: req.params.userId,
    });
    res.json(user);
  } catch (error) {
    let statusCode = error.statusCode || 500;
    let message = error.message || 'Failed to update user';
    if (error.code === '23505') {
      statusCode = 409;
      message = 'A user with that email or username already exists';
    }
    logError('Failed to update user', error);
    res.status(statusCode).json({ error: message });
  }
});

router.delete('/users/:userId', async (req, res) => {
  try {
    const deleted = await deleteUser(req.params.userId, req.user.id);
    logInfo('Admin deleted user', {
      telemetryEvent: 'admin.user.delete',
      adminId: req.user.id,
      deletedUserId: req.params.userId,
      deletedUsername: deleted.username,
    });
    res.json({ success: true, ...deleted });
  } catch (error) {
    let statusCode = error.statusCode || 500;
    let message = error.message || 'Failed to delete user';
    if (error.code === '23503') {
      statusCode = 409;
      message = 'Cannot delete this user because they have associated campaigns, characters, or other data. Remove those first.';
    }
    logError('Failed to delete user', error);
    res.status(statusCode).json({ error: message });
  }
});

router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const { password } = req.body ?? {};
    const result = await resetUserPassword(req.params.userId, password, req.user.id);
    logInfo('Admin reset user password', {
      telemetryEvent: 'admin.user.password_reset',
      adminId: req.user.id,
      targetUserId: req.params.userId,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logError('Failed to reset user password', error);
    res.status(statusCode).json({ error: error.message || 'Failed to reset password' });
  }
});

export const registerAdminRoutes = (app) => {
  app.use('/api/admin', router);
};
