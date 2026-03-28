import { query } from '../../db/pool.js';
import { hashPassword } from '../../auth-middleware.js';

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
    const err = new Error(\1); err.status = \2; throw err;
  }

  if (userId === adminId) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const result = await query(
    `UPDATE user_profiles SET status = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username, email, roles, status`,
    [status, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  return result.rows[0];
}

/**
 * Update user roles.
 */
export async function updateUserRoles(userId, roles, adminId) {
  const validRoles = ['player', 'dm', 'admin'];
  if (!Array.isArray(roles) || roles.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const invalid = roles.filter((r) => !validRoles.includes(r));
  if (invalid.length > 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  if (userId === adminId && !roles.includes('admin')) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const result = await query(
    `UPDATE user_profiles SET roles = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username, email, roles, status`,
    [roles, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  return result.rows[0];
}

/**
 * Create a new user.
 */
export async function createUser({ username, email, password, roles }) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    const err = new Error(\1); err.status = \2; throw err;
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    const err = new Error(\1); err.status = \2; throw err;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const validRoles = ['player', 'dm', 'admin'];
  const normalizedRoles = Array.isArray(roles)
    ? roles.filter((r) => validRoles.includes(r))
    : ['player'];
  if (normalizedRoles.length === 0) normalizedRoles.push('player');

  const existing = await query(
    `SELECT id FROM user_profiles WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)`,
    [email.trim(), username.trim()]
  );
  if (existing.rows.length > 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const passwordHash = await hashPassword(password);

  const result = await query(
    `INSERT INTO user_profiles (username, email, password_hash, roles, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
     RETURNING id, username, email, roles, status, created_at, last_login`,
    [username.trim(), email.trim(), passwordHash, normalizedRoles]
  );

  return result.rows[0];
}

/**
 * Update user details (username, email, roles).
 */
export async function updateUser(userId, { username, email, roles }, adminId) {
  const sets = [];
  const params = [];
  let paramIndex = 1;

  if (username !== undefined) {
    sets.push(`username = $${paramIndex++}`);
    params.push(username.trim());
  }
  if (email !== undefined) {
    sets.push(`email = $${paramIndex++}`);
    params.push(email.trim());
  }
  if (roles !== undefined) {
    const validRoles = ['player', 'dm', 'admin'];
    const normalizedRoles = Array.isArray(roles) ? roles.filter((r) => validRoles.includes(r)) : [];
    if (normalizedRoles.length === 0) {
      const err = new Error(\1); err.status = \2; throw err;
    }
    if (userId === adminId && !normalizedRoles.includes('admin')) {
      const err = new Error(\1); err.status = \2; throw err;
    }
    sets.push(`roles = $${paramIndex++}`);
    params.push(normalizedRoles);
  }

  if (sets.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  sets.push('updated_at = NOW()');
  params.push(userId);

  const result = await query(
    `UPDATE user_profiles SET ${sets.join(', ')} WHERE id = $${paramIndex}
     RETURNING id, username, email, roles, status, created_at, last_login`,
    params
  );

  if (result.rows.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  return result.rows[0];
}

/**
 * Delete a user.
 */
export async function deleteUser(userId, adminId) {
  if (userId === adminId) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const result = await query(
    `DELETE FROM user_profiles WHERE id = $1 RETURNING id, username`,
    [userId]
  );

  if (result.rows.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  return result.rows[0];
}

/**
 * Reset a user's password (admin action).
 */
export async function resetUserPassword(userId, newPassword, adminId) {
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  if (userId === adminId) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  const passwordHash = await hashPassword(newPassword);

  const result = await query(
    `UPDATE user_profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username`,
    [passwordHash, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error(\1); err.status = \2; throw err;
  }

  return result.rows[0];
}
