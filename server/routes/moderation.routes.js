import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { logError, logInfo } from '../utils/logger.js';
import { query } from '../db/pool.js';

const router = Router();

// Submit a report (any authenticated user)
router.post('/api/reports', requireAuth, async (req, res) => {
  const { reportedUserId, campaignId, reportType, description } = req.body ?? {};

  const validTypes = ['harassment', 'cheating', 'spam', 'inappropriate_content', 'other'];
  if (!validTypes.includes(reportType)) {
    return res.status(400).json({ error: `Invalid report type. Must be one of: ${validTypes.join(', ')}` });
  }

  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }

  try {
    const { rows } = await query(
      `INSERT INTO moderation_reports (reporter_id, reported_user_id, campaign_id, report_type, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, report_type, status, created_at`,
      [req.user.id, reportedUserId || null, campaignId || null, reportType, description.trim()]
    );

    logInfo('Moderation report submitted', {
      telemetryEvent: 'moderation.report.created',
      reportId: rows[0].id,
      reporterId: req.user.id,
      reportType,
    });

    res.status(201).json(rows[0]);
  } catch (error) {
    logError('Failed to submit report', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// Admin: list reports
router.get('/api/admin/moderation/reports', requireAuth, requireRole('admin'), async (req, res) => {
  const { status, limit = '25', offset = '0' } = req.query;

  try {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status && typeof status === 'string' && status.trim()) {
      conditions.push(`r.status = $${paramIndex}`);
      params.push(status.trim());
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM moderation_reports r ${whereClause}`,
      params
    );

    const parsedLimit = Math.min(parseInt(limit, 10) || 25, 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const { rows } = await query(
      `SELECT r.id, r.report_type, r.description, r.status, r.admin_notes,
              r.created_at, r.resolved_at,
              reporter.username AS reporter_username,
              reported.username AS reported_username,
              resolver.username AS resolved_by_username
         FROM moderation_reports r
         LEFT JOIN user_profiles reporter ON r.reporter_id = reporter.id
         LEFT JOIN user_profiles reported ON r.reported_user_id = reported.id
         LEFT JOIN user_profiles resolver ON r.resolved_by = resolver.id
         ${whereClause}
        ORDER BY r.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parsedLimit, parsedOffset]
    );

    res.json({
      reports: rows,
      total: countResult.rows[0]?.total ?? 0,
    });
  } catch (error) {
    logError('Failed to list moderation reports', error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// Admin: update report (resolve/dismiss)
router.patch('/api/admin/moderation/reports/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { status, adminNotes } = req.body ?? {};

  const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;

      if (status === 'resolved' || status === 'dismissed') {
        updates.push(`resolved_by = $${paramIndex}`);
        params.push(req.user.id);
        paramIndex++;
        updates.push(`resolved_at = NOW()`);
      }
    }

    if (typeof adminNotes === 'string') {
      updates.push(`admin_notes = $${paramIndex}`);
      params.push(adminNotes);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE moderation_reports SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, report_type, status, admin_notes, resolved_at`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    logInfo('Moderation report updated', {
      telemetryEvent: 'moderation.report.updated',
      reportId: id,
      adminId: req.user.id,
      newStatus: status,
    });

    res.json(rows[0]);
  } catch (error) {
    logError('Failed to update moderation report', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

export const registerModerationRoutes = (app) => {
  app.use(router);
};
