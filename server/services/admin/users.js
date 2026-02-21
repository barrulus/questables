import { query } from '../../db/pool.js';

/**
 * List users with optional search, status filter, and pagination.
 */
export async function listUsers({ search, status, limit = 25, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (search && typeof search === 'string' && search.trim()) {
    conditions.push(`(username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${search.trim()}%`);
    paramIndex++;
  }

  if (status && typeof status === 'string' && status.trim()) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status.trim());
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM user_profiles ${whereClause}`,
    params
  );

  const total = countResult.rows[0]?.total ?? 0;

  const dataResult = await query(
    `SELECT id, username, email, roles, status, created_at, last_login
       FROM user_profiles
       ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return { users: dataResult.rows, total };
}

/**
 * Get detailed info for a single user.
 */
export async function getUserDetail(userId) {
  const userResult = await query(
    `SELECT id, username, email, roles, status, avatar_url, timezone, created_at, updated_at, last_login
       FROM user_profiles
      WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const user = userResult.rows[0];

  const [campaignCount, characterCount] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS count FROM campaign_players WHERE user_id = $1`,
      [userId]
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM characters WHERE user_id = $1`,
      [userId]
    ),
  ]);

  return {
    ...user,
    campaignCount: campaignCount.rows[0]?.count ?? 0,
    characterCount: characterCount.rows[0]?.count ?? 0,
  };
}

/**
 * Update user account status.
 */
export async function updateUserStatus(userId, status, adminId) {
  const validStatuses = ['active', 'inactive', 'banned'];
  if (!validStatuses.includes(status)) {
    throw Object.assign(new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`), { statusCode: 400 });
  }

  if (userId === adminId) {
    throw Object.assign(new Error('Cannot change your own account status'), { statusCode: 400 });
  }

  const result = await query(
    `UPDATE user_profiles SET status = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username, email, roles, status`,
    [status, userId]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  return result.rows[0];
}

/**
 * Update user roles.
 */
export async function updateUserRoles(userId, roles, adminId) {
  const validRoles = ['player', 'dm', 'admin'];
  if (!Array.isArray(roles) || roles.length === 0) {
    throw Object.assign(new Error('Roles must be a non-empty array'), { statusCode: 400 });
  }

  const invalid = roles.filter((r) => !validRoles.includes(r));
  if (invalid.length > 0) {
    throw Object.assign(new Error(`Invalid roles: ${invalid.join(', ')}. Must be one of: ${validRoles.join(', ')}`), { statusCode: 400 });
  }

  if (userId === adminId && !roles.includes('admin')) {
    throw Object.assign(new Error('Cannot remove admin role from your own account'), { statusCode: 400 });
  }

  const result = await query(
    `UPDATE user_profiles SET roles = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username, email, roles, status`,
    [roles, userId]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  return result.rows[0];
}
