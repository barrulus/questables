import { query } from '../../db/pool.js';
import { logError } from '../../utils/logger.js';

const sanitizeRoles = (roles) => {
  const allowed = new Set(['player', 'dm', 'admin']);

  if (Array.isArray(roles)) {
    const normalized = roles
      .map((role) => (typeof role === 'string' ? role.toLowerCase().trim() : null))
      .filter((role) => role && allowed.has(role));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : ['player'];
  }

  if (typeof roles === 'string') {
    const normalized = roles.toLowerCase().trim();
    if (allowed.has(normalized)) {
      return [normalized];
    }
  }

  return ['player'];
};

const mapUserRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    roles: sanitizeRoles(row.roles),
    status: row.status,
    avatar_url: row.avatar_url ?? null,
    timezone: row.timezone ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login: row.last_login ?? null,
  };
};

export const getUserProfile = async (userId) => {
  try {
    const { rows } = await query(
      `SELECT id,
              username,
              email,
              roles,
              status,
              avatar_url,
              timezone,
              created_at,
              updated_at,
              last_login
         FROM user_profiles
        WHERE id = $1`,
      [userId],
      { label: 'users.profile.fetch' },
    );

    return mapUserRow(rows[0]);
  } catch (error) {
    logError('Failed to fetch user profile', error, { userId });
    throw error;
  }
};

const ALLOWED_UPDATE_FIELDS = new Map([
  ['username', 'username'],
  ['avatarUrl', 'avatar_url'],
  ['avatar_url', 'avatar_url'],
  ['timezone', 'timezone'],
]);

const coerceUpdateValue = (field, value) => {
  if (value === undefined) {
    return undefined;
  }

  if (field === 'username' && typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (field === 'timezone' && typeof value === 'string') {
    return value.trim();
  }

  if (field === 'avatar_url' && typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  return value;
};

export const updateUserProfile = async (userId, updates) => {
  const normalizedUpdates = updates ?? {};
  const assignments = [];
  const values = [];

  for (const [key, pgColumn] of ALLOWED_UPDATE_FIELDS.entries()) {
    if (!(key in normalizedUpdates)) {
      continue;
    }

    const value = coerceUpdateValue(pgColumn, normalizedUpdates[key]);
    if (value === undefined) {
      continue;
    }

    assignments.push(`${pgColumn} = $${assignments.length + 1}`);
    values.push(value);
  }

  if (assignments.length === 0) {
    return getUserProfile(userId);
  }

  values.push(userId);
  const paramIndex = assignments.length + 1;

  const updateText = `UPDATE user_profiles
                         SET ${assignments.join(', ')}, updated_at = NOW()
                       WHERE id = $${paramIndex}
                   RETURNING id,
                             username,
                             email,
                             roles,
                             status,
                             avatar_url,
                             timezone,
                             created_at,
                             updated_at,
                             last_login`;

  try {
    const { rows } = await query(updateText, values, { label: 'users.profile.update' });
    return mapUserRow(rows[0]);
  } catch (error) {
    logError('Failed to update user profile', error, {
      userId,
      fields: Object.keys(normalizedUpdates),
    });
    throw error;
  }
};

export const serializeUserForClient = (user) => {
  if (!user) {
    return null;
  }

  return {
    ...user,
    roles: sanitizeRoles(user.roles),
  };
};
