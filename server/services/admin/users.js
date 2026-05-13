import { query } from '../../db/pool.js';
import { decryptField, encryptField, hmacLookup } from '../../crypto.js';
import { createEnrolmentToken } from '../auth/webauthn.js';

const decryptUserRow = (row) => {
  if (!row) return row;
  return {
    ...row,
    username: decryptField(row.username),
    email: decryptField(row.email),
  };
};

const matchesSearch = (row, term) => {
  if (!term) return true;
  const haystack = `${row.username ?? ''} ${row.email ?? ''}`.toLowerCase();
  return haystack.includes(term);
};

/**
 * List users with optional search, status filter, and pagination.
 * Search runs in Node (post-decrypt) since email/username are encrypted at rest.
 */
export async function listUsers({ search, status, limit = 25, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (status && typeof status === 'string' && status.trim()) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status.trim());
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const dataResult = await query(
    `SELECT id, username, email, roles, status, created_at, last_login
       FROM user_profiles
       ${whereClause}
      ORDER BY created_at DESC`,
    params,
  );

  const decrypted = dataResult.rows.map(decryptUserRow);
  const term = typeof search === 'string' ? search.trim().toLowerCase() : '';
  const filtered = term ? decrypted.filter((row) => matchesSearch(row, term)) : decrypted;

  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  return { users: paged, total };
}

/**
 * Get detailed info for a single user.
 */
export async function getUserDetail(userId) {
  const userResult = await query(
    `SELECT id, username, email, roles, status, avatar_url, timezone, created_at, updated_at, last_login
       FROM user_profiles
      WHERE id = $1`,
    [userId],
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const user = decryptUserRow(userResult.rows[0]);

  const [campaignCount, characterCount, passkeyCount] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM campaign_players WHERE user_id = $1`, [userId]),
    query(`SELECT COUNT(*)::int AS count FROM characters WHERE user_id = $1`, [userId]),
    query(`SELECT COUNT(*)::int AS count FROM webauthn_credentials WHERE user_id = $1`, [userId]),
  ]);

  return {
    ...user,
    campaignCount: campaignCount.rows[0]?.count ?? 0,
    characterCount: characterCount.rows[0]?.count ?? 0,
    passkeyCount: passkeyCount.rows[0]?.count ?? 0,
  };
}

/**
 * Update user account status.
 */
export async function updateUserStatus(userId, status, adminId) {
  const validStatuses = ['active', 'inactive', 'banned'];
  if (!validStatuses.includes(status)) {
    throw Object.assign(new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`), { status: 400 });
  }

  if (userId === adminId) {
    throw Object.assign(new Error('Cannot change your own account status'), { status: 400 });
  }

  const result = await query(
    `UPDATE user_profiles SET status = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username, email, roles, status`,
    [status, userId],
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  return decryptUserRow(result.rows[0]);
}

/**
 * Update user roles.
 */
export async function updateUserRoles(userId, roles, adminId) {
  const validRoles = ['player', 'dm', 'admin'];
  if (!Array.isArray(roles) || roles.length === 0) {
    throw Object.assign(new Error('Roles must be a non-empty array'), { status: 400 });
  }

  const invalid = roles.filter((r) => !validRoles.includes(r));
  if (invalid.length > 0) {
    throw Object.assign(new Error(`Invalid roles: ${invalid.join(', ')}. Must be one of: ${validRoles.join(', ')}`), { status: 400 });
  }

  if (userId === adminId && !roles.includes('admin')) {
    throw Object.assign(new Error('Cannot remove admin role from your own account'), { status: 400 });
  }

  const result = await query(
    `UPDATE user_profiles SET roles = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, username, email, roles, status`,
    [roles, userId],
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  return decryptUserRow(result.rows[0]);
}

/**
 * Create a new user. With passkey-only auth there is no password — we return an
 * enrolment token URL fragment that the admin will hand to the new user.
 */
export async function createUser({ username, email, roles }, adminId) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    throw Object.assign(new Error('Username is required'), { status: 400 });
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw Object.assign(new Error('Email is required'), { status: 400 });
  }

  const validRoles = ['player', 'dm', 'admin'];
  const normalizedRoles = Array.isArray(roles)
    ? roles.filter((r) => validRoles.includes(r))
    : ['player'];
  if (normalizedRoles.length === 0) normalizedRoles.push('player');

  const trimmedUsername = username.trim();
  const trimmedEmail = email.trim();
  const usernameLookup = hmacLookup(trimmedUsername);
  const emailLookup = hmacLookup(trimmedEmail);

  const existing = await query(
    `SELECT id FROM user_profiles WHERE email_lookup = $1 OR username_lookup = $2`,
    [emailLookup, usernameLookup],
  );
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('A user with that email or username already exists'), { status: 409 });
  }

  const result = await query(
    `INSERT INTO user_profiles
       (username, username_lookup, email, email_lookup, roles, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
     RETURNING id, username, email, roles, status, created_at, last_login`,
    [
      encryptField(trimmedUsername),
      usernameLookup,
      encryptField(trimmedEmail),
      emailLookup,
      normalizedRoles,
    ],
  );

  const created = decryptUserRow(result.rows[0]);
  const enrolment = await createEnrolmentToken({ userId: created.id, createdBy: adminId });

  return { ...created, enrolment };
}

/**
 * Update user details (username, email, roles).
 */
export async function updateUser(userId, { username, email, roles }, adminId) {
  const sets = [];
  const params = [];
  let paramIndex = 1;

  if (username !== undefined) {
    const trimmed = username.trim();
    sets.push(`username = $${paramIndex++}`);
    params.push(encryptField(trimmed));
    sets.push(`username_lookup = $${paramIndex++}`);
    params.push(hmacLookup(trimmed));
  }
  if (email !== undefined) {
    const trimmed = email.trim();
    sets.push(`email = $${paramIndex++}`);
    params.push(encryptField(trimmed));
    sets.push(`email_lookup = $${paramIndex++}`);
    params.push(hmacLookup(trimmed));
  }
  if (roles !== undefined) {
    const validRoles = ['player', 'dm', 'admin'];
    const normalizedRoles = Array.isArray(roles) ? roles.filter((r) => validRoles.includes(r)) : [];
    if (normalizedRoles.length === 0) {
      throw Object.assign(new Error('Roles must contain at least one valid role'), { status: 400 });
    }
    if (userId === adminId && !normalizedRoles.includes('admin')) {
      throw Object.assign(new Error('Cannot remove admin role from your own account'), { status: 400 });
    }
    sets.push(`roles = $${paramIndex++}`);
    params.push(normalizedRoles);
  }

  if (sets.length === 0) {
    throw Object.assign(new Error('No fields to update'), { status: 400 });
  }

  sets.push('updated_at = NOW()');
  params.push(userId);

  const result = await query(
    `UPDATE user_profiles SET ${sets.join(', ')} WHERE id = $${paramIndex}
     RETURNING id, username, email, roles, status, created_at, last_login`,
    params,
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  return decryptUserRow(result.rows[0]);
}

/**
 * Delete a user.
 */
export async function deleteUser(userId, adminId) {
  if (userId === adminId) {
    throw Object.assign(new Error('Cannot delete your own account'), { status: 400 });
  }

  const result = await query(
    `DELETE FROM user_profiles WHERE id = $1 RETURNING id, username`,
    [userId],
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  return { id: result.rows[0].id, username: decryptField(result.rows[0].username) };
}

/**
 * Issue a fresh enrolment token for a user. Use when a user has lost all their
 * passkeys (or for the initial onboarding of an existing account).
 */
export async function issueEnrolmentToken(userId, adminId) {
  const exists = await query(`SELECT id FROM user_profiles WHERE id = $1`, [userId]);
  if (exists.rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }
  return createEnrolmentToken({ userId, createdBy: adminId });
}
