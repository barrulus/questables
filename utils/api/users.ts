import type { User } from '../database/data-structures';
import {
  fetchJson,
  buildJsonRequestInit,
  ensurePayload,
  type ApiRequestOptions,
} from '../api-client';

const ROLE_PRIORITY: Array<User['roles'][number]> = ['admin', 'dm', 'player'];

const normalizeRoles = (candidate: unknown): User['roles'] => {
  const collected = new Set<User['roles'][number]>();

  const register = (value: unknown) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(register);
      return;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase().trim();
      if (normalized === 'admin' || normalized === 'dm' || normalized === 'player') {
        collected.add(normalized as User['roles'][number]);
      }
    }
  };

  register(candidate);
  collected.add('player');

  return ROLE_PRIORITY.filter((role) => collected.has(role));
};

export const mapUserFromServer = (payload: Record<string, unknown>): User => {
  const roles = normalizeRoles(payload.roles ?? payload.role);
  const primaryRole = roles.find((role) => role !== 'player') ?? 'player';

  const id = typeof payload.id === 'string' ? payload.id : String(payload.id ?? '');
  const username = typeof payload.username === 'string' ? payload.username : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const status = typeof payload.status === 'string' ? payload.status : 'active';
  const avatarUrl = typeof payload.avatar_url === 'string' ? payload.avatar_url : null;
  const timezone = typeof payload.timezone === 'string' ? payload.timezone : null;
  const createdAt = typeof payload.created_at === 'string' ? payload.created_at : null;
  const updatedAt = typeof payload.updated_at === 'string' ? payload.updated_at : null;
  const lastLogin = typeof payload.last_login === 'string' ? payload.last_login : null;

  return {
    id,
    username,
    email,
    roles,
    role: primaryRole,
    status,
    avatar_url: avatarUrl,
    timezone,
    created_at: createdAt ?? '',
    updated_at: updatedAt ?? '',
    last_login: lastLogin ?? undefined,
    createdAt: createdAt ?? undefined,
    updatedAt: updatedAt ?? undefined,
    lastLogin: lastLogin ?? undefined,
  };
};

export interface UserProfileUpdatePayload {
  username?: string;
  avatarUrl?: string | null;
  timezone?: string | null;
}

const buildUpdateBody = (payload: UserProfileUpdatePayload): Record<string, unknown> => {
  const body: Record<string, unknown> = {};

  if (payload.username !== undefined) {
    body.username = payload.username?.trim() || null;
  }

  if (payload.avatarUrl !== undefined) {
    const normalized = payload.avatarUrl === null ? null : payload.avatarUrl?.trim() || null;
    body.avatarUrl = normalized;
  }

  if (payload.timezone !== undefined) {
    const normalized = payload.timezone === null ? null : payload.timezone?.trim() || null;
    body.timezone = normalized;
  }

  return body;
};

export async function fetchCurrentUser(options: ApiRequestOptions = {}): Promise<User> {
  const data = await fetchJson<{ user?: Record<string, unknown> }>(
    '/api/users/profile',
    { method: 'GET', signal: options.signal },
    'Failed to load user profile',
  );

  const payload = ensurePayload(data, 'User profile response missing payload');
  if (!payload.user) {
    throw new Error('User profile response did not include user details');
  }

  return mapUserFromServer(payload.user);
}

export async function updateCurrentUser(
  updates: UserProfileUpdatePayload,
  options: ApiRequestOptions = {},
): Promise<User> {
  const body = buildUpdateBody(updates);

  const data = await fetchJson<{ user?: Record<string, unknown> }>(
    '/api/users/profile',
    buildJsonRequestInit('PUT', body, options),
    'Failed to update user profile',
  );

  const payload = ensurePayload(data, 'User profile update response missing payload');
  if (!payload.user) {
    throw new Error('User profile update response did not include user details');
  }

  return mapUserFromServer(payload.user);
}
