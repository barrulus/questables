import type { User } from '../database/data-structures';
import {
  fetchJson,
  buildJsonRequestInit,
  ensurePayload,
  type ApiRequestOptions,
} from '../api-client';
import { mapUserFromServer } from './users';

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken?: string;
}

export interface LoginRequest {
  email: string;
  password?: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password?: string;
  roles?: string[];
}

const mapAuthResponse = (payload: Record<string, unknown>): AuthResponse => {
  if (typeof payload.token !== 'string' || !payload.token) {
    throw new Error('Authentication response missing token');
  }

  if (!payload.user || typeof payload.user !== 'object') {
    throw new Error('Authentication response missing user payload');
  }

  const user = mapUserFromServer(payload.user as Record<string, unknown>);
  const refreshToken = typeof payload.refreshToken === 'string' ? payload.refreshToken : undefined;

  return {
    user,
    token: payload.token,
    refreshToken,
  };
};

export async function login(
  credentials: LoginRequest,
  options: ApiRequestOptions = {},
): Promise<AuthResponse> {
  const data = await fetchJson<Record<string, unknown>>(
    '/api/auth/login',
    buildJsonRequestInit('POST', credentials, options),
    'Failed to log in',
  );

  const payload = ensurePayload(data, 'Authentication response missing payload');
  return mapAuthResponse(payload);
}

export async function register(
  payload: RegisterRequest,
  options: ApiRequestOptions = {},
): Promise<AuthResponse> {
  const body = {
    username: payload.username,
    email: payload.email,
    password: payload.password,
    roles: payload.roles && payload.roles.length > 0 ? payload.roles : ['player'],
  };

  const data = await fetchJson<Record<string, unknown>>(
    '/api/auth/register',
    buildJsonRequestInit('POST', body, options),
    'Failed to register account',
  );

  const response = ensurePayload(data, 'Registration response missing payload');
  return mapAuthResponse(response);
}
